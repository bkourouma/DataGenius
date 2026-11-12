/**
 * Cartes d'indicateurs résolues vers un tableau plat (une ligne par carte), commun aux
 * exports xlsx (feuille d'indicateurs) et csv. Les valeurs sont brutes ; les libellés
 * d'en-tête viennent du traducteur.
 */

import type { FormatColonne } from '@/lib/medic-assist/contrats';
import type { IndicateurResolu, Traducteur } from '../types-rendu';

export interface TableauIndicateurs {
  entetes: {
    indicateur: string;
    valeur: string;
    comparaison: string;
    valeurComparaison: string;
    variation: string;
    objectif: string;
    valeurObjectif: string;
    taux: string;
    statut: string;
  };
  /** Lignes indexées par les valeurs de `entetes`. */
  lignes: Record<string, unknown>[];
  /** Format de chaque colonne, par libellé d'en-tête. */
  formats: Record<string, FormatColonne>;
}

const CLE_STATUT = { atteint: 'atteint', en_cours: 'enCours', a_risque: 'aRisque' } as const;

/** Format commun des valeurs si toutes les cartes partagent le même, sinon `decimal`. */
function formatCommun(indicateurs: IndicateurResolu[]): FormatColonne {
  const formats = new Set(indicateurs.map(i => i.format));
  return formats.size === 1 ? [...formats][0] : 'decimal';
}

export function tableauIndicateurs(
  indicateurs: IndicateurResolu[],
  traduire: Traducteur
): TableauIndicateurs {
  const e = {
    indicateur: traduire('exports.indicateurs.indicateur'),
    valeur: traduire('exports.indicateurs.valeur'),
    comparaison: traduire('exports.indicateurs.comparaison'),
    valeurComparaison: traduire('exports.indicateurs.valeurComparaison'),
    variation: traduire('exports.indicateurs.variation'),
    objectif: traduire('exports.indicateurs.objectif'),
    valeurObjectif: traduire('exports.indicateurs.valeurObjectif'),
    taux: traduire('exports.indicateurs.taux'),
    statut: traduire('exports.indicateurs.statut'),
  };
  const commun = formatCommun(indicateurs);
  const lignes = indicateurs.map(i => ({
    [e.indicateur]: i.libelle,
    [e.valeur]: i.valeur,
    [e.comparaison]: i.comparaison?.libelle ?? null,
    [e.valeurComparaison]: i.comparaison?.valeur ?? null,
    [e.variation]: i.comparaison?.variationPct ?? null,
    [e.objectif]: i.objectif?.libelle ?? null,
    [e.valeurObjectif]: i.objectif?.valeur ?? null,
    [e.taux]: i.objectif?.taux ?? null,
    [e.statut]: i.objectif?.statut
      ? traduire(`exports.indicateurs.statuts.${CLE_STATUT[i.objectif.statut]}`)
      : null,
  }));
  const formats: Record<string, FormatColonne> = {
    [e.indicateur]: 'texte',
    [e.valeur]: commun,
    [e.comparaison]: 'texte',
    [e.valeurComparaison]: commun,
    [e.variation]: 'pourcentage',
    [e.objectif]: 'texte',
    [e.valeurObjectif]: commun,
    [e.taux]: 'pourcentage',
    [e.statut]: 'texte',
  };
  return { entetes: e, lignes, formats };
}
