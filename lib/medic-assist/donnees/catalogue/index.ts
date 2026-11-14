/**
 * Lecture du catalogue semantique pour le modele :
 *  - `catalogueDonnees` : sortie de l'outil `catalogue_donnees` (liste des jeux, ou detail
 *    d'un jeu avec definitions, libelles dans la langue et colonnes de sa vue `mv_*`) ;
 *  - `resumeCatalogueCompact` : texte court et DETERMINISTE place dans le prompt systeme
 *    (meme registre -> meme texte, pour le cache de prompt).
 *
 * Aucune expression SQL du catalogue ne sort d'ici : le modele recoit des cles, des
 * definitions et les colonnes des vues, jamais les formules ni le corps des vues.
 */

import type { ContexteExecution, TypeColonne } from '@/lib/medic-assist/contrats'
import { libelleDe, REGLES } from './communs'
import { TEXTES_MOTEUR } from '../moteur/libelles'
import { GRANULARITES, type Granularite, dimensionsDisponibles } from '../moteur/temps'
import { ErreurDonnees } from '../types'
import type {
  AgregatMesure,
  ColonneVue,
  DefinitionJeu,
  EntiteFiltre,
  EntreeCatalogue,
  Libelle,
  Registre,
  TempsJeu,
  TypeFiltre,
} from './types'

export interface ResumeJeuCatalogue {
  cle: string
  libelle: string
  description: string
  granularite: string
}

export interface DetailJeuCatalogue {
  cle: string
  libelle: string
  description: string
  granularite: string
  siegeSeulement?: boolean
  cles?: string[]
  calendrier?: string
  responsable?: string
  versionMetier?: number
  temps: (TempsJeu & { granularites: Granularite[] }) | null
  dimensions: {
    cle: string
    libelle: string
    definition: string
    type: TypeColonne
    valeursPossibles?: string[]
  }[]
  mesures: {
    cle: string
    libelle: string
    definition: string
    type: TypeColonne
    unite?: string
    devise?: string
    agregat: AgregatMesure
    instantane?: boolean
  }[]
  filtres: {
    cle: string
    libelle: string
    definition: string
    type: TypeFiltre | 'periode'
    entite?: EntiteFiltre
    valeursPossibles?: string[]
  }[]
  regles: string[]
  exemples: string[]
  /** Vue logique a interroger avec `requete_sql` : nom, description et colonnes (pas le corps). */
  vueSql: { nom: string; description: string; colonnes: ColonneVue[] }
}

type Ctx = Pick<ContexteExecution, 'locale'>

const DEFINITION_PERIODE =
  "Periode du calcul, bornes incluses : {debut: 'YYYY-MM', fin: 'YYYY-MM'}, {exercice: 2026} " +
  '(exercice demarrant en 2026 ; sans reglage du jeu, annee civile) ou {dernierMoisClos: true}. Absente : defaut du jeu (temps.defaut).'

