/**
 * Tri par libelle, de A a Z.
 *
 * Regle de l'application : toute liste, tout tableau, tout pivot et tout menu
 * qui affiche des elements nommes (produits, pays, grossistes...) les range par
 * libelle croissant. Ce module est la seule facon de comparer deux libelles :
 * un `a.localeCompare(b)` ou un `a < b` isoles redonnent un ordre different
 * selon l'ecran (accents rejetes en fin d'alphabet, « Produit 10 » avant
 * « Produit 2 »...).
 *
 * Regles de comparaison :
 *  - les accents et la casse ne comptent pas (« Egypte », « Égypte » et
 *    « egypte » sont voisins) ;
 *  - les nombres se comparent comme des nombres (« Produit 2 » avant « Produit 10 ») ;
 *  - une valeur vide (null, undefined, chaine vide ou d'espaces) passe en dernier ;
 *  - a egalite, l'ordre des chaines brutes departage, pour qu'un meme jeu de
 *    donnees donne toujours le meme affichage.
 */

/** Langue de repli : celle de l'application avant toute traduction. */
const LANGUE_PAR_DEFAUT = "fr"

/**
 * Un comparateur `Intl.Collator` coute cher a construire : on en garde un par
 * langue au lieu d'en creer un a chaque comparaison (un tri en fait des milliers).
 */
const comparateurs = new Map<string, Intl.Collator>()

function comparateurPour(locale: string): Intl.Collator {
  let comparateur = comparateurs.get(locale)
  if (!comparateur) {
    comparateur = new Intl.Collator(locale, { sensitivity: "base", numeric: true })
    comparateurs.set(locale, comparateur)
  }
  return comparateur
}

/** Valeur absente : null, undefined, chaine vide ou faite d'espaces. */
function estVide(valeur: unknown): boolean {
  return valeur === null || valeur === undefined || String(valeur).trim() === ""
}

/**
 * Compare deux libelles pour un tri croissant (A -> Z) dans la langue donnee.
 * Utilisable directement comme argument de `Array.prototype.sort`.
 */
export function comparerLibelles(a: unknown, b: unknown, locale: string = LANGUE_PAR_DEFAUT): number {
  const aVide = estVide(a)
  const bVide = estVide(b)
  if (aVide || bVide) {
    if (aVide && bVide) return 0
    return aVide ? 1 : -1
  }

  const brutA = String(a)
  const brutB = String(b)
  const resultat = comparateurPour(locale).compare(brutA.trim(), brutB.trim())
  if (resultat !== 0) return resultat

  // Egalite au sens de l'alphabet (meme mot a l'accent ou a la casse pres) :
  // on departage sur les chaines brutes pour un ordre deterministe.
  return brutA < brutB ? -1 : brutA > brutB ? 1 : 0
}

/**
 * Renvoie une COPIE de `elements` triee par libelle croissant ; le tableau
 * recu n'est jamais modifie. Le tri est stable : deux elements de meme libelle
 * gardent leur ordre d'origine.
 */
export function trierParLibelle<T>(
  elements: readonly T[],
  libelle: (element: T) => unknown,
  locale: string = LANGUE_PAR_DEFAUT
): T[] {
  // Le libelle est calcule une fois par element, pas a chaque comparaison.
  return elements
    .map((element) => ({ element, cle: libelle(element) }))
    .sort((x, y) => comparerLibelles(x.cle, y.cle, locale))
    .map(({ element }) => element)
}

/** Nombre, bigint ou date exploitable pour une comparaison numerique ; sinon `undefined`. */
function valeurNumerique(valeur: unknown): number | bigint | undefined {
  if (typeof valeur === "bigint") return valeur
  if (typeof valeur === "number") return Number.isNaN(valeur) ? undefined : valeur
  if (valeur instanceof Date) {
    const instant = valeur.getTime()
    return Number.isNaN(instant) ? undefined : instant
  }
  return undefined
}

/**
 * Compare deux valeurs de cellule pour le tri d'une colonne de tableau :
 * nombres, bigint et dates se comparent par leur valeur (negatifs et decimaux
 * compris), le reste comme des libelles. Les valeurs vides passent en dernier.
 */
export function trierCellules(a: unknown, b: unknown, locale: string = LANGUE_PAR_DEFAUT): number {
  const numeriqueA = valeurNumerique(a)
  const numeriqueB = valeurNumerique(b)

  if (numeriqueA !== undefined && numeriqueB !== undefined) {
    return numeriqueA < numeriqueB ? -1 : numeriqueA > numeriqueB ? 1 : 0
  }

  // Un nombre (ou une date) face a une valeur vide ou invalide : la valeur
  // vide passe apres, comme dans `comparerLibelles`.
  if (numeriqueA !== undefined && (estVide(b) || b instanceof Date || typeof b === "number")) return -1
  if (numeriqueB !== undefined && (estVide(a) || a instanceof Date || typeof a === "number")) return 1

  return comparerLibelles(a, b, locale)
}
