/**
 * Base Prisma en mémoire pour les tests des garde-fous du chat (verrou, idempotence, fin de
 * tour). Ne couvre que les formes de requêtes utilisées par lib/medic-assist/agent
 * (persistance.ts, verrou.ts) : égalité, null, `OR`, `in`, `lt`, `gt`, `gte`, relation
 * `conversation: { userId }` et `messages: { none: {} }`. La contrainte unique
 * (conversationId, idClient) lève une vraie erreur Prisma P2002, NULL distincts comme en
 * PostgreSQL. `$transaction` est tout ou rien (instantané restauré en cas d'échec).
 */
import { Prisma } from '@prisma/client'

type Ligne = Record<string, unknown>
type Where = Record<string, unknown>

interface Etat {
  conversations: Ligne[]
  messages: Ligne[]
  usages: Ligne[]
  actions: Ligne[]
  piecesJointes: Ligne[]
}

let etat: Etat = vide()
let compteur = 0
/** Échecs injectés : nom de l'opération -> erreur à lever (une fois). */
const pannes = new Map<string, Error>()

function vide(): Etat {
  return { conversations: [], messages: [], usages: [], actions: [], piecesJointes: [] }
}

function nouvelId(prefixe: string): string {
  compteur += 1
  return `${prefixe}_${compteur.toString().padStart(4, '0')}`
}

function valeurComparable(v: unknown): unknown {
  return v instanceof Date ? v.getTime() : v
}

function correspondChamp(valeur: unknown, condition: unknown): boolean {
  if (condition === null) return valeur === null || valeur === undefined
  if (condition instanceof Date) {
    return valeur instanceof Date && valeur.getTime() === condition.getTime()
  }
  if (typeof condition === 'object' && !Array.isArray(condition)) {
    const c = condition as Record<string, unknown>
    const v = valeurComparable(valeur)
    if ('in' in c) return (c.in as unknown[]).includes(valeur)
    if ('lt' in c) return valeur != null && (v as number) < (valeurComparable(c.lt) as number)
    if ('gt' in c) return valeur != null && (v as number) > (valeurComparable(c.gt) as number)
    if ('gte' in c) return valeur != null && (v as number) >= (valeurComparable(c.gte) as number)
    throw new Error(`Condition non prise en charge : ${JSON.stringify(c)}`)
  }
  return valeur === condition
}

function correspond(ligne: Ligne, where: Where | undefined, table: keyof Etat): boolean {
  if (!where) return true
  return Object.entries(where).every(([cle, condition]) => {
    if (condition === undefined) return true
    if (cle === 'OR') return (condition as Where[]).some(w => correspond(ligne, w, table))
    if (cle === 'AND') return (condition as Where[]).every(w => correspond(ligne, w, table))
    if (cle === 'conversation') {
      const conv = etat.conversations.find(c => c.id === ligne.conversationId)
      return !!conv && correspond(conv, condition as Where, 'conversations')
    }
    if (cle === 'messages' && table === 'conversations') {
      const c = condition as { none?: Where }
      const siens = etat.messages.filter(m => m.conversationId === ligne.id)
      if (c.none) return !siens.some(m => correspond(m, c.none, 'messages'))
      throw new Error('Relation messages non prise en charge')
    }
    return correspondChamp(ligne[cle], condition)
  })
}

function selectionner(ligne: Ligne, select?: Record<string, boolean>): Ligne {
  if (!select) return { ...ligne }
  return Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, ligne[k]]))
}

function panne(nom: string): void {
  const erreur = pannes.get(nom)
  if (erreur) {
    pannes.delete(nom)
    throw erreur
  }
}

function violationUnicite(): Error {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`conversationId`,`idClient`)',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['conversationId', 'idClient'] } }
  )
}

