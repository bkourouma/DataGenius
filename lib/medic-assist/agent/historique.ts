/**
 * Réduction de l'historique avant l'appel au modèle.
 *
 * Module pur : types structurels locaux, aucune dépendance au SDK. Les messages sont
 * ceux du flux UI (forme `UIMessage` du SDK v7) relus en base.
 *
 * Ce que fait la réduction :
 *  1. garde intacts les N derniers échanges (un échange = un tour utilisateur et tout ce
 *     qui le suit jusqu'au tour utilisateur suivant) ;
 *  2. dans les plus anciens, remplace la sortie des outils volumineux par une version
 *     compacte qui garde de quoi se référer au jeu de données (id, colonnes, nombre de
 *     lignes, provenance courte, artefact) mais pas l'aperçu des lignes ;
 *  3. retire les parties inutiles au modèle (`data-*`, raisonnement ancien). Les `step-start`
 *     sont GARDÉS entre deux parties utiles : `convertToModelMessages` s'en sert pour découper
 *     un message assistant en étapes et placer les résultats d'outil (message `tool`) juste
 *     après chaque étape. Sans eux, le texte final passerait avant le résultat de l'outil.
 *     Ceux qui ne séparent rien (en tête, en queue, consécutifs) sont retirés ;
 *  4. retire les parties d'outil sans sortie (états `input-streaming`, `input-available`,
 *     approbations...) qui feraient échouer `convertToModelMessages` ;
 *  5. si le budget de caractères reste dépassé, supprime les plus anciens échanges ;
 *  6. ne mute jamais l'entrée et garde toujours le dernier message utilisateur.
 */

export interface MessageUi {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: Array<{ type: string; [k: string]: unknown }>
  metadata?: unknown
}

type PartieUi = MessageUi['parts'][number]

export interface OptionsReductionHistorique {
  /** Tours utilisateur complets gardés intacts. Défaut 8. */
  derniersEchanges?: number
  /** Budget de caractères du contexte historique. Défaut 400 000 (environ 100 000 jetons). */
  budgetCaracteres?: number
}

export interface ResultatReductionHistorique {
  messages: MessageUi[]
  /** Vrai si une sortie a été compactée ou un échange supprimé. */
  compacte: boolean
}

export const DERNIERS_ECHANGES_DEFAUT = 8
export const BUDGET_CARACTERES_DEFAUT = 400_000
export const TEXTE_DEBUT_OMIS = '[Début de la conversation omis]'
export const ID_MESSAGE_RAPPEL = 'medic-assist-rappel-debut'

/** Sortie d'outil au-delà de laquelle une sortie non reconnue est tronquée (anciens échanges). */
const SEUIL_SORTIE_VOLUMINEUSE = 1_500
/** Taille d'une valeur de sortie conservée telle quelle lors d'une compaction générique. */
const SEUIL_VALEUR_CONSERVEE = 400
/** Taille au-delà de laquelle une URL `data:` d'un fichier est considérée comme lourde. */
const SEUIL_FICHIER_LOURD = 2_000

/**
 * États d'une partie `tool-<nom>` (UIMessage v7) exploitables par le modèle. Les autres
 * (`input-streaming`, `input-available`, `approval-requested`, `approval-responded`,
 * `output-denied`) sont retirées : sans sortie, `convertToModelMessages` échoue.
 */
const ETATS_OUTIL_COMPLETS = new Set(['output-available', 'output-error'])

