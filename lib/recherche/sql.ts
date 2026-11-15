import { Prisma } from '@prisma/client'
import { normaliser } from '@/lib/glossaire/normaliser'

// Chaque groupe associe des lettres accentuées à leur équivalent sans accent (majuscules comprises,
// pour ne pas dépendre de la locale de lower() sur les capitales accentuées).
const GROUPES: [string, string][] = [
  ['àâäáãå', 'a'], ['ç', 'c'], ['éèêë', 'e'], ['íìîï', 'i'], ['ñ', 'n'],
  ['óòôöõ', 'o'], ['úùûü', 'u'], ['ýÿ', 'y'],
  ['ÀÂÄÁÃÅ', 'A'], ['Ç', 'C'], ['ÉÈÊË', 'E'], ['ÍÌÎÏ', 'I'], ['Ñ', 'N'],
  ['ÓÒÔÖÕ', 'O'], ['ÚÙÛÜ', 'U'], ['ÝŸ', 'Y'],
]
export const ACCENTS = GROUPES.map(([accentuees]) => accentuees).join('')
export const SANS_ACCENT = GROUPES.map(([accentuees, lettre]) => lettre.repeat(accentuees.length)).join('')

/**
 * Condition « la colonne contient la requête », insensible à la casse et aux accents,
 * sans extension PostgreSQL ni joker : `position` sur un texte normalisé. Toutes les
 * valeurs sont des paramètres liés. `colonne` est un fragment écrit en dur dans le code.
 *
 * Limite de translate() : seules les lettres latines accentuées listées ci-dessus sont repliées. Les
 * ligatures (œ, æ), les lettres d'autres alphabets latins (ł, ø, ß...) et les écritures arabe, hindi et
 * chinoise ne sont comparées qu'à l'identique ; lower() PostgreSQL suit la locale de la base, donc la
 * casse des écritures non latines n'est pas garantie. Étendre ACCENTS/SANS_ACCENT si un besoin apparaît.
 */
export function contient(colonne: Prisma.Sql, requete: string): Prisma.Sql {
  return Prisma.sql`position(${normaliser(requete)}::text in lower(translate(coalesce(${colonne}, ''), ${ACCENTS}::text, ${SANS_ACCENT}::text))) > 0`
}
