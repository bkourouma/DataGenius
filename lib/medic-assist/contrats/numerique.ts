const DECIMAL_SIMPLE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

export type NombreAnalytique = number | string

/** Décimaux transportés en texte pour conserver les chiffres en JSON et dans les exports. */
export function estDecimalExact(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string' || !DECIMAL_SIMPLE.test(valeur)) return false
  const [entier, fraction = ''] = valeur.replace(/^-/, '').split('.')
  const significatifs = (entier + fraction).replace(/^0+/, '')
  return entier.length > 15 || fraction.length > 15 || significatifs.length > 15
}

export function estNombreAnalytique(valeur: unknown): valeur is NombreAnalytique {
  return typeof valeur === 'number' && Number.isFinite(valeur) || estDecimalExact(valeur)
}

export function nombreAnalytique(decimal: string): NombreAnalytique {
  return estDecimalExact(decimal) ? decimal : Number(decimal)
}

function decimalEnClair(valeur: NombreAnalytique) {
  const [coefficient, exposant] = String(valeur).split('e')
  if (exposant === undefined) return coefficient
  const signe = coefficient.startsWith('-') ? '-' : ''
  const [entier, fraction = ''] = coefficient.slice(signe.length).split('.')
  const chiffres = entier + fraction
  const position = entier.length + Number(exposant)
  if (position <= 0) return signe + '0.' + '0'.repeat(-position) + chiffres
  if (position >= chiffres.length) return signe + chiffres.padEnd(position, '0')
  return signe + chiffres.slice(0, position) + '.' + chiffres.slice(position)
}

export function sommerDecimaux(valeurs: readonly NombreAnalytique[]): NombreAnalytique {
  let somme = BigInt(0)
  let echelle = 0
  for (const valeur of valeurs) {
    const brut = decimalEnClair(valeur)
    const [entier, fraction = ''] = brut.split('.')
    const precision = Math.max(echelle, fraction.length)
    somme = somme * BigInt(10) ** BigInt(precision - echelle)
      + BigInt(entier + fraction.padEnd(precision, '0'))
    echelle = precision
  }
  const signe = somme < BigInt(0) ? '-' : ''
  const chiffres = (signe ? -somme : somme).toString().padStart(echelle + 1, '0')
  const entier = chiffres.slice(0, chiffres.length - echelle)
  const fraction = echelle ? chiffres.slice(-echelle).replace(/0+$/, '') : ''
  return nombreAnalytique(signe + entier + (fraction ? '.' + fraction : ''))
}
