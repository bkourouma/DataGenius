type Niveau = 'info' | 'avertissement' | 'erreur'
type Champs = Record<string, unknown>

const CLES_SENSIBLES = [
  'password',
  'motdepasse',
  'secret',
  'token',
  'cle',
  'key',
  'authorization',
  'cookie',
]
const MASQUE = '[masqué]'
const PROFONDEUR_MAX = 6

function estSensible(cle: string): boolean {
  const minuscule = cle.toLowerCase()
  return CLES_SENSIBLES.some((fragment) => minuscule.includes(fragment))
}

function assainerValeur(valeur: unknown, profondeur: number, vus: WeakSet<object>): unknown {
  if (valeur === null || typeof valeur !== 'object') {
    if (typeof valeur === 'bigint') return valeur.toString()
    if (typeof valeur === 'function' || typeof valeur === 'symbol') return undefined
    return valeur
  }
  if (valeur instanceof Error) {
    const code = (valeur as { code?: unknown }).code
    return {
      nom: valeur.name,
      message: valeur.message,
      ...(code !== undefined ? { code: String(code) } : {}),
    }
  }
  if (valeur instanceof Date) return valeur.toISOString()
  if (vus.has(valeur)) return '[circulaire]'
  if (profondeur >= PROFONDEUR_MAX) return '[profondeur max]'
  vus.add(valeur)
  try {
    if (Array.isArray(valeur)) {
      return valeur.map((element) => assainerValeur(element, profondeur + 1, vus))
    }
    const resultat: Record<string, unknown> = {}
    for (const [cle, element] of Object.entries(valeur)) {
      resultat[cle] = estSensible(cle) ? MASQUE : assainerValeur(element, profondeur + 1, vus)
    }
    return resultat
  } finally {
    vus.delete(valeur)
  }
}

/** Copie sûre d'une valeur : clés sensibles masquées, cycles et profondeur bornés. */
export function assainir(valeur: unknown): unknown {
  return assainerValeur(valeur, 0, new WeakSet())
}

export function nouvelleReference(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

export interface Journal {
  info(message: string, champs?: Champs): void
  avertissement(message: string, champs?: Champs): void
  erreur(message: string, champs?: Champs): void
  enfant(champs: Champs): Journal
}

function ecrire(niveau: Niveau, message: string, base: Champs, champs?: Champs) {
  const contenu = assainir({ ...base, ...champs }) as Champs
  const ligne = JSON.stringify({
    horodatage: new Date().toISOString(),
    niveau,
    message,
    ...contenu,
  })
  if (niveau === 'erreur') console.error(ligne)
  else if (niveau === 'avertissement') console.warn(ligne)
  else console.info(ligne)
}

function creer(base: Champs): Journal {
  return {
    info: (message, champs) => ecrire('info', message, base, champs),
    avertissement: (message, champs) => ecrire('avertissement', message, base, champs),
    erreur: (message, champs) => ecrire('erreur', message, base, champs),
    enfant: (champs) => creer({ ...base, ...(assainir(champs) as Champs) }),
  }
}

export const journal: Journal = creer({})
