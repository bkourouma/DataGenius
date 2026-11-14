import { getTranslations } from 'next-intl/server';

import { EnTetePage } from '@/components/ui/en-tete-page';
import { VueArtefactSuivi } from '@/components/medic-assist/suivi/vue-artefact-suivi';

export const dynamic = 'force-dynamic';

// Next 14 : objet simple ; les versions suivantes passent une Promise.
type Props = { params: { id: string } | Promise<{ id: string }> };

/** Ouvrir une analyse (id = artefactId) : retour, titre et vue recalculee. */
export default async function AnalysePage({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations('medicAssistSuivi.analyses');

  return (
    <div className="space-y-4 py-4 sm:space-y-6 sm:py-6">
      <EnTetePage
        retour={{ href: '/assistant/analyses', libelle: t('retour') }}
        titre={t('titreRepli')}
      />
      <VueArtefactSuivi artefactId={id} />
    </div>
  );
}