function trier(lignes: Ligne[]): Ligne[] {
  return [...lignes].sort(
    (a, b) =>
      (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() ||
      String(a.id).localeCompare(String(b.id))
  )
}

/** Horloge des `createdAt` : strictement croissante, pour un ordre stable. */
let tic = Date.UTC(2026, 10, 13, 8, 0, 0)
function horodatage(): Date {
  tic += 1
  return new Date(tic)
}

const client = {
  assistantConversation: {
    async create({ data, select }: { data: Ligne; select?: Record<string, boolean> }) {
      panne('conversation.create')
      const ligne: Ligne = {
        id: nouvelId('conv'),
        titre: 'Nouvelle conversation',
        epinglee: false,
        archivee: false,
        tourEnCoursJusqua: null,
        dernierMessageA: horodatage(),
        createdAt: horodatage(),
        ...data,
      }
      etat.conversations.push(ligne)
      return selectionner(ligne, select)
    },
    async findFirst({ where, select }: { where: Where; select?: Record<string, boolean> }) {
      const ligne = etat.conversations.find(c => correspond(c, where, 'conversations'))
      return ligne ? selectionner(ligne, select) : null
    },
    async updateMany({ where, data }: { where: Where; data: Ligne }) {
      panne('conversation.updateMany')
      const cibles = etat.conversations.filter(c => correspond(c, where, 'conversations'))
      for (const c of cibles) Object.assign(c, data)
      return { count: cibles.length }
    },
    async count({ where }: { where: Where }) {
      return etat.conversations.filter(c => correspond(c, where, 'conversations')).length
    },
    async deleteMany({ where }: { where: Where }) {
      const avant = etat.conversations.length
      etat.conversations = etat.conversations.filter(c => !correspond(c, where, 'conversations'))
      return { count: avant - etat.conversations.length }
    },
  },
  assistantMessage: {
    async create({ data }: { data: Ligne }) {
      panne('message.create')
      if (
        typeof data.idClient === 'string' &&
        etat.messages.some(
          m => m.conversationId === data.conversationId && m.idClient === data.idClient
        )
      ) {
        throw violationUnicite()
      }
      if (etat.messages.some(m => m.id === data.id)) throw violationUnicite()
      const ligne: Ligne = { idClient: null, metadonnees: null, createdAt: horodatage(), ...data }
      etat.messages.push(ligne)
      return { ...ligne }
    },
    async findMany({ where, select }: { where: Where; select?: Record<string, boolean> }) {
      const lignes = etat.messages.filter(m => {
        const { role, ...reste } = where as { role?: { in: string[] } }
        return correspond(m, reste, 'messages') && (!role || role.in.includes(m.role as string))
      })
      return trier(lignes).map(l => selectionner(l, select))
    },
    async findFirst({ where, select }: { where: Where; select?: Record<string, boolean> }) {
      const ligne = trier(etat.messages).find(m => correspond(m, where, 'messages'))
      return ligne ? selectionner(ligne, select) : null
    },
    async deleteMany({ where }: { where: Where }) {
      const avant = etat.messages.length
      etat.messages = etat.messages.filter(m => !correspond(m, where, 'messages'))
      return { count: avant - etat.messages.length }
    },
  },
  assistantUsage: {
    async create({ data }: { data: Ligne }) {
      panne('usage.create')
      const ligne = { id: nouvelId('usage'), createdAt: horodatage(), ...data }
      etat.usages.push(ligne)
      return { ...ligne }
    },
  },
  assistantAction: {
    async updateMany({ where, data }: { where: Where; data: Ligne }) {
      const cibles = etat.actions.filter(a => correspond(a, where, 'actions'))
      for (const a of cibles) Object.assign(a, data)
      return { count: cibles.length }
    },
  },
  assistantPieceJointe: {
    async findMany({ where, select }: { where: Where; select?: Record<string, boolean> }) {
      return etat.piecesJointes
        .filter(p => correspond(p, where, 'piecesJointes'))
        .map(p => selectionner(p, select))
    },
    async updateMany({ where, data }: { where: Where; data: Ligne }) {
      const cibles = etat.piecesJointes.filter(p => correspond(p, where, 'piecesJointes'))
      for (const p of cibles) Object.assign(p, data)
      return { count: cibles.length }
    },
  },
  async $transaction<T>(fn: (tx: typeof client) => Promise<T>): Promise<T> {
    const instantane = structuredClone(etat)
    try {
      return await fn(client)
    } catch (erreur) {
      etat = instantane
      throw erreur
    }
  },
}

export const base = client

/** Accès direct aux tables (assertions, préparation). */
export const tables = {
  get conversations() {
    return etat.conversations
  },
  get messages() {
    return etat.messages
  },
  get usages() {
    return etat.usages
  },
}

export function reinitialiserBase(): void {
  etat = vide()
  pannes.clear()
}

/** La prochaine opération `nom` (ex. 'usage.create') lève `erreur`. */
export function injecterPanne(nom: string, erreur: Error = new Error('panne simulée')): void {
  pannes.set(nom, erreur)
}

export function ajouterConversation(ligne: Partial<Ligne> & { userId: string }): Ligne {
  const c: Ligne = {
    id: nouvelId('conv'),
    titre: 'Analyse existante',
    epinglee: false,
    archivee: false,
    tourEnCoursJusqua: null,
    dernierMessageA: horodatage(),
    createdAt: horodatage(),
    ...ligne,
  }
  etat.conversations.push(c)
  return c
}

export function ajouterMessage(ligne: Partial<Ligne> & { conversationId: string; role: string }): Ligne {
  const m: Ligne = {
    id: nouvelId('msg'),
    parts: [{ type: 'text', text: 'Bonjour' }],
    metadonnees: null,
    idClient: null,
    createdAt: horodatage(),
    ...ligne,
  }
  etat.messages.push(m)
  return m
}
