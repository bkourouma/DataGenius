/**
 * Stockage des artefacts de Medic Assist (architecture §4, §6) : création, nouvelles versions et
 * lecture, au-dessus des tables AssistantArtefact, AssistantPartage, AssistantEpingle et
 * AssistantJeuDeDonnees.
 *
 * Modèle : une ligne PAR VERSION. `racineId` est l'id de la version 1, commun à toutes les
 * versions ; c'est aussi l'`artefactId` que les outils et l'API manipulent (stable d'une version
 * à l'autre). Toute fonction de lecture accepte indifféremment l'id de la racine ou celui d'une
 * version.
 *
 * Sécurité (règle unique) : l'accès à un artefact est décidé DANS la requête qui le lit. Les
 * listes de partages et d'épingles proviennent de requêtes bornées au lecteur ; elles entrent
 * dans le `where` d'un unique `findFirst`. Il n'y a jamais d'accès par id suivi d'une
 * vérification après coup. Un artefact absent et un artefact non accessible donnent la même
 * erreur `introuvable`.
 */

import { randomUUID } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import { auteurDansPerimetreLecteur, contenuAuPerimetreCourant } from '@/lib/auth/data-access'
import { ressourceDansPerimetre } from '@/lib/medic-assist/suivi/perimetre-ressource'
import {
  ArtefactSpecSchema,
  artefactsReferences,
  jeuxReferences,
  type ArtefactCree,
  type ArtefactDto,
  type ArtefactSpec,
  type ColonneJeu,
  type ContexteExecution,
  type EntreeCreerArtefact,
  type EntreeModifierArtefact,
  type JeuLieDto,
  type ModifierArtefactCorps,
  type Provenance,
  type VersionArtefactDto,
} from '@/lib/medic-assist/contrats'
import { peutAdministrerMedicAssist } from '@/lib/medic-assist/contrats/droits'

import type { ArtefactResumeReponse } from './reponse'

export type CodeErreurArtefact =
  | 'spec_invalide'
  | 'jeu_inaccessible'
  | 'introuvable'
  | 'interdit'
  | 'conflit'

/** Erreur prévisible du stockage : le code décide du statut HTTP ou du retour à l'agent. */
export class ErreurArtefact extends Error {
  constructor(
    public readonly code: CodeErreurArtefact,
    message: string
  ) {
    super(message)
    this.name = 'ErreurArtefact'
  }
}

const ESSAIS_MAX = 3
/** Garde-fou sur les listes de partages et d'épingles d'un lecteur. */
const LISTE_ACCES_MAX = 2_000
const LISTE_ARTEFACTS_MAX = 200

const MESSAGES = {
  jeu: 'Jeu de données non accessible.',
  artefactCite: 'Artefact cité non accessible.',
  conversation: 'Conversation introuvable.',
  artefact: 'Artefact introuvable.',
  version: 'Version introuvable.',
  interdit: 'Modification non autorisée.',
  conflit: 'Une version plus récente existe : recharger l’artefact.',
} as const

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Revalide une spécification (le modèle ou le client peuvent se tromper). */
export function validerSpec(brut: unknown): ArtefactSpec {
  const lecture = ArtefactSpecSchema.safeParse(brut)
  if (lecture.success) return lecture.data
  const details = lecture.error.issues
    .slice(0, 5)
    .map(i => `${i.path.length > 0 ? i.path.join('.') : 'spec'} : ${i.message}`)
    .join(' ; ')
  throw new ErreurArtefact('spec_invalide', `Spécification invalide (${details.slice(0, 700)}).`)
}

/** Les jeux et les artefacts cités par la spécification appartiennent tous au lecteur. */
async function verifierReferences(userId: string, spec: ArtefactSpec): Promise<void> {
  const jeux = jeuxReferences(spec)
  if (jeux.length > 0) {
    const trouves = await prisma.assistantJeuDeDonnees.findMany({
      where: { id: { in: jeux }, userId },
      select: { id: true },
    })
    // Même erreur pour un jeu inexistant et pour le jeu d'un autre utilisateur.
    if (trouves.length !== jeux.length) throw new ErreurArtefact('jeu_inaccessible', MESSAGES.jeu)
  }
  const cites = artefactsReferences(spec)
  if (cites.length > 0) {
    const trouves = await prisma.assistantArtefact.findMany({
      where: { id: { in: cites }, userId },
      select: { id: true },
    })
    if (trouves.length !== cites.length) {
      throw new ErreurArtefact('spec_invalide', MESSAGES.artefactCite)
    }
  }
}

