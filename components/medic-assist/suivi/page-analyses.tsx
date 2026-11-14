'use client';

/**
 * Page « Mes analyses » : quatre onglets (analyses, partages, tâches, rapports).
 * L'onglet actif suit le paramètre d'URL `?onglet=` (défaut : analyses) ; la
 * mise à jour de l'URL se fait sans rechargement.
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { getDirection } from '@/i18n/config';
import { EnTetePage } from '@/components/ui/en-tete-page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { OngletAnalyses } from './onglet-analyses';
import { OngletPartages } from './onglet-partages';
import { OngletRapports } from './onglet-rapports';
import { OngletTaches } from './onglet-taches';
import { TOPIC_MES_ANALYSES } from './topics';

export const ONGLETS = ['analyses', 'partages', 'taches', 'rapports'] as const;
export type Onglet = (typeof ONGLETS)[number];

export function ongletDepuisUrl(valeur: string | null | undefined): Onglet {
  return (ONGLETS as readonly string[]).includes(valeur ?? '') ? (valeur as Onglet) : 'analyses';
}

export function PageAnalyses() {
  const t = useTranslations('medicAssistSuivi.analyses');
  const direction = getDirection(useLocale());
  const params = useSearchParams();
  const [onglet, setOnglet] = useState<Onglet>(() => ongletDepuisUrl(params?.get('onglet')));

  const changer = useCallback((valeur: string) => {
    const suivant = ongletDepuisUrl(valeur);
    setOnglet(suivant);
    try {
      const url = new URL(window.location.href);
      if (suivant === 'analyses') url.searchParams.delete('onglet');
      else url.searchParams.set('onglet', suivant);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // L'URL est un confort : l'onglet reste choisi même si elle ne se met pas à jour.
    }
  }, []);

  return (
    <div className="space-y-4 py-4 sm:space-y-6 sm:py-6">
      <EnTetePage titre={t('page.titre')} description={t('page.description')} />

      <Tabs value={onglet} onValueChange={changer} dir={direction} className="space-y-4">
        <TabsList
          aria-label={t('onglets.aria')}
          className="grid h-auto w-full grid-cols-2 justify-start gap-1 md:flex md:overflow-x-auto md:overscroll-x-contain [&>*]:min-h-11 [&>*]:whitespace-normal md:[&>*]:min-h-10 md:[&>*]:shrink-0 md:[&>*]:whitespace-nowrap"
        >
          {ONGLETS.map(o => (
            <TabsTrigger key={o} value={o}>
              {t(`onglets.${o}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="analyses">
          <OngletAnalyses />
        </TabsContent>
        <TabsContent value="partages">
          <OngletPartages />
        </TabsContent>
        <TabsContent value="taches">
          <OngletTaches />
        </TabsContent>
        <TabsContent value="rapports">
          <OngletRapports />
        </TabsContent>
      </Tabs>
    </div>
  );
}
