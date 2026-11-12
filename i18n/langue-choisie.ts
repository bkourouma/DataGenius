import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE, type Locale } from './config';

/**
 * Langue posée par le sélecteur (cookie), ou null si l'utilisateur n'a rien
 * choisi ou si l'appel a lieu hors requête (script, test).
 *
 * Module à part, sans next-intl : la configuration d'authentification l'importe.
 */
export function langueChoisie(): Locale | null {
  try {
    const fromCookie = cookies().get(LOCALE_COOKIE)?.value;
    return isLocale(fromCookie) ? fromCookie : null;
  } catch {
    return null;
  }
}
