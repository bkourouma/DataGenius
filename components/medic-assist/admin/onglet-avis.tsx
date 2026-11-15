'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Loader2,
  MessageSquareOff,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toIntlTag } from '@/i18n/config';

import { appelerJson, estAnnulation, useMessageErreur } from './api';
import {
  CHEMIN_MEDIC_ASSIST,
  PARAMETRE_CONVERSATION,
  TAILLE_PAGE_AVIS,
  URL_AVIS,
} from './constantes';
import { creerFormats, type Formats } from './format';
import type { AvisAdminDto, ListeAvisAdminDto } from './dependances';

type FiltreAvis = 'negatif' | 'positif' | 'tous';
const FILTRES: FiltreAvis[] = ['negatif', 'positif', 'tous'];

function adresseAvis(filtre: FiltreAvis, curseur: string | null): string {
  const params = new URLSearchParams({ taille: String(TAILLE_PAGE_AVIS) });
  if (filtre !== 'tous') params.set('valeur', filtre);
  if (curseur) params.set('curseur', curseur);
  return `${URL_AVIS}?${params.toString()}`;
}

/** Texte brut : jamais interprete comme HTML ni comme markdown (noeud texte React). */
function TexteBrut({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm">{children}</p>;
}

function CarteAvis({
  avis,
  formats,
  identifiantAdmin,
}: {
  avis: AvisAdminDto;
  formats: Formats;
  identifiantAdmin: string;
}) {
  const t = useTranslations('medicAssistAdmin.avis');
  const negatif = avis.valeur === 'negatif';
  const Icone = negatif ? ThumbsDown : ThumbsUp;
  const modele = [avis.fournisseur, avis.modele].filter(Boolean).join(' · ');
  // Isolation (architecture §3) : une conversation ne s'ouvre que pour son auteur.
  const conversationOuvrable = avis.utilisateur.id === identifiantAdmin;

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={negatif ? 'danger' : 'success'}>
          <Icone className="h-3.5 w-3.5" aria-hidden="true" />
          {t(`valeur.${avis.valeur}`)}
        </Badge>
        <span className="text-sm font-semibold">{avis.utilisateur.nom}</span>
        <time dateTime={avis.creeA} className="text-xs text-muted-foreground tabular-nums">
          {formats.dateHeure(avis.creeA)}
        </time>
      </header>

      <dl className="space-y-3">
        <div className="space-y-0.5">
          <dt className="text-xs font-semibold text-muted-foreground">{t('champs.commentaire')}</dt>
          <dd>
            {avis.commentaire ? (
              <TexteBrut>{avis.commentaire}</TexteBrut>
            ) : (
              <p className="text-sm text-muted-foreground">{t('sansCommentaire')}</p>
            )}
          </dd>
        </div>
        {avis.question ? (
          <div className="space-y-0.5">
            <dt className="text-xs font-semibold text-muted-foreground">{t('champs.question')}</dt>
            <dd>
              <TexteBrut>{avis.question}</TexteBrut>
            </dd>
          </div>
        ) : null}
        {avis.reponse ? (
          <div className="space-y-0.5">
            <dt className="text-xs font-semibold text-muted-foreground">{t('champs.reponse')}</dt>
            <dd className="rounded-md bg-muted/50 p-2">
              <TexteBrut>{avis.reponse}</TexteBrut>
            </dd>
          </div>
        ) : null}
      </dl>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {modele ? (
          <span className="flex gap-1.5">
            <span>{t('champs.modele')}</span>
            <span className="font-medium text-foreground">{modele}</span>
          </span>
        ) : null}
        {conversationOuvrable ? (
          <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
            <Link
              prefetch={false}
              href={`${CHEMIN_MEDIC_ASSIST}?${PARAMETRE_CONVERSATION}=${encodeURIComponent(avis.conversationId)}`}
            >
              {t('ouvrirConversation')}
            </Link>
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

export function OngletAvis({ identifiantAdmin }: { identifiantAdmin: string }) {
  const t = useTranslations('medicAssistAdmin');
  const intlTag = toIntlTag(useLocale());
  const formats = useMemo(() => creerFormats(intlTag), [intlTag]);
  const messageErreur = useMessageErreur();

  const [filtre, setFiltre] = useState<FiltreAvis>('negatif');
  const [avis, setAvis] = useState<AvisAdminDto[]>([]);
  const [totaux, setTotaux] = useState<ListeAvisAdminDto['totaux'] | null>(null);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    const controle = new AbortController();
    setChargement(true);
    setErreur(null);
    setAvis([]);
    setSuivant(null);
    appelerJson<ListeAvisAdminDto>(adresseAvis(filtre, null), { signal: controle.signal })
      .then(page => {
        setAvis(page.avis ?? []);
        setTotaux(page.totaux ?? null);
        setSuivant(page.suivant ?? null);
      })
      .catch(e => {
        if (estAnnulation(e)) return;
        const message = messageErreur(e);
        setErreur(message);
        toast.error(t('avis.erreurChargement'), { description: message });
      })
      .finally(() => {
        if (!controle.signal.aborted) setChargement(false);
      });
    return () => controle.abort();
    // Le filtre et le bouton Reessayer declenchent le rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtre, essai]);

  const chargerPlus = useCallback(async () => {
    if (!suivant) return;
    setChargementSuite(true);
    try {
      const page = await appelerJson<ListeAvisAdminDto>(adresseAvis(filtre, suivant));
      setAvis(courant => {
        const connus = new Set(courant.map(a => a.id));
        return [...courant, ...(page.avis ?? []).filter(a => !connus.has(a.id))];
      });
      setTotaux(page.totaux ?? null);
      setSuivant(page.suivant ?? null);
    } catch (e) {
      toast.error(t('avis.erreurSuite'), { description: messageErreur(e) });
    } finally {
      setChargementSuite(false);
    }
  }, [suivant, filtre, messageErreur, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('avis.filtre.libelle')} className="flex flex-wrap gap-2">
          {FILTRES.map(f => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={filtre === f ? 'default' : 'outline'}
              aria-pressed={filtre === f}
              onClick={() => setFiltre(f)}
            >
              {t(`avis.filtre.${f}`)}
            </Button>
          ))}
        </div>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums"
          data-testid="avis-totaux"
        >
          {totaux ? (
            <>
              <span>{t('avis.totaux.positifs', { count: totaux.positifs })}</span>
              <span>{t('avis.totaux.negatifs', { count: totaux.negatifs })}</span>
            </>
          ) : null}
        </div>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
        {!chargement && !erreur ? t('avis.compteur', { count: avis.length }) : null}
      </p>

      {chargement ? (
        <div role="status" aria-live="polite" className="space-y-3" data-testid="avis-chargement">
          <span className="sr-only">{t('avis.chargement')}</span>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : null}

      {!chargement && erreur ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>{t('avis.erreurChargement')}</p>
            <p className="text-sm">{erreur}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setEssai(n => n + 1)}>
              <RotateCcw aria-hidden="true" />
              {t('commun.reessayer')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!chargement && !erreur && avis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <MessageSquareOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">{t('avis.vide.titre')}</p>
          <p className="text-sm text-muted-foreground">{t(`avis.vide.${filtre}`)}</p>
        </div>
      ) : null}

      {!chargement && !erreur && avis.length > 0 ? (
        <>
          <ul aria-label={t('avis.liste')} className="space-y-3">
            {avis.map(a => (
              <li key={a.id}>
                <CarteAvis avis={a} formats={formats} identifiantAdmin={identifiantAdmin} />
              </li>
            ))}
          </ul>
          {suivant ? (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={chargementSuite}
                onClick={() => void chargerPlus()}
              >
                {chargementSuite ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {chargementSuite ? t('avis.chargementSuite') : t('avis.chargerPlus')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
