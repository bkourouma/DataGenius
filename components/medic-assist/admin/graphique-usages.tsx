'use client';

/**
 * Graphique par periode (jour ou mois) de l'onglet Usages et couts. Charge a la demande
 * (next/dynamic) pour ne pas alourdir le reste de l'ecran avec recharts.
 * Couleurs : variables du theme (clair et sombre).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type MetriqueUsage = 'coutEur' | 'requetes' | 'jetons';

export interface PointGraphique {
  /** AAAA-MM-JJ (groupement par jour) ou AAAA-MM (par mois). */
  periode: string;
  coutEur: number;
  requetes: number;
  tokensEntree: number;
  tokensSortie: number;
}

export interface SerieGraphique {
  cle: 'coutEur' | 'requetes' | 'tokensEntree' | 'tokensSortie';
  libelle: string;
  couleur: string;
}

export interface GraphiqueUsagesProps {
  donnees: PointGraphique[];
  series: SerieGraphique[];
  empile: boolean;
  etiquetteAria: string;
  formaterPeriode: (iso: string) => string;
  formaterPeriodeLongue: (iso: string) => string;
  formaterValeur: (cle: SerieGraphique['cle'], valeur: number) => string;
  formaterAxe: (valeur: number) => string;
}

interface PayloadInfobulle {
  dataKey?: string | number;
  value?: number;
  color?: string;
}

function Infobulle({
  active,
  payload,
  label,
  series,
  formaterPeriodeLongue,
  formaterValeur,
}: {
  active?: boolean;
  payload?: PayloadInfobulle[];
  label?: string;
  series: SerieGraphique[];
  formaterPeriodeLongue: (iso: string) => string;
  formaterValeur: GraphiqueUsagesProps['formaterValeur'];
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold">{formaterPeriodeLongue(label)}</p>
      <ul className="space-y-0.5">
        {series.map(serie => {
          const entree = payload.find(p => p.dataKey === serie.cle);
          if (!entree || typeof entree.value !== 'number') return null;
          return (
            <li key={serie.cle} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: serie.couleur }}
              />
              <span className="text-muted-foreground">{serie.libelle}</span>
              <span className="ms-auto ps-3 font-semibold tabular-nums">
                {formaterValeur(serie.cle, entree.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function GraphiqueUsages({
  donnees,
  series,
  empile,
  etiquetteAria,
  formaterPeriode,
  formaterPeriodeLongue,
  formaterValeur,
  formaterAxe,
}: GraphiqueUsagesProps) {
  // Un seul repere de temps sur ~10 au-dela de 14 points : l'axe reste lisible.
  const intervalle = donnees.length > 14 ? Math.ceil(donnees.length / 10) - 1 : 0;

  return (
    // Le graphique reste de gauche a droite, y compris en arabe : le temps y est lu comme les chiffres.
    <div dir="ltr" role="img" aria-label={etiquetteAria} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={donnees} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="periode"
            tickFormatter={formaterPeriode}
            interval={intervalle}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
          />
          <YAxis
            width={56}
            tickFormatter={formaterAxe}
            tickLine={false}
            axisLine={false}
            allowDecimals
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.6 }}
            content={
              <Infobulle
                series={series}
                formaterPeriodeLongue={formaterPeriodeLongue}
                formaterValeur={formaterValeur}
              />
            }
          />
          {series.map(serie => (
            <Bar
              key={serie.cle}
              dataKey={serie.cle}
              name={serie.libelle}
              fill={serie.couleur}
              stackId={empile ? 'pile' : undefined}
              radius={empile ? 0 : [2, 2, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
