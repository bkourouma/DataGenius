'use client';

/** Onglet « Partagés avec moi » + sous-section « Que j'ai partagé ». */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BarChart3, MessageSquare } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { PartageEnvoyeJson, PartageRecuJson } from '@/lib/medic-assist/suivi/partages';

import { listerPartagesApi, retirerPartageApi } from './api-analyses';
import { useAfficherErreur } from './api-client';
import { BlocErreur, BlocVide, useFormatsDate } from './etats-liste';

type Sens = 'recus' | 'envoyes';

function lienCible(cibleType: 'conversation' | 'artefact', cibleId: string): string {
  return cibleType === 'conversation'
    ? `/assistant?c=${encodeURIComponent(cibleId)}`
    : `/assistant/analyses/${encodeURIComponent(cibleId)}`;
}

/** Liste paginee (« Charger plus ») d'un sens de partage. */
function ListePartages<T extends PartageRecuJson | PartageEnvoyeJson>({
  sens,
  rendre,
  vide,
  chargement,
}: {
  sens: Sens;
  rendre: (p: T, action: React.ReactNode) => React.ReactNode;
  vide: React.ReactNode;
  chargement: string;
}) {
  const t = useTranslations('medicAssistSuivi.partagesRecus');
  const afficherErreur = useAfficherErreur();
  const { toast } = useToast();
  const [lignes, setLignes] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statut, setStatut] = useState<'chargement' | 'ok' | 'erreur'>('chargement');
  const [plusEnCours, setPlusEnCours] = useState(false);
  const [essai, setEssai] = useState(0);
  const [aRetirer, setARetirer] = useState<T | null>(null);
  const [retraitEnCours, setRetraitEnCours] = useState(false);
  // Rechargement apres un retrait : la liste reste affichee, sans squelette.
  const silencieux = useRef(false);
  const cle = sens === 'recus' ? 'retirer.recu' : 'retirer.envoye';

  useEffect(() => {
    const controle = new AbortController();
    if (!silencieux.current) setStatut('chargement');
    silencieux.current = false;
    listerPartagesApi(sens, 1, controle.signal)
      .then(r => {
        setLignes(r.data as T[]);
        setTotal(r.total);
        setPage(1);
        setStatut('ok');
      })
      .catch(erreur => {
        if (erreur instanceof DOMException && erreur.name === 'AbortError') return;
        setStatut('erreur');
      });
    return () => controle.abort();
  }, [sens, essai]);

  const confirmerRetrait = useCallback(async () => {
    const cible = aRetirer;
    if (!cible) return;
    setRetraitEnCours(true);
    try {
      await retirerPartageApi(cible.id);
      setLignes(l => l.filter(x => x.id !== cible.id));
      setTotal(n => Math.max(0, n - 1));
      toast({ title: t(`${cle}.ok`) });
      silencieux.current = true;
      setEssai(n => n + 1);
    } catch (erreur) {
      afficherErreur(erreur);
    } finally {
      setRetraitEnCours(false);
      setARetirer(null);
    }
  }, [aRetirer, afficherErreur, toast, t, cle]);

  const chargerPlus = useCallback(async () => {
    setPlusEnCours(true);
    try {
      const r = await listerPartagesApi(sens, page + 1);
      setLignes(actuelles => {
        const ids = new Set(actuelles.map(l => l.id));
        return [...actuelles, ...(r.data as T[]).filter(l => !ids.has(l.id))];
      });
      setTotal(r.total);
      setPage(p => p + 1);
    } catch (erreur) {
      afficherErreur(erreur);
    } finally {
      setPlusEnCours(false);
    }
  }, [sens, page, afficherErreur]);

  if (statut === 'chargement') {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">{chargement}</span>
        {[1, 2].map(i => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (statut === 'erreur') {
    return (
      <BlocErreur
        titre={t('erreur.titre')}
        texte={t('erreur.texte')}
        reessayer={t('erreur.reessayer')}
        onReessayer={() => setEssai(n => n + 1)}
      />
    );
  }
  if (lignes.length === 0) return <>{vide}</>;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {lignes.map(p => (
          <li key={p.id}>
            {rendre(
              p,
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-10 sm:shrink-0"
                onClick={() => setARetirer(p)}
                disabled={retraitEnCours}
                aria-label={t(`${cle}.aria`, { titre: p.titre })}
              >
                {t(`${cle}.bouton`)}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog
        open={aRetirer !== null}
        onOpenChange={ouvert => !ouvert && !retraitEnCours && setARetirer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${cle}.titre`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${cle}.texte`, {
                titre: aRetirer?.titre ?? '',
                nom:
                  aRetirer && 'destinataireNom' in aRetirer
                    ? aRetirer.destinataireNom || t('compteDisparu')
                    : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retraitEnCours}>{t('retirer.annuler')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={retraitEnCours}
              onClick={event => {
                // Le dialogue reste ouvert pendant l'appel : on le ferme nous-memes.
                event.preventDefault();
                void confirmerRetrait();
              }}
            >
              {t(`${cle}.confirmer`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {lignes.length < total && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-10"
            onClick={chargerPlus}
            disabled={plusEnCours}
          >
            {t('chargerPlus')}
          </Button>
        </div>
      )}
    </div>
  );
}

function BadgeCible({ cibleType }: { cibleType: 'conversation' | 'artefact' }) {
  const t = useTranslations('medicAssistSuivi.partagesRecus');
  const Icone = cibleType === 'conversation' ? MessageSquare : BarChart3;
  return (
    <Badge variant="outline">
      <Icone className="size-3.5" aria-hidden="true" />
      {t(`cible.${cibleType}`)}
    </Badge>
  );
}

export function OngletPartages() {
  const t = useTranslations('medicAssistSuivi.partagesRecus');
  const formats = useFormatsDate();

  return (
    <div className="space-y-8">
      <section aria-labelledby="partages-recus-titre" className="space-y-3">
        <h2 id="partages-recus-titre" className="text-lg font-semibold">
          {t('titre')}
        </h2>
        <ListePartages<PartageRecuJson>
          sens="recus"
          chargement={t('chargement')}
          vide={<BlocVide titre={t('vide.titre')} texte={t('vide.texte')} />}
          rendre={(p, retirer) => (
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeCible cibleType={p.cibleType} />
                  <h3 className="break-words text-base font-semibold">{p.titre}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('de', { nom: p.expediteurNom || t('compteDisparu') })}
                  {' · '}
                  <span data-figure>{t('partageLe', { date: formats.jour(p.creeLe) })}</span>
                </p>
                {p.message && (
                  <p className="break-words border-s-2 border-border ps-3 text-sm text-foreground">
                    {p.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
                <Button asChild className="min-h-11 sm:min-h-10 sm:shrink-0">
                  <Link
                    prefetch={false}
                    href={lienCible(p.cibleType, p.cibleId)}
                    aria-label={t('ouvrirAria', { titre: p.titre })}
                  >
                    {p.cibleType === 'conversation' ? t('ouvrirConversation') : t('ouvrirArtefact')}
                  </Link>
                </Button>
                {retirer}
              </div>
            </Card>
          )}
        />
      </section>

      <section aria-labelledby="partages-envoyes-titre" className="space-y-3">
        <h2 id="partages-envoyes-titre" className="text-lg font-semibold">
          {t('envoyes.titre')}
        </h2>
        <ListePartages<PartageEnvoyeJson>
          sens="envoyes"
          chargement={t('envoyes.chargement')}
          vide={<BlocVide texte={t('envoyes.vide')} />}
          rendre={(p, retirer) => (
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeCible cibleType={p.cibleType} />
                  <h3 className="break-words text-base font-semibold">{p.titre}</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('envoyes.a', { nom: p.destinataireNom || t('compteDisparu') })}
                  {' · '}
                  <span data-figure>{t('partageLe', { date: formats.jour(p.creeLe) })}</span>
                </p>
              </div>
              {retirer}
            </Card>
          )}
        />
      </section>
    </div>
  );
}