async function verifierConversation(contexte: ContexteExecution): Promise<string | null> {
  if (!contexte.conversationId) return null
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id: contexte.conversationId, userId: contexte.userId },
    select: { id: true },
  })
  if (!conversation) throw new ErreurArtefact('introuvable', MESSAGES.conversation)
  return conversation.id
}

function enJson(spec: ArtefactSpec): Prisma.InputJsonValue {
  return spec as unknown as Prisma.InputJsonValue
}

function estConflitUnicite(erreur: unknown): boolean {
  return (
    typeof erreur === 'object' && erreur !== null && (erreur as { code?: unknown }).code === 'P2002'
  )
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/**
 * Crée un artefact (version 1) dans la conversation `contexte.conversationId`.
 * L'id est généré côté code pour que `racineId` soit son propre id dans une seule écriture.
 */
export async function creerArtefact(
  contexte: ContexteExecution,
  entree: EntreeCreerArtefact
): Promise<ArtefactCree> {
  const spec = validerSpec(entree.spec)
  await verifierReferences(contexte.userId, spec)
  const conversationId = await verifierConversation(contexte)

  const id = randomUUID()
  await prisma.assistantArtefact.create({
    data: {
      id,
      racineId: id,
      userId: contexte.userId,
      conversationId,
      version: 1,
      type: spec.type,
      titre: spec.titre,
      spec: enJson(spec),
      jeuxDeDonneesIds: jeuxReferences(spec),
      auteur: 'assistant',
    },
    select: { id: true },
  })
  return { artefactId: id, version: 1, type: spec.type, titre: spec.titre }
}

/** Racine d'un artefact DONT LE LECTEUR EST PROPRIÉTAIRE (propriétaire dans le même `where`). */
async function racineDuProprietaire(userId: string, artefactId: string): Promise<string | null> {
  const ligne = await prisma.assistantArtefact.findFirst({
    where: { id: artefactId, userId },
    select: { racineId: true },
  })
  return ligne?.racineId ?? null
}

/**
 * Écrit la version suivante d'une racine. Conflit d'unicité (racineId, version) : la version
 * est recalculée et l'écriture retentée (3 essais). `versionAttendue` plus ancienne que la
 * dernière version : conflit immédiat.
 */
async function ecrireNouvelleVersion(
  contexte: ContexteExecution,
  racineId: string,
  spec: ArtefactSpec,
  auteur: 'assistant' | 'utilisateur',
  versionAttendue?: number
): Promise<ArtefactCree> {
  for (let essai = 0; essai < ESSAIS_MAX; essai++) {
    const dernier = await prisma.assistantArtefact.findFirst({
      where: { racineId, userId: contexte.userId },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        conversationId: true,
        description: true,
        enregistre: true,
        enregistreA: true,
      },
    })
    if (!dernier) throw new ErreurArtefact('introuvable', MESSAGES.artefact)
    if (versionAttendue !== undefined && versionAttendue < dernier.version) {
      throw new ErreurArtefact('conflit', MESSAGES.conflit)
    }
    const version = dernier.version + 1
    try {
      await prisma.assistantArtefact.create({
        data: {
          userId: contexte.userId,
          conversationId: dernier.conversationId,
          racineId,
          version,
          type: spec.type,
          titre: spec.titre,
          // Un artefact enregistré dans Mes analyses le reste après édition.
          description: dernier.description,
          enregistre: dernier.enregistre,
          enregistreA: dernier.enregistreA,
          spec: enJson(spec),
          jeuxDeDonneesIds: jeuxReferences(spec),
          auteur,
        },
        select: { id: true },
      })
      return { artefactId: racineId, version, type: spec.type, titre: spec.titre }
    } catch (erreur) {
      if (!estConflitUnicite(erreur)) throw erreur
    }
  }
  throw new ErreurArtefact('conflit', MESSAGES.conflit)
}

