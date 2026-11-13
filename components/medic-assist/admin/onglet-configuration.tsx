'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toIntlTag } from '@/i18n/config';
import { cn } from '@/lib/utils';
import {
  CODES_ERREUR_TEST,
  TAUX_EUR_PAR_USD_DEFAUT,
  type ConfigAdminReponse,
  type CorpsTestAdmin,
  type ResultatTestAdmin,
} from '@/lib/medic-assist/admin/types';

import { appelerJson, estAnnulation, useMessageErreur } from './api';
import {
  brouillonDepuis,
  calculerMiseAJour,
  changerFournisseur,
  changerTranscription,
  estModifie,
  lireTaux,
  modelesEnErreur,
  problemeModele,
  tarifDuModele,
  texteTaux,
  transcriptionEnErreur,
  type Brouillon,
} from './config-brouillon';
import { SUGGESTION_MODELE_TRANSCRIPTION, URL_CONFIG, URL_TESTER } from './constantes';
import { creerFormats } from './format';
import {
  FOURNISSEURS,
  FOURNISSEURS_TRANSCRIPTION,
  MODES_LANGAGE,
  VARIABLES_CLES_FOURNISSEURS,
} from './dependances';
import type { Fournisseur, FournisseurTranscription, ModeLangage } from './dependances';

type EtatTest =
  | { etat: 'enCours' }
  | { etat: 'ok'; modele: string; latenceMs: number }
  | { etat: 'ko'; message: string };

interface OptionChoix {
  valeur: string;
  libelle: string;
  description?: string;
  desactive?: boolean;
}

