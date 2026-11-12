'use client';

/** Onglet « Rapports programmés » : liste, interrupteur Actif / En pause, suppression. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

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
import { toIntlTag } from '@/i18n/config';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { RapportProgrammeJson } from '@/lib/medic-assist/suivi/rapports-programmes';

import { changerActifRapportApi, listerRapportsApi, supprimerRapportApi } from './api-analyses';
import { useAfficherErreur } from './api-client';
import { BlocErreur, BlocVide, useFormatsDate } from './etats-liste';

const RAISONS_CONNUES = [
  'proprietaire_sans_acces',
  'artefact_introuvable',
  'planning_invalide',
  'aucun_destinataire',
  'export_impossible',
  'envoi_impossible',
  'erreur_interne',
  'destinataires_ecartes',
  'envoi_partiel',
] as const;

type RaisonConnue = (typeof RAISONS_CONNUES)[number];

function raisonDe(code: string): RaisonConnue | 'inconnue' {
  return (RAISONS_CONNUES as readonly string[]).includes(code)
    ? (code as RaisonConnue)
    : 'inconnue';
}

const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;
type Jour = (typeof JOURS)[number];

function jourDe(n: number | null | undefined): Jour {
  return (JOURS as readonly number[]).includes(n ?? 0) ? (n as Jour) : 1;
}

const VARIANTE_STATUT = { ok: 'success', partiel: 'warning', echec: 'danger' } as const;

export function OngletRapports() {
  const t = useTranslations('medicAssistSuivi.rapports');
  const tag = toIntlTag(useLocale());
  const formats = useFormatsDate();
  const { toast } = useToast();
  const afficherErreur = useAfficherErreur();

  const [rapports, setRapports] = useState<RapportProgrammeJson[]>([]);
  const [statut, setStatut] = useState<'chargement' | 'ok' | 'erreur'>('chargement');
  const [essai, setEssai] = useState(0);
  const [aSupprimer, setASupprimer] = useState<RapportProgrammeJson | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    setStatut('chargement');
    listerRapportsApi(controle.signal)
      .then(liste => {
        setRapports(liste);
        setStatut('ok');
      })
      .catch(erreur => {
        if (erreur instanceof DOMException && erreur.name === 'AbortError') return;
        setStatut('erreur');
      });
    return () => controle.abort();
  }, [essai]);

  const liste = useCallback(
    (valeurs: string[]) =>
      new Intl.ListFormat(tag, { style: 'short', type: 'conjunction' }).format(valeurs),
    [tag]
  );

  const phraseFrequence = (r: RapportProgrammeJson): string => {
    const heure = r.heure;
    if (r.frequence === 'hebdomadaire') {
      return t('frequence.hebdomadaire', { jour: t(`jours.${jourDe(r.jourSemaine)}`), heure });
    }
    if (r.frequence === 'mensuel') {
      return t('frequence.mensuel', { jourMois: r.jourMois ?? 1, heure });
    }
    return t('frequence.quotidien', { heure });
  };

  const basculerActif = useCallback(
    async (r: RapportProgrammeJson) => {
      const actif = !r.actif;
      const maj = (valeur: boolean) => (l: RapportProgrammeJson[]) =>
        l.map(x => (x.id === r.id ? { ...x, actif: valeur } : x));
      setRapports(maj(actif));
      try {
        await changerActifRapportApi(r.id, actif);
      } catch (erreur) {
        setRapports(maj(r.actif));
        afficherErreur(erreur);
      }
    },
    [afficherErreur]
  );

  const confirmerSuppression = useCallback(async () => {
    const cible = aSupprimer;
    setASupprimer(null);
    if (!cible) return;
    try {
      await supprimerRapportApi(cible.id);
      setRapports(l => l.filter(x => x.id !== cible.id));
      toast({ title: t('supprimeOk') });
    } catch (erreur) {
      afficherErreur(erreur);
    }
  }, [aSupprimer, afficherErreur, toast, t]);

  if (statut === 'chargement') {
    return (
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">{t('chargement')}</span>
        {[1, 2].map(i => (
          <Skeleton key={i} className="h-32" />
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
  if (rapports.length === 0) {
    return <BlocVide titre={t('vide.titre')} texte={t('vide.texte')} />;
  }

  return (
    <>
      <ul className="space-y-3">
        {rapports.map(r => {
          const noms = r.destinataires.map(d => d.nom || t('compteDisparu'));
          const raison = r.derniereErreur ? t(`raison.${raisonDe(r.derniereErreur)}`) : null;
          return (
            <li key={r.id}>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold">{r.artefactTitre}</h3>
                    <p className="text-sm text-muted-foreground" data-figure>
                      {phraseFrequence(r)}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.actif}
                    aria-label={t('interrupteurAria', { titre: r.artefactTitre })}
                    onClick={() => basculerActif(r)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-10"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative inline-block h-6 w-11 shrink-0 rounded-full border transition-colors',
                        r.actif ? 'border-success bg-success' : 'border-border bg-secondary'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                          r.actif ? 'start-[1.375rem]' : 'start-0.5'
                        )}
                      />
                    </span>
                    {r.actif ? t('actif') : t('pause')}
                  </button>
                </div>

                <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <p>{t('formats', { formats: liste(r.formats.map(f => t(`format.${f}`))) })}</p>
                  <p className="break-words">{t('destinataires', { noms: liste(noms) })}</p>
                  <p data-figure>
                    {r.actif && r.prochainEnvoiA
                      ? t('prochainEnvoi', { date: formats.envoi(r.prochainEnvoiA) })
                      : t('aucunProchainEnvoi')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2" data-figure>
                    <span>
                      {r.dernierEnvoiA
                        ? t('dernierEnvoi', { date: formats.envoi(r.dernierEnvoiA) })
                        : t('jamaisEnvoye')}
                    </span>
                    {r.dernierStatut && (
                      <Badge variant={VARIANTE_STATUT[r.dernierStatut]}>
                        {t(`statut.${r.dernierStatut}`)}
                      </Badge>
                    )}
                  </div>
                </div>

                {raison && <p className="text-sm text-muted-foreground">{raison}</p>}

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" className="min-h-11 sm:min-h-10">
                    <Link
                      href={`/medic-assist/analyses/${encodeURIComponent(r.artefactId)}`}
                      prefetch={false}
                    >
                      {t('ouvrirAnalyse')}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 sm:min-h-10"
                    aria-label={t('supprimerAria', { titre: r.artefactTitre })}
                    onClick={() => setASupprimer(r)}
                  >
                    {t('supprimer')}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={aSupprimer !== null}
        onOpenChange={ouvert => !ouvert && setASupprimer(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('supprimerTitre')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('supprimerTexte', { titre: aSupprimer?.artefactTitre ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmerSuppression}>
              {t('supprimerConfirmer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
