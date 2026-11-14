'use client';

/**
 * Elements communs aux onglets de « Mes analyses » : bloc d'erreur avec
 * « Reessayer », bloc vide, et formatage des dates (jamais de texte en dur).
 */

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';

import { AlertCircle, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EtatVide } from '@/components/ui/en-tete-page';
import { toIntlTag } from '@/i18n/config';

export function BlocErreur({
  titre,
  texte,
  reessayer,
  onReessayer,
}: {
  titre: string;
  texte: string;
  reessayer: string;
  onReessayer: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-lg border border-destructive/40 bg-card px-6 py-10 text-center"
    >
      <span
        className="mb-3 flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive"
        aria-hidden
      >
        <AlertCircle className="size-5" />
      </span>
      <p className="font-semibold">{titre}</p>
      <p className="mt-1 max-w-sm text-pretty text-sm text-muted-foreground">{texte}</p>
      <Button variant="outline" className="mt-4 min-h-11 sm:min-h-10" onClick={onReessayer}>
        {reessayer}
      </Button>
    </div>
  );
}

export function BlocVide({
  titre,
  texte,
  icone,
}: {
  titre?: string;
  texte: string;
  icone?: ReactNode;
}) {
  return (
    <EtatVide icone={icone ?? <Inbox />} titre={titre ?? texte}>
      {titre ? texte : null}
    </EtatVide>
  );
}

/** Fonctions de formatage liees a la langue courante. */
export function useFormatsDate() {
  const tag = toIntlTag(useLocale());
  return {
    /** Date courte d'un instant ISO, dans le fuseau du navigateur. */
    jour(iso: string): string {
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(new Date(iso));
    },
    /**
     * Echeance (date seule). Une valeur historique a minuit UTC est une date
     * « calendaire » : on la lit en UTC, sans decalage. Toute autre valeur (fin
     * de journee Paris creee par Medic Assist) se lit en heure de Paris, jamais
     * dans le fuseau du navigateur.
     */
    echeance(iso: string): string {
      const minuitUtc = /T00:00:00(\.000)?Z$/.test(iso) || /^\d{4}-\d{2}-\d{2}$/.test(iso);
      return new Intl.DateTimeFormat(tag, {
        dateStyle: 'medium',
        timeZone: minuitUtc ? 'UTC' : 'Europe/Paris',
      }).format(new Date(iso));
    },
    /** Instant d'envoi d'un rapport, lu en heure de Paris (fuseau affiche). */
    envoi(iso: string): string {
      return new Intl.DateTimeFormat(tag, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Paris',
      }).format(new Date(iso));
    },
  };
}
