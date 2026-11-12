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
import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { prochainEnvoiA, validerPlanning, type Planning } from './echeances'
import { composerEmailRapport } from './emails-rapport'
import { ErreurSuivi, nomErreur } from './erreurs'
import { creerNotificationSuivi } from './notifications'
import { traducteurSuivi } from './emails'
import { exigerExpediteurProprietaire, exigerProprietaireArtefact } from './proprietaire'
import type { CompteResume, ModificationRapportProgramme, RapportProgrammeRow } from './types'

export interface DependancesRapports {
  depot?: DepotSuivi
}

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
}

export interface OptionsTraitementRapports {
  maintenant?: Date
  limite?: number
  depot?: DepotSuivi
  construireExport?: ConstruireExport
  envoyerMail?: typeof envoyerMail
}

const LIMITE_PAR_DEFAUT = 50

type Issue = { statut: 'ok' | 'partiel' | 'echec'; erreur: string | null }

async function nomDuCompte(userId: string): Promise<string> {
  const compte = await prisma.user.findFirst({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  })
  return compte ? `${compte.firstName} ${compte.lastName}`.trim() : ''
}

async function traiterUnRapport(
  rapport: RapportProgrammeRow,
  maintenant: Date,
  depot: DepotSuivi,
  options: OptionsTraitementRapports
): Promise<Issue | 'ignore'> {
  // a. Prochaine echeance apres MAINTENANT : un serveur arrete trois jours n'envoie qu'un rapport.
  let nouveau: Date
  try {
    nouveau = prochainEnvoiA(rapport, maintenant)
  } catch (error) {
    console.error(`[medic-assist] rapport ${rapport.id} : planning illisible :`, nomErreur(error))
    await depot.mettreAJourRapport(rapport.id, rapport.userId, { actif: false })
    return { statut: 'echec', erreur: 'planning_invalide' }
  }
  const ancien = rapport.prochainEnvoiA
  if (!ancien) return 'ignore'

  // b. Reservation atomique : une seule execution envoie.
  if (!(await depot.reserverRapport(rapport.id, ancien, nouveau))) return 'ignore'

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
  const { comptes } = await validerDestinataires(rapport.destinataires)
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
    console.error(`[medic-assist] rapport ${rapport.id} : export impossible :`, nomErreur(error))
    return { statut: 'echec', erreur: 'export_impossible' }
  }

  // f. Un e-mail et une notification par destinataire, dans sa langue.
  const envoyer = options.envoyerMail ?? envoyerMail
  let partis = 0
  for (const destinataire of comptes) {
    try {
      const email = await composerEmailRapport({
        locale: destinataire.locale,
        destinataireNom: destinataire.nom,
        proprietaireNom: nomProprietaire,
        titreArtefact: artefact.titre,
        frequence: rapport.frequence,
        formats: rapport.formats,
      })
      const parti = await envoyer({
        to: destinataire.email,
        subject: email.sujet,
        html: email.html,
        text: email.texte,
        attachments: pieces,
      })
      if (parti) partis += 1
    } catch (error) {
      console.error(`[medic-assist] rapport ${rapport.id} : e-mail non envoye :`, nomErreur(error))
    }
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
      console.error(`[medic-assist] rapport ${rapport.id} : notification non creee :`, nomErreur(error))
    }
  }

  if (partis === 0) return { statut: 'echec', erreur: 'envoi_impossible' }
  if (partis < comptes.length || ecartes > 0) {
    return { statut: 'partiel', erreur: ecartes > 0 ? 'destinataires_ecartes' : 'envoi_partiel' }
  }
  return { statut: 'ok', erreur: null }
}

/**
 * Envoie les rapports echus. Appelee par la tache planifiee (toutes les 15 minutes) ;
 * sans effet quand rien n'est echu, et sans double envoi si deux executions se
 * chevauchent.
 */
export async function traiterRapportsEchus(
  options: OptionsTraitementRapports = {}
): Promise<BilanRapports> {
  const maintenant = options.maintenant ?? new Date()
  const depot = options.depot ?? obtenirDepot()
  const rapports = await depot.listerRapportsEchus(maintenant, options.limite ?? LIMITE_PAR_DEFAUT)
  const bilan: BilanRapports = {
    echus: rapports.length,
    envoyes: 0,
    partiels: 0,
    echecs: 0,
    ignores: 0,
  }

  for (const rapport of rapports) {
    let issue: Issue | 'ignore'
    try {
      issue = await traiterUnRapport(rapport, maintenant, depot, options)
    } catch (error) {
      // Un rapport en erreur ne bloque pas les suivants.
      console.error(`[medic-assist] rapport ${rapport.id} : traitement interrompu :`, nomErreur(error))
      issue = { statut: 'echec', erreur: 'erreur_interne' }
    }
    if (issue === 'ignore') {
      bilan.ignores += 1
      continue
    }
    try {
      await depot.enregistrerResultatRapport(rapport.id, {
        dernierEnvoiA: maintenant,
        statut: issue.statut,
        erreur: issue.erreur,
      })
    } catch (error) {
      console.error(`[medic-assist] rapport ${rapport.id} : resultat non enregistre :`, nomErreur(error))
    }
    if (issue.statut === 'ok') bilan.envoyes += 1
    else if (issue.statut === 'partiel') bilan.partiels += 1
    else bilan.echecs += 1
  }
  return bilan
}
