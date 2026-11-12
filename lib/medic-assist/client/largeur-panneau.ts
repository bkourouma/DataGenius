/**
 * Preferences de mise en page de l'espace de chat, memorisees dans le
 * navigateur (localStorage, toujours en try/catch : navigation privee, stockage
 * refuse ou indisponible -> valeur par defaut, jamais d'erreur).
 */

export const LARGEUR_PANNEAU_DEFAUT = 480
export const LARGEUR_PANNEAU_MIN = 360
export const LARGEUR_PANNEAU_MAX = 720
/** Part maximale de la zone de conversation occupee par le panneau. */
export const PART_MAX_PANNEAU = 0.6
/** Pas des fleches du clavier sur la poignee. */
export const PAS_CLAVIER_PANNEAU = 24

export const CLE_LARGEUR_PANNEAU = 'medicpro.medic-assist.largeur-panneau'
export const CLE_LISTE_REPLIEE = 'medicpro.medic-assist.liste-repliee'

/** Borne maximale : 720 px ou 60 % de la zone, sans jamais passer sous le minimum. */
export function largeurMaxPanneau(largeurZone?: number): number {
  if (!largeurZone || !Number.isFinite(largeurZone) || largeurZone <= 0) return LARGEUR_PANNEAU_MAX
  return Math.max(
    LARGEUR_PANNEAU_MIN,
    Math.min(LARGEUR_PANNEAU_MAX, Math.floor(largeurZone * PART_MAX_PANNEAU)),
  )
}

/** Ramene une largeur dans [360, min(720, 60 % de la zone)] ; NaN -> defaut borne. */
export function bornerLargeur(largeur: number, largeurZone?: number): number {
  const max = largeurMaxPanneau(largeurZone)
  const valeur = Number.isFinite(largeur) ? Math.round(largeur) : LARGEUR_PANNEAU_DEFAUT
  return Math.min(max, Math.max(LARGEUR_PANNEAU_MIN, valeur))
}

/** Largeur memorisee, ou null si absente, illisible ou stockage indisponible. */
export function lireLargeurPanneau(): number | null {
  try {
    const brut = window.localStorage.getItem(CLE_LARGEUR_PANNEAU)
    if (brut === null) return null
    const valeur = Number(brut)
    return Number.isFinite(valeur) && valeur > 0 ? valeur : null
  } catch {
    return null
  }
}

export function ecrireLargeurPanneau(largeur: number): void {
  try {
    window.localStorage.setItem(CLE_LARGEUR_PANNEAU, String(Math.round(largeur)))
  } catch {
    // Sans stockage, la largeur vaut pour la session en cours seulement.
  }
}

export function lireListeRepliee(): boolean {
  try {
    return window.localStorage.getItem(CLE_LISTE_REPLIEE) === '1'
  } catch {
    return false
  }
}

export function ecrireListeRepliee(repliee: boolean): void {
  try {
    window.localStorage.setItem(CLE_LISTE_REPLIEE, repliee ? '1' : '0')
  } catch {
    // Preference non memorisee.
  }
}
