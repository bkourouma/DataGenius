import { z } from 'zod'
import { prisma } from '@/lib/db/client'

const colonne = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)
export const regleDonneesSchema = z.strictObject({
  groupes: z.array(z.string().uuid()).max(50),
  masquer: z.array(colonne).max(50),
  filtre: z.strictObject({ colonne, valeur: z.string().max(500) }).nullable(),
})

export type RegleDonnees = z.infer<typeof regleDonneesSchema>
export interface DroitsDonnees {
  revision: string
  depuis: Date
  administrateur: boolean
  groupes: ReadonlySet<string>
  regles: ReadonlyMap<string, RegleDonnees>
  espaces: ReadonlyMap<string, readonly string[]>
}

/** Charge la politique et les appartenances dans le même instantané PostgreSQL. */
export async function chargerDroitsDonnees(userId: string, roleName: string): Promise<DroitsDonnees | undefined> {
  const [etat] = await prisma.$queryRaw<{
    revision: string; depuis: Date | null; groupes: string[]; regles: Record<string, unknown>; espaces: Record<string, string[]>
  }[]>`
    SELECT revision::text AS revision, CASE WHEN revision > 0 THEN depuis END AS depuis,
      ARRAY(SELECT groupe_id::text FROM warehouse.membres_groupes WHERE utilisateur_id = ${userId}) AS groupes,
      COALESCE((SELECT jsonb_object_agg(jeu, definition) FROM warehouse.regles_acces), '{}') AS regles,
      COALESCE((SELECT jsonb_object_agg(e.jeu, ARRAY(SELECT eg.groupe_id::text
        FROM warehouse.espaces_groupes eg WHERE eg.espace_id = e.espace_id)) FROM warehouse.espaces_jeux e), '{}') AS espaces
    FROM warehouse.revision_acces WHERE id = 1
  `
  if (!etat) throw new Error('La configuration des droits est indisponible.')
  if (!etat.depuis) return undefined
  return {
    revision: etat.revision,
    depuis: etat.depuis,
    administrateur: roleName === 'TenantAdmin',
    groupes: new Set(etat.groupes),
    regles: new Map(Object.entries(etat.regles).map(([jeu, definition]) => [jeu, regleDonneesSchema.parse(definition)])),
    espaces: new Map(Object.entries(etat.espaces)),
  }
}

export function restrictionsActives(droits: DroitsDonnees | undefined): droits is DroitsDonnees {
  return !!droits && (droits.regles.size > 0 || droits.espaces.size > 0)
}

export function peutConsulterJeu(droits: DroitsDonnees, cle: string) {
  if (droits.administrateur) return true
  const espace = droits.espaces.get(cle)
  const regle = droits.regles.get(cle)
  return (!espace || espace.some(id => droits.groupes.has(id))) &&
    (!regle || regle.groupes.some(id => droits.groupes.has(id)))
}

/** Le texte d'un résultat peut inclure des données de plusieurs jeux, même sans références structurées. */
export function contenuAuPerimetreCourant(droits: DroitsDonnees | undefined, dateCreation: Date) {
  return !restrictionsActives(droits) || droits.administrateur || dateCreation >= droits.depuis
}

/** Autorise un transfert de contenu déjà calculé si le destinataire couvre le périmètre de l'auteur. */
export async function destinataireCouvrePerimetre(auteur: DroitsDonnees | undefined, destinataireId: string) {
  if (!restrictionsActives(auteur)) return true
  const droits = await droitsCompteActif(destinataireId)
  return droits ? couvrePerimetre(auteur, droits) : false
}

async function droitsCompteActif(id: string) {
  const compte = await prisma.user.findFirst({
    where: { id, status: 'active', deletedAt: null },
    select: { roleName: true },
  })
  return compte ? chargerDroitsDonnees(id, compte.roleName) : undefined
}

function couvrePerimetre(auteur: DroitsDonnees, lecteur: DroitsDonnees) {
  if (lecteur.revision !== auteur.revision) return false
  if (lecteur.administrateur) return true
  return [...new Set([...auteur.regles.keys(), ...auteur.espaces.keys()])].every(cle => {
    if (!peutConsulterJeu(auteur, cle)) return true
    const regle = auteur.regles.get(cle)
    if (auteur.administrateur && (regle?.filtre || regle?.masquer.length)) return false
    return peutConsulterJeu(lecteur, cle)
  })
}

export async function auteurDansPerimetreLecteur(lecteur: DroitsDonnees | undefined, lecteurId: string, auteurId: string) {
  if (!restrictionsActives(lecteur) || lecteur.administrateur || lecteurId === auteurId) return true
  const droits = await droitsCompteActif(auteurId)
  return droits ? couvrePerimetre(droits, lecteur) : false
}
