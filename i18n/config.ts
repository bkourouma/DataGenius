/**
 * Configuration des langues de l'interface.
 *
 * La langue est choisie par l'utilisateur (sélecteur dans l'en-tête) et mémorisée
 * dans un cookie : les URL ne changent pas (pas de préfixe /fr, /en...).
 * Voir docs/I18N.md.
 */

export const locales = ['fr', 'en', 'es', 'zh', 'ar', 'hi'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'fr';

/** Cookie qui mémorise la langue choisie (lu par i18n/request.ts). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 an

/** Nom de chaque langue, écrit dans la langue elle-même (affiché dans le sélecteur). */
export const LOCALE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
};

/**
 * Étiquette BCP 47 à passer à Intl.* (dates, nombres) pour chaque langue.
 *
 * Pour l'arabe on retient volontairement le Maroc (ar-MA) : comme l'Algérie et la
 * Tunisie, il écrit les nombres en chiffres latins (1 234,50) alors que ar-SA et
 * ar-EG utilisent les chiffres arabes orientaux (١٢٣٤). Dans une application qui
 * affiche des codes produits, des prix et des quantités, les chiffres latins
 * restent lisibles et cohérents avec les données saisies.
 *
 * Le hindi (hi-IN) écrit lui aussi les nombres en chiffres latins, mais les groupe
 * à l'indienne : 12,34,567.50 (lakh, crore).
 */
export const INTL_LOCALE_TAGS: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  zh: 'zh-CN',
  ar: 'ar-MA',
  hi: 'hi-IN',
};

/** Sens d'écriture : seul l'arabe s'écrit de droite à gauche. */
export type Direction = 'ltr' | 'rtl';

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function getDirection(locale: string): Direction {
  return isLocale(locale) && RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** Convertit une langue de l'interface ('en') en étiquette Intl ('en-GB'). */
export function toIntlTag(locale: string): string {
  return isLocale(locale) ? INTL_LOCALE_TAGS[locale] : INTL_LOCALE_TAGS[defaultLocale];
}
