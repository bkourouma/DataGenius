/**
 * Traducteur du namespace `medicAssistArtefacts` pour le serveur (exports, routes).
 *
 * Le client utilise `useTranslations` ; ici on appelle `createTranslator` de next-intl sur le
 * JSON de la langue, chargé à la demande, posé SUR le français : une clé absente de la langue
 * (traduction partielle ou fichier manquant) retombe sur le français, clé par clé. Une clé
 * absente partout donne la clé elle-même, sans bruit dans les journaux ni exception : un
 * export ne doit jamais échouer pour un libellé.
 */

import { createTranslator } from 'next-intl';

import { defaultLocale, getDirection, type Locale } from '@/i18n/config';

import type { Traducteur } from '../types-rendu';

export interface TraducteurServeur {
  traduire: Traducteur;
  rtl: boolean;
  /** Langue réellement chargée (le français si celle demandée manque). */
  locale: Locale;
}

async function chargerMessages(locale: Locale): Promise<Record<string, unknown> | null> {
  try {
    const mod = await import(`../../../../messages/${locale}/medicAssistArtefacts.json`);
    return (mod.default ?? mod) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type Messages = Record<string, unknown>;

function estObjet(valeur: unknown): valeur is Messages {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

/** Fusion profonde : les valeurs de `dessus` l'emportent sur celles de `base`. */
function fusionner(base: Messages, dessus: Messages): Messages {
  const sortie: Messages = { ...base };
  for (const [cle, valeur] of Object.entries(dessus)) {
    const existant = sortie[cle];
    sortie[cle] = estObjet(existant) && estObjet(valeur) ? fusionner(existant, valeur) : valeur;
  }
  return sortie;
}

/** Crée le traducteur de la langue demandée (repli sur le français) et indique le sens d'écriture. */
export async function creerTraducteurServeur(locale: Locale): Promise<TraducteurServeur> {
  let effective: Locale = locale;
  const reference = (await chargerMessages(defaultLocale)) ?? {};
  let messages: Messages = reference;
  if (locale !== defaultLocale) {
    const propres = await chargerMessages(locale);
    if (propres) messages = fusionner(reference, propres);
    else effective = defaultLocale;
  }
  const t = createTranslator({
    locale: effective,
    messages: { medicAssistArtefacts: messages },
    namespace: 'medicAssistArtefacts' as never,
    onError: () => {},
    getMessageFallback: ({ key }: { key: string }) => key,
  } as never) as unknown as (cle: string, valeurs?: Record<string, string | number>) => string;

  return {
    traduire: (cle, valeurs) => t(cle, valeurs),
    rtl: getDirection(locale) === 'rtl',
    locale: effective,
  };
}