/**
 * Nouvelle version d'un artefact (outil `modifier_artefact`). Propriétaire seulement ; un
 * artefact d'un autre utilisateur est `introuvable`. Sortie : `artefactId` = racine.
 */
export async function modifierArtefact(
  contexte: ContexteExecution,
  entree: EntreeModifierArtefact
): Promise<ArtefactCree> {
  const spec = validerSpec(entree.spec)
  const racineId = await racineDuProprietaire(contexte.userId, entree.artefactId)
  if (racineId && !(await ressourceDansPerimetre(contexte, 'artefact', racineId))) throw new ErreurArtefact('introuvable', MESSAGES.artefact)
  if (!racineId) throw new ErreurArtefact('introuvable', MESSAGES.artefact)
  await verifierReferences(contexte.userId, spec)
  return ecrireNouvelleVersion(contexte, racineId, spec, 'assistant')
}

/**
 * Édition depuis l'interface (PATCH) : `{ spec, versionAttendue? }` ou `{ restaurerVersion }`.
 * Propriétaire seulement. Un lecteur qui voit l'artefact sans le posséder reçoit `interdit`
 * (403) ; un artefact absent ou invisible, `introuvable` (404).
 */
export async function modifierArtefactParUtilisateur(
  contexte: ContexteExecution,
  artefactId: string,
  corps: ModifierArtefactCorps
): Promise<ArtefactCree> {
  const racineId = await racineDuProprietaire(contexte.userId, artefactId)
  if (racineId && !(await ressourceDansPerimetre(contexte, 'artefact', racineId))) throw new ErreurArtefact('introuvable', MESSAGES.artefact)
  if (!racineId) {
    const visible = await trouverLigneAccessible(contexte, artefactId)
    throw visible
      ? new ErreurArtefact('interdit', MESSAGES.interdit)
      : new ErreurArtefact('introuvable', MESSAGES.artefact)
  }

  let spec: ArtefactSpec
  let versionAttendue: number | undefined
  if ('restaurerVersion' in corps) {
    const source = await prisma.assistantArtefact.findFirst({
      where: { racineId, userId: contexte.userId, version: corps.restaurerVersion },
      select: { spec: true },
    })
    if (!source) throw new ErreurArtefact('introuvable', MESSAGES.version)
    spec = validerSpec(source.spec)
  } else {
    spec = validerSpec(corps.spec)
    versionAttendue = corps.versionAttendue
  }
  await verifierReferences(contexte.userId, spec)
  return ecrireNouvelleVersion(contexte, racineId, spec, 'utilisateur', versionAttendue)
}

// ---------------------------------------------------------------------------
// Accès en lecture
// ---------------------------------------------------------------------------

interface ListesAcces {
  partagesArtefact: string[]
  partagesConversation: string[]
  epingles: string[]
}

