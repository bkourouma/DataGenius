/**
 * Actions proposees par l'assistant (tache, e-mail, notification, rapport
 * programme). REGLE : rien ne s'execute hors de `executerAction`, appelee par le
 * clic « Confirmer » de la carte ; `proposerAction` (outil proposer_action du lot 1)
 * ne fait qu'enregistrer une action 'proposee' avec son resume lisible.
 *
 * Fusion de l'ancien actions-impl.ts dans la souche du lot 0 : ce fichier porte
 * les signatures figees des contrats (`proposerAction`, `executerAction`) et les
 * fonctions annexes des routes (`lireAction`, `annulerAction`).
 *
 * IDENTIFIANTS : l'`artefactId` public est le `racineId` de l'artefact (commun a
 * toutes ses versions). Il est OPAQUE ici : on ne fait que le transmettre au depot
 * et au module d'export du lot 4.
 *
 * RESULTAT : `ActionProposee.resultat` suit le contrat { message, entiteId?, lien?,
 * erreur? }. `message` est une phrase dans la langue de `contexte.locale`
 * (section actionResultat), `entiteId` l'id de la Task ou du rapport, `erreur` un
 * code court d'echec (export_impossible, mail_non_envoye, execution_impossible,
 * destinataire_invalide...), jamais une trace.
 */

import { toIntlTag, type Locale } from '@/i18n/config'
import { prisma } from '@/lib/db/client'
import { envoyerMail } from '@/lib/mail/transport'
import { destinataireCouvrePerimetre } from '@/lib/auth/data-access'
import { ressourceDansPerimetre } from './perimetre-ressource'
import {
  PRIORITE_TACHE_EN_BASE,
  SCHEMAS_PARAMETRES_ACTION,
  STATUT_TACHE_EN_BASE,
  TYPES_NOTIFICATION,
  type ActionEnregistree,
  type ActionProposee,
  type ContexteExecution,
  type EntreeProposerAction,
  type FormatEnvoi,
  type ParametresAction,
  type ParametresCreerTache,
  type ParametresEnvoyerEmail,
  type ParametresNotifier,
  type ParametresProgrammerRapport,
  type ResultatAction,
  type TypeAction,
} from '@/lib/medic-assist/contrats'

import { validerDestinataires, validerDestinatairesActifs } from './comptes'
import { construireExport as construireExportParDefaut, type ConstruireExport } from './dependances'
import type { DepotSuivi } from './depot'
import { obtenirDepot } from './depot-prisma'
import { finDeJourneeParis } from './echeances'
import { composerEmailArtefact, listeFormats, traducteurSuivi, type Traducteur } from './emails'
import { ErreurSuivi, nomErreur } from './erreurs'
import { creerNotificationSuivi } from './notifications'
import { exigerExpediteurProprietaire, exigerProprietaireArtefact } from './proprietaire'
import { creerRapportProgramme } from './rapports-programmes'
import type { ActionRow, ArtefactVisible, CompteNotifiable } from './types'

export interface DependancesActions {
  depot?: DepotSuivi
  construireExport?: ConstruireExport
  envoyerMail?: typeof envoyerMail
  maintenant?: () => Date
}

/** Champs que l'utilisateur peut modifier sur la carte avant de confirmer. */
const CHAMPS_MODIFIABLES: Record<TypeAction, readonly string[]> = {
  creer_tache: ['assigneA', 'echeance', 'priorite'],
  envoyer_email: ['destinataires', 'formats', 'message'],
  notifier: ['destinataires', 'message'],
  programmer_rapport: ['destinataires', 'formats', 'frequence', 'heure', 'jourSemaine', 'jourMois'],
}

/** Ecran de la liste des taches / rapports de l'utilisateur (onglets de Mes analyses). */
const HREF_TACHES = '/medic-assist/analyses?onglet=taches'
const HREF_RAPPORTS = '/medic-assist/analyses?onglet=rapports'

