'use client';

/** Onglet « Mes tâches » : filtres avec compteurs, mise à jour optimiste. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TacheJson } from '@/lib/medic-assist/suivi/types';

import { changerEtatTacheApi, listerTachesApi } from './api-analyses';
import { useAfficherErreur } from './api-client';
import { BlocErreur, BlocVide, useFormatsDate } from './etats-liste';

type Filtre = TacheJson['etat'];
const FILTRES: Filtre[] = ['a_faire', 'en_retard', 'terminee'];

const VARIANTE_PRIORITE: Record<TacheJson['priorite'], 'danger' | 'secondary' | 'outline'> = {
  haute: 'danger',
  normale: 'secondary',
  basse: 'outline',
};

/** Etat d'une tâche rouverte : en retard si l'échéance est passée. */
function etatApresReouverture(tache: TacheJson): Filtre {
  return tache.echeance && new Date(tache.echeance).getTime() < Date.now()
    ? 'en_retard'
    : 'a_faire';
}

export function OngletTaches() {
  const t = useTranslations('medicAssistSuivi.taches');
  const formats = useFormatsDate();
  const afficherErreur = useAfficherErreur();

  const [taches, setTaches] = useState<TacheJson[]>([]);
  const [statut, setStatut] = useState<'chargement' | 'ok' | 'erreur'>('chargement');
  const [filtre, setFiltre] = useState<Filtre>('a_faire');
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    setStatut('chargement');
    listerTachesApi(controle.signal)
      .then(liste => {
        setTaches(liste);
        setStatut('ok');
      })
      .catch(erreur => {
        if (erreur instanceof DOMException && erreur.name === 'AbortError') return;
        setStatut('erreur');
      });
    return () => controle.abort();
  }, [essai]);

  const compteurs = useMemo(() => {
    const c: Record<Filtre, number> = { a_faire: 0, en_retard: 0, terminee: 0 };
    for (const tache of taches) c[tache.etat] += 1;
    return c;
  }, [taches]);

  const visibles = useMemo(() => taches.filter(x => x.etat === filtre), [taches, filtre]);

  const basculer = useCallback(
    async (tache: TacheJson) => {
      const terminee = !tache.terminee;
      const avant = tache;
      const apres: TacheJson = {
        ...tache,
        terminee,
        etat: terminee ? 'terminee' : etatApresReouverture(tache),
        termineeLe: terminee ? new Date().toISOString() : null,
      };
      const remplacer = (x: TacheJson) => (y: TacheJson[]) => y.map(z => (z.id === x.id ? x : z));
      setTaches(remplacer(apres));
      try {
        const serveur = await changerEtatTacheApi(tache.id, terminee);
        setTaches(remplacer(serveur));
      } catch (erreur) {
        setTaches(remplacer(avant));
        afficherErreur(erreur);
      }
    },
    [afficherErreur]
  );

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('filtres.aria')} className="flex flex-wrap gap-2">
        {FILTRES.map(f => (
          <Button
            key={f}
            type="button"
            variant={filtre === f ? 'default' : 'outline'}
            aria-pressed={filtre === f}
            className="min-h-11 sm:min-h-10"
            onClick={() => setFiltre(f)}
          >
            {t(`filtres.${f}`)}
            {statut === 'ok' && (
              <span className="rounded-full bg-background/20 px-1.5 text-xs" data-figure>
                {compteurs[f]}
              </span>
            )}
          </Button>
        ))}
      </div>

      {statut === 'chargement' && (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">{t('chargement')}</span>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {statut === 'erreur' && (
        <BlocErreur
          titre={t('erreur.titre')}
          texte={t('erreur.texte')}
          reessayer={t('erreur.reessayer')}
          onReessayer={() => setEssai(n => n + 1)}
        />
      )}

      {statut === 'ok' && visibles.length === 0 && <BlocVide texte={t(`vide.${filtre}`)} />}

      {statut === 'ok' && visibles.length > 0 && (
        <ul className="space-y-3">
          {visibles.map(tache => {
            const enRetard = tache.etat === 'en_retard';
            return (
              <li key={tache.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={cn(
                          'break-words text-base font-semibold',
                          tache.terminee && 'text-muted-foreground line-through'
                        )}
                      >
                        {tache.titre}
                      </h3>
                      <Badge variant={VARIANTE_PRIORITE[tache.priorite]}>
                        {t(`priorite.${tache.priorite}`)}
                      </Badge>
                    </div>
                    {tache.description && (
                      <p className="break-words text-sm text-muted-foreground">
                        {tache.description}
                      </p>
                    )}
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-figure>
                      {tache.terminee && tache.termineeLe ? (
                        <span className="text-muted-foreground">
                          {t('termineeLe', { date: formats.jour(tache.termineeLe) })}
                        </span>
                      ) : tache.echeance ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1',
                            enRetard ? 'font-medium text-destructive' : 'text-muted-foreground'
                          )}
                        >
                          {enRetard && <AlertCircle className="size-4" aria-hidden="true" />}
                          {t('echeance', { date: formats.echeance(tache.echeance) })}
                          {enRetard && <span>{` · ${t('enRetard')}`}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('sansEcheance')}</span>
                      )}
                      <span className="text-muted-foreground">
                        {tache.assigneeAMoi
                          ? t('assigneAMoi')
                          : t('assigneA', { nom: tache.assigneeNom })}
                      </span>
                      {tache.creeParNom && (
                        <span className="text-muted-foreground">
                          {t('creeePar', { nom: tache.creeParNom })}
                        </span>
                      )}
                    </p>
                    {tache.conversationId && tache.conversationOuvrable && (
                      <Link
                        prefetch={false}
                        href={`/assistant?c=${encodeURIComponent(tache.conversationId)}`}
                        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-0"
                      >
                        {t('voirConversation')}
                      </Link>
                    )}
                  </div>
                  {tache.assigneeAMoi && (
                    <Button
                      type="button"
                      variant={tache.terminee ? 'outline' : 'default'}
                      className="min-h-11 sm:min-h-10 sm:shrink-0"
                      aria-label={
                        tache.terminee
                          ? t('rouvrirAria', { titre: tache.titre })
                          : t('marquerAria', { titre: tache.titre })
                      }
                      onClick={() => basculer(tache)}
                    >
                      {tache.terminee ? t('rouvrir') : t('marquerTerminee')}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
