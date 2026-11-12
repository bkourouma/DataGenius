/**
 * Tableau vers TSV (texte séparé par des tabulations) pour coller dans Excel.
 *
 * Module pur. Les valeurs sont FORMATÉES comme à l'écran (`creerFormateur`) : c'est ce que
 * l'utilisateur voit qu'il copie. Une tabulation ou un retour à la ligne dans une cellule
 * casserait la grille au collage : ils sont remplacés par une espace.
 */

import { creerFormateur } from './formats'

import type { ModeleTableau } from './types-rendu'

export interface OptionsTsv {
  locale: string
  /** Libellé de la ligne de totaux (traduit par l'appelant). */
  libelleTotal: string
}

// Séparateurs de ligne Unicode inclus (codes 8232 et 8233), sans caractère invisible dans le source.
const SEPARATEURS_CASSANTS = new RegExp('[' + String.fromCharCode(9, 10, 13, 0x2028, 0x2029) + ']+', 'g')

/** Une cellule sans tabulation ni retour à la ligne. */
export function nettoyerCelluleTsv(texte: string): string {
  return texte.replace(SEPARATEURS_CASSANTS, ' ')
}

/**
 * Lignes d'en-tête : une par niveau d'`entete` (pivot), sinon une seule avec `libelle`.
 * Les niveaux sont alignés sur le bas : une colonne à un seul niveau (dimension, total)
 * porte son libellé sur la dernière ligne d'en-tête.
 */
function lignesEntete(modele: ModeleTableau): string[][] {
  const niveaux = modele.colonnes.map(c =>
    c.entete && c.entete.length > 0 ? c.entete : [c.libelle]
  )
  const profondeur = niveaux.reduce((max, n) => Math.max(max, n.length), 1)
  const lignes: string[][] = []
  for (let i = 0; i < profondeur; i++) {
    lignes.push(
      niveaux.map(n => {
        const decalage = profondeur - n.length
        return i < decalage ? '' : n[i - decalage]
      })
    )
  }
  return lignes
}

export function modeleVersTsv(modele: ModeleTableau, options: OptionsTsv): string {
  const formateurs = modele.colonnes.map(c =>
    creerFormateur(c.format, options.locale, { unite: c.unite })
  )
  const sortie: string[] = []

  for (const ligne of lignesEntete(modele)) {
    sortie.push(ligne.map(nettoyerCelluleTsv).join('\t'))
  }

  for (const ligne of modele.lignes) {
    sortie.push(
      modele.colonnes
        .map((c, i) => nettoyerCelluleTsv(formateurs[i](ligne[c.id])))
        .join('\t')
    )
  }

  if (modele.totaux) {
    const totaux = modele.totaux
    sortie.push(
      modele.colonnes
        .map((c, i) => {
          const valeur = formateurs[i](totaux[c.id])
          if (i === 0) {
            return nettoyerCelluleTsv(valeur ? `${options.libelleTotal} ${valeur}` : options.libelleTotal)
          }
          return nettoyerCelluleTsv(valeur)
        })
        .join('\t')
    )
  }

  return sortie.join('\n')
}