/** Codes d'echec qui ont une phrase dediee (actionResultat.echec.<code>). */
const CODES_ECHEC_DECRITS = [
  'export_impossible',
  'mail_non_envoye',
  'destinataire_invalide',
  'artefact_non_proprietaire',
]

/** Echec d'execution avec un code court (le seul detail conserve en base). */
class ErreurExecution extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

// ---------------------------------------------------------------------------
// Verification des droits et resume
// ---------------------------------------------------------------------------

interface Verification {
  /**
   * Destinataires (ou assigne) dans l'ordre demande. `aAcces` est toujours vrai sauf
   * pour `notifier`, ouvert a tout compte actif (H7 validee) : un destinataire sans
   * acces ne recoit qu'un texte, sans lien et sans partage.
   */
  comptes: CompteNotifiable[]
  /** Artefact dont l'utilisateur est PROPRIETAIRE (seul le proprietaire envoie, notifie, programme). */
  artefact: ArtefactVisible | null
}

function idsConcernes(type: TypeAction, parametres: unknown): string[] {
  if (type === 'creer_tache') return [(parametres as ParametresCreerTache).assigneA]
  return (parametres as ParametresEnvoyerEmail | ParametresNotifier | ParametresProgrammerRapport)
    .destinataires
}

function artefactIdConcerne(type: TypeAction, parametres: unknown): string | undefined {
  if (type === 'creer_tache') return undefined
  return (parametres as { artefactId?: string }).artefactId
}

/**
 * H7 : comptes actifs avec acces a Medic Assist (pour `notifier` : tout compte
 * actif). Artefact : l'utilisateur doit en etre le PROPRIETAIRE, a la proposition
 * comme au clic.
 */
async function verifierDroits(
  depot: DepotSuivi,
  contexte: ContexteExecution,
  type: TypeAction,
  parametres: unknown
): Promise<Verification> {
  // Propriete d'abord : un artefact recu en lecture seule est refuse avant toute autre lecture.
  let artefact: ArtefactVisible | null = null
  const artefactId = artefactIdConcerne(type, parametres)
  if (artefactId) artefact = await exigerProprietaireArtefact(depot, artefactId, contexte.userId)
  if (artefactId && !(await ressourceDansPerimetre(contexte, 'artefact', artefactId))) throw new ErreurSuivi('introuvable')

  const ids = idsConcernes(type, parametres)
  let comptes: CompteNotifiable[]
  if (type === 'notifier') {
    const lecture = await validerDestinatairesActifs(ids)
    if (lecture.refuses.length > 0) throw new ErreurSuivi('destinataire_invalide')
    comptes = lecture.comptes
  } else {
    const lecture = await validerDestinataires(ids)
    if (lecture.refuses.length > 0) throw new ErreurSuivi('destinataire_invalide')
    comptes = lecture.comptes.map(c => ({ ...c, aAcces: true }))
  }

  const autorisations = await Promise.all(comptes.map(c => destinataireCouvrePerimetre(contexte.scope.donnees, c.id)))
  if (autorisations.some(ok => !ok)) throw new ErreurSuivi('destinataire_invalide')
  return { comptes, artefact }
}

/** Valide avec le schema REEL du type (strictObject : un champ inconnu est refuse). */
function validerParametres(type: TypeAction, parametres: unknown): ParametresAction {
  const schema = SCHEMAS_PARAMETRES_ACTION[type]
  if (!schema) throw new ErreurSuivi('invalide')
  const lecture = schema.safeParse(parametres)
  if (!lecture.success) {
    throw new ErreurSuivi(
      'invalide',
      lecture.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    )
  }
  return lecture.data as ParametresAction
}

