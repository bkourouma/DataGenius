const MOIS = /^(\d{4})-(0[1-9]|1[0-2])$/
const DECIMAL = /^-?\d+(?:\.\d+)?$/

export function indiceMois(mois: string) {
  const parties = MOIS.exec(mois)
  return parties ? Number(parties[1]) * 12 + Number(parties[2]) - 1 : NaN
}

export function libelleMois(indice: number) {
  return `${Math.floor(indice / 12)}-${String(indice % 12 + 1).padStart(2, '0')}`
}

function nombre(valeur: number | string | null) {
  if (valeur === null || (typeof valeur === 'string' && !DECIMAL.test(valeur))) return null
  const n = Number(valeur)
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return null
  if (n === 0 && typeof valeur === 'string' && /[1-9]/.test(valeur)) return null
  return n
}

function mediane(valeurs: readonly number[]) {
  const triees = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(triees.length / 2)
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2
}

/**
 * Baseline constante, médiane des trois dernières observations. La validation rejoue
 * chaque prévision à un mois en se limitant aux observations disponibles à sa date.
 * L’écart atypique est évalué sur les six observations précédentes avec la MAD.
 */
export function analyserSerie(
  valeurs: ReadonlyMap<string, number | string | null>, debut: number, fin: number, horizon: number,
) {
  const observations = []
  const erreurs = []
  const derniers: number[] = []
  let dernieresObservations = 0
  let manquants = 0
  let valeursHorsPrecision = 0
  for (let indice = debut; indice <= fin; indice++) {
    const mois = libelleMois(indice)
    const valeur = valeurs.get(mois) ?? null
    const n = nombre(valeur)
    let atypique = false
    if (n === null) {
      if (valeur === null) manquants++
      else valeursHorsPrecision++
      derniers.length = 0
      dernieresObservations = 0
    } else {
      if (derniers.length >= 3) erreurs.push(Math.abs(n - mediane(derniers.slice(-3))))
      if (derniers.length === 6) {
        const centre = mediane(derniers)
        const mad = mediane(derniers.map(v => Math.abs(v - centre)))
        const distance = Math.abs(n - centre)
        atypique = mad === 0 ? distance > 0 : 0.6745 * distance / mad > 3.5
        derniers.shift()
      }
      derniers.push(n)
      dernieresObservations++
    }
    observations.push({ mois, valeur, atypique })
  }
  const validation = erreurs.length >= 3
    ? { mae: erreurs.reduce((somme, erreur) => somme + erreur, 0) / erreurs.length, points: erreurs.length }
    : null
  const ecart = erreurs.length >= 12 ? erreurs.sort((a, b) => a - b)[Math.ceil(0.9 * erreurs.length) - 1] : null
  const previsions = []
  if (dernieresObservations >= 6) {
    const valeur = mediane(derniers.slice(-3))
    for (let i = 1; i <= horizon; i++) {
      previsions.push({ mois: libelleMois(fin + i), valeur,
        bas: ecart === null ? null : valeur - ecart, haut: ecart === null ? null : valeur + ecart })
    }
  }
  return { observations, previsions, validation, dernieresObservations, manquants, valeursHorsPrecision }
}
