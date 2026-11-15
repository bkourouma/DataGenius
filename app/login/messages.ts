export const MESSAGE_TROP_DE_TENTATIVES = 'Trop de tentatives. Réessayez dans 15 minutes.'
export const MESSAGE_IDENTIFIANTS_INVALIDES = 'Identifiants invalides.'
export const MESSAGE_CONNEXION_IMPOSSIBLE = 'Connexion impossible. Vérifiez que votre compte est autorisé.'
export const MESSAGE_MOT_DE_PASSE_DEFINI = 'Votre mot de passe est défini. Vous pouvez vous connecter.'

/**
 * Code d'erreur next-auth (`?error=` ou `result.error`) vers un message affichable.
 * Le code brut n'est jamais montré. `source` distingue un échec du formulaire
 * d'une erreur arrivée par l'URL (retour d'un fournisseur, par exemple).
 */
export function messageErreurConnexion(code: string | null | undefined, source: 'formulaire' | 'url'): string {
  if (code === 'trop_de_tentatives') return MESSAGE_TROP_DE_TENTATIVES
  return source === 'formulaire' ? MESSAGE_IDENTIFIANTS_INVALIDES : MESSAGE_CONNEXION_IMPOSSIBLE
}
