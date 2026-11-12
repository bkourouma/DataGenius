'use client';

/**
 * Carte de confirmation d'une action proposee par l'assistant (tache, e-mail,
 * notification, rapport programme).
 *
 * Regle de fond : AUCUNE execution sans clic sur « Confirmer ». A la premiere
 * apparition la carte relit l'action sur le serveur : au rechargement d'une
 * conversation, c'est l'etat REEL (deja executee, annulee, en echec) qui
 * s'affiche, pas celui du message d'origine.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  Mail,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChampDate } from '@/components/ui/champ-date';
import { Label } from '@/components/ui/label';
import { toIntlTag } from '@/i18n/config';
import type { ActionProposee, TypeAction } from '@/lib/medic-assist/contrats';
import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import {
  annulerAction,
  confirmerAction,
  lireAction,
  resoudreComptes,
  useAfficherErreur,
  type ParametresConfirmation,
} from './api-client';
import { SelecteurUtilisateurs } from './selecteur-utilisateurs';
import { useMoi } from './use-moi';

const ICONES: Record<TypeAction, LucideIcon> = {
  creer_tache: ListChecks,
  envoyer_email: Mail,
  notifier: Bell,
  programmer_rapport: CalendarClock,
};

/** Codes d'echec d'execution ayant un texte dedie ; les autres retombent sur `interne`. */
const RAISONS_CONNUES = [
  'introuvable',
  'destinataire_invalide',
  'export_impossible',
  'mail_non_envoye',
  'execution_impossible',
] as const;

type RaisonCarte = (typeof RAISONS_CONNUES)[number] | 'interne';

type Lecture = 'chargement' | 'ok' | 'erreur';
type EtatNoms = 'chargement' | 'ok' | 'erreur';

export interface CarteActionProps {
  action: ActionProposee;
  onChange?: (action: ActionProposee) => void;
}

function enObjet(valeur: unknown): Record<string, unknown> {
  return valeur && typeof valeur === 'object' ? (valeur as Record<string, unknown>) : {};
}

function identifiantsDe(action: ActionProposee): string[] {
  const p = enObjet(action.parametres);
  if (action.type === 'creer_tache') {
    return typeof p.assigneA === 'string' && p.assigneA ? [p.assigneA] : [];
  }
  return Array.isArray(p.destinataires)
    ? p.destinataires.filter((v): v is string => typeof v === 'string')
    : [];
}

function echeanceDe(action: ActionProposee): string {
  const e = enObjet(action.parametres).echeance;
  return typeof e === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e) ? e.slice(0, 10) : '';
}