function detailJeu(entree: EntreeCatalogue, ctx: Ctx): DetailJeuCatalogue {
  const { jeu, vue } = entree
  const t = (l: Libelle) => libelleDe(l, ctx.locale)
  return {
    cle: jeu.cle,
    libelle: t(jeu.libelle),
    description: jeu.description,
    granularite: jeu.granularite,
    ...(jeu.versionMetier ? { cles: jeu.cles, calendrier: jeu.calendrier, responsable: jeu.responsable, versionMetier: jeu.versionMetier } : {}),
    ...(jeu.siegeSeulement ? { siegeSeulement: true } : {}),
    temps: jeu.temps ? { ...jeu.temps, granularites: [...GRANULARITES] } : null,
    dimensions: dimensionsDisponibles(jeu).map(d => ({
      cle: d.cle,
      libelle: t(d.libelle),
      definition: d.definition,
      type: d.type,
      ...(d.valeursPossibles ? { valeursPossibles: [...d.valeursPossibles] } : {}),
    })),
    mesures: jeu.mesures.map(m => ({
      cle: m.cle,
      libelle: t(m.libelle),
      definition: m.definition,
      type: m.type,
      ...(m.unite ? { unite: m.unite } : {}),
      ...(m.devise ? { devise: m.devise } : {}),
      agregat: m.agregat,
      ...(m.instantane || jeu.temps?.instantane ? { instantane: true } : {}),
    })),
    filtres: [
      ...(jeu.temps
        ? [
            {
              cle: 'periode',
              libelle: t(TEXTES_MOTEUR.periode),
              definition: jeu.temps.calendrier
                ? `Période du calcul sur ${jeu.temps.calendrier.colonneDate} : {debut: 'YYYY-MM', fin: 'YYYY-MM'}, {exercice: 2026} (année de début ; l’exercice commence au mois ${jeu.temps.calendrier.moisDebutExercice}) ou {dernierMoisClos: true}.`
                : DEFINITION_PERIODE,
              type: 'periode' as const,
            },
          ]
        : []),
      ...jeu.filtres.map(f => ({
        cle: f.cle,
        libelle: t(f.libelle),
        definition: f.definition,
        type: f.type,
        ...(f.entite ? { entite: f.entite } : {}),
        ...(f.valeursPossibles ? { valeursPossibles: [...f.valeursPossibles] } : {}),
      })),
    ],
    regles: [
      ...jeu.regles.map(t),
      ...jeu.mesures.flatMap(m => (m.regles ?? []).map(r => `${m.cle} : ${t(r)}`)),
    ],
    exemples: [...(jeu.exemples ?? [])],
    vueSql: {
      nom: vue.nom,
      description: vue.description,
      colonnes: vue.colonnes.map(c => ({ nom: c.nom, type: c.type, description: c.description,
        ...(c.synonymes?.length ? { synonymes: c.synonymes } : {}) })),
    },
  }
}

/**
 * Sortie de l'outil `catalogue_donnees`. Sans jeu : la liste des jeux. Avec jeu : son detail.
 * Un jeu inconnu leve `ErreurDonnees` en listant les jeux possibles.
 */
export function catalogueDonnees(
  entree: { jeu?: undefined },
  ctx: Ctx,
  registre: Registre
): { jeux: ResumeJeuCatalogue[] }
export function catalogueDonnees(
  entree: { jeu: string },
  ctx: Ctx,
  registre: Registre
): { jeu: DetailJeuCatalogue }
export function catalogueDonnees(
  entree: { jeu?: string },
  ctx: Ctx,
  registre: Registre
): { jeux: ResumeJeuCatalogue[] } | { jeu: DetailJeuCatalogue }
export function catalogueDonnees(
  entree: { jeu?: string },
  ctx: Ctx,
  registre: Registre
): { jeux: ResumeJeuCatalogue[] } | { jeu: DetailJeuCatalogue } {
  if (entree.jeu === undefined || entree.jeu === null || entree.jeu === '') {
    return {
      jeux: registre.map(({ jeu }) => ({
        cle: jeu.cle,
        libelle: libelleDe(jeu.libelle, ctx.locale),
        description: jeu.description,
        granularite: jeu.granularite,
      })),
    }
  }
  const trouvee = registre.find(e => e.jeu.cle === entree.jeu)
  if (!trouvee) {
    const possibles = registre.map(e => e.jeu.cle).join(', ') || 'aucun'
    throw new ErreurDonnees(
      `Jeu inconnu "${String(entree.jeu).slice(0, 64)}". Jeux possibles : ${possibles}.`,
      'jeu_inconnu'
    )
  }
  return { jeu: detailJeu(trouvee, ctx) }
}

// ---------------------------------------------------------------------------
// Resume compact du prompt systeme
// ---------------------------------------------------------------------------

/** Taille visee du resume (caracteres) : environ 2 000 tokens, sous le plafond de 2 500. */
export const LIMITE_RESUME_CARACTERES = 7_000

/** Estimation prudente du nombre de tokens d'un texte (francais, cles snake_case). */
export function estimerTokens(texte: string): number {
  return Math.ceil(texte.length / 3.5)
}

