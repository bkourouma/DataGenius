/**
 * Assainissement des détails d'une entrée d'audit : le journal ne doit contenir ni secret, ni e-mail,
 * ni contenu de données. Les clés sensibles sont SUPPRIMÉES (et non masquées) : leur simple présence
 * est déjà une information inutile.
 */

export const LIMITES_DETAILS = {
  cles: 20,
  longueurCle: 40,
  longueurChaine: 200,
  elementsTableau: 10,
  longueurChaineTableau: 100,
  /** Taille maximale du JSON final, en OCTETS UTF-8 (le CHECK de la migration accepte 4096). */
  tailleJson: 2000,
} as const

const FRAGMENTS_SENSIBLES = [
  'password', 'motdepasse', 'secret', 'token', 'cle', 'key', 'authorization', 'cookie',
  'email', 'mail', 'contenu', 'donnees', 'lignes_brutes',
]
const MASQUE = '[masqué]'
const FORME_CLE = /^[A-Za-z0-9_]+$/
const FORME_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/

type Primitive = string | number | boolean | null

const estSensible = (cle: string) => {
  const minuscule = cle.toLowerCase()
  return FRAGMENTS_SENSIBLES.some(fragment => minuscule.includes(fragment))
}

function chaineSure(valeur: string, maximum: number): string {
  return FORME_EMAIL.test(valeur) ? MASQUE : valeur.slice(0, maximum)
}

/** Texte libre (libellé de cible) : tronqué, et entièrement masqué s'il contient une adresse e-mail. */
export function texteSur(valeur: string, maximum: number): string {
  return chaineSure(valeur, maximum)
}

function primitive(valeur: unknown, maximumChaine: number): { valeur: Primitive } | undefined {
  if (valeur === null || typeof valeur === 'boolean') return { valeur }
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? { valeur } : undefined
  if (typeof valeur === 'string') return { valeur: chaineSure(valeur, maximumChaine) }
  return undefined
}

function valeurConservee(valeur: unknown): { valeur: Primitive | Primitive[] } | undefined {
  if (Array.isArray(valeur)) {
    const elements: Primitive[] = []
    for (const element of valeur.slice(0, LIMITES_DETAILS.elementsTableau)) {
      const retenu = primitive(element, LIMITES_DETAILS.longueurChaineTableau)
      if (retenu) elements.push(retenu.valeur)
    }
    return { valeur: elements }
  }
  return primitive(valeur, LIMITES_DETAILS.longueurChaine)
}

/** Copie bornée et assainie des détails : voir les règles dans LIMITES_DETAILS. */
export function borner(details: Record<string, unknown> | undefined): Record<string, unknown> {
  const resultat: Record<string, unknown> = {}
  if (!details || typeof details !== 'object') return resultat
  for (const [cle, valeur] of Object.entries(details)) {
    if (Object.keys(resultat).length >= LIMITES_DETAILS.cles) break
    if (cle.length > LIMITES_DETAILS.longueurCle || !FORME_CLE.test(cle) || estSensible(cle)) continue
    const retenu = valeurConservee(valeur)
    if (retenu) resultat[cle] = retenu.valeur
  }
  // Taille totale : on retire les dernières clés jusqu'à tenir dans la limite.
  const cles = Object.keys(resultat)
  while (cles.length > 0 && Buffer.byteLength(JSON.stringify(resultat), 'utf8') > LIMITES_DETAILS.tailleJson) {
    delete resultat[cles.pop() as string]
  }
  return resultat
}
