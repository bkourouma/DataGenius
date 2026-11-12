'use client';

import * as React from 'react';

import { Input, type InputProps } from '@/components/ui/input';

/** Annees acceptees : en dessous, l'annee est encore en cours de frappe. */
const ANNEE_MIN = 2000;
const ANNEE_MAX = 2099;

/**
 * Date `YYYY-MM-DD` entierement saisie. Au clavier, le champ date passe par
 * « 0002 », « 0020 », « 0202 » avant « 2026 » : ces valeurs sont valides pour le
 * navigateur mais ne sont pas encore la date voulue.
 */
export function dateSaisieComplete(valeur: string): boolean {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  if (!morceaux) return false;
  const annee = Number(morceaux[1]);
  return annee >= ANNEE_MIN && annee <= ANNEE_MAX;
}

export interface ChampDateProps extends Omit<InputProps, 'type' | 'value' | 'defaultValue' | 'onChange'> {
  /** Date appliquee (`YYYY-MM-DD`), ou vide. */
  value?: string;
  /** Recoit la date une fois complete, ou `undefined` quand le champ est vide. */
  onValueChange: (valeur: string | undefined) => void;
}

/**
 * Champ date de filtre : la saisie en cours reste dans le champ et n'est
 * transmise qu'une fois l'annee complete. Chaque frappe declenchait sinon un
 * rechargement sur l'an 2 ou l'an 202, refuse par le serveur.
 */
export const ChampDate = React.forwardRef<HTMLInputElement, ChampDateProps>(
  ({ value, onValueChange, onBlur, ...props }, ref) => {
    const [saisie, setSaisie] = React.useState(value ?? '');

    // Date changee hors du champ (filtres effaces) : le champ la reprend.
    React.useEffect(() => {
      setSaisie(value ?? '');
    }, [value]);

    return (
      <Input
        {...props}
        ref={ref}
        type="date"
        value={saisie}
        onChange={(e) => {
          const valeur = e.target.value;
          setSaisie(valeur);
          if (valeur === '') onValueChange(undefined);
          else if (dateSaisieComplete(valeur)) onValueChange(valeur);
        }}
        onBlur={(e) => {
          // Saisie abandonnee en cours de route : on revient a la date appliquee.
          if (saisie !== '' && !dateSaisieComplete(saisie)) setSaisie(value ?? '');
          onBlur?.(e);
        }}
      />
    );
  }
);
ChampDate.displayName = 'ChampDate';
