'use client';

/**
 * Vue d'un artefact par son identifiant : rend l'artefact seul, sans le chrome du panneau
 * (ni onglets, ni versions, ni actions), en LECTURE SEULE (jamais de PATCH). Sert aux cartes
 * de « Mes analyses » et aux épingles du tableau de bord.
 *
 * - Charge `GET /api/medic-assist/artefacts/[id]` (avec `?version=n` si `version`).
 * - Titre (et sous-titre hors compact) au-dessus ; barre d'outils réduite (menu Télécharger).
 * - `compact` : graphique de 280 px, tableau de 8 lignes visibles environ (le reste défile),
 *   document tronqué avec dégradé.
 * - États : chargement (squelette de hauteur stable), erreur (message + Réessayer), artefact
 *   introuvable, vide.
 * - Accessible : région nommée par le titre ; RTL (classes logiques) ; utilisable à 375 px.
 */

import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ArtefactClient } from '@/lib/medic-assist/artefacts/types-rendu';
import { cn } from '@/lib/utils';

import { MenuTelechargement } from './menu-telechargement';
import {
  HAUTEUR_GRAPHIQUE_COMPACT,
  RenduArtefact,
  type RenduGraphiqueHandle,
} from './rendu-artefact';
import { useArtefact } from './use-artefact';

export interface VueArtefactProps {
  artefactId: string;
  /** Petit conteneur (carte, épingle) : hauteurs limitées, barre d'outils réduite. */
  compact?: boolean;
  /** Version à afficher ; absente : la dernière. */
  version?: number;
}

/** Hauteur réservée au squelette : celle du rendu, pour éviter tout saut de mise en page. */
const HAUTEUR_SQUELETTE = { compact: HAUTEUR_GRAPHIQUE_COMPACT, normal: 320 } as const;
/** Hauteur maximale d'un document en aperçu compact. */
const HAUTEUR_DOCUMENT_COMPACT = 280;

function ArtefactSansContenu(artefact: ArtefactClient): boolean {
  const spec = artefact.spec;
  if (spec.type === 'document') return spec.blocs.length === 0;
  if (spec.type === 'indicateurs') return spec.cartes.length === 0;
  return false;
}

const noop = () => {};

export function VueArtefact({ artefactId, compact = false, version }: VueArtefactProps) {
  const t = useTranslations('medicAssistArtefacts');
  const idTitre = useId();
  const refGraphique = useRef<RenduGraphiqueHandle>(null);
  const { artefact, etat, erreur, recharger } = useArtefact(artefactId, version);

  // Lecture seule : aucun rendu ne propose d'édition, aucune édition n'est envoyée.
  const enLecture = useMemo<ArtefactClient | null>(
    () => (artefact ? { ...artefact, modifiable: false } : null),
    [artefact]
  );

  const hauteurSquelette = compact ? HAUTEUR_SQUELETTE.compact : HAUTEUR_SQUELETTE.normal;

  if (etat === 'erreur') {
    const introuvable = erreur === 'introuvable';
    return (
      <section
        aria-label={t('panneau.titre')}
        className="grid min-w-0 content-start justify-items-start gap-3 rounded-lg border border-border bg-card p-4"
      >
        <p role="alert" className="m-0 text-sm text-foreground">
          {t(`erreurs.${erreur ?? 'chargement'}`)}
        </p>
        {introuvable ? null : (
          <Button type="button" variant="outline" size="sm" onClick={recharger}>
            {t('panneau.reessayer')}
          </Button>
        )}
      </section>
    );
  }

  if (etat === 'chargement' || !artefact || !enLecture) {
    return (
      <section
        aria-label={t('panneau.titre')}
        aria-busy="true"
        className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-4"
      >
        <p role="status" className="sr-only">
          {t('panneau.chargement')}
        </p>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="w-full" style={{ height: hauteurSquelette }} />
      </section>
    );
  }

  const telechargerPng =
    artefact.type === 'graphique'
      ? async (nomBase: string) => {
          const poignee = refGraphique.current;
          if (!poignee) throw new Error('graphique indisponible');
          await poignee.telechargerPng(nomBase);
        }
      : undefined;

  const vide = ArtefactSansContenu(artefact);
  const documentCompact = compact && artefact.type === 'document';

  return (
    <section
      aria-labelledby={idTitre}
      data-compact={compact ? 'true' : undefined}
      className="grid min-w-0 content-start gap-3 rounded-lg border border-border bg-card p-3 text-foreground sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={idTitre} className="m-0 break-words text-base font-semibold" dir="auto">
            {artefact.titre}
          </h3>
          {!compact && artefact.sousTitre ? (
            <p className="m-0 mt-0.5 text-sm text-muted-foreground" dir="auto">
              {artefact.sousTitre}
            </p>
          ) : null}
        </div>
        <MenuTelechargement
          artefactId={artefact.id}
          titre={artefact.titre}
          type={artefact.type}
          version={artefact.version}
          onTelechargerPng={telechargerPng}
        />
      </div>

      <div
        className={cn(
          'relative min-w-0',
          documentCompact && 'overflow-hidden'
        )}
        style={documentCompact ? { maxHeight: HAUTEUR_DOCUMENT_COMPACT } : undefined}
      >
        {vide ? (
          <p
            role="status"
            className="m-0 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
          >
            {t('panneau.apercu.vide')}
          </p>
        ) : (
          <RenduArtefact
            artefact={enLecture}
            spec={enLecture.spec}
            onSpecChange={noop}
            refGraphique={refGraphique}
            compact={compact}
            onReessayer={recharger}
          />
        )}
        {documentCompact && !vide ? (
          <div
            aria-hidden
            data-testid="degrade-apercu"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent"
          />
        ) : null}
      </div>
    </section>
  );
}
