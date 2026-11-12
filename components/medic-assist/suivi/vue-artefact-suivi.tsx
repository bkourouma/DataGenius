'use client';

/**
 * VueArtefactSuivi : vue d'un artefact dans le suivi (page « Mes analyses », epingles du
 * tableau de bord). Delegue au rendu du lot 4 (`VueArtefact`), qui lit
 * GET /api/medic-assist/artefacts/[id] : l'artefact est RECALCULE sur les donnees du jour.
 * Chargement, erreur et rechargement sont geres par `VueArtefact` (hook `useArtefact`).
 */

import { VueArtefact } from '@/components/medic-assist/artefacts/vue-artefact';

export interface VueArtefactSuiviProps {
  artefactId: string;
  /** Vignette du tableau de bord (hauteur reduite). */
  compact?: boolean;
}

export function VueArtefactSuivi({ artefactId, compact = false }: VueArtefactSuiviProps) {
  return <VueArtefact artefactId={artefactId} compact={compact} />;
}
