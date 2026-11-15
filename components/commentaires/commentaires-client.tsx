'use client';

import { useId, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ajouter, supprimer } from '@/lib/commentaires/actions';
import type { CommentaireAnalyse } from '@/lib/commentaires/commentaires';
import { LONGUEUR_MAX_COMMENTAIRE, longueurTexte } from '@/lib/commentaires/texte';

type CodeErreur = 'introuvable' | 'invalide' | 'interdit' | 'limite_debit' | 'interne';

interface Props {
  artefactId: string;
  commentaires: CommentaireAnalyse[];
}

/** Liste et formulaire des commentaires d'une analyse (texte brut, jamais interprété). */
export function CommentairesClient({ artefactId, commentaires }: Props) {
  const t = useTranslations('glossaire.commentaires');
  const locale = useLocale();
  const idChamp = useId();
  const idErreur = useId();
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<CodeErreur | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const restants = LONGUEUR_MAX_COMMENTAIRE - longueurTexte(texte);
  const vide = texte.trim().length === 0;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

  function envoyer(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (vide || restants < 0 || enCours) return;
    setErreur(null);
    demarrer(async () => {
      try {
        const resultat = await ajouter(artefactId, texte);
        if ('erreur' in resultat) setErreur(resultat.erreur);
        else setTexte('');
      } catch {
        setErreur('interne');
      }
    });
  }

  function retirer(id: string) {
    setErreur(null);
    setASupprimer(null);
    demarrer(async () => {
      try {
        const resultat = await supprimer(id);
        if ('erreur' in resultat) setErreur(resultat.erreur);
      } catch {
        setErreur('interne');
      }
    });
  }

  return (
    <section aria-labelledby={`${idChamp}-titre`} className="space-y-4 text-start">
      <h2 id={`${idChamp}-titre`} className="text-lg font-semibold tracking-tight">
        {t('titre')}
      </h2>

      {commentaires.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('vide')}</p>
      ) : (
        <ul className="space-y-3">
          {commentaires.map((commentaire) => (
            <li key={commentaire.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">
                {t('auteurLe', { auteur: commentaire.auteurNom, date: date.format(new Date(commentaire.creeLe)) })}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{commentaire.texte}</p>
              {commentaire.supprimable ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {aSupprimer === commentaire.id ? (
                    <>
                      <span className="text-sm">{t('confirmerSuppression')}</span>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={enCours}
                        onClick={() => retirer(commentaire.id)}
                      >
                        {t('confirmer')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setASupprimer(null)}>
                        {t('annuler')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={enCours}
                      onClick={() => setASupprimer(commentaire.id)}
                    >
                      {t('supprimer')}
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={envoyer} className="space-y-2">
        <label htmlFor={idChamp} className="sr-only">
          {t('libelleChamp')}
        </label>
        <Textarea
          id={idChamp}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={t('placeholder')}
          rows={3}
          className="text-start"
          aria-invalid={restants < 0 || undefined}
          aria-describedby={erreur ? idErreur : undefined}
          disabled={enCours}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={restants < 0 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
            {t('restants', { restants })}
          </p>
          <Button type="submit" size="sm" loading={enCours} disabled={vide || restants < 0}>
            {t('envoyer')}
          </Button>
        </div>
        <div id={idErreur} aria-live="polite">
          {erreur ? <Alert variant="destructive">{t(erreur)}</Alert> : null}
        </div>
      </form>
    </section>
  );
}
