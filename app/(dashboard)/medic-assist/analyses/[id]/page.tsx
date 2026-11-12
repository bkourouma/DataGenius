import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

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
      <Link
        href="/medic-assist/analyses"
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-0"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('retour')}
      </Link>
      <h1 className="text-2xl font-bold sm:text-3xl">{t('titreRepli')}</h1>
      <VueArtefactSuivi artefactId={id} />
    </div>
  );
}
