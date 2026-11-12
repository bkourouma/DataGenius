'use client';

/** Onglet « Analyses enregistrees » : recherche, cartes, retrait avec confirmation. */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BarChart3, FileText, Gauge, Table2, type LucideIcon } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import type { AnalyseResumeJson } from '@/lib/medic-assist/suivi/analyses';

import { listerAnalysesApi, retirerAnalyseApi } from './api-analyses';
import { useAfficherErreur } from './api-client';
import { BlocErreur, BlocVide, useFormatsDate } from './etats-liste';

const ICONES: Record<string, LucideIcon> = {
  tableau: Table2,
  graphique: BarChart3,
  indicateurs: Gauge,
  document: FileText,
};
const TYPES_CONNUS = ['tableau', 'graphique', 'indicateurs', 'document'] as const;
type TypeConnu = (typeof TYPES_CONNUS)[number];

function estTypeConnu(type: string): type is TypeConnu {
  return (TYPES_CONNUS as readonly string[]).includes(type);
}
const DELAI_ANTI_REBOND_MS = 300;

export function OngletAnalyses() {
  const t = useTranslations('medicAssistSuivi.analyses');
  const formats = useFormatsDate();
  const { toast } = useToast();
  const afficherErreur = useAfficherErreur();

  const [saisie, setSaisie] = useState('');
  const [recherche, setRecherche] = useState('');
  const [lignes, setLignes] = useState<AnalyseResumeJson[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statut, setStatut] = useState<'chargement' | 'ok' | 'erreur'>('chargement');
  const [plusEnCours, setPlusEnCours] = useState(false);
  const [essai, setEssai] = useState(0);
  const [aRetirer, setARetirer] = useState<AnalyseResumeJson | null>(null);
  const premiere = useRef(true);

  // Anti-rebond de la recherche.
  useEffect(() => {
    if (premiere.current) {
      premiere.current = false;
      return;
    }
    const minuteur = setTimeout(() => setRecherche(saisie), DELAI_ANTI_REBOND_MS);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    const controle = new AbortController();
    setStatut('chargement');
    listerAnalysesApi({ q: recherche, page: 1 }, controle.signal)
      .then(r => {
        setLignes(r.data);
        setTotal(r.total);
        setPage(1);
        setStatut('ok');
      })
      .catch(erreur => {
        if (erreur instanceof DOMException && erreur.name === 'AbortError') return;
        setStatut('erreur');
      });
    return () => controle.abort();
  }, [recherche, essai]);

  const chargerPlus = useCallback(async () => {
    setPlusEnCours(true);
    try {
      const r = await listerAnalysesApi({ q: recherche, page: page + 1 });
      setLignes(actuelles => {
        const ids = new Set(actuelles.map(l => l.artefactId));
        return [...actuelles, ...r.data.filter(l => !ids.has(l.artefactId))];
      });
      setTotal(r.total);
      setPage(p => p + 1);
    } catch (erreur) {
      afficherErreur(erreur);
    } finally {
      setPlusEnCours(false);
    }
  }, [recherche, page, afficherErreur]);

  const confirmerRetrait = useCallback(async () => {
    const cible = aRetirer;
    setARetirer(null);
    if (!cible) return;
    try {
      await retirerAnalyseApi(cible.artefactId);
      setLignes(l => l.filter(x => x.artefactId !== cible.artefactId));
      setTotal(n => Math.max(0, n - 1));
      toast({ title: t('retireOk') });
    } catch (erreur) {
      afficherErreur(erreur);
    }
  }, [aRetirer, afficherErreur, toast, t]);

  const reste = lignes.length < total;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full min-w-0 sm:flex-1 sm:max-w-sm">
          <label htmlFor="mes-analyses-recherche" className="sr-only">
            {t('recherche.label')}
          </label>
          <Input
            id="mes-analyses-recherche"
            type="search"
            value={saisie}
            onChange={e => setSaisie(e.target.value)}
            placeholder={t('recherche.placeholder')}
            className="min-h-11 sm:min-h-10"
          />
        </div>
        {statut === 'ok' && (
          <p className="shrink-0 whitespace-nowrap text-sm text-muted-foreground" data-figure>
            {t('total', { count: total })}
          </p>
        )}
      </div>

      {statut === 'chargement' && (
        <div role="status" aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">{t('chargement')}</span>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-36" />
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

      {statut === 'ok' && lignes.length === 0 && (
        <BlocVide
          titre={recherche ? t('vide.rechercheTitre') : t('vide.titre')}
          texte={recherche ? t('vide.rechercheTexte') : t('vide.texte')}
        />
      )}

      {statut === 'ok' && lignes.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lignes.map(a => {
            const Icone = ICONES[a.type] ?? FileText;
            return (
              <li key={a.artefactId}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline">
                      <Icone className="size-3.5" aria-hidden="true" />
                      {estTypeConnu(a.type) ? t(`type.${a.type}`) : a.type}
                    </Badge>
                    {a.partage && <Badge variant="info">{t('partagee')}</Badge>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-semibold leading-snug">{a.titre}</h3>
                    {a.sousTitre && (
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {a.sousTitre}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground" data-figure>
                    {t('enregistreeLe', { date: formats.jour(a.enregistreeLe) })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild className="min-h-11 flex-1 sm:min-h-10 sm:flex-none">
                      <Link
                        prefetch={false}
                        href={`/medic-assist/analyses/${encodeURIComponent(a.artefactId)}`}
                        aria-label={t('ouvrirAria', { titre: a.titre })}
                      >
                        {t('ouvrir')}
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1 sm:min-h-10 sm:flex-none"
                      aria-label={t('retirerAria', { titre: a.titre })}
                      onClick={() => setARetirer(a)}
                    >
                      {t('retirer')}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {statut === 'ok' && reste && (
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

      <AlertDialog open={aRetirer !== null} onOpenChange={ouvert => !ouvert && setARetirer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('retirerTitre')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('retirerTexte', { titre: aRetirer?.titre ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('annuler')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmerRetrait}>
              {t('retirerConfirmer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
