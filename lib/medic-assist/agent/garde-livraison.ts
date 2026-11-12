/**
 * Garde-fou de livraison du détail (anomalie B1 de la recette) : logique pure, sans accès
 * base ni SDK de modèle.
 *
 * Constat : sur des questions de ventilation, le modèle interroge les données (2 à 6 lignes),
 * n'écrit que le total, puis renvoie à « le tableau ci-dessus » sans jamais avoir créé
 * d'artefact ni écrit de tableau. En fin de tour, `evaluerLivraison` repère ce cas et
 * `construireSpecTableau` prépare l'artefact `tableau` que le serveur crée lui-même (aucun
 * second appel au modèle : résultat identique à chaque fois).
 *
 * Tout est borné : le texte pris en compte est tronqué, aucun accès réseau.
 */

import {
  EntreeCreerArtefactSchema,
  LIMITES,
  estErreurOutil,
  type EntreeCreerArtefact,
  type ResultatJeu,
} from '@/lib/medic-assist/contrats'

/** Texte de réponse pris en compte (au-delà, ignoré). */
export const LONGUEUR_MAX_TEXTE_GARDE = 20_000

/** Au plus ce nombre de lignes : le détail peut rester dans le texte (sinon artefact obligatoire). */
const LIGNES_MAX_TEXTE = 5

/** Outils qui produisent un jeu de données. */
const OUTILS_JEU = new Set(['interroger_donnees', 'requete_sql', 'lire_piece_jointe'])
/** Outils qui livrent un artefact. */
const OUTILS_ARTEFACT = new Set(['creer_artefact', 'modifier_artefact'])

/** Jeux mémorisés au plus par tour (borne mémoire). */
const JEUX_MAX = 50

export interface EtatLivraison {
  /** toolCallId -> nom de l'outil, pour rattacher les sorties à leur appel. */
  outils: Map<string, string>
  /** Jeux de données du tour, dans l'ordre d'arrivée. */
  jeux: ResultatJeu[]
  /** Vrai si creer_artefact ou modifier_artefact a abouti dans le tour. */
  artefactLivre: boolean
}

export function creerEtatLivraison(): EtatLivraison {
  return { outils: new Map(), jeux: [], artefactLivre: false }
}

function ressembleAUnJeu(v: unknown): v is ResultatJeu {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.jeuDeDonneesId === 'string' &&
    Array.isArray(o.colonnes) &&
    Array.isArray(o.apercu) &&
    typeof o.nbLignes === 'number'
  )
}

/**
 * Alimente l'état avec un morceau du flux d'interface. Ignore silencieusement tout ce qui
 * n'est pas un appel ou une sortie d'outil. Ne lève jamais.
 */
export function collecterMorceau(etat: EtatLivraison, morceau: unknown): void {
  if (typeof morceau !== 'object' || morceau === null) return
  const m = morceau as Record<string, unknown>
  if (typeof m.toolCallId !== 'string') return

  if (m.type === 'tool-input-available') {
    if (typeof m.toolName === 'string') etat.outils.set(m.toolCallId, m.toolName)
    return
  }
  if (m.type !== 'tool-output-available') return

  const nom = etat.outils.get(m.toolCallId)
  if (!nom) return
  const sortie = m.output
  if (estErreurOutil(sortie)) return

  if (OUTILS_ARTEFACT.has(nom)) {
    etat.artefactLivre = true
    return
  }
  if (!OUTILS_JEU.has(nom)) return
  const candidat =
    nom === 'lire_piece_jointe' && typeof sortie === 'object' && sortie !== null
      ? (sortie as Record<string, unknown>).resultat
      : sortie
  if (ressembleAUnJeu(candidat)) {
    etat.jeux.push(candidat)
    if (etat.jeux.length > JEUX_MAX) etat.jeux.shift()
  }
}