/** Groupe de choix exclusifs : boutons radio natifs, un element grise reste lisible. */
function ChoixExclusif({
  nom,
  legende,
  aide,
  options,
  valeur,
  onChange,
}: {
  nom: string;
  legende: string;
  aide?: string;
  options: OptionChoix[];
  valeur: string;
  onChange: (valeur: string) => void;
}) {
  const idBase = useId();
  const idAide = `${idBase}-aide`;

  return (
    <fieldset className="space-y-2" aria-describedby={aide ? idAide : undefined}>
      <legend className="text-sm font-semibold">{legende}</legend>
      {aide ? (
        <p id={idAide} className="text-sm text-muted-foreground">
          {aide}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => {
          const id = `${idBase}-${option.valeur}`;
          const coche = valeur === option.valeur;
          return (
            <div
              key={option.valeur}
              className={cn(
                'flex items-start gap-3 rounded-md border p-3',
                coche ? 'border-primary bg-accent/40' : 'border-border bg-card',
                option.desactive && 'bg-muted/50'
              )}
            >
              <input
                id={id}
                type="radio"
                name={`${idBase}-${nom}`}
                value={option.valeur}
                checked={coche}
                disabled={option.desactive}
                aria-describedby={option.description ? `${id}-desc` : undefined}
                onChange={() => onChange(option.valeur)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
              />
              <div className="min-w-0">
                <label
                  htmlFor={id}
                  className={cn(
                    'text-sm font-medium',
                    option.desactive ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'
                  )}
                >
                  {option.libelle}
                </label>
                {option.description ? (
                  <p id={`${id}-desc`} className="mt-0.5 break-words text-xs text-muted-foreground">
                    {option.description}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

const CHOIX_NAVIGATEUR = 'navigateur';

export function OngletConfiguration() {
  const t = useTranslations('medicAssistAdmin');
  const locale = useLocale();
  const intlTag = toIntlTag(locale);
  const formats = useMemo(() => creerFormats(intlTag), [intlTag]);
  const messageErreur = useMessageErreur();

  const [serveur, setServeur] = useState<ConfigAdminReponse | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [tests, setTests] = useState<Partial<Record<ModeLangage, EtatTest>>>({});
  const [essai, setEssai] = useState(0);

  const idTaux = useId();
  const idTranscription = useId();

  useEffect(() => {
    const controle = new AbortController();
    setChargement(true);
    setErreurChargement(null);
    appelerJson<ConfigAdminReponse>(URL_CONFIG, { signal: controle.signal })
      .then(config => {
        setServeur(config);
        setBrouillon(brouillonDepuis(config, intlTag));
      })
      .catch(erreur => {
        if (estAnnulation(erreur)) return;
        const message = messageErreur(erreur);
        setErreurChargement(message);
        toast.error(t('configuration.erreurChargement'), { description: message });
      })
      .finally(() => {
        if (!controle.signal.aborted) setChargement(false);
      });
    return () => controle.abort();
    // Le rechargement ne depend que du bouton Reessayer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [essai]);

  const modifie = useMemo(
    () => (serveur && brouillon ? estModifie(serveur, brouillon, intlTag) : false),
    [serveur, brouillon, intlTag]
  );

  // Une fermeture d'onglet avec des modifications non enregistrees demande confirmation.
  useEffect(() => {
    if (!modifie) return;
    const avertir = (evenement: BeforeUnloadEvent) => {
      evenement.preventDefault();
      evenement.returnValue = '';
    };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [modifie]);

  const modifierBrouillon = useCallback((partiel: Partial<Brouillon>) => {
    setBrouillon(courant => (courant ? { ...courant, ...partiel } : courant));
  }, []);

  const tester = useCallback(
    async (mode: ModeLangage) => {
      if (!brouillon) return;
      const corps: CorpsTestAdmin = {
        mode,
        fournisseur: brouillon.fournisseur,
        modele: brouillon.modeles[mode].trim(),
      };
      setTests(courant => ({ ...courant, [mode]: { etat: 'enCours' } }));
      try {
        const resultat = await appelerJson<ResultatTestAdmin>(URL_TESTER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corps),
        });
        const code = resultat.erreurCode;
        const message =
          code && (CODES_ERREUR_TEST as readonly string[]).includes(code)
            ? t(`configuration.test.erreurs.${code}`)
            : t('configuration.test.echecGenerique');
        setTests(courant => ({
          ...courant,
          [mode]: resultat.ok
            ? { etat: 'ok', modele: resultat.modele, latenceMs: resultat.latenceMs }
            : { etat: 'ko', message },
        }));
      } catch (erreur) {
        setTests(courant => ({
          ...courant,
          [mode]: { etat: 'ko', message: messageErreur(erreur) },
        }));
      }
    },
    [brouillon, messageErreur, t]
  );

  const enregistrer = useCallback(async () => {
    if (!serveur || !brouillon) return;
    const corps = calculerMiseAJour(serveur, brouillon);
    if (!corps) return;
    setEnregistrement(true);
    try {
      const maj = await appelerJson<ConfigAdminReponse>(URL_CONFIG, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      });
      setServeur(maj);
      setBrouillon(brouillonDepuis(maj, intlTag));
      setTests({});
      toast.success(t('configuration.actions.succes'));
    } catch (erreur) {
      toast.error(t('configuration.actions.erreur'), { description: messageErreur(erreur) });
    } finally {
      setEnregistrement(false);
    }
  }, [serveur, brouillon, intlTag, messageErreur, t]);

  if (chargement) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-4"
        data-testid="configuration-chargement"
      >
        <span className="sr-only">{t('configuration.chargement')}</span>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (erreurChargement || !serveur || !brouillon) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3">
          <p>{t('configuration.erreurChargement')}</p>
          {erreurChargement ? <p className="text-sm">{erreurChargement}</p> : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setEssai(n => n + 1)}>
            <RotateCcw aria-hidden="true" />
            {t('commun.reessayer')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const fournisseurDisponible = (id: Fournisseur) => serveur.fournisseursDisponibles.includes(id);
  const defautsDuFournisseur = serveur.modelesParDefaut[brouillon.fournisseur];

  const optionsFournisseurs: OptionChoix[] = FOURNISSEURS.map(id => {
    const disponible = fournisseurDisponible(id);
    return {
      valeur: id,
      libelle: t(`fournisseurs.${id}`),
      desactive: !disponible,
      description: disponible
        ? t('configuration.fournisseur.disponible')
        : t('configuration.fournisseur.indisponible', {
            variable: VARIABLES_CLES_FOURNISSEURS[id],
          }),
    };
  });

  const optionsTranscription: OptionChoix[] = [
    {
      valeur: CHOIX_NAVIGATEUR,
      libelle: t('configuration.transcription.navigateur'),
      description: t('configuration.transcription.navigateurDescription'),
    },
    ...FOURNISSEURS_TRANSCRIPTION.map(id => {
      const disponible = serveur.fournisseursTranscriptionDisponibles.includes(id);
      return {
        valeur: id,
        libelle: t(`fournisseurs.${id}`),
        desactive: !disponible,
        description: disponible
          ? t('configuration.fournisseur.disponible')
          : t('configuration.fournisseur.indisponible', {
              variable: VARIABLES_CLES_FOURNISSEURS[id],
            }),
      };
    }),
  ];

  const tauxSaisi = lireTaux(brouillon.taux);
  const tauxInvalide = tauxSaisi === null;
  const enErreur = modelesEnErreur(brouillon);
  const erreurTranscription = transcriptionEnErreur(brouillon);
  const peutEnregistrer =
    modifie &&
    !tauxInvalide &&
    enErreur.length === 0 &&
    erreurTranscription === null &&
    !enregistrement;
  const idDescTaux = `${idTaux}-desc`;
  const idErreurTaux = `${idTaux}-erreur`;
  const choixTranscription = brouillon.transcription?.fournisseur ?? CHOIX_NAVIGATEUR;
  const suggestionTranscription = brouillon.transcription
    ? SUGGESTION_MODELE_TRANSCRIPTION[brouillon.transcription.fournisseur]
    : null;
  const tarifTexte = (modele: string) => {
    const tarif = tarifDuModele(serveur.tarifs, brouillon.fournisseur, modele);
    return tarif
      ? t('configuration.modeles.tarif', {
          entree: formats.usd(tarif.entreeUsdParMillion),
          sortie: formats.usd(tarif.sortieUsdParMillion),
        })
      : t('configuration.modeles.tarifInconnu');
  };

  return (
    <div className="space-y-6">
      {!fournisseurDisponible(serveur.fournisseur) ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            {t('configuration.fournisseur.courantIndisponible', {
              variable: VARIABLES_CLES_FOURNISSEURS[serveur.fournisseur],
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground" data-testid="configuration-maj">
        {serveur.majA && serveur.majPar
          ? t('configuration.maj.par', {
              nom: serveur.majPar.nom,
              date: formats.dateHeure(serveur.majA),
            })
          : serveur.majA
            ? t('configuration.maj.le', { date: formats.dateHeure(serveur.majA) })
            : t('configuration.maj.jamais')}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t('configuration.fournisseur.titre')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChoixExclusif
            nom="fournisseur"
            legende={t('configuration.fournisseur.titre')}
            aide={t('configuration.fournisseur.aide')}
            options={optionsFournisseurs}
            valeur={brouillon.fournisseur}
            onChange={valeur =>
              setBrouillon(courant =>
                courant ? changerFournisseur(courant, serveur, valeur as Fournisseur) : courant
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('configuration.modeles.titre')}</CardTitle>
          <CardDescription>{t('configuration.modeles.aide')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {MODES_LANGAGE.map(mode => {
            const idChamp = `${idTaux}-modele-${mode}`;
            const defaut = defautsDuFournisseur?.[mode] ?? null;
            const libelleMode = t(`modes.${mode}`);
            const test = tests[mode];
            const probleme = problemeModele(brouillon.modeles[mode]);
            return (
              <div key={mode} className="space-y-2">
                <Label htmlFor={idChamp}>
                  {t('configuration.modeles.libelle', { mode: libelleMode })}
                </Label>
                <p id={`${idChamp}-aide`} className="text-xs text-muted-foreground">
                  {t(`configuration.modeles.aideMode.${mode}`)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <Input
                      id={idChamp}
                      value={brouillon.modeles[mode]}
                      placeholder={defaut ?? ''}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      aria-invalid={probleme !== null}
                      aria-describedby={`${idChamp}-aide ${idChamp}-defaut ${idChamp}-tarif${
                        probleme ? ` ${idChamp}-probleme` : ''
                      }`}
                      onChange={e =>
                        modifierBrouillon({
                          modeles: { ...brouillon.modeles, [mode]: e.target.value },
                        })
                      }
                    />
                    <p id={`${idChamp}-defaut`} className="mt-1 text-xs text-muted-foreground">
                      {defaut !== null
                        ? t('configuration.modeles.defaut', { modele: defaut })
                        : t('configuration.modeles.defautAChoisir')}
                    </p>
                    <p
                      id={`${idChamp}-tarif`}
                      data-testid={`tarif-${mode}`}
                      className="mt-0.5 text-xs text-muted-foreground"
                    >
                      {probleme ? null : tarifTexte(brouillon.modeles[mode])}
                    </p>
                    {probleme ? (
                      <p
                        id={`${idChamp}-probleme`}
                        className="mt-1 text-xs font-medium text-destructive"
                      >
                        {probleme === 'vide'
                          ? t('configuration.modeles.vide')
                          : t('configuration.modeles.invalide')}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={defaut === null || brouillon.modeles[mode] === defaut}
                      aria-label={t('configuration.modeles.utiliserDefautPour', {
                        mode: libelleMode,
                      })}
                      onClick={() =>
                        defaut !== null &&
                        modifierBrouillon({ modeles: { ...brouillon.modeles, [mode]: defaut } })
                      }
                    >
                      {t('configuration.modeles.utiliserDefaut')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={probleme !== null || test?.etat === 'enCours'}
                      aria-label={t('configuration.test.boutonPour', { mode: libelleMode })}
                      onClick={() => void tester(mode)}
                    >
                      {test?.etat === 'enCours' ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : null}
                      {t('configuration.test.bouton')}
                    </Button>
                  </div>
                </div>
                <div role="status" aria-live="polite" className="min-h-5 text-sm">
                  {test?.etat === 'enCours' ? (
                    <span className="text-muted-foreground">{t('configuration.test.enCours')}</span>
                  ) : null}
                  {test?.etat === 'ok' ? (
                    <span className="inline-flex items-start gap-1.5 text-success">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span data-figure>
                        {t('configuration.test.succes', {
                          modele: test.modele,
                          latence: test.latenceMs,
                        })}
                      </span>
                    </span>
                  ) : null}
                  {test?.etat === 'ko' ? (
                    <span className="inline-flex items-start gap-1.5 text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t('configuration.test.echec', { erreur: test.message })}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('configuration.transcription.titre')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChoixExclusif
            nom="transcription"
            legende={t('configuration.transcription.libelle')}
            aide={t('configuration.transcription.aide')}
            options={optionsTranscription}
            valeur={choixTranscription}
            onChange={valeur =>
              setBrouillon(courant =>
                courant
                  ? changerTranscription(
                      courant,
                      serveur,
                      valeur === CHOIX_NAVIGATEUR ? null : (valeur as FournisseurTranscription)
                    )
                  : courant
              )
            }
          />
          {brouillon.transcription ? (
            <div className="max-w-md space-y-1.5">
              <Label htmlFor={idTranscription}>{t('configuration.transcription.modele')}</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <Input
                  id={idTranscription}
                  value={brouillon.transcription.modele}
                  placeholder={suggestionTranscription ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  aria-invalid={erreurTranscription !== null}
                  aria-describedby={`${idTranscription}-aide`}
                  onChange={e =>
                    brouillon.transcription &&
                    modifierBrouillon({
                      transcription: { ...brouillon.transcription, modele: e.target.value },
                    })
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={
                    suggestionTranscription === null ||
                    brouillon.transcription.modele === suggestionTranscription
                  }
                  onClick={() =>
                    brouillon.transcription &&
                    suggestionTranscription !== null &&
                    modifierBrouillon({
                      transcription: {
                        ...brouillon.transcription,
                        modele: suggestionTranscription,
                      },
                    })
                  }
                >
                  {t('configuration.transcription.utiliserSuggestion')}
                </Button>
              </div>
              <p id={`${idTranscription}-aide`} className="text-xs text-muted-foreground">
                {t('configuration.transcription.suggestion', {
                  modele: suggestionTranscription ?? '',
                })}
              </p>
              {erreurTranscription ? (
                <p className="text-xs font-medium text-destructive">
                  {erreurTranscription === 'vide'
                    ? t('configuration.modeles.vide')
                    : t('configuration.modeles.invalide')}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('configuration.taux.titre')}</CardTitle>
        </CardHeader>
        <CardContent className="max-w-sm space-y-2">
          <Label htmlFor={idTaux}>{t('configuration.taux.libelle')}</Label>
          <Input
            id={idTaux}
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            data-figure
            value={brouillon.taux}
            aria-invalid={tauxInvalide}
            aria-describedby={`${idDescTaux}${tauxInvalide ? ` ${idErreurTaux}` : ''}`}
            onChange={e => modifierBrouillon({ taux: e.target.value })}
          />
          <p id={idDescTaux} className="text-xs text-muted-foreground">
            {t('configuration.taux.aide', { defaut: texteTaux(TAUX_EUR_PAR_USD_DEFAUT, intlTag) })}{' '}
            {serveur.tauxSource === 'config'
              ? t('configuration.taux.sourceConfig')
              : t('configuration.taux.sourceDefaut')}
          </p>
          {tauxInvalide ? (
            <p id={idErreurTaux} className="text-xs font-medium text-destructive">
              {t('configuration.taux.invalide')}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
        <p
          role="status"
          aria-live="polite"
          className={cn(
            'text-sm',
            modifie ? 'font-medium text-foreground' : 'text-muted-foreground'
          )}
        >
          {modifie ? t('configuration.actions.nonEnregistre') : t('configuration.actions.aJour')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!modifie || enregistrement}
            onClick={() => setBrouillon(brouillonDepuis(serveur, intlTag))}
          >
            {t('configuration.actions.annuler')}
          </Button>
          <Button type="button" disabled={!peutEnregistrer} onClick={() => void enregistrer()}>
            {enregistrement ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {enregistrement
              ? t('configuration.actions.enregistrement')
              : t('configuration.actions.enregistrer')}
          </Button>
        </div>
      </div>
    </div>
  );
}
