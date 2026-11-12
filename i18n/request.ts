import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, type Locale } from './config';
import { langueChoisie } from './langue-choisie';
import { loadMessages } from './messages';

/**
 * Langue de la requête en cours : le cookie posé par le sélecteur de langue,
 * sinon le français. On ne lit volontairement pas l'en-tête Accept-Language :
 * l'application reste en français tant que l'utilisateur n'a rien choisi.
 */
export async function resolveRequestLocale(): Promise<Locale> {
  return langueChoisie() ?? defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: process.env.NEXT_PUBLIC_TIMEZONE || 'UTC',
  };
});

