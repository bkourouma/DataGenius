'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { getDirection } from '@/i18n/config';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  ONGLETS,
  PARAMETRE_ONGLET,
  TOPIC_GUIDE_ADMIN_MEDIC_ASSIST,
  ongletValide,
  type OngletAdmin,
} from './constantes';
import { OngletAvis } from './onglet-avis';
import { OngletConfiguration } from './onglet-configuration';
import { OngletUsages } from './onglet-usages';

/**
 * Ecran d'administration de Medic Assist : trois onglets, memorises dans l'URL
 * (?onglet=configuration|usages|avis). Un onglet n'est monte (et ne charge ses
 * donnees) qu'a sa premiere visite, puis reste monte pour ne pas perdre une saisie.
 */
export function AdministrationMedicAssist({ identifiantAdmin }: { identifiantAdmin: string }) {
  const t = useTranslations('medicAssistAdmin');
  const direction = getDirection(useLocale());
  const router = useRouter();
  const pathname = usePathname();
  const parametres = useSearchParams();
  const depuisUrl = ongletValide(parametres?.get(PARAMETRE_ONGLET));

  const [actif, setActif] = useState<OngletAdmin>(depuisUrl);
  const [visites, setVisites] = useState<ReadonlySet<OngletAdmin>>(() => new Set([depuisUrl]));

  // Retour arriere du navigateur ou lien direct : l'onglet suit l'URL.
  useEffect(() => {
    setActif(depuisUrl);
    setVisites(courant => (courant.has(depuisUrl) ? courant : new Set(courant).add(depuisUrl)));
  }, [depuisUrl]);

  function changer(valeur: string) {
    const onglet = ongletValide(valeur);
    setActif(onglet);
    setVisites(courant => (courant.has(onglet) ? courant : new Set(courant).add(onglet)));
    const suite = new URLSearchParams(parametres?.toString() ?? '');
    suite.set(PARAMETRE_ONGLET, onglet);
    router.replace(`${pathname}?${suite.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6 py-6">
      <div>
        <div className="[&>div]:items-baseline [&>div]:gap-2">
          <h1
            className="text-2xl font-bold sm:text-3xl"
          >
            {t('page.titre')}
          </h1>
        </div>
        <p className="mt-2 text-muted-foreground">{t('page.sousTitre')}</p>
      </div>

      <Tabs value={actif} onValueChange={changer} dir={direction} className="space-y-4">
        <div className="max-w-full overflow-x-auto">
          <TabsList aria-label={t('onglets.liste')}>
            {ONGLETS.map(onglet => (
              <TabsTrigger key={onglet} value={onglet}>
                {t(`onglets.${onglet}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="configuration" forceMount className="mt-0 data-[state=inactive]:hidden">
          {visites.has('configuration') ? <OngletConfiguration /> : null}
        </TabsContent>
        <TabsContent value="usages" forceMount className="mt-0 data-[state=inactive]:hidden">
          {visites.has('usages') ? <OngletUsages /> : null}
        </TabsContent>
        <TabsContent value="avis" forceMount className="mt-0 data-[state=inactive]:hidden">
          {visites.has('avis') ? <OngletAvis identifiantAdmin={identifiantAdmin} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
