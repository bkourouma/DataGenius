/**
 * Rapports programmes : un artefact envoye par e-mail, a heure fixe, a une liste
 * de destinataires (lot 5).
 *
 * - CRUD du proprietaire (le proprietaire est toujours dans le meme `where`).
 * - Traitement par la tache planifiee (`traiterRapportsEchus`) : chaque rapport
 *   echu est reserve par compare-and-set (idempotent), recalcule dans le
 *   perimetre de son PROPRIETAIRE, puis envoye a chaque destinataire dans sa
 *   langue, avec les fichiers en pieces jointes.
 *
 * HYPOTHESE H7 : un destinataire est un compte actif qui a acces a Medic Assist.
 * HYPOTHESE H8 : programmer un rapport PARTAGE l'artefact avec ses destinataires
 * (lecture seule, sans notification de partage : le rapport en tient lieu).
 * Un rapport dont le proprietaire a perdu l'acces est DESACTIVE (question ouverte).
 *
 * REPRISE (durcissement lot D) :
 * - La reservation pose un BAIL de 10 min (enCoursJusqua) ; prochainEnvoiA n'avance
 *   qu'a l'enregistrement du resultat. Un plantage laisse le bail expirer : le
 *   rapport redevient eligible et est repris (ce passage compte comme un essai).
 * - ok -> echeance suivante, essais 0.
 * - 'partiel' (au moins un destinataire servi, pas tous, ou destinataires ecartes
 *   par le perimetre) est TERMINAL : on avance l'echeance sans nouvel essai, pour
 *   ne pas renvoyer aux destinataires deja servis.
 * - Echecs reessayables (export_impossible, envoi_impossible = aucun destinataire
 *   servi, erreur_interne) : essais + 1, l'echeance n'avance pas (le rapport reste
 *   echu, repris ~15 min plus tard) ; a la 3e erreur on avance l'echeance, essais 0,
 *   et le proprietaire ainsi que les TenantAdmin actifs recoivent une notification
 *   in-app (pas d'e-mail).
 * - Echecs non reessayables (planning_invalide, proprietaire_sans_acces,
 *   artefact_introuvable, aucun_destinataire) : pas de reprise, l'echeance avance
 *   (ou le rapport est desactive) ; pas de notification.
 * - Notification in-app au destinataire : seulement quand son e-mail est parti.
 */

import { prisma } from '@/lib/db/client'
import { envoyerMail } from '@/lib/mail/transport'

import {
  TYPES_NOTIFICATION,
  type ContexteExecution,
  type FormatEnvoi,
  type ModifierRapportProgrammeCorps,
  type ParametresProgrammerRapport,
} from '@/lib/medic-assist/contrats'

import { chargerComptesAvecAcces, contexteDepuisCompte, validerDestinataires } from './comptes'
import { construireExport as construireExportParDefaut, type ConstruireExport } from './dependances'
import { destinataireCouvrePerimetre } from '@/lib/auth/data-access'
import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { prochainEnvoiA, validerPlanning, type Planning } from './echeances'
import { composerEmailRapport } from './emails-rapport'
import { ErreurSuivi, nomErreur } from './erreurs'
import { defaultLocale, isLocale, type Locale } from '@/i18n/config'
import { creerNotificationSuivi } from './notifications'
import { journal } from '@/lib/journal'
import { traducteurSuivi } from './emails'
import { exigerExpediteurProprietaire, exigerProprietaireArtefact } from './proprietaire'
import type { CompteResume, ModificationRapportProgramme, RapportProgrammeRow } from './types'

export interface DependancesRapports {
  depot?: DepotSuivi
}

/** Duree du bail pose a la reservation : un plantage libere le rapport apres ce delai. */
const DUREE_BAIL_MS = 10 * 60 * 1000
/** Essais rates (dont plantages) avant d'abandonner l'echeance et de notifier. */
const MAX_ESSAIS = 3

const log = journal.enfant({ domaine: 'rapports' })

// ---------------------------------------------------------------------------
// Formes JSON
// ---------------------------------------------------------------------------

export interface RapportProgrammeJson {
  id: string
  artefactId: string
  artefactTitre: string
  frequence: RapportProgrammeRow['frequence']
  jourSemaine: number | null
  jourMois: number | null
  /** 'HH:mm', heure de Paris. */
  heure: string
  /** Nom affiche ; '' si le compte n'existe plus ou n'a plus acces (l'ecran le traduit). */
  destinataires: { id: string; nom: string }[]
  formats: FormatEnvoi[]
  actif: boolean
  prochainEnvoiA: string | null
  dernierEnvoiA: string | null
  dernierStatut: RapportProgrammeRow['dernierStatut']
  derniereErreur: string | null
  creeLe: string
}