export function CarteAction({ action: actionRecue, onChange }: CarteActionProps) {
  const t = useTranslations('medicAssistSuivi');
  const locale = useLocale();
  const afficherErreur = useAfficherErreur();
  const idTitre = useId();
  const [action, setAction] = useState<ActionProposee>(actionRecue);
  // « Moi » ne sert qu'a une carte encore modifiable : pas d'appel pour les cartes traitees.
  const moi = useMoi(action.statut === 'proposee');
  const [lecture, setLecture] = useState<Lecture>('chargement');
  const [relance, setRelance] = useState(0);
  const [annuaire, setAnnuaire] = useState<Record<string, CompteJson>>({});
  const [etatNoms, setEtatNoms] = useState<EtatNoms>('chargement');
  // null = rien touche : on n'envoie alors aucune surcharge.
  const [choix, setChoix] = useState<CompteJson[] | null>(null);
  const [echeance, setEcheance] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<'confirmer' | 'annuler' | null>(null);
  // Repli si le serveur ne renvoie pas `traiteeA` : instant du clic.
  const [traiteeLocale, setTraiteeLocale] = useState<string | null>(null);

  const gardeRef = useRef(false);
  const annuaireRef = useRef(annuaire);
  annuaireRef.current = annuaire;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Relecture a la premiere apparition (et sur « Reessayer »).
  useEffect(() => {
    const controleur = new AbortController();
    setLecture('chargement');
    lireAction(actionRecue.id, controleur.signal)
      .then(relue => {
        setAction(relue);
        setLecture('ok');
        if (JSON.stringify(relue) !== JSON.stringify(actionRecue)) onChangeRef.current?.(relue);
      })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setLecture('erreur');
      });
    return () => controleur.abort();
    // Seul l'identifiant relance la relecture : l'objet recu peut changer de reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRecue.id, relance]);

  // Noms des personnes concernees (jamais leurs identifiants).
  const ids = identifiantsDe(action);
  const idsCle = ids.join(',');
  useEffect(() => {
    if (lecture !== 'ok') return;
    const manquants = idsCle.split(',').filter(id => id && !annuaireRef.current[id]);
    if (manquants.length === 0) {
      setEtatNoms('ok');
      return;
    }
    setEtatNoms('chargement');
    const controleur = new AbortController();
    resoudreComptes(manquants, controleur.signal)
      .then(comptes => {
        setAnnuaire(prec => ({ ...prec, ...Object.fromEntries(comptes.map(c => [c.id, c])) }));
        setEtatNoms('ok');
      })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setEtatNoms('erreur');
      });
    return () => controleur.abort();
  }, [idsCle, lecture]);

  const comptesInitiaux = useMemo(
    () => ids.map(id => annuaire[id]).filter((c): c is CompteJson => Boolean(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsCle, annuaire]
  );
  const comptesAffiches = choix ?? comptesInitiaux;
  const idsEffectifs = choix ? choix.map(c => c.id) : ids;
  const echeanceInitiale = echeanceDe(action);
  const echeanceAffichee = echeance ?? echeanceInitiale;

  const noms = useMemo(() => {
    const liste = comptesInitiaux.map(c => c.nom);
    if (liste.length === 0) return '';
    return new Intl.ListFormat(toIntlTag(locale), { style: 'long', type: 'conjunction' }).format(
      liste
    );
  }, [comptesInitiaux, locale]);

  const appliquer = useCallback((misAJour: ActionProposee) => {
    setAction(misAJour);
    setChoix(null);
    setEcheance(null);
    onChangeRef.current?.(misAJour);
  }, []);

  async function confirmer() {
    if (gardeRef.current || action.statut !== 'proposee') return;
    gardeRef.current = true;
    setEnCours('confirmer');
    try {
      // Uniquement ce que la personne a modifie.
      const parametres: ParametresConfirmation = {};
      if (choix) {
        if (action.type === 'creer_tache') parametres.assigneA = choix[0]?.id;
        else parametres.destinataires = choix.map(c => c.id);
      }
      if (action.type === 'creer_tache' && echeance !== null && echeance !== echeanceInitiale) {
        parametres.echeance = echeance;
      }
      const confirmee = await confirmerAction(action.id, parametres);
      setTraiteeLocale(new Date().toISOString());
      appliquer(confirmee);
    } catch (e) {
      afficherErreur(e);
    } finally {
      gardeRef.current = false;
      setEnCours(null);
    }
  }

  async function annuler() {
    if (gardeRef.current || action.statut !== 'proposee') return;
    gardeRef.current = true;
    setEnCours('annuler');
    try {
      const annulee = await annulerAction(action.id);
      setTraiteeLocale(new Date().toISOString());
      appliquer(annulee);
    } catch (e) {
      afficherErreur(e);
    } finally {
      gardeRef.current = false;
      setEnCours(null);
    }
  }

  const Icone = ICONES[action.type] ?? ListChecks;
  const modifiable = lecture === 'ok' && action.statut === 'proposee';
  const occupe = enCours !== null;
  const manqueDestinataire = idsEffectifs.length === 0;
  const varianteStatut = {
    proposee: 'info',
    executee: 'success',
    annulee: 'secondary',
    echec: 'danger',
  } as const;

  const dateTraitement = (() => {
    const brute = action.traiteeA ?? traiteeLocale;
    if (!brute) return null;
    const d = new Date(brute);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(toIntlTag(locale), {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(d);
  })();

  const resultat = action.resultat;
  const codeRaison: RaisonCarte | null = (() => {
    const code = resultat?.erreur;
    if (typeof code !== 'string' || !code) return null;
    return (RAISONS_CONNUES as readonly string[]).includes(code)
      ? (code as RaisonCarte)
      : 'interne';
  })();

  return (
    <section
      aria-labelledby={idTitre}
      aria-busy={lecture === 'chargement' || occupe}
      className="w-full max-w-xl space-y-3 rounded-lg border bg-card p-4 text-sm shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 id={idTitre} className="min-w-0 flex-1 text-base font-semibold">
          {t(`carteAction.titre.${action.type}`)}
        </h3>
        {lecture === 'ok' && (
          <Badge variant={varianteStatut[action.statut]}>
            {t(`carteAction.statut.${action.statut}`)}
          </Badge>
        )}
      </header>

      {/* Zone annoncee aux lecteurs d'ecran a chaque changement d'etat. */}
      <div role="status" aria-live="polite" className="space-y-3">
        {lecture === 'chargement' && (
          <p className="text-muted-foreground">{t('carteAction.chargement')}</p>
        )}

        {lecture === 'erreur' && (
          <div className="space-y-2">
            <p className="text-destructive">{t('carteAction.erreurLecture')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRelance(n => n + 1)}
            >
              {t('carteAction.reessayer')}
            </Button>
          </div>
        )}

        {lecture === 'ok' && action.statut === 'executee' && (
          <p className="flex items-start gap-2 font-medium text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {resultat?.message
                ? resultat.message
                : noms
                  ? t(`carteAction.executee.${action.type}`, { noms })
                  : t(`carteAction.executeeSimple.${action.type}`)}
            </span>
          </p>
        )}

        {lecture === 'ok' && action.statut === 'executee' && (
          <p className="ps-6 text-xs text-muted-foreground">
            {dateTraitement
              ? t('carteAction.confirmeeLe', { date: dateTraitement })
              : t('carteAction.confirmee')}
          </p>
        )}

        {lecture === 'ok' && action.statut === 'executee' && resultat?.lien && (
          <Link
            prefetch={false}
            href={resultat.lien.href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-0"
          >
            {resultat.lien.libelle}
          </Link>
        )}

        {lecture === 'ok' && action.statut === 'annulee' && (
          <p className="flex items-start gap-2 text-muted-foreground">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex flex-col">
              <span>{t('carteAction.annulee')}</span>
              {dateTraitement && (
                <span className="text-xs">{t('carteAction.annuleeLe', { date: dateTraitement })}</span>
              )}
            </span>
          </p>
        )}

        {lecture === 'ok' && action.statut === 'echec' && (
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">{t('carteAction.echec')}</p>
              {resultat?.message ? (
                <p>{resultat.message}</p>
              ) : (
                codeRaison && (
                  <p>{t('carteAction.echecRaison', { raison: t(`erreurs.${codeRaison}`) })}</p>
                )
              )}
            </div>
          </div>
        )}

        {enCours && <p className="text-muted-foreground">{t('carteAction.enCours')}</p>}
      </div>

      {lecture === 'ok' && action.resume && <p className="break-words">{action.resume}</p>}

      {modifiable && (
        <div className="space-y-3">
          {etatNoms === 'chargement' ? (
            <p className="text-muted-foreground">{t('carteAction.chargement')}</p>
          ) : (
            <SelecteurUtilisateurs
              label={t(
                action.type === 'creer_tache' ? 'carteAction.assigne' : 'carteAction.destinataires'
              )}
              valeur={comptesAffiches}
              unique={action.type === 'creer_tache'}
              moi={moi}
              disabled={occupe}
              onChange={comptes => {
                setChoix(comptes);
                setAnnuaire(prec => ({
                  ...prec,
                  ...Object.fromEntries(comptes.map(c => [c.id, c])),
                }));
              }}
            />
          )}
          {etatNoms === 'erreur' && (
            <p className="text-xs text-muted-foreground">{t('carteAction.nomsIndisponibles')}</p>
          )}

          {action.type === 'creer_tache' && (
            <div className="space-y-2">
              <Label htmlFor={`${idTitre}-echeance`}>{t('carteAction.echeance')}</Label>
              <ChampDate
                id={`${idTitre}-echeance`}
                value={echeanceAffichee}
                disabled={occupe}
                // Un champ vidé ne supprime pas l'échéance : on garde la valeur d'origine.
                onValueChange={v => {
                  if (v !== undefined) setEcheance(v);
                }}
              />
            </div>
          )}

          {manqueDestinataire && etatNoms !== 'chargement' && (
            <p className="text-xs font-medium text-destructive">
              {t(
                action.type === 'creer_tache'
                  ? 'carteAction.assigneRequis'
                  : 'carteAction.destinatairesRequis'
              )}
            </p>
          )}

          <p className="text-xs text-muted-foreground">{t('carteAction.nonExecute')}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={annuler}
              disabled={occupe}
              loading={enCours === 'annuler'}
            >
              {t('carteAction.annuler')}
            </Button>
            <Button
              type="button"
              onClick={confirmer}
              disabled={occupe || manqueDestinataire || etatNoms === 'chargement'}
              loading={enCours === 'confirmer'}
            >
              {t('carteAction.confirmer')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