/** Minuscules sans accents ni espaces multiples. */
function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Tableau markdown : une ligne d'en-tête `| a | b |` suivie d'une séparatrice `|---|:--:|`. */
export function contientTableauMarkdown(texte: string): boolean {
  const lignes = texte.slice(0, LONGUEUR_MAX_TEXTE_GARDE).split('\n')
  const separatrice = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
  for (let i = 0; i + 1 < lignes.length; i++) {
    const suivante = lignes[i + 1]!
    if (!lignes[i]!.includes('|') || !suivante.includes('|')) continue
    if (separatrice.test(suivante)) return true
  }
  return false
}

function libellesDesLignes(jeu: ResultatJeu): string[] | null {
  const colonne = jeu.colonnes.find(c => c.type === 'texte' || c.type === 'periode')
  if (!colonne) return null
  const libelles: string[] = []
  for (const ligne of jeu.apercu) {
    const v = ligne[colonne.cle]
    const s = v === null || v === undefined ? '' : normaliser(String(v))
    if (s) libelles.push(s)
  }
  return libelles.length > 0 ? libelles : null
}

/**
 * Renvoie le jeu pour lequel il faut créer un tableau, ou null si le détail est livré.
 *
 * Règle : dernier jeu du tour à 2 lignes ou plus ; rien si un artefact a abouti ; au-delà de
 * 5 lignes un artefact est obligatoire ; de 2 à 5 lignes, le détail est livré si le texte
 * contient un tableau markdown ou cite le libellé de CHAQUE ligne de l'aperçu.
 */
export function evaluerLivraison(entree: {
  jeux: readonly ResultatJeu[]
  artefactLivre: boolean
  texte: string
}): ResultatJeu | null {
  if (entree.artefactLivre) return null
  let jeu: ResultatJeu | undefined
  for (let i = entree.jeux.length - 1; i >= 0; i--) {
    if (entree.jeux[i]!.nbLignes >= 2) {
      jeu = entree.jeux[i]
      break
    }
  }
  if (!jeu) return null
  if (jeu.nbLignes > LIGNES_MAX_TEXTE) return jeu

  const texte = entree.texte.slice(0, LONGUEUR_MAX_TEXTE_GARDE)
  if (contientTableauMarkdown(texte)) return null
  const libelles = libellesDesLignes(jeu)
  if (libelles) {
    const norme = normaliser(texte)
    if (libelles.every(l => norme.includes(l))) return null
  }
  return jeu
}

/** Texte d'une ligne : retours à la ligne et espaces multiples aplatis, tronqué. */
function uneLigne(texte: string, max: number): string {
  return texte.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/**
 * Spécification d'un artefact `tableau` à partir d'un jeu. Renvoie null si elle ne passe pas
 * le schéma du contrat (le garde-fou ne crée alors rien).
 */
export function construireSpecTableau(
  jeu: ResultatJeu,
  _locale?: string
): EntreeCreerArtefact | null {
  const p = jeu.provenance
  const base = uneLigne(p.libelleSource, LIMITES.longueurMaxTitre)
  const periode = p.periode?.libelle ? uneLigne(p.periode.libelle, LIMITES.longueurMaxTitre) : ''
  const titre = uneLigne(periode ? `${base} · ${periode}` : base, LIMITES.longueurMaxTitre)
  const sousTitre = p.perimetre?.libelle
    ? uneLigne(p.perimetre.libelle, LIMITES.longueurMaxSousTitre)
    : ''
  const totaux = jeu.totaux !== undefined && Object.keys(jeu.totaux).length > 0

  const brut = {
    spec: {
      type: 'tableau' as const,
      titre,
      ...(sousTitre ? { sousTitre } : {}),
      jeuDeDonneesId: jeu.jeuDeDonneesId,
      ...(totaux ? { totaux: true } : {}),
    },
  }
  const analyse = EntreeCreerArtefactSchema.safeParse(brut)
  if (analyse.success) return analyse.data
  // Sous-titre refusé (HTML, URL...) : on le retire plutôt que de renoncer au tableau.
  if (sousTitre) {
    const { sousTitre: _retire, ...sansSousTitre } = brut.spec as typeof brut.spec & {
      sousTitre?: string
    }
    const seconde = EntreeCreerArtefactSchema.safeParse({ spec: sansSousTitre })
    if (seconde.success) return seconde.data
  }
  return null
}