function estPartieOutil(partie: PartieUi): boolean {
  return partie.type === 'dynamic-tool' || partie.type.startsWith('tool-')
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

function longueurJson(valeur: unknown): number {
  try {
    return JSON.stringify(valeur)?.length ?? 0
  } catch {
    return 0
  }
}

/** Nombre approximatif de caractères que le modèle recevra pour ces messages. */
export function estimerCaracteres(messages: readonly MessageUi[]): number {
  let total = 0
  for (const message of messages) {
    for (const partie of message.parts ?? []) {
      if (partie.type === 'text' && typeof partie.text === 'string') total += partie.text.length
      else total += longueurJson(partie)
    }
  }
  return total
}

// ---------------------------------------------------------------------------
// Compaction des sorties d'outil
// ---------------------------------------------------------------------------

function resumeProvenance(provenance: unknown): string | undefined {
  if (!estObjet(provenance)) return undefined
  const morceaux: string[] = []
  if (typeof provenance.libelleSource === 'string') morceaux.push(provenance.libelleSource)
  const periode = provenance.periode
  if (estObjet(periode) && typeof periode.libelle === 'string') morceaux.push(periode.libelle)
  const perimetre = provenance.perimetre
  if (estObjet(perimetre) && typeof perimetre.libelle === 'string') morceaux.push(perimetre.libelle)
  return morceaux.length > 0 ? morceaux.join(' · ').slice(0, 300) : undefined
}

/** Version compacte d'un `ResultatJeu` : tout sauf l'aperçu des lignes. */
function compacterResultatJeu(sortie: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  if ('jeuDeDonneesId' in sortie) compact.jeuDeDonneesId = sortie.jeuDeDonneesId
  if (Array.isArray(sortie.colonnes)) {
    compact.colonnes = sortie.colonnes.map(colonne =>
      estObjet(colonne)
        ? { cle: colonne.cle, libelle: colonne.libelle, type: colonne.type }
        : colonne
    )
  }
  if ('nbLignes' in sortie) compact.nbLignes = sortie.nbLignes
  if ('tronque' in sortie) compact.tronque = sortie.tronque
  if (estObjet(sortie.totaux) && Object.keys(sortie.totaux).length <= 20) {
    compact.totaux = sortie.totaux
  }
  const provenance = resumeProvenance(sortie.provenance)
  if (provenance) compact.provenance = provenance
  compact.apercuOmis = true
  return compact
}

/** Compaction d'une sortie qui n'est pas un jeu : on garde les petites valeurs. */
function compacterSortieGenerique(sortie: unknown): unknown {
  if (typeof sortie === 'string') {
    return sortie.length > SEUIL_SORTIE_VOLUMINEUSE
      ? `${sortie.slice(0, SEUIL_SORTIE_VOLUMINEUSE)}… [sortie tronquée]`
      : sortie
  }
  if (Array.isArray(sortie)) {
    return { elementsOmis: sortie.length, sortieTronquee: true }
  }
  if (estObjet(sortie)) {
    const compact: Record<string, unknown> = {}
    let omis = false
    for (const [cle, valeur] of Object.entries(sortie)) {
      if (longueurJson(valeur) > SEUIL_VALEUR_CONSERVEE) omis = true
      else compact[cle] = valeur
    }
    if (omis) compact.sortieTronquee = true
    return compact
  }
  return sortie
}

function compacterSortie(sortie: unknown): unknown {
  if (estObjet(sortie) && Array.isArray(sortie.apercu)) return compacterResultatJeu(sortie)
  if (longueurJson(sortie) <= SEUIL_SORTIE_VOLUMINEUSE) return sortie
  return compacterSortieGenerique(sortie)
}

/** Les spécifications d'artefact peuvent être longues : on ne garde que de quoi les citer. */
function compacterEntree(partie: PartieUi): unknown {
  const entree = partie.input
  if (!estObjet(entree)) return entree
  if (!estObjet(entree.spec)) return entree
  const spec = entree.spec
  const resume: Record<string, unknown> = {}
  for (const cle of ['type', 'titre', 'jeuDeDonneesId'] as const) {
    if (cle in spec) resume[cle] = spec[cle]
  }
  const compact: Record<string, unknown> = { ...entree, spec: resume }
  return compact
}

function compacterPartieOutil(partie: PartieUi): PartieUi {
  const compact: PartieUi = { ...partie }
  if ('input' in partie) compact.input = compacterEntree(partie)
  if (partie.state === 'output-available' && 'output' in partie) {
    compact.output = compacterSortie(partie.output)
  }
  return compact
}

function compacterFichier(partie: PartieUi): PartieUi {
  const url = typeof partie.url === 'string' ? partie.url : ''
  if (url.length <= SEUIL_FICHIER_LOURD) return partie
  const nom = typeof partie.filename === 'string' ? partie.filename : 'fichier'
  return { type: 'text', text: `[Fichier ancien omis : ${nom}]` }
}

// ---------------------------------------------------------------------------
// Nettoyage d'un message
// ---------------------------------------------------------------------------

/** Retire les `step-start` en tête, en queue ou consécutifs (ils ne séparent aucune étape). */
function elaguerStepStart(parts: readonly PartieUi[]): PartieUi[] {
  const sortie: PartieUi[] = []
  for (const partie of parts) {
    if (partie.type === 'step-start') {
      if (sortie.length === 0 || sortie.at(-1)?.type === 'step-start') continue
    }
    sortie.push(partie)
  }
  while (sortie.length > 0 && sortie.at(-1)?.type === 'step-start') sortie.pop()
  return sortie
}

type ModeNettoyage = 'recent' | 'ancien'

function nettoyerMessage(
  message: MessageUi,
  mode: ModeNettoyage
): { message: MessageUi | null; compacte: boolean } {
  let compacte = false
  const parts: PartieUi[] = []

  for (const partie of message.parts ?? []) {
    if (!partie || typeof partie.type !== 'string') continue
    const type = partie.type

    if (type.startsWith('data-')) continue
    if (type === 'reasoning') {
      if (mode === 'ancien') continue
      parts.push(partie)
      continue
    }
    if (estPartieOutil(partie)) {
      // Sans sortie, la partie ferait échouer la conversion en messages modèle.
      if (!ETATS_OUTIL_COMPLETS.has(String(partie.state))) continue
      if (mode === 'ancien') {
        const compactee = compacterPartieOutil(partie)
        if (longueurJson(compactee) < longueurJson(partie)) compacte = true
        parts.push(compactee)
      } else {
        parts.push(partie)
      }
      continue
    }
    if (type === 'text' && message.role === 'assistant') {
      // Un bloc de texte vide est refusé par certains fournisseurs.
      if (typeof partie.text !== 'string' || partie.text.trim() === '') continue
    }
    if (type === 'file' && mode === 'ancien') {
      const fichier = compacterFichier(partie)
      if (fichier !== partie) compacte = true
      parts.push(fichier)
      continue
    }
    parts.push(partie)
  }

  // Un `step-start` ne sert que s'il sépare deux parties utiles.
  const utiles = elaguerStepStart(parts)
  parts.length = 0
  parts.push(...utiles)

  // Un message assistant devenu vide n'a plus de raison d'être.
  if (parts.length === 0 && message.role !== 'user') return { message: null, compacte }
  return { message: { ...message, parts }, compacte }
}

function nettoyerGroupe(
  messages: readonly MessageUi[],
  mode: ModeNettoyage
): { messages: MessageUi[]; compacte: boolean } {
  const sortie: MessageUi[] = []
  let compacte = false
  for (const message of messages) {
    const resultat = nettoyerMessage(message, mode)
    if (resultat.compacte) compacte = true
    if (resultat.message) sortie.push(resultat.message)
  }
  return { messages: sortie, compacte }
}

// ---------------------------------------------------------------------------
// Réduction
// ---------------------------------------------------------------------------

/** Découpe en échanges : chacun commence à un message utilisateur. */
function decouperEchanges(messages: readonly MessageUi[]): MessageUi[][] {
  const groupes: MessageUi[][] = []
  for (const message of messages) {
    if (message.role === 'user' || groupes.length === 0) groupes.push([message])
    else groupes[groupes.length - 1]!.push(message)
  }
  return groupes
}

function rappelDebut(): MessageUi {
  return {
    id: ID_MESSAGE_RAPPEL,
    role: 'user',
    parts: [{ type: 'text', text: TEXTE_DEBUT_OMIS }],
  }
}

export function reduireHistorique(
  messages: readonly MessageUi[],
  options: OptionsReductionHistorique = {}
): ResultatReductionHistorique {
  const derniers = Math.max(1, Math.floor(options.derniersEchanges ?? DERNIERS_ECHANGES_DEFAUT))
  const budget = options.budgetCaracteres ?? BUDGET_CARACTERES_DEFAUT

  if (messages.length === 0) return { messages: [], compacte: false }

  let groupes = decouperEchanges(messages)
  // Messages qui précèdent le premier tour utilisateur : jamais traités comme « récents ».
  const debutSansUtilisateur = groupes[0]![0]!.role !== 'user'
  const estAncien = (index: number, total: number): boolean =>
    index < total - derniers || (index === 0 && debutSansUtilisateur && total > 1)

  let compacte = false
  const nettoyer = (liste: MessageUi[][], toutAncien: boolean) =>
    liste.map((groupe, index) => {
      const mode: ModeNettoyage = toutAncien || estAncien(index, liste.length) ? 'ancien' : 'recent'
      const resultat = nettoyerGroupe(groupe, mode)
      return resultat
    })

  let nettoyes = nettoyer(groupes, false)
  const tailles = nettoyes.map(g => estimerCaracteres(g.messages))
  let total = tailles.reduce((somme, taille) => somme + taille, 0)

  // Suppression des plus anciens échanges tant que le budget est dépassé.
  let supprimes = 0
  while (total > budget && groupes.length - supprimes > 1) {
    total -= tailles[supprimes]!
    supprimes += 1
  }
  if (supprimes > 0) {
    compacte = true
    groupes = groupes.slice(supprimes)
    nettoyes = nettoyes.slice(supprimes)
  }

  // Dernier recours : le dernier échange seul dépasse encore le budget, on le compacte aussi.
  if (total > budget) {
    const recompactes = nettoyer(groupes, true)
    if (recompactes.some(g => g.compacte)) compacte = true
    nettoyes = recompactes
  }

  if (nettoyes.some(g => g.compacte)) compacte = true

  let resultat = nettoyes.flatMap(g => g.messages)

  // Une conversation doit commencer par un tour utilisateur (exigence de plusieurs
  // fournisseurs) : on ajoute un rappel neutre seulement quand ce n'est pas le cas.
  const premier = resultat.find(m => m.role !== 'system')
  if (premier && premier.role !== 'user') {
    resultat = [rappelDebut(), ...resultat]
    compacte = true
  }

  return { messages: resultat, compacte }
}