/** Partages reçus et épingles du LECTEUR (requêtes bornées à `contexte.userId`). */
async function chargerListesAcces(userId: string): Promise<ListesAcces> {
  const [artefacts, conversations, epingles] = await Promise.all([
    prisma.assistantPartage.findMany({
      where: { aUserId: userId, ressourceType: 'artefact' },
      select: { ressourceId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LISTE_ACCES_MAX,
    }),
    prisma.assistantPartage.findMany({
      where: { aUserId: userId, ressourceType: 'conversation' },
      select: { ressourceId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LISTE_ACCES_MAX,
    }),
    prisma.assistantEpingle.findMany({
      where: { userId },
      select: { artefactRacineId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LISTE_ACCES_MAX,
    }),
  ])
  // `ressourceId` d'un partage d'artefact : la racine OU l'id d'une version. Les ids de version
  // (propres aux partages DU LECTEUR) sont ramenés à leur racine : un partage ouvre l'artefact.
  const cibles = artefacts.map(p => p.ressourceId)
  const racinesPartagees = new Set(cibles)
  if (cibles.length > 0) {
    const versionsPartagees = await prisma.assistantArtefact.findMany({
      where: { id: { in: cibles } },
      select: { racineId: true },
    })
    for (const v of versionsPartagees) racinesPartagees.add(v.racineId)
  }
  return {
    partagesArtefact: [...racinesPartagees],
    partagesConversation: conversations.map(p => p.ressourceId),
    epingles: epingles.map(e => e.artefactRacineId),
  }
}

interface LigneAccessible {
  id: string
  userId: string
  racineId: string
  conversationId: string | null
  estProprietaire: boolean
  epingle: boolean
}

/**
 * UNE requête : l'artefact existe ET le lecteur est propriétaire, destinataire d'un partage
 * d'artefact (`ressourceId` = racine OU id d'une version), destinataire d'un partage de sa
 * conversation, ou l'a épinglé. Null : absent ou non accessible (indiscernables).
 */
async function trouverLigneAccessible(
  contexte: ContexteExecution,
  artefactId: string,
  listes?: ListesAcces
): Promise<LigneAccessible | null> {
  const acces = listes ?? (await chargerListesAcces(contexte.userId))
  const ligne = await prisma.assistantArtefact.findFirst({
    where: {
      id: artefactId,
      OR: [
        { userId: contexte.userId },
        { racineId: { in: acces.partagesArtefact } },
        { conversationId: { in: acces.partagesConversation } },
        { racineId: { in: acces.epingles } },
      ],
    },
    select: { id: true, userId: true, racineId: true, conversationId: true },
  })
  if (!ligne) return null
  if (!(await auteurDansPerimetreLecteur(contexte.scope.donnees, contexte.userId, ligne.userId))) return null
  return {
    ...ligne,
    estProprietaire: ligne.userId === contexte.userId,
    epingle: acces.epingles.includes(ligne.racineId),
  }
}

function sansSql(provenance: Provenance): Provenance {
  const { sql: _sql, ...reste } = provenance
  void _sql
  return reste
}

/**
 * Lit un artefact (GET /api/medic-assist/artefacts/[id]). `options.version` : version à lire,
 * la dernière par défaut (404 si elle n'existe pas). `droits` : lecture et export pour tout
 * lecteur ; modification, partage et programmation pour le propriétaire seulement.
 * Les jeux sont décrits SANS leurs lignes ; le SQL de la provenance n'est conservé que pour un
 * administrateur de Medic Assist.
 */
export async function lireArtefact(
  contexte: ContexteExecution,
  artefactId: string,
  options?: { version?: number }
): Promise<ArtefactDto> {
  const listes = await chargerListesAcces(contexte.userId)
  const ligne = await trouverLigneAccessible(contexte, artefactId, listes)
  if (!ligne) throw new ErreurArtefact('introuvable', MESSAGES.artefact)

  const versions = await prisma.assistantArtefact.findMany({
    where: { racineId: ligne.racineId, userId: ligne.userId },
    orderBy: { version: 'asc' },
    select: {
      version: true,
      titre: true,
      type: true,
      createdAt: true,
      auteur: true,
      enregistre: true,
      conversationId: true,
    },
  })
  if (versions[0] && !contenuAuPerimetreCourant(contexte.scope.donnees, versions[0].createdAt)) {
    throw new ErreurArtefact('introuvable', MESSAGES.version)
  }
  const derniere = versions[versions.length - 1]
  const cible =
    options?.version === undefined ? derniere : versions.find(v => v.version === options.version)
  if (!derniere || !cible) throw new ErreurArtefact('introuvable', MESSAGES.version)

  const [contenu, proprietaire] = await Promise.all([
    prisma.assistantArtefact.findFirst({
      where: { racineId: ligne.racineId, userId: ligne.userId, version: cible.version },
      select: { spec: true },
    }),
    prisma.user.findUnique({
      where: { id: ligne.userId },
      select: { id: true, firstName: true, lastName: true },
    }),
  ])
  if (!contenu) throw new ErreurArtefact('introuvable', MESSAGES.version)
  const spec = contenu.spec as unknown as ArtefactSpec

  const admin = peutAdministrerMedicAssist(contexte.roleName, contexte.habilitations)
  const idsJeux = jeuxReferences(spec)
  const jeuxLus =
    idsJeux.length === 0
      ? []
      : await prisma.assistantJeuDeDonnees.findMany({
          // Le jeu doit appartenir au propriétaire de l'artefact (jamais à un tiers).
          where: { id: { in: idsJeux }, userId: ligne.userId },
          select: {
            id: true,
            colonnes: true,
            nbLignes: true,
            tronque: true,
            provenance: true,
            calculeA: true,
          },
        })
  const jeux: JeuLieDto[] = []
  for (const id of idsJeux) {
    const jeu = jeuxLus.find(j => j.id === id)
    if (!jeu) continue
    const provenance = jeu.provenance as unknown as Provenance
    jeux.push({
      jeuDeDonneesId: jeu.id,
      colonnes: jeu.colonnes as unknown as ColonneJeu[],
      nbLignes: jeu.nbLignes,
      tronque: jeu.tronque,
      provenance: admin ? provenance : sansSql(provenance),
      calculeA: jeu.calculeA.toISOString(),
    })
  }

  const listeVersions: VersionArtefactDto[] = versions.map(v => ({
    version: v.version,
    titre: v.titre,
    type: v.type as VersionArtefactDto['type'],
    creeA: v.createdAt.toISOString(),
    auteur: v.auteur === 'utilisateur' ? 'utilisateur' : 'assistant',
  }))

  const nom = proprietaire ? `${proprietaire.firstName} ${proprietaire.lastName}`.trim() : ''
  return {
    id: ligne.racineId,
    conversationId: cible.conversationId,
    type: cible.type as ArtefactDto['type'],
    titre: cible.titre,
    spec,
    version: cible.version,
    versions: listeVersions,
    jeux,
    // « Enregistré » est propre au propriétaire (Mes analyses) ; porté par la dernière version.
    enregistre: ligne.estProprietaire && derniere.enregistre,
    epingle: ligne.epingle,
    droits: {
      lecture: true,
      modification: ligne.estProprietaire,
      partage: ligne.estProprietaire,
      export: true,
      programmation: ligne.estProprietaire,
    },
    proprietaire: { id: ligne.userId, nom },
    creeA: versions[0].createdAt.toISOString(),
    majA: derniere.createdAt.toISOString(),
  }
}

/**
 * Artefacts d'une conversation (onglets du panneau), dernière version de chaque racine, dans
 * l'ordre de création. Le lecteur voit ceux de sa propre conversation et, si la conversation
 * lui est partagée, ceux de son propriétaire. Conversation inconnue ou d'un autre : liste vide.
 */
export async function listerArtefactsConversation(
  contexte: ContexteExecution,
  conversationId: string
): Promise<ArtefactResumeReponse[]> {
  const listes = await chargerListesAcces(contexte.userId)
  const where: Prisma.AssistantArtefactWhereInput = {
    conversationId,
    OR: [{ userId: contexte.userId }, { conversationId: { in: listes.partagesConversation } }],
  }
  const [dernieres, premieres] = await Promise.all([
    prisma.assistantArtefact.findMany({
      where,
      orderBy: [{ racineId: 'asc' }, { version: 'desc' }, { id: 'asc' }],
      distinct: ['racineId'],
      select: {
        id: true,
        racineId: true,
        version: true,
        type: true,
        titre: true,
        spec: true,
        createdAt: true,
        userId: true,
      },
      take: LISTE_ARTEFACTS_MAX,
    }),
    prisma.assistantArtefact.findMany({
      where: { ...where, version: 1 },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { racineId: true, createdAt: true },
      take: LISTE_ARTEFACTS_MAX,
    }),
  ])
  const creation = new Map(premieres.map(p => [p.racineId, p.createdAt.getTime()]))
  const autorisations = await Promise.all(dernieres.map(a =>
    contenuAuPerimetreCourant(contexte.scope.donnees, new Date(creation.get(a.racineId) ?? a.createdAt.getTime())) &&
      auteurDansPerimetreLecteur(contexte.scope.donnees, contexte.userId, a.userId),
  ))
  return dernieres.filter((_, index) => autorisations[index])
    .map(a => {
      const sousTitre = (a.spec as { sousTitre?: unknown } | null)?.sousTitre
      const resume: ArtefactResumeReponse = {
        id: a.racineId,
        racineId: a.racineId,
        type: a.type as ArtefactResumeReponse['type'],
        titre: a.titre,
        ...(typeof sousTitre === 'string' ? { sousTitre } : {}),
        version: a.version,
        majA: a.createdAt.toISOString(),
      }
      return { resume, creeA: creation.get(a.racineId) ?? a.createdAt.getTime() }
    })
    .sort((x, y) => x.creeA - y.creeA)
    .map(x => x.resume)
}
