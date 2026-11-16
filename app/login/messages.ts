/**
 * Clés des messages de connexion, traduites par la page dans
 * `ecrans.connexion.erreurs.*` / `ecrans.connexion.succes.*` (aucun texte ici).
 */
export type CleErreurConnexion = 'tropDeTentatives' | 'identifiantsInvalides' | 'connexionImpossible'

export const MESSAGE_TROP_DE_TENTATIVES = 'tropDeTentatives' satisfies CleErreurConnexion
export const MESSAGE_IDENTIFIANTS_INVALIDES = 'identifiantsInvalides' satisfies CleErreurConnexion
export const MESSAGE_CONNEXION_IMPOSSIBLE = 'connexionImpossible' satisfies CleErreurConnexion
export const MESSAGE_MOT_DE_PASSE_DEFINI = 'motDePasseDefini'

/**
 * Code d'erreur next-auth (`?error=` ou `result.error`) vers la clé du message à afficher.
 * Le code brut n'est jamais montré. `source` distingue un échec du formulaire
 * d'une erreur arrivée par l'URL (retour d'un fournisseur, par exemple).
 */
export function messageErreurConnexion(code: string | null | undefined, source: 'formulaire' | 'url'): CleErreurConnexion {
  if (code === 'trop_de_tentatives') return MESSAGE_TROP_DE_TENTATIVES
  return source === 'formulaire' ? MESSAGE_IDENTIFIANTS_INVALIDES : MESSAGE_CONNEXION_IMPOSSIBLE
}