/** `dateCivile` = 'YYYY-MM-DD' : on formate le jour tel quel, sans decalage de fuseau. */
function formaterDate(locale: Locale, dateCivile: string): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${dateCivile}T12:00:00Z`))
}

/** `heure` = 'HH:mm' (heure de Paris), affichee avec les conventions de la langue. */
function formaterHeure(locale: Locale, heure: string): string {
  const [h, m] = heure.split(':').map(Number)
  return new Intl.DateTimeFormat(toIntlTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, 1, h, m)))
}

/** 1 = lundi ... 7 = dimanche ; le 1er janvier 2024 est un lundi. */
function nomJourSemaine(locale: Locale, jour: number): string {
  return new Intl.DateTimeFormat(toIntlTag(locale), { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, jour))
  )
}

function listeNoms(locale: Locale, comptes: { nom: string }[]): string {
  return new Intl.ListFormat(toIntlTag(locale), { type: 'conjunction' }).format(
    comptes.map(c => c.nom)
  )
}

function decrireFrequence(t: Traducteur, locale: Locale, p: ParametresProgrammerRapport): string {
  const heure = formaterHeure(locale, p.heure)
  if (p.frequence === 'quotidien') return t('actionResume.frequence.quotidien', { heure })
  if (p.frequence === 'hebdomadaire') {
    return p.jourSemaine
      ? t('actionResume.frequence.hebdomadaire', {
          jour: nomJourSemaine(locale, p.jourSemaine),
          heure,
        })
      : t('actionResume.frequence.hebdomadaireSansJour', { heure })
  }
  return p.jourMois
    ? t('actionResume.frequence.mensuel', { jourMois: p.jourMois, heure })
    : t('actionResume.frequence.mensuelSansJour', { heure })
}

/** Resume lisible : des NOMS (jamais des identifiants), dans la langue de l'utilisateur. */
async function composerResume(
  locale: Locale,
  type: TypeAction,
  parametres: unknown,
  verification: Verification
): Promise<string> {
  const t = await traducteurSuivi(locale)
  const noms = listeNoms(locale, verification.comptes)
  const titreArtefact = verification.artefact?.titre ?? ''
  const note = t('actionResume.partageNote')

  switch (type) {
    case 'creer_tache': {
      const p = parametres as ParametresCreerTache
      return p.echeance
        ? t('actionResume.creerTacheEcheance', {
            titre: p.titre,
            assigne: noms,
            echeance: formaterDate(locale, p.echeance),
          })
        : t('actionResume.creerTache', { titre: p.titre, assigne: noms })
    }
    case 'envoyer_email': {
      const p = parametres as ParametresEnvoyerEmail
      const principal = t('actionResume.envoyerEmail', {
        titre: titreArtefact,
        destinataires: noms,
        formats: listeFormats(locale, p.formats),
      })
      return `${principal} ${note}`
    }
    case 'notifier': {
      const p = parametres as ParametresNotifier
      if (!verification.artefact) {
        return t('actionResume.notifier', { destinataires: noms, message: p.message })
      }
      const principal = t('actionResume.notifierArtefact', {
        destinataires: noms,
        titre: titreArtefact,
        message: p.message,
      })
      // Sans acces a Medic Assist : message seul, ni lien ni partage.
      const sansAcces = verification.comptes.filter(c => !c.aAcces)
      const avecAcces = verification.comptes.length - sansAcces.length
      const notes = [
        ...(avecAcces > 0 ? [note] : []),
        ...(sansAcces.length > 0
          ? [
              t('actionResume.notifierSansAcces', {
                nombre: sansAcces.length,
                destinataires: listeNoms(locale, sansAcces),
              }),
            ]
          : []),
      ]
      return [principal, ...notes].join(' ')
    }
    case 'programmer_rapport': {
      const p = parametres as ParametresProgrammerRapport
      const principal = t('actionResume.programmerRapport', {
        titre: titreArtefact,
        formats: listeFormats(locale, p.formats),
        destinataires: noms,
        frequence: decrireFrequence(t, locale, p),
      })
      return `${principal} ${note}`
    }
  }
}

/**
 * Convertisseur UNIQUE ligne du depot -> `ActionProposee` du contrat. Sert
 * GET /actions/[id], confirmer et annuler. `traiteeA` = date d'execution, d'echec
 * ou d'annulation (colonne executeeA du depot).
 */
export function versActionProposee(ligne: ActionRow): ActionProposee {
  const action = {
    id: ligne.id,
    type: ligne.type,
    statut: ligne.statut,
    parametres: ligne.parametres,
    resume: ligne.resume,
    conversationId: ligne.conversationId,
    creeA: ligne.creeA.toISOString(),
    ...(ligne.executeeA ? { traiteeA: ligne.executeeA.toISOString() } : {}),
    ...(ligne.resultat ? { resultat: ligne.resultat } : {}),
  }
  return action as ActionProposee
}

// ---------------------------------------------------------------------------
// Proposer, lire
// ---------------------------------------------------------------------------

/**
 * Outil `proposer_action` : valide et enregistre l'action au statut `proposee`,
 * SANS RIEN EXECUTER. Exige `contexte.conversationId` (une action est rattachee a
 * sa conversation). Les droits sont verifies maintenant et REVERIFIES au clic.
 */
export async function proposerAction(
  contexte: ContexteExecution,
  entree: EntreeProposerAction,
  deps: DependancesActions = {}
): Promise<ActionEnregistree> {
  if (!contexte.conversationId) {
    throw new ErreurSuivi('invalide', 'conversationId requis pour proposer une action')
  }
  const depot = deps.depot ?? obtenirDepot()
  const valides = validerParametres(entree.type, entree.parametres)
  const verification = await verifierDroits(depot, contexte, entree.type, valides)
  const resume = await composerResume(contexte.locale, entree.type, valides, verification)
  const ligne = await depot.creerAction({
    userId: contexte.userId,
    conversationId: contexte.conversationId,
    type: entree.type,
    parametres: valides,
    resume,
  })
  return { actionId: ligne.id, type: ligne.type, statut: 'proposee', resume: ligne.resume }
}

export async function lireAction(
  contexte: ContexteExecution,
  actionId: string,
  deps: DependancesActions = {}
): Promise<ActionProposee> {
  const depot = deps.depot ?? obtenirDepot()
  const ligne = await depot.trouverAction(actionId, contexte.userId)
  if (!ligne) throw new ErreurSuivi('introuvable')
  return versActionProposee(ligne)
}

// ---------------------------------------------------------------------------
// Surcharges (champs modifies sur la carte)
// ---------------------------------------------------------------------------

function fusionnerSurcharges(ligne: ActionRow, surcharges: unknown): unknown {
  const enregistres = (ligne.parametres ?? {}) as Record<string, unknown>
  if (!surcharges || typeof surcharges !== 'object' || Array.isArray(surcharges)) return enregistres
  const fusion: Record<string, unknown> = { ...enregistres }
  for (const champ of CHAMPS_MODIFIABLES[ligne.type]) {
    if (!(champ in surcharges)) continue
    const valeur = (surcharges as Record<string, unknown>)[champ]
    // null = retirer un champ facultatif (echeance, message...).
    if (valeur === null || valeur === undefined) delete fusion[champ]
    else fusion[champ] = valeur
  }
  return fusion
}

// ---------------------------------------------------------------------------
// Executer (clic sur Confirmer)
// ---------------------------------------------------------------------------

/**
 * Execute une action confirmee. Proprietaire dans le meme `where`, droits
 * REVERIFIES, `parametres` (retouches sur la carte : partiels ou complets, seuls
 * les champs modifiables comptent) revalides avec le schema reel. Idempotent : une
 * action deja executee n'est jamais rejouee. Un echec d'execution est un resultat
 * (statut 'echec'), pas une exception.
 */
export async function executerAction(
  contexte: ContexteExecution,
  actionId: string,
  parametres?: ParametresAction | Record<string, unknown>,
  deps: DependancesActions = {}
): Promise<ActionProposee> {
  const depot = deps.depot ?? obtenirDepot()

  const ligne = await depot.trouverAction(actionId, contexte.userId)
  if (!ligne) throw new ErreurSuivi('introuvable')
  if (ligne.statut === 'executee') return versActionProposee(ligne)
  if (ligne.statut !== 'proposee') throw new ErreurSuivi('conflit')

  // Surcharges revalidees avec le schema du type, puis resume recompose.
  const fusion = fusionnerSurcharges(ligne, parametres)
  const valides = validerParametres(ligne.type, fusion)

  // Droits re-verifies AU CLIC : un destinataire desactive depuis la proposition est refuse.
  const verification = await verifierDroits(depot, contexte, ligne.type, valides)
  const resume = await composerResume(contexte.locale, ligne.type, valides, verification)
  const misAJour = await depot.mettreAJourActionProposee(ligne.id, contexte.userId, {
    parametres: valides,
    resume,
  })
  if (!misAJour) return relireEtat(depot, contexte, ligne.id)

  // Compare-and-set : un seul appelant executera (double clic, requetes simultanees).
  const reservee = await depot.reserverAction(ligne.id, contexte.userId)
  if (!reservee) return relireEtat(depot, contexte, ligne.id)

  const executee: ActionRow = { ...ligne, parametres: valides, resume }
  const t = await traducteurSuivi(contexte.locale)
  let resultat: ResultatAction
  try {
    resultat = await executer(executee, valides, verification, contexte, depot, deps, t)
  } catch (error) {
    const code = codeEchec(error)
    if (code === 'execution_impossible') {
      console.error(`[medic-assist] action ${ligne.type} en echec :`, nomErreur(error))
    }
    const cle = CODES_ECHEC_DECRITS.includes(code) ? code : 'generique'
    await depot.terminerAction(ligne.id, contexte.userId, {
      statut: 'echec',
      resultat: { message: t(`actionResultat.echec.${cle}`), erreur: code },
    })
    return relireEtat(depot, contexte, ligne.id)
  }

  // L'effet a eu lieu (tache creee, e-mails partis) et le compare-and-set a deja pose
  // 'executee' : si la cloture echoue, on journalise et on garde 'executee' (jamais 'echec').
  try {
    await depot.terminerAction(ligne.id, contexte.userId, { statut: 'executee', resultat })
  } catch (error) {
    console.error(`[medic-assist] action ${ligne.type} executee, resultat non enregistre :`, nomErreur(error))
  }
  const relue = await relireEtat(depot, contexte, ligne.id)
  return relue.resultat ? relue : { ...relue, resultat }
}

/** Code court d'echec : ErreurExecution, refus de propriete, sinon execution_impossible. */
function codeEchec(error: unknown): string {
  if (error instanceof ErreurExecution) return error.code
  if (error instanceof ErreurSuivi && error.code === 'artefact_non_proprietaire') return error.code
  return 'execution_impossible'
}

async function relireEtat(
  depot: DepotSuivi,
  contexte: ContexteExecution,
  actionId: string
): Promise<ActionProposee> {
  const relue = await depot.trouverAction(actionId, contexte.userId)
  if (!relue) throw new ErreurSuivi('introuvable')
  return versActionProposee(relue)
}

// ---------------------------------------------------------------------------
// Annuler
// ---------------------------------------------------------------------------

export async function annulerAction(
  contexte: ContexteExecution,
  actionId: string,
  deps: DependancesActions = {}
): Promise<ActionProposee> {
  const depot = deps.depot ?? obtenirDepot()
  const annulee = await depot.annulerAction(actionId, contexte.userId)
  const ligne = await depot.trouverAction(actionId, contexte.userId)
  if (!ligne) throw new ErreurSuivi('introuvable')
  // Deja annulee : idempotent. Executee ou en echec : on ne revient pas en arriere.
  if (!annulee && ligne.statut !== 'annulee') throw new ErreurSuivi('conflit')
  return versActionProposee(ligne)
}

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------

async function nomExpediteur(userId: string): Promise<string> {
  const compte = await prisma.user.findFirst({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  })
  return compte ? `${compte.firstName} ${compte.lastName}`.trim() : ''
}

async function executer(
  ligne: ActionRow,
  parametres: ParametresAction,
  verification: Verification,
  contexte: ContexteExecution,
  depot: DepotSuivi,
  deps: DependancesActions,
  t: Traducteur
): Promise<ResultatAction> {
  switch (ligne.type) {
    case 'creer_tache':
      return executerCreerTache(
        ligne,
        parametres as ParametresCreerTache,
        verification,
        contexte,
        t
      )
    case 'envoyer_email':
      return executerEnvoyerEmail(
        parametres as ParametresEnvoyerEmail,
        verification,
        contexte,
        depot,
        deps,
        t
      )
    case 'notifier':
      return executerNotifier(parametres as ParametresNotifier, verification, contexte, depot, t)
    case 'programmer_rapport': {
      const rapport = await creerRapportProgramme(
        contexte,
        parametres as ParametresProgrammerRapport,
        { depot }
      )
      await partagerArtefactAvecDestinataires(
        depot,
        contexte,
        verification.artefact,
        verification.comptes,
        null
      )
      return {
        message: t('actionResultat.programmerRapport', {
          titre: verification.artefact?.titre ?? '',
        }),
        entiteId: rapport.id,
        lien: { href: HREF_RAPPORTS, libelle: t('actionResultat.lien.rapports') },
      }
    }
  }
}

/**
 * HYPOTHESE H8 : envoyer un e-mail, notifier avec une analyse ou programmer un
 * rapport PARTAGE aussi l'artefact (lecture seule, recalcule dans le perimetre
 * du destinataire), pour que le lien du message s'ouvre. Fonction unique, a
 * neutraliser ici si l'hypothese est refusee (le resume de la carte annonce ce
 * partage avant le clic : retirer aussi `actionResume.partageNote`).
 * Aucune notification de partage : le message envoye en tient lieu. Jamais de
 * partage pour un destinataire sans acces a Medic Assist.
 */
async function partagerArtefactAvecDestinataires(
  depot: DepotSuivi,
  contexte: ContexteExecution,
  artefact: ArtefactVisible | null,
  destinataires: CompteNotifiable[],
  message: string | null
): Promise<void> {
  if (!artefact) return
  // Seul le proprietaire partage : refus AVANT tout effet (jamais de partage partiel).
  exigerExpediteurProprietaire(artefact, contexte.userId)
  const partages = destinataires
    .filter(c => c.aAcces)
    .filter(c => c.id !== contexte.userId && c.id !== artefact.proprietaireId)
    .map(c => ({
      expediteurId: contexte.userId,
      destinataireId: c.id,
      cibleType: 'artefact' as const,
      cibleId: artefact.id,
      message,
    }))
  if (partages.length > 0) await depot.creerPartages(partages)
}

async function executerCreerTache(
  ligne: ActionRow,
  p: ParametresCreerTache,
  verification: Verification,
  contexte: ContexteExecution,
  t: Traducteur
): Promise<ResultatAction> {
  const assigne = verification.comptes[0]
  if (!assigne) throw new ErreurExecution('destinataire_invalide')
  // Le lien donne par l'IA prime ; sinon la tache pointe sur la conversation de l'action.
  const lien = p.lien ?? { type: 'conversation' as const, id: ligne.conversationId }

  const tache = await prisma.task.create({
    data: {
      title: p.titre,
      description: p.description ?? null,
      assignedToId: assigne.id,
      // Echeance = date civile ; la tache n'est en retard qu'apres la fin du jour (Paris).
      dueDate: p.echeance ? finDeJourneeParis(p.echeance) : null,
      priority: PRIORITE_TACHE_EN_BASE[p.priorite ?? 'normale'],
      status: STATUT_TACHE_EN_BASE.a_faire,
      relatedEntityType: lien.type,
      relatedEntityId: lien.id,
    },
    select: { id: true },
  })

  // Pas de notification quand on s'assigne la tache a soi-meme.
  if (assigne.id !== contexte.userId) {
    const tAssigne = await traducteurSuivi(assigne.locale)
    const expediteur = await nomExpediteur(contexte.userId)
    await creerNotificationSuivi({
      userId: assigne.id,
      type: TYPES_NOTIFICATION.tache,
      titre: tAssigne('notifTache.titre', { expediteur }),
      message: p.echeance
        ? tAssigne('notifTache.messageEcheance', {
            titre: p.titre,
            echeance: formaterDate(assigne.locale, p.echeance),
          })
        : tAssigne('notifTache.message', { titre: p.titre }),
      entite: { type: 'tache', id: tache.id },
    })
  }
  return {
    message: t('actionResultat.creerTache', { assigne: assigne.nom }),
    entiteId: tache.id,
    lien: { href: HREF_TACHES, libelle: t('actionResultat.lien.taches') },
  }
}

async function executerEnvoyerEmail(
  p: ParametresEnvoyerEmail,
  verification: Verification,
  contexte: ContexteExecution,
  depot: DepotSuivi,
  deps: DependancesActions,
  t: Traducteur
): Promise<ResultatAction> {
  const artefact = verification.artefact
  if (!artefact) throw new ErreurExecution('introuvable')
  const exporter = deps.construireExport ?? construireExportParDefaut
  const envoyer = deps.envoyerMail ?? envoyerMail

  // Un export par format, dans le perimetre de l'expediteur.
  const expediteurNom = await nomExpediteur(contexte.userId)
  const pieces: { format: FormatEnvoi; filename: string; content: Buffer; contentType: string }[] =
    []
  try {
    for (const format of p.formats) {
      const exporte = await exporter(artefact.id, format, contexte, { exportePar: expediteurNom })
      pieces.push({
        format,
        filename: exporte.nomFichier,
        content: exporte.buffer,
        contentType: exporte.typeMime,
      })
    }
  } catch (error) {
    console.error('[medic-assist] export impossible :', nomErreur(error))
    throw new ErreurExecution('export_impossible')
  }

  await partagerArtefactAvecDestinataires(
    depot,
    contexte,
    verification.artefact,
    verification.comptes,
    p.message ?? null
  )

  let envoyes = 0
  let echecs = 0
  for (const destinataire of verification.comptes) {
    try {
      const email = await composerEmailArtefact({
        locale: destinataire.locale,
        destinataireNom: destinataire.nom,
        expediteurNom,
        titreArtefact: artefact.titre,
        message: p.message,
        formats: p.formats,
      })
      const parti = await envoyer({
        to: destinataire.email,
        subject: email.sujet,
        html: email.html,
        text: email.texte,
        attachments: pieces.map(({ filename, content, contentType }) => ({
          filename,
          content,
          contentType,
        })),
      })
      if (parti) envoyes += 1
      else echecs += 1
    } catch (error) {
      console.error('[medic-assist] e-mail non envoye :', nomErreur(error))
      echecs += 1
    }
  }
  if (envoyes === 0) throw new ErreurExecution('mail_non_envoye')
  const message = [
    t('actionResultat.envoyerEmail', { envoyes }),
    ...(echecs > 0 ? [t('actionResultat.envoyerEmailEchecs', { echecs })] : []),
  ].join(' ')
  return { message }
}

async function executerNotifier(
  p: ParametresNotifier,
  verification: Verification,
  contexte: ContexteExecution,
  depot: DepotSuivi,
  t: Traducteur
): Promise<ResultatAction> {
  await partagerArtefactAvecDestinataires(
    depot,
    contexte,
    verification.artefact,
    verification.comptes,
    p.message
  )
  const expediteur = await nomExpediteur(contexte.userId)
  let notifies = 0
  for (const destinataire of verification.comptes) {
    const tDestinataire = await traducteurSuivi(destinataire.locale)
    await creerNotificationSuivi({
      userId: destinataire.id,
      type: TYPES_NOTIFICATION.message,
      titre: tDestinataire('notifMessage.titre', { expediteur }),
      message: p.message,
      // Sans acces a Medic Assist (ou sans artefact) : texte seul, sans lien.
      entite:
        verification.artefact && destinataire.aAcces
          ? { type: 'artefact', id: verification.artefact.id }
          : undefined,
    })
    notifies += 1
  }
  return { message: t('actionResultat.notifier', { nombre: notifies }) }
}
