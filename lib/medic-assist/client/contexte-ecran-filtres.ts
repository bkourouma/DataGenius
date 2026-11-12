/**
 * Construction du contexte d'ecran de Medic Assist a partir des filtres d'un ecran.
 *
 * Chaque ecran decrit ses filtres actifs (cle, etiquette dans la langue de
 * l'interface, valeur brute, noms affiches) ; l'utilitaire omet les valeurs vides,
 * garde les valeurs BRUTES dans `filtres` (identifiants, codes, annees) et ajoute
 * un `libelle` lisible. Il retourne null quand rien n'est filtre : l'ecran passe
 * alors null a `useEnregistrerContexteMedicAssist`.
 */

import type { ContexteEcran } from '@/lib/medic-assist/contrats/chat'

export type ValeurFiltre = string | number | boolean | null | undefined | ReadonlyArray<string | number>

export interface ChampFiltre {
  /** Cle du filtre dans `filtres` (ex. 'pays', 'exercice'). */
  cle: string
  /** Nom du filtre dans la langue de l'interface (ex. « Pays »). */
  etiquette: string
  /** Valeur brute (identifiant, code, annee, liste d'identifiants). Vide : le filtre est omis. */
  valeur: ValeurFiltre
  /** Noms affiches des valeurs (un par valeur), ajoutes sous `<cle>Noms` et utilises dans le libelle. */
  noms?: string | ReadonlyArray<string>
  /** Texte du libelle quand il differe de la valeur et des noms (ex. periode mise en forme). */
  affichage?: string
  /** Vrai : le filtre figure dans `filtres` mais pas dans le libelle (ex. fin de periode deja citee). */
  horsLibelle?: boolean
}

export interface EntreeContexteFiltres {
  /** Titre de l'ecran, dans la langue de l'interface. */
  titre: string
  champs: ReadonlyArray<ChampFiltre>
  /** Langue de l'interface (BCP 47), pour la mise en liste des noms. */
  locale?: string
  /** Au-dela de ce nombre de noms, le libelle ajoute « +N ». */
  nomsMaxDansLibelle?: number
}

const TAILLE_MAX_FILTRES = 9_000
const LONGUEUR_MAX_LIBELLE = 300
const VALEURS_MAX_PAR_LISTE = 100

export function valeurFiltreVide(valeur: ValeurFiltre): boolean {
  if (valeur === null || valeur === undefined) return true
  if (typeof valeur === 'string') return valeur.trim() === ''
  if (typeof valeur === 'number') return !Number.isFinite(valeur)
  if (typeof valeur === 'boolean') return false
  return valeur.length === 0
}

function enListe(elements: ReadonlyArray<string>, locale?: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(elements)
  } catch {
    return elements.join(', ')
  }
}

function texteChamp(champ: ChampFiltre, locale: string | undefined, nomsMax: number): string {
  if (champ.affichage) return champ.affichage
  const source = champ.noms ?? champ.valeur
  const liste = (Array.isArray(source) ? [...(source as ReadonlyArray<string | number>)] : [source]).map((v) => String(v))
  if (liste.length <= nomsMax) return enListe(liste, locale)
  return `${enListe(liste.slice(0, nomsMax), locale)} +${liste.length - nomsMax}`
}

export function construireContexteFiltres(entree: EntreeContexteFiltres): Partial<ContexteEcran> | null {
  const { titre, champs, locale } = entree
  const nomsMax = entree.nomsMaxDansLibelle ?? 5
  const retenus = champs.filter((champ) => !valeurFiltreVide(champ.valeur))
  if (retenus.length === 0) return null

  const filtres: Record<string, unknown> = {}
  for (const champ of retenus) {
    const valeur = champ.valeur
    filtres[champ.cle] = Array.isArray(valeur) ? [...valeur] : valeur
    if (champ.noms !== undefined && !valeurFiltreVide(Array.isArray(champ.noms) ? champ.noms : (champ.noms as string))) {
      filtres[`${champ.cle}Noms`] = Array.isArray(champ.noms) ? [...champ.noms] : champ.noms
    }
  }

  // Le contrat borne la taille des filtres : on retire d'abord les noms, puis on coupe les longues listes.
  if (JSON.stringify(filtres).length > TAILLE_MAX_FILTRES) {
    for (const cle of Object.keys(filtres)) if (cle.endsWith('Noms')) delete filtres[cle]
  }
  if (JSON.stringify(filtres).length > TAILLE_MAX_FILTRES) {
    for (const cle of Object.keys(filtres)) {
      const valeur = filtres[cle]
      if (Array.isArray(valeur) && valeur.length > VALEURS_MAX_PAR_LISTE) {
        filtres[cle] = valeur.slice(0, VALEURS_MAX_PAR_LISTE)
        filtres[`${cle}Total`] = valeur.length
      }
    }
  }

  const morceaux = retenus.filter((champ) => !champ.horsLibelle).map((champ) => `${champ.etiquette} : ${texteChamp(champ, locale, nomsMax)}`)
  const libelle = `${titre} · ${morceaux.join(' · ')}`.slice(0, LONGUEUR_MAX_LIBELLE)
  return { titre: titre.slice(0, 200), filtres, libelle }
}

/** « 2026-09 » en « sept. 2026 » (ou l'equivalent dans la langue). Valeur inchangee si ce n'est pas AAAA-MM. */
export function libelleMoisAAAAMM(periode: string, locale?: string): string {
  const trouve = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periode)
  if (!trouve) return periode
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(new Date(Number(trouve[1]), Number(trouve[2]) - 1, 1))
  } catch {
    return periode
  }
}

/** « 2026-09-01 » en « 1 sept. 2026 » (locale de l'interface). Valeur inchangee si ce n'est pas AAAA-MM-JJ. */
export function libelleDateISO(iso: string, locale?: string): string {
  const trouve = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(iso)
  if (!trouve) return iso
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(Number(trouve[1]), Number(trouve[2]) - 1, Number(trouve[3])),
    )
  } catch {
    return iso
  }
}

/** Periode lisible « 1 sept. 2026 – 30 sept. 2026 » a partir de deux dates ISO ; une seule date si elles sont egales. */
export function libellePeriodeDates(debut: string, fin: string, locale?: string): string {
  const d = libelleDateISO(debut, locale)
  const f = libelleDateISO(fin, locale)
  return d === f ? d : `${d} – ${f}`
}
