'use client';

/**
 * Graphique par periode (jour ou mois) de l'onglet Usages et couts. Charge a la demande
 * (next/dynamic) avec ECharts, via l'enveloppe partagee des artefacts.
 * Couleurs d'axe et de grille : variables du theme lues sur le DOM (clair et sombre).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { EchartsReact } from '@/components/medic-assist/artefacts/echarts-react';

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

interface CouleursTheme {
  bordure: string;
  texte: string;
  survol: string;
  fond: string;
  texteCarte: string;
}

const COULEURS_PAR_DEFAUT: CouleursTheme = {
  bordure: '#e5e7eb',
  texte: '#6b7280',
  survol: 'rgba(0,0,0,0.05)',
  fond: '#ffffff',
  texteCarte: '#111827',
};

function lireCouleurs(noeud: HTMLElement): CouleursTheme {
  const style = getComputedStyle(noeud);
  const lire = (nom: string, repli: string) => {
    const valeur = style.getPropertyValue(nom).trim();
    return valeur ? `hsl(${valeur})` : repli;
  };
  const survol = style.getPropertyValue('--accent').trim();
  return {
    bordure: lire('--border', COULEURS_PAR_DEFAUT.bordure),
    texte: lire('--muted-foreground', COULEURS_PAR_DEFAUT.texte),
    survol: survol ? `hsl(${survol} / 0.6)` : COULEURS_PAR_DEFAUT.survol,
    fond: lire('--card', COULEURS_PAR_DEFAUT.fond),
    texteCarte: lire('--card-foreground', COULEURS_PAR_DEFAUT.texteCarte),
  };
}

function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface ParametreInfobulle {
  axisValue?: string;
  seriesId?: string;
  value?: unknown;
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
  const racine = useRef<HTMLDivElement | null>(null);
  const [couleurs, setCouleurs] = useState<CouleursTheme>(COULEURS_PAR_DEFAUT);

  useEffect(() => {
    const noeud = racine.current;
    if (!noeud) return;
    const actualiser = () => setCouleurs(lireCouleurs(noeud));
    actualiser();
    const observateur = new MutationObserver(actualiser);
    observateur.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observateur.disconnect();
  }, []);

  const option = useMemo(() => {
    // Un seul repere de temps sur ~10 au-dela de 14 points : l'axe reste lisible.
    const intervalle = donnees.length > 14 ? Math.ceil(donnees.length / 10) - 1 : 0;
    return {
      animation: false,
      grid: { top: 8, right: 8, bottom: 4, left: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: donnees.map(point => point.periode),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: couleurs.bordure } },
        axisLabel: {
          interval: intervalle,
          color: couleurs.texte,
          fontSize: 12,
          formatter: (valeur: string) => formaterPeriode(valeur),
        },
      },
      yAxis: {
        type: 'value',
        axisTick: { show: false },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: couleurs.bordure } },
        axisLabel: {
          color: couleurs.texte,
          fontSize: 12,
          formatter: (valeur: number) => formaterAxe(valeur),
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: couleurs.survol } },
        backgroundColor: couleurs.fond,
        borderColor: couleurs.bordure,
        textStyle: { color: couleurs.texteCarte, fontSize: 12 },
        formatter: (parametres: ParametreInfobulle[]) => {
          if (!parametres?.length) return '';
          const periode = parametres[0].axisValue ?? '';
          const lignes = series
            .map(serie => {
              const entree = parametres.find(p => p.seriesId === serie.cle);
              if (!entree || typeof entree.value !== 'number') return '';
              return (
                `<div style="display:flex;align-items:center;gap:8px;margin-top:2px">` +
                `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${echapper(serie.couleur)}"></span>` +
                `<span style="opacity:0.7">${echapper(serie.libelle)}</span>` +
                `<span style="margin-inline-start:auto;padding-inline-start:12px;font-weight:600">` +
                `${echapper(formaterValeur(serie.cle, entree.value))}</span></div>`
              );
            })
            .join('');
          return `<div style="font-weight:600">${echapper(formaterPeriodeLongue(periode))}</div>${lignes}`;
        },
      },
      series: series.map(serie => ({
        id: serie.cle,
        name: serie.libelle,
        type: 'bar',
        stack: empile ? 'pile' : undefined,
        data: donnees.map(point => point[serie.cle]),
        itemStyle: {
          color: serie.couleur,
          borderRadius: empile ? 0 : [2, 2, 0, 0],
        },
        animation: false,
      })),
    };
  }, [
    donnees,
    series,
    empile,
    couleurs,
    formaterPeriode,
    formaterPeriodeLongue,
    formaterValeur,
    formaterAxe,
  ]);

  return (
    // Le graphique reste de gauche a droite, y compris en arabe : le temps y est lu comme les chiffres.
    <div ref={racine} dir="ltr" role="img" aria-label={etiquetteAria} className="h-64 w-full">
      <EchartsReact option={option} hauteur={256} />
    </div>
  );
}
