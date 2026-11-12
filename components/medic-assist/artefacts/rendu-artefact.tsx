'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type Ref } from 'react';

import type { ArtefactSpec, ContenuTableau } from '@/lib/medic-assist/contrats';
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu';

import { Button } from '@/components/ui/button';

import { RenduDocument } from './rendu-document';
import { RenduGraphique, type RenduGraphiqueHandle } from './rendu-graphique';
import { RenduIndicateurs } from './rendu-indicateurs';
import { RenduTableau, type RenduTableauHandle } from './rendu-tableau';

export type { RenduGraphiqueHandle, RenduTableauHandle };

interface RenduArtefactProps {
  artefact: ArtefactClient;
  /** Spécification à afficher (l'édition locale en cours, sinon `artefact.spec`). */
  spec: ArtefactSpec;
  onSpecChange: (spec: ArtefactSpec) => void;
  refGraphique?: Ref<RenduGraphiqueHandle>;
  refTableau?: Ref<RenduTableauHandle>;
  /**
   * `tableau` : pour un graphique, les mêmes données en tableau (lecture seule). Sans effet
   * sur les autres types.
   */
  vue?: 'natif' | 'tableau';
  /** Petit conteneur (carte, aperçu) : graphique de 280 px, tableau limité à 8 lignes visibles. */
  compact?: boolean;
  /** Relit l'artefact (bouton « Réessayer » quand la limite de recalculs est atteinte). */
  onReessayer?: () => void;
}

/** Hauteur d'un graphique compact. */
export const HAUTEUR_GRAPHIQUE_COMPACT = 280;
/** Hauteur maximale d'un tableau compact : en-tête + 8 lignes, le reste défile. */
export const HAUTEUR_TABLEAU_COMPACT = 340;

function EtatJeuManquant() {
  const t = useTranslations('medicAssistArtefacts');
  return (
    <p
      role="alert"
      className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
    >
      {t('erreurs.jeuManquant')}
    </p>
  );
}

/** Minutes entières (au moins 1) avant de réessayer, d'après le délai en secondes du serveur. */
function minutesDepuisSecondes(secondes: number): number {
  return Math.max(1, Math.ceil(secondes / 60));
}

/**
 * Limite de recalculs atteinte : les lignes n'ont pas été chargées. Dit quand réessayer, à la
 * place d'un tableau vide qui laisserait croire qu'il n'y a pas de données.
 */
function EtatLimiteDebit({
  reessayerDansSecondes,
  onReessayer,
}: {
  reessayerDansSecondes: number;
  onReessayer?: () => void;
}) {
  const t = useTranslations('medicAssistArtefacts');
  return (
    <div
      role="alert"
      className="grid justify-items-start gap-3 rounded-md border border-border bg-warning-soft p-4 text-sm text-foreground"
    >
      <p className="m-0">
        {t('erreurs.limiteDebit', { minutes: minutesDepuisSecondes(reessayerDansSecondes) })}
      </p>
      {onReessayer ? (
        <Button type="button" variant="outline" size="sm" onClick={onReessayer}>
          {t('panneau.reessayer')}
        </Button>
      ) : null}
    </div>
  );
}

/** Aiguille un artefact vers le rendu de son type. */
export function RenduArtefact({
  artefact,
  spec,
  onSpecChange,
  refGraphique,
  refTableau,
  vue = 'natif',
  compact = false,
  onReessayer,
}: RenduArtefactProps) {
  const modifiable = artefact.modifiable;
  // Plus petit délai parmi les jeux dont la lecture est limitée (indicateurs, document).
  const delais = Object.values(artefact.jeux)
    .map(j => j.limiteDebit?.reessayerDansSecondes)
    .filter((d): d is number => d !== undefined);
  const limiteGlobale = delais.length > 0 ? Math.min(...delais) : undefined;

  // Tableau dérivé d'un graphique : toutes les colonnes du jeu, sans total.
  const tableauDuGraphique = useMemo<ContenuTableau | null>(
    () =>
      spec.type === 'graphique'
        ? { titre: spec.titre, jeuDeDonneesId: spec.jeuDeDonneesId, totaux: false }
        : null,
    [spec]
  );

  switch (spec.type) {
    case 'tableau': {
      const jeu = artefact.jeux[spec.jeuDeDonneesId];
      if (!jeu) return <EtatJeuManquant />;
      if (jeu.limiteDebit) {
        return (
          <EtatLimiteDebit
            reessayerDansSecondes={jeu.limiteDebit.reessayerDansSecondes}
            onReessayer={onReessayer}
          />
        );
      }
      return (
        <RenduTableau
          ref={refTableau}
          spec={spec}
          jeu={jeu}
          modifiable={modifiable}
          hauteurMax={compact ? HAUTEUR_TABLEAU_COMPACT : undefined}
          onSpecChange={nouveau => onSpecChange({ ...nouveau, type: 'tableau' })}
        />
      );
    }
    case 'graphique': {
      const jeu = artefact.jeux[spec.jeuDeDonneesId];
      if (!jeu) return <EtatJeuManquant />;
      if (jeu.limiteDebit) {
        return (
          <EtatLimiteDebit
            reessayerDansSecondes={jeu.limiteDebit.reessayerDansSecondes}
            onReessayer={onReessayer}
          />
        );
      }
      if (vue === 'tableau' && tableauDuGraphique) {
        return (
          <RenduTableau
            ref={refTableau}
            spec={tableauDuGraphique}
            jeu={jeu}
            hauteurMax={compact ? HAUTEUR_TABLEAU_COMPACT : undefined}
          />
        );
      }
      return (
        <RenduGraphique
          ref={refGraphique}
          titre={spec.titre}
          spec={spec.graphique}
          jeu={jeu}
          modifiable={modifiable}
          compact={compact}
          hauteur={compact ? HAUTEUR_GRAPHIQUE_COMPACT : undefined}
          onSpecChange={graphique => onSpecChange({ ...spec, graphique })}
        />
      );
    }
    case 'indicateurs':
      if (limiteGlobale !== undefined) {
        return <EtatLimiteDebit reessayerDansSecondes={limiteGlobale} onReessayer={onReessayer} />;
      }
      return <RenduIndicateurs cartes={spec.cartes} jeux={artefact.jeux} />;
    case 'document':
      return (
        <>
          {limiteGlobale !== undefined ? (
            <EtatLimiteDebit reessayerDansSecondes={limiteGlobale} onReessayer={onReessayer} />
          ) : null}
          <RenduDocument
            artefact={{ ...artefact, spec }}
            onSpecChange={modifiable ? nouveau => onSpecChange(nouveau) : undefined}
            renduGraphique={({ titre, spec: graphique, jeu }) => (
              <RenduGraphique
                titre={titre}
                spec={graphique}
                jeu={jeu}
                compact={compact}
                hauteur={compact ? HAUTEUR_GRAPHIQUE_COMPACT : undefined}
              />
            )}
            renduIndicateurs={({ cartes, jeux }) => (
              <RenduIndicateurs cartes={cartes} jeux={jeux} />
            )}
          />
        </>
      );
    default:
      return null;
  }
}