/**
 * Regles communes : l'en-tete les dit une fois ; dans un jeu on n'ecrit qu'une etiquette
 * courte pour celles qui ne valent pas partout (null : deja dans l'en-tete).
 */
const ETIQUETTES_REGLES: { regle: Libelle; etiquette: string | null }[] = [
  { regle: REGLES.ca, etiquette: null },
  { regle: REGLES.inactifs, etiquette: null },
  { regle: REGLES.dernierMoisClos, etiquette: null },
  { regle: REGLES.exercice, etiquette: null },
  { regle: REGLES.stockInstantane, etiquette: null },
  { regle: REGLES.perimetre, etiquette: null },
  { regle: REGLES.devise, etiquette: null },
  { regle: REGLES.tauxRealisation, etiquette: 'taux = somme ventes / somme budget' },
  { regle: REGLES.budgetCa, etiquette: 'budget CA = qte budget x PGHT en vigueur' },
  { regle: REGLES.seuils, etiquette: 'seuils 70/90 %' },
  { regle: REGLES.visasFiables, etiquette: 'visas fiables seulement' },
]

const EN_TETE = [
  'CATALOGUE DE LA SOURCE. interroger_donnees {jeu, mesures[], dimensions[], filtres{}, tri[{cle,sens}], limite}. Sans mesure : liste distincte.',
  'catalogue_donnees {jeu} donne les dimensions, mesures et filtres. Utilise filtres.autres pour les filtres personnalisés (valeur exacte).',
  'requete_sql : une lecture sur les vues mv_<jeu>. Utilise les unités et définitions de chaque jeu. Ne présume aucune règle métier.',
  'JEUX (clé, grain, vue SQL, M mesures, D dimensions, F filtres, R règles) :',
].join('\n')

interface NiveauResume {
  exemples: boolean
  reglesPropres: boolean
  description: 'complete' | 'phrase' | 'aucune'
  valeursFiltres: boolean
  unites: boolean
  maxElements: number
}

/**
 * Du plus detaille au plus court : on garde le premier palier qui tient dans la limite.
 * L'usage du jeu (sa description) passe avant les exemples, les regles propres, les unites
 * et les valeurs de filtres, que `catalogue_donnees` redonne de toute facon.
 */
const NIVEAUX: NiveauResume[] = [
  {
    exemples: true,
    reglesPropres: true,
    description: 'complete',
    valeursFiltres: true,
    unites: true,
    maxElements: Infinity,
  },
  {
    exemples: false,
    reglesPropres: true,
    description: 'complete',
    valeursFiltres: true,
    unites: true,
    maxElements: Infinity,
  },
  {
    exemples: false,
    reglesPropres: false,
    description: 'complete',
    valeursFiltres: true,
    unites: true,
    maxElements: Infinity,
  },
  {
    exemples: false,
    reglesPropres: false,
    description: 'complete',
    valeursFiltres: false,
    unites: false,
    maxElements: Infinity,
  },
  {
    exemples: false,
    reglesPropres: false,
    description: 'phrase',
    valeursFiltres: false,
    unites: false,
    maxElements: Infinity,
  },
  {
    exemples: false,
    reglesPropres: false,
    description: 'phrase',
    valeursFiltres: false,
    unites: false,
    maxElements: 8,
  },
  {
    exemples: false,
    reglesPropres: false,
    description: 'aucune',
    valeursFiltres: false,
    unites: false,
    maxElements: 8,
  },
]

function premierePhrase(texte: string): string {
  const fin = texte.search(/[.!?](\s|$)/)
  return (fin >= 0 ? texte.slice(0, fin + 1) : texte).trim()
}

function borner(elements: string[], max: number): string {
  if (elements.length <= max) return elements.join(', ')
  return `${elements.slice(0, max).join(', ')}, ...`
}

