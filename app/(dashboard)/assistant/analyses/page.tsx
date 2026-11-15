import { Suspense } from 'react';

import { PageAnalyses } from '@/components/medic-assist/suivi/page-analyses';

export const dynamic = 'force-dynamic';

/** Mes analyses : serveur mince, tout l'ecran est dans le composant client. */
export default function MesAnalysesPage() {
  return (
    <Suspense fallback={null}>
      <PageAnalyses />
    </Suspense>
  );
}
