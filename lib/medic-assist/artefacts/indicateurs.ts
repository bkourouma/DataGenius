/**
 * Résolution des cartes d'indicateurs : valeur, comparaison, variation, objectif et statut.
 * Module pur : les chiffres viennent des jeux de données, rien n'est recalculé ailleurs.
 */

import { SEUIL_TAUX_ATTEINT } from '@/lib/donnees/seuils-taux'
import { estDecimalExact, type NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'

import { creerFormateur, enNombre, formatParDefaut } from './formats'

import type {
  CarteIndicateur,
  FormatColonne,
  SourceValeur,
} from '@/lib/medic-assist/contrats'
import type { IndicateurResolu, JeuClient, StatutObjectif } from './types-rendu'

/**
 * Statut d'un objectif (cible) d'une carte d'indicateur :
 * - « atteint » quand la valeur est au moins égale à l'objectif (la flèche de tendance
 *   n'intervient pas : règle validée par le métier) ;
 * - « en cours » du seuil `SEUIL_TAUX_ATTEINT` (90 %, importé de `lib/donnees/seuils-taux`,
 *   inclus) jusqu'à 100 % (exclu) ;
 * - « à risque » en dessous.
 */
export function statutObjectif(valeur: number, objectif: number): StatutObjectif {
  if (objectif === 0) return 'a_risque'
  if (valeur >= objectif) return 'atteint'
  if (objectif < 0) return 'a_risque'
  return (valeur / objectif) * 100 >= SEUIL_TAUX_ATTEINT ? 'en_cours' : 'a_risque'
}

/** Écart sous lequel une variation est jugée stable (en points de pourcentage). */
const SEUIL_STABLE = 0.05

interface Resolution {
  valeur: NombreAnalytique | null
  format: FormatColonne
  unite?: string
}

function egalTolerant(cellule: unknown, valeur: unknown): boolean {
  if (cellule === null || cellule === undefined) return false
  return String(cellule).toLowerCase() === String(valeur).toLowerCase()
}

/**
 * Valeur d'une colonne quand aucune ligne n'est précisée. Règle unique, partagée par les cartes
 * d'indicateurs, la jauge, l'écran et les exports :
 * - le total du jeu (`jeu.totaux`) quand il existe ;
 * - à défaut, la valeur de l'unique ligne d'un jeu d'une seule ligne ;
 * - jamais la première ligne d'un jeu de plusieurs lignes (ce serait un chiffre faux, présenté
 *   comme le total) : pas de valeur (`null`).
 */
export function valeurSansLigne(
  jeu: Pick<JeuClient, 'lignes' | 'totaux'>,
  colonne: string
): unknown {
  const total = jeu.totaux?.[colonne]
  if (total !== undefined && total !== null) return total
  const lignes = jeu.lignes ?? []
  return lignes.length === 1 ? lignes[0][colonne] : null
}

/** Résout une source dans les jeux ; `formatCarte` l'emporte sur le type de la colonne. */
function resoudreSource(
  source: SourceValeur,
  jeux: Record<string, JeuClient>,
  formatCarte: FormatColonne | undefined
): Resolution {
  const jeu = jeux[source.jeuDeDonneesId]
  const colonne = jeu?.colonnes.find(c => c.cle === source.colonne)
  const format = formatCarte ?? (colonne ? formatParDefaut(colonne) : 'decimal')
  const unite = colonne?.unite
  if (!jeu) return { valeur: null, format, unite }

  const lignes = jeu.lignes ?? []
  let brut: unknown = null
  const { ligne } = source
  if (typeof ligne === 'number') {
    brut = Number.isInteger(ligne) && ligne >= 0 ? lignes[ligne]?.[source.colonne] : null
  } else if (ligne && typeof ligne === 'object') {
    const trouvee = lignes.find(l => egalTolerant(l[ligne.cle], ligne.valeur))
    brut = trouvee?.[source.colonne]
  } else {
    brut = valeurSansLigne(jeu, source.colonne)
  }
  return { valeur: estDecimalExact(brut) ? brut : enNombre(brut), format, unite }
}

export function resoudreIndicateurs(
  cartes: CarteIndicateur[],
  jeux: Record<string, JeuClient>,
  locale: string
): IndicateurResolu[] {
  return cartes.map(carte => {
    const principale = resoudreSource(carte.source, jeux, carte.format)
    const formater = (r: Resolution): string =>
      r.valeur === null ? '' : creerFormateur(r.format, locale, { unite: r.unite })(r.valeur)

    const resolu: IndicateurResolu = {
      libelle: carte.libelle,
      valeur: principale.valeur,
      format: principale.format,
      valeurFormatee: formater(principale),
    }

    if (carte.comparaison) {
      const ref = resoudreSource(carte.comparaison.source, jeux, carte.format)
      let variationPct: number | null = null
      if (typeof principale.valeur === 'number' && typeof ref.valeur === 'number' && ref.valeur !== 0) {
        variationPct = ((principale.valeur - ref.valeur) / Math.abs(ref.valeur)) * 100
      }
      resolu.comparaison = {
        libelle: carte.comparaison.libelle,
        valeur: ref.valeur,
        valeurFormatee: formater(ref),
        variationPct,
        sens:
          variationPct === null
            ? null
            : Math.abs(variationPct) < SEUIL_STABLE
              ? 'stable'
              : variationPct > 0
                ? 'hausse'
                : 'baisse',
      }
    }

    if (carte.objectif) {
      const cible = resoudreSource(carte.objectif.source, jeux, carte.format)
      const calculable = typeof principale.valeur === 'number' && typeof cible.valeur === 'number' && cible.valeur !== 0
      resolu.objectif = {
        libelle: carte.objectif.libelle,
        valeur: cible.valeur,
        valeurFormatee: formater(cible),
        taux: calculable ? ((principale.valeur as number) / (cible.valeur as number)) * 100 : null,
        statut: calculable
          ? statutObjectif(principale.valeur as number, cible.valeur as number)
          : null,
      }
    }

    return resolu
  })
}