/** Filtres en notation courte : les filtres d'ids `xxxIds` regroupes en `ids(xxx, ...)`. */
function filtresCourts(jeu: DefinitionJeu, niveau: NiveauResume): string[] {
  const ids = jeu.filtres
    .filter(f => f.type === 'ids' && /^[a-z][a-zA-Z0-9]*Ids$/.test(f.cle))
    .map(f => f.cle.slice(0, -3))
  const autres = jeu.filtres
    .filter(f => !(f.type === 'ids' && /^[a-z][a-zA-Z0-9]*Ids$/.test(f.cle)))
    .map(f =>
      niveau.valeursFiltres && f.valeursPossibles?.length
        ? `${f.cle}=${f.valeursPossibles.join('|')}`
        : f.cle
    )
  return [...(ids.length > 0 ? [`ids(${ids.join(', ')})`] : []), ...autres]
}

function blocJeu(jeu: DefinitionJeu, vue: string, niveau: NiveauResume): string {
  const lignes: string[] = []
  const temps = jeu.temps
    ? ` [${jeu.temps.defaut === 'dernier_mois_clos' ? 'dmc' : 'tout'}${jeu.temps.instantane ? ', inst' : ''}]`
    : ''
  const grain = jeu.granularite.replace(/^une ligne\s*=\s*/i, '')
  const marques = [vue !== `mv_${jeu.cle}` ? `vue ${vue}` : '', jeu.siegeSeulement ? 'siege' : '']
    .filter(Boolean)
    .join(', ')
  const usage =
    niveau.description === 'aucune'
      ? ''
      : ` ${niveau.description === 'complete' ? jeu.description : premierePhrase(jeu.description)}`
  lignes.push(`- ${jeu.cle}${marques ? ` (${marques})` : ''} : ${grain}${temps}.${usage}`)

  const mesures = jeu.mesures.map(m => {
    const details = [
      niveau.unites ? m.unite : undefined,
      m.instantane && !jeu.temps?.instantane ? 'inst' : undefined,
    ]
      .filter(Boolean)
      .join(', ')
    return details ? `${m.cle} (${details})` : m.cle
  })
  if (mesures.length > 0) lignes.push(` M: ${borner(mesures, niveau.maxElements)}`)
  if (jeu.dimensions.length > 0) {
    lignes.push(
      ` D: ${borner(
        jeu.dimensions.map(d => d.cle),
        niveau.maxElements
      )}`
    )
  }
  const filtres = filtresCourts(jeu, niveau)
  if (filtres.length > 0) lignes.push(` F: ${filtres.join(', ')}`)

  const regles: string[] = []
  for (const regle of jeu.regles) {
    const connue = ETIQUETTES_REGLES.find(e => e.regle.fr === regle.fr)
    if (connue) {
      if (connue.etiquette && !regles.includes(connue.etiquette)) regles.push(connue.etiquette)
    } else if (niveau.reglesPropres) {
      regles.push(regle.fr)
    }
  }
  if (regles.length > 0) lignes.push(` R: ${regles.join(' ; ')}`)

  if (niveau.exemples && jeu.exemples?.length)
    lignes.push(` Ex: ${jeu.exemples.slice(0, 2).join(' / ')}`)
  return lignes.join('\n')
}

function resumeAuNiveau(registre: Registre, niveau: NiveauResume): string {
  return [EN_TETE, ...registre.map(e => blocJeu(e.jeu, e.vue.nom, niveau))].join('\n')
}

/**
 * Resume compact du catalogue pour le prompt systeme : cles des jeux, grain, mesures,
 * dimensions, filtres, regles cles et usage. Vise au plus LIMITE_RESUME_CARACTERES
 * (moins de 2 500 tokens) en retirant les details par paliers fixes : deterministe.
 * Le texte est en francais (langue des definitions) quelle que soit la langue du lecteur.
 */
export function resumeCatalogueCompact(_ctx: Ctx | undefined, registre: Registre): string {
  let texte = ''
  for (const niveau of NIVEAUX) {
    texte = resumeAuNiveau(registre, niveau)
    if (texte.length <= LIMITE_RESUME_CARACTERES) return texte
  }
  return texte
}
