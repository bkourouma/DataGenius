/**
 * « Premier demarrage guide » de l'accueil du chat. Calcul SERVEUR uniquement :
 * chaque etape vient de donnees reelles (entrepot, messages, comptes).
 */

import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats/contexte'
import { registreAutorise } from '@/lib/medic-assist/donnees/catalogue/autorisation'

export type CleEtapeDemarrage = 'source' | 'import' | 'catalogue' | 'question' | 'collegue'

export interface EtapeDemarrage {
  cle: CleEtapeDemarrage
  fait: boolean
  /** Ecran concerne ; null pour l'etape « question » (on la pose dans le chat). */
  href: string | null
}

export interface EtatDemarrage {
  role: 'admin' | 'membre'
  etapes: EtapeDemarrage[]
  masque: boolean
  /** Jeux accessibles au lecteur (Member). */
  nbJeux: number
}

export type AffichageDemarrage = 'admin' | 'membre-sans-jeu' | null

/** Valeur serialisable transmise au composant client (ni Date ni Set). */
export interface ValeurDemarrage {
  affichage: Exclude<AffichageDemarrage, null>
  etapes: EtapeDemarrage[]
}

export const cleMasquageDemarrage = (userId: string) => `demarrage_masque:${userId}`

/**
 * Admin : guide tant que les 5 etapes ne sont pas toutes faites et qu'il n'a pas
 * ete masque (tout fait -> rien). Member : message seulement s'il n'a aucun jeu.
 */
export function calculerAffichage(etat: EtatDemarrage): AffichageDemarrage {
  if (etat.role === 'membre') return etat.nbJeux === 0 ? 'membre-sans-jeu' : null
  if (etat.masque) return null
  const toutFait = etat.etapes.length > 0 && etat.etapes.every((e) => e.fait)
  return toutFait ? null : 'admin'
}

export function valeurDemarrage(etat: EtatDemarrage): ValeurDemarrage | null {
  const affichage = calculerAffichage(etat)
  if (!affichage) return null
  return { affichage, etapes: affichage === 'admin' ? etat.etapes : [] }
}

async function existe(requete: PromiseLike<{ ok: boolean }[]>): Promise<boolean> {
  const [ligne] = await requete
  return ligne?.ok === true
}

export async function etatDemarrage(args: {
  userId: string
  roleName: string
  contexte?: ContexteExecution
  /** true pour un compte autorise a administrer Medic Assist (sinon : roleName === 'TenantAdmin'). */
  admin?: boolean
}): Promise<EtatDemarrage> {
  const { userId, contexte } = args
  const admin = args.admin ?? args.roleName === 'TenantAdmin'

  if (!admin) {
    const nbJeux = contexte ? (await registreAutorise(contexte)).length : 0
    return { role: 'membre', etapes: [], masque: false, nbJeux }
  }

  const [source, importe, catalogue, question, collegue, masque] = await Promise.all([
    existe(prisma.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM warehouse.sources) AS ok`),
    existe(prisma.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM warehouse.imports) AS ok`),
    existe(prisma.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM warehouse.catalogue_metier) AS ok`),
    prisma.assistantMessage.count({ where: { role: 'user', conversation: { userId } } }),
    prisma.user.count({ where: { id: { not: userId }, deletedAt: null } }),
    prisma.parametreApplication.findUnique({ where: { cle: cleMasquageDemarrage(userId) } }),
  ])

  return {
    role: 'admin',
    masque: masque?.valeur === '1',
    nbJeux: 0,
    etapes: [
      { cle: 'source', fait: source, href: '/sources' },
      { cle: 'import', fait: importe, href: '/sources' },
      { cle: 'catalogue', fait: catalogue, href: '/sources' },
      { cle: 'question', fait: question > 0, href: null },
      { cle: 'collegue', fait: collegue > 0, href: '/utilisateurs' },
    ],
  }
}