/** Corps d'un PATCH : valide par ModifierRapportProgrammeCorpsSchema du contrat (pas de copie locale). */
export type ModificationRapport = ModifierRapportProgrammeCorps

/** Ajoute les noms des destinataires (un seul aller-retour pour toute la liste). */
export async function rapportsEnJson(
  lignes: RapportProgrammeRow[]
): Promise<RapportProgrammeJson[]> {
  const ids = [...new Set(lignes.flatMap(r => r.destinataires))]
  const comptes = ids.length > 0 ? await chargerComptesAvecAcces({ ids }) : []
  const noms = new Map(comptes.map(c => [c.id, c.nom]))
  return lignes.map(r => ({
    id: r.id,
    artefactId: r.artefactId,
    artefactTitre: r.artefactTitre,
    frequence: r.frequence,
    jourSemaine: r.jourSemaine,
    jourMois: r.jourMois,
    heure: r.heure,
    destinataires: r.destinataires.map(id => ({ id, nom: noms.get(id) ?? '' })),
    formats: r.formats,
    actif: r.actif,
    prochainEnvoiA: r.prochainEnvoiA ? r.prochainEnvoiA.toISOString() : null,
    dernierEnvoiA: r.dernierEnvoiA ? r.dernierEnvoiA.toISOString() : null,
    dernierStatut: r.dernierStatut,
    derniereErreur: r.derniereErreur,
    creeLe: r.creeA.toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/** Les jours qui ne servent pas a la frequence sont remis a null. */
function planningNormalise(p: Planning): Planning & {
  jourSemaine: number | null
  jourMois: number | null
} {
  return {
    frequence: p.frequence,
    jourSemaine: p.frequence === 'hebdomadaire' ? (p.jourSemaine ?? null) : null,
    jourMois: p.frequence === 'mensuel' ? (p.jourMois ?? null) : null,
    heure: p.heure,
  }
}

async function comptesValides(ids: string[]): Promise<CompteResume[]> {
  const { comptes, refuses } = await validerDestinataires(ids)
  if (refuses.length > 0) {
    throw new ErreurSuivi(
      'destinataire_invalide',
      'destinataire inconnu, inactif ou sans acces a Medic Assist'
    )
  }
  return comptes
}

/**
 * H8 : l'artefact est partage (lecture seule) avec les destinataires, sans
 * notification. Seul le proprietaire partage : le controle passe AVANT tout effet.
 */
async function partagerAvecDestinataires(
  depot: DepotSuivi,
  expediteurId: string,
  artefact: { id: string; proprietaireId: string },
  comptes: CompteResume[]
): Promise<void> {
  exigerExpediteurProprietaire(artefact, expediteurId)
  const partages = comptes
    .filter(c => c.id !== expediteurId && c.id !== artefact.proprietaireId)
    .map(c => ({
      expediteurId,
      destinataireId: c.id,
      cibleType: 'artefact' as const,
      cibleId: artefact.id,
      message: null,
    }))
  if (partages.length > 0) await depot.creerPartages(partages)
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function creerRapportProgramme(
  contexte: ContexteExecution,
  parametres: ParametresProgrammerRapport,
  deps: DependancesRapports = {}
): Promise<RapportProgrammeRow> {
  const depot = deps.depot ?? obtenirDepot()
  validerPlanning(parametres)
  const planning = planningNormalise(parametres)

  // Seul le proprietaire programme un rapport : controle en tete, avant toute ecriture.
  const artefact = await exigerProprietaireArtefact(depot, parametres.artefactId, contexte.userId)

  const comptes = await comptesValides(parametres.destinataires)
  const prochain = prochainEnvoiA(planning, contexte.maintenant)

  await partagerAvecDestinataires(depot, contexte.userId, artefact, comptes)

  return depot.creerRapport({
    userId: contexte.userId,
    artefactId: artefact.id,
    frequence: planning.frequence,
    jourSemaine: planning.jourSemaine,
    jourMois: planning.jourMois,
    heure: planning.heure,
    destinataires: comptes.map(c => c.id),
    formats: [...new Set(parametres.formats)],
    prochainEnvoiA: prochain,
  })
}

export async function listerRapports(
  contexte: ContexteExecution,
  deps: DependancesRapports = {}
): Promise<RapportProgrammeJson[]> {
  const depot = deps.depot ?? obtenirDepot()
  return rapportsEnJson(await depot.listerRapports(contexte.userId))
}

export async function lireRapport(
  contexte: ContexteExecution,
  id: string,
  deps: DependancesRapports = {}
): Promise<RapportProgrammeJson> {
  const depot = deps.depot ?? obtenirDepot()
  const rapport = await depot.trouverRapport(id, contexte.userId)
  if (!rapport) throw new ErreurSuivi('introuvable')
  return (await rapportsEnJson([rapport]))[0]
}

export async function modifierRapport(
  contexte: ContexteExecution,
  id: string,
  modification: ModificationRapport,
  deps: DependancesRapports = {}
): Promise<RapportProgrammeJson> {
  const depot = deps.depot ?? obtenirDepot()
  const existant = await depot.trouverRapport(id, contexte.userId)
  if (!existant) throw new ErreurSuivi('introuvable')
  // Seul le proprietaire de l'artefact modifie un rapport : controle avant toute ecriture.
  const artefact = await exigerProprietaireArtefact(depot, existant.artefactId, contexte.userId)

  const planning = planningNormalise({
    frequence: modification.frequence ?? existant.frequence,
    jourSemaine:
      modification.jourSemaine !== undefined ? modification.jourSemaine : existant.jourSemaine,
    jourMois: modification.jourMois !== undefined ? modification.jourMois : existant.jourMois,
    heure: modification.heure ?? existant.heure,
  })
  validerPlanning(planning)

  const donnees: ModificationRapportProgramme = {}
  const planningChange =
    planning.frequence !== existant.frequence ||
    planning.jourSemaine !== existant.jourSemaine ||
    planning.jourMois !== existant.jourMois ||
    planning.heure !== existant.heure
  const reactive = modification.actif === true && !existant.actif

  if (planningChange) {
    donnees.frequence = planning.frequence
    donnees.jourSemaine = planning.jourSemaine
    donnees.jourMois = planning.jourMois
    donnees.heure = planning.heure
  }
  if (modification.actif !== undefined) donnees.actif = modification.actif
  if (planningChange || reactive) {
    donnees.prochainEnvoiA = prochainEnvoiA(planning, contexte.maintenant)
  }
  if (modification.formats) donnees.formats = [...new Set(modification.formats)]
  if (modification.destinataires) {
    const comptes = await comptesValides(modification.destinataires)
    donnees.destinataires = comptes.map(c => c.id)
    await partagerAvecDestinataires(depot, contexte.userId, artefact, comptes)
  }

  const misAJour =
    Object.keys(donnees).length > 0
      ? await depot.mettreAJourRapport(id, contexte.userId, donnees)
      : existant
  if (!misAJour) throw new ErreurSuivi('introuvable')
  return (await rapportsEnJson([misAJour]))[0]
}

export async function supprimerRapport(
  contexte: ContexteExecution,
  id: string,
  deps: DependancesRapports = {}
): Promise<void> {
  const depot = deps.depot ?? obtenirDepot()
  const supprime = await depot.supprimerRapport(id, contexte.userId)
  if (!supprime) throw new ErreurSuivi('introuvable')
}

// ---------------------------------------------------------------------------
// Traitement par la tache planifiee
// ---------------------------------------------------------------------------

export interface BilanRapports {
  /** Rapports echus lus. */
  echus: number
  /** Rapports envoyes a tous leurs destinataires. */
  envoyes: number
  /** Rapports envoyes a une partie seulement. */
  partiels: number
  echecs: number
  /** Deja pris par une autre execution. */
  ignores: number
  /** Rapports echus non traites faute de temps (budgetMs) : repris a l'appel suivant. */
  restants: number
}

export interface OptionsTraitementRapports {
  maintenant?: Date
  limite?: number
  depot?: DepotSuivi
  construireExport?: ConstruireExport
  envoyerMail?: typeof envoyerMail
  /**
   * Budget de temps (ms) : la boucle ne commence plus de rapport une fois ce temps
   * ecoule depuis son debut. Un rapport commence va jusqu'au bout ; les autres ne sont
   * pas reserves et seront repris a l'appel suivant.
   */
  budgetMs?: number
  /** Horloge en ms (tests). Par defaut Date.now. */
  horloge?: () => number
}

const LIMITE_PAR_DEFAUT = 50

type Issue = {
  statut: 'ok' | 'partiel' | 'echec'
  erreur: string | null
  /** Echec que le rapport peut retenter a l'appel suivant (export, SMTP, erreur interne). */
  reessayable?: boolean
}

/** Resultat de traiterUnRapport : l'issue, les essais deja rates et la prochaine echeance (si calculable). */
interface Traitement {
  issue: Issue
  essaisAvant: number
  nouveau: Date | null
}

async function nomDuCompte(userId: string): Promise<string> {
  const compte = await prisma.user.findFirst({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  })
  return compte ? `${compte.firstName} ${compte.lastName}`.trim() : ''
}

/** Langue de chaque destinataire (User.locale, repli defaultLocale) ; ne leve jamais. */
async function languesDesDestinataires(ids: string[]): Promise<Map<string, Locale>> {
  const langues = new Map<string, Locale>()
  try {
    const comptes = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, locale: true },
    })
    for (const compte of comptes) {
      langues.set(compte.id, isLocale(compte.locale) ? compte.locale : defaultLocale)
    }
  } catch (error) {
    log.erreur('Lecture des langues des destinataires impossible', {
      etape: 'langues_destinataires',
      nomErreur: nomErreur(error),
    })
  }
  return langues
}

/** Cree la notification d'echec definitif ; ne leve jamais. */
async function notifierEchecDefinitif(
  rapport: RapportProgrammeRow,
  depot: DepotSuivi
): Promise<void> {
  let destinataires: string[] = [rapport.userId]
  try {
    const admins = await depot.listerAdministrateursActifs()
    destinataires = [...new Set([rapport.userId, ...admins])]
  } catch (error) {
    log.erreur("Lecture des administrateurs impossible pour la notification d'échec", {
      rapportId: rapport.id,
      etape: 'lister_administrateurs',
      resultat: 'echec',
      nomErreur: nomErreur(error),
    })
  }
  const langues = await languesDesDestinataires(destinataires)
  for (const userId of destinataires) {
    try {
      const t = await traducteurSuivi(langues.get(userId) ?? defaultLocale)
      await creerNotificationSuivi({
        userId,
        type: TYPES_NOTIFICATION.rapport,
        titre: t('notifRapport.echecTitre'),
        message: t('notifRapport.echecMessage', {
          titre: rapport.artefactTitre,
          essais: MAX_ESSAIS,
        }),
        entite: { type: 'artefact', id: rapport.artefactId },
      })
    } catch (error) {
      log.erreur('Notification de rapport impossible', {
        rapportId: rapport.id,
        destinataireId: userId,
        etape: 'notification',
        resultat: 'echec',
        nomErreur: nomErreur(error),
      })
    }
  }
}

/** Journal par destinataire : ni adresse e-mail, ni sujet, ni message d'erreur brut. */
function journaliserEnvoi(
  rapportId: string,
  destinataireId: string,
  ok: boolean,
  essai: number,
  nom?: string
): void {
  const ligne = {
    rapportId,
    destinataireId,
    resultat: ok ? 'ok' : 'echec',
    essai,
    ...(nom ? { nomErreur: nom } : {}),
  }
  if (ok) log.info('Rapport envoyé à un destinataire', ligne)
  else log.erreur('Envoi du rapport à un destinataire impossible', ligne)
}

async function envoyerRapport(
  rapport: RapportProgrammeRow,
  maintenant: Date,
  depot: DepotSuivi,
  options: OptionsTraitementRapports,
  essai: number
): Promise<Issue> {
  // c. Droits du proprietaire re-verifies maintenant.
  const proprietaire = await contexteDepuisCompte(rapport.userId, maintenant)
  if (!proprietaire) {
    await depot.mettreAJourRapport(rapport.id, rapport.userId, { actif: false })
    return { statut: 'echec', erreur: 'proprietaire_sans_acces' }
  }

  // d. Artefact toujours visible du proprietaire ; destinataires encore valides.
  const artefact = await depot.trouverArtefactVisible(rapport.artefactId, rapport.userId)
  if (!artefact) {
    await depot.mettreAJourRapport(rapport.id, rapport.userId, { actif: false })
    return { statut: 'echec', erreur: 'artefact_introuvable' }
  }
  const { comptes: actifs } = await validerDestinataires(rapport.destinataires)
  const autorisations = await Promise.all(
    actifs.map(compte => destinataireCouvrePerimetre(proprietaire.scope.donnees, compte.id))
  )
  const comptes = actifs.filter((_, index) => autorisations[index])
  if (comptes.length === 0) return { statut: 'echec', erreur: 'aucun_destinataire' }
  const ecartes = rapport.destinataires.length - comptes.length

  // e. Un export par format, dans le perimetre du PROPRIETAIRE.
  const exporter = options.construireExport ?? construireExportParDefaut
  const nomProprietaire = await nomDuCompte(rapport.userId)
  const pieces: { filename: string; content: Buffer; contentType: string }[] = []
  try {
    for (const format of rapport.formats) {
      const exporte = await exporter(artefact.id, format, proprietaire, {
        exportePar: nomProprietaire,
      })
      pieces.push({
        filename: exporte.nomFichier,
        content: exporte.buffer,
        contentType: exporte.typeMime,
      })
    }
  } catch (error) {
    log.erreur('Export du rapport impossible', {
      rapportId: rapport.id,
      etape: 'export',
      resultat: 'echec',
      essai,
      nomErreur: nomErreur(error),
    })
    return { statut: 'echec', erreur: 'export_impossible', reessayable: true }
  }

  // f. Un e-mail par destinataire, dans sa langue ; la notification in-app suit
  // seulement un e-mail parti (sinon chaque reprise la dupliquerait).
  const envoyer = options.envoyerMail ?? envoyerMail
  let partis = 0
  for (const destinataire of comptes) {
    let parti = false
    try {
      const email = await composerEmailRapport({
        locale: destinataire.locale,
        destinataireNom: destinataire.nom,
        proprietaireNom: nomProprietaire,
        titreArtefact: artefact.titre,
        frequence: rapport.frequence,
        formats: rapport.formats,
      })
      parti = await envoyer({
        to: destinataire.email,
        subject: email.sujet,
        html: email.html,
        text: email.texte,
        attachments: pieces,
      })
      if (parti) partis += 1
      journaliserEnvoi(rapport.id, destinataire.id, parti, essai)
    } catch (error) {
      parti = false
      journaliserEnvoi(rapport.id, destinataire.id, false, essai, nomErreur(error))
    }
    if (!parti) continue
    try {
      const t = await traducteurSuivi(destinataire.locale)
      await creerNotificationSuivi({
        userId: destinataire.id,
        type: TYPES_NOTIFICATION.rapport,
        titre: t('notifRapport.titre', { titre: artefact.titre }),
        message: t('notifRapport.message', {
          proprietaire: nomProprietaire,
          frequence: t(`notifRapport.frequence.${rapport.frequence}`),
        }),
        entite: { type: 'artefact', id: artefact.id },
      })
    } catch (error) {
      log.erreur('Notification de rapport impossible', {
        rapportId: rapport.id,
        destinataireId: destinataire.id,
        etape: 'notification',
        resultat: 'echec',
        essai,
        nomErreur: nomErreur(error),
      })
    }
  }

  if (partis === 0) return { statut: 'echec', erreur: 'envoi_impossible', reessayable: true }
  if (partis < comptes.length || ecartes > 0) {
    return { statut: 'partiel', erreur: ecartes > 0 ? 'destinataires_ecartes' : 'envoi_partiel' }
  }
  return { statut: 'ok', erreur: null }
}

async function traiterUnRapport(
  rapport: RapportProgrammeRow,
  maintenant: Date,
  depot: DepotSuivi,
  options: OptionsTraitementRapports
): Promise<Traitement | 'ignore'> {
  // a. Prochaine echeance apres MAINTENANT : un serveur arrete trois jours n'envoie qu'un rapport.
  let nouveau: Date
  try {
    nouveau = prochainEnvoiA(rapport, maintenant)
  } catch (error) {
    log.erreur("Calcul de l'échéance du rapport impossible", {
      rapportId: rapport.id,
      etape: 'planning',
      resultat: 'echec',
      nomErreur: nomErreur(error),
    })
    await depot.mettreAJourRapport(rapport.id, rapport.userId, { actif: false })
    return { issue: { statut: 'echec', erreur: 'planning_invalide' }, essaisAvant: 0, nouveau: null }
  }
  const ancien = rapport.prochainEnvoiA
  if (!ancien) return 'ignore'

  // Un bail present mais expire = l'execution precedente s'est arretee en route : ce
  // passage compte comme un essai rate (borne les plantages repetes a MAX_ESSAIS).
  const essaisAvant = rapport.enCoursJusqua ? rapport.essais + 1 : rapport.essais

  // b. Reservation atomique = pose du bail : une seule execution envoie.
  const jusqua = new Date(maintenant.getTime() + DUREE_BAIL_MS)
  const reserve = await depot.reserverRapport(
    rapport.id,
    { prochainEnvoiA: ancien, essais: rapport.essais },
    maintenant,
    jusqua,
    essaisAvant
  )
  if (!reserve) return 'ignore'

  if (essaisAvant >= MAX_ESSAIS) {
    // Plantages repetes : on n'envoie pas, on abandonne cette echeance (essai MAX atteint).
    return {
      issue: { statut: 'echec', erreur: 'reprise_abandonnee', reessayable: true },
      essaisAvant: MAX_ESSAIS - 1,
      nouveau,
    }
  }

  try {
    const issue = await envoyerRapport(rapport, maintenant, depot, options, essaisAvant + 1)
    return { issue, essaisAvant, nouveau }
  } catch (error) {
    log.erreur('Traitement du rapport en échec', {
      rapportId: rapport.id,
      etape: 'traitement',
      resultat: 'echec',
      essai: essaisAvant + 1,
      nomErreur: nomErreur(error),
    })
    return {
      issue: { statut: 'echec', erreur: 'erreur_interne', reessayable: true },
      essaisAvant,
      nouveau,
    }
  }
}

/** Enregistre le resultat : avance l'echeance, ou garde le rapport echu pour une reprise. */
async function terminerRapport(
  rapport: RapportProgrammeRow,
  traitement: Traitement,
  maintenant: Date,
  depot: DepotSuivi
): Promise<void> {
  const { issue, essaisAvant, nouveau } = traitement
  let essais = 0
  let prochain: Date | undefined = nouveau ?? undefined
  let notifier = false
  if (issue.statut === 'echec' && issue.reessayable) {
    essais = essaisAvant + 1
    if (essais >= MAX_ESSAIS) {
      essais = 0
      notifier = true
    } else {
      prochain = undefined // reste echu : repris au prochain appel de la tache
    }
  }
  await depot.enregistrerResultatRapport(rapport.id, {
    dernierEnvoiA: maintenant,
    statut: issue.statut,
    erreur: issue.erreur,
    essais,
    ...(prochain ? { prochainEnvoiA: prochain } : {}),
  })
  if (notifier) await notifierEchecDefinitif(rapport, depot)
}

/**
 * Envoie les rapports echus. Appelee par la tache planifiee (toutes les 15 minutes) ;
 * sans effet quand rien n'est echu, et sans double envoi si deux executions se
 * chevauchent (bail, puis echeance avancee au succes).
 */
export async function traiterRapportsEchus(
  options: OptionsTraitementRapports = {}
): Promise<BilanRapports> {
  const maintenant = options.maintenant ?? new Date()
  const depot = options.depot ?? obtenirDepot()
  const horloge = options.horloge ?? Date.now
  const debut = horloge()
  const rapports = await depot.listerRapportsEchus(maintenant, options.limite ?? LIMITE_PAR_DEFAUT)
  const bilan: BilanRapports = {
    echus: rapports.length,
    envoyes: 0,
    partiels: 0,
    echecs: 0,
    ignores: 0,
    restants: 0,
  }

  for (let index = 0; index < rapports.length; index += 1) {
    const rapport = rapports[index]
    if (options.budgetMs !== undefined && horloge() - debut >= options.budgetMs) {
      bilan.restants = rapports.length - index
      break
    }
    let traitement: Traitement | 'ignore'
    try {
      traitement = await traiterUnRapport(rapport, maintenant, depot, options)
    } catch (error) {
      // Echec avant reservation : rien n'est reserve, le rapport reste echu. Il ne bloque pas les suivants.
      log.erreur('Réservation du rapport impossible', {
        rapportId: rapport.id,
        etape: 'reservation',
        resultat: 'echec',
        nomErreur: nomErreur(error),
      })
      bilan.echecs += 1
      continue
    }
    if (traitement === 'ignore') {
      bilan.ignores += 1
      continue
    }
    try {
      await terminerRapport(rapport, traitement, maintenant, depot)
    } catch (error) {
      // Le bail expirera seul (10 min) et le rapport sera repris.
      log.erreur('Enregistrement du résultat du rapport impossible', {
        rapportId: rapport.id,
        etape: 'resultat',
        resultat: 'echec',
        nomErreur: nomErreur(error),
      })
    }
    const { statut } = traitement.issue
    if (statut === 'ok') bilan.envoyes += 1
    else if (statut === 'partiel') bilan.partiels += 1
    else bilan.echecs += 1
  }
  return bilan
}
