'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, BarChart3, Download, Loader2, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChampDate } from '@/components/ui/champ-date';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toIntlTag } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { USAGES_FENETRE_MAX_JOURS, type UsagesReponse } from '@/lib/medic-assist/admin/types';

import { appelerJson, enregistrerBlob, estAnnulation, telecharger, useMessageErreur } from './api';
import { URL_USAGES } from './constantes';
import { creerFormats } from './format';
import { FOURNISSEURS, MODES } from './dependances';
import type { AgregatUsage, Fournisseur, Mode } from './dependances';
import {
  aujourdhuiParis,
  completerPeriodes,
  derniersJours,
  memePeriode,
  moisCourant,
  periodeTropLongue,
  periodeValide,
  type Groupement,
  type Periode,
} from './periode';
import { TableauTrie, type ColonneTableau } from './tableau-trie';
import type { MetriqueUsage, PointGraphique, SerieGraphique } from './graphique-usages';

const GraphiqueUsages = dynamic(() => import('./graphique-usages'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const METRIQUES: MetriqueUsage[] = ['coutEur', 'requetes', 'jetons'];
const GROUPEMENTS: Groupement[] = ['jour', 'mois'];

interface Filtres {
  groupement: Groupement;
  fournisseur: Fournisseur | '';
  mode: Mode | '';
}

function adresseUsages(periode: Periode, filtres: Filtres, format?: 'xlsx'): string {
  const params = new URLSearchParams({
    du: periode.debut,
    au: periode.fin,
    groupement: filtres.groupement,
  });
  if (filtres.fournisseur) params.set('fournisseur', filtres.fournisseur);
  if (filtres.mode) params.set('mode', filtres.mode);
  if (format) params.set('format', format);
  return `${URL_USAGES}?${params.toString()}`;
}

const CLASSE_SELECTEUR =
  'h-9 w-full max-md:min-h-11 sm:w-auto rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

type LigneUtilisateur = UsagesReponse['parUtilisateur'][number];
type LigneModele = UsagesReponse['parModele'][number];
type LigneMode = UsagesReponse['parMode'][number];
type CleMesure =
  | 'requetes'
  | 'tokensEntree'
  | 'tokensSortie'
  | 'tokensCacheLecture'
  | 'tokensCacheEcriture'
  | 'coutEur'
  | 'coutUsd';

export function OngletUsages() {
  const t = useTranslations('medicAssistAdmin');
  const locale = useLocale();
  const intlTag = toIntlTag(locale);
  const formats = useMemo(() => creerFormats(intlTag), [intlTag]);
  const messageErreur = useMessageErreur();

  const aujourdhui = useMemo(() => aujourdhuiParis(), []);
  const [periode, setPeriode] = useState<Periode>(() => derniersJours(30, aujourdhui));
  const [filtres, setFiltres] = useState<Filtres>({
    groupement: 'jour',
    fournisseur: '',
    mode: '',
  });
  const [donnees, setDonnees] = useState<UsagesReponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [essai, setEssai] = useState(0);
  const [metrique, setMetrique] = useState<MetriqueUsage>('coutEur');
  const [tableauOuvert, setTableauOuvert] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);

  const idDebut = useId();
  const idFin = useId();
  const idOrdre = useId();
  const idFournisseur = useId();
  const idMode = useId();

  const ordreValide = periodeValide(periode);
  const tropLongue = periodeTropLongue(periode, USAGES_FENETRE_MAX_JOURS);
  const valide = ordreValide && !tropLongue;

  useEffect(() => {
    if (!valide) return;
    const controle = new AbortController();
    setChargement(true);
    setErreur(null);
    appelerJson<UsagesReponse>(adresseUsages(periode, filtres), { signal: controle.signal })
      .then(dto => setDonnees(dto))
      .catch(e => {
        if (estAnnulation(e)) return;
        const message = messageErreur(e);
        setDonnees(null);
        setErreur(message);
        toast.error(t('usages.erreurChargement'), { description: message });
      })
      .finally(() => {
        if (!controle.signal.aborted) setChargement(false);
      });
    return () => controle.abort();
    // La periode, les filtres et le bouton Reessayer declenchent le rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    periode.debut,
    periode.fin,
    filtres.groupement,
    filtres.fournisseur,
    filtres.mode,
    valide,
    essai,
  ]);

  const exporter = useCallback(async () => {
    setExportEnCours(true);
    try {
      const { blob, nomFichier } = await telecharger(adresseUsages(periode, filtres, 'xlsx'));
      enregistrerBlob(
        blob,
        nomFichier ?? `medic-assist-usages-${periode.debut}-${periode.fin}.xlsx`
      );
    } catch (e) {
      toast.error(t('usages.export.erreur'), { description: messageErreur(e) });
    } finally {
      setExportEnCours(false);
    }
  }, [periode, filtres, messageErreur, t]);

  const raccourcis = useMemo(
    () => [
      { id: 'jours7', libelle: t('usages.periode.jours7'), valeur: derniersJours(7, aujourdhui) },
      {
        id: 'jours30',
        libelle: t('usages.periode.jours30'),
        valeur: derniersJours(30, aujourdhui),
      },
      {
        id: 'jours90',
        libelle: t('usages.periode.jours90'),
        valeur: derniersJours(90, aujourdhui),
      },
      {
        id: 'moisCourant',
        libelle: t('usages.periode.moisCourant'),
        valeur: moisCourant(aujourdhui),
      },
    ],
    [aujourdhui, t]
  );

  const taux = donnees?.tauxEurParUsd ?? 0;
  /** Le cout est calcule en USD par le serveur ; l'euro (devise de l'application) = USD x taux. */
  const enEur = useCallback((usd: number) => usd * taux, [taux]);

  const libelleFournisseur = useCallback(
    (id: string) =>
      (FOURNISSEURS as readonly string[]).includes(id)
        ? t(`fournisseurs.${id as Fournisseur}`)
        : id,
    [t]
  );

  const colonnesMesures = useMemo(() => {
    const c = (
      cle: CleMesure,
      valeur: (l: AgregatUsage) => number,
      rendu: (n: number) => string
    ) => ({
      id: cle,
      entete: t(`usages.tableaux.colonnes.${cle}`),
      numerique: true as const,
      valeur,
      rendu: (l: AgregatUsage) => rendu(valeur(l)),
    });
    return [
      c('requetes', l => l.requetes, formats.entier),
      c('tokensEntree', l => l.tokensEntree, formats.entier),
      c('tokensSortie', l => l.tokensSortie, formats.entier),
      c('tokensCacheLecture', l => l.tokensCacheLecture, formats.entier),
      c('tokensCacheEcriture', l => l.tokensCacheEcriture, formats.entier),
      c('coutEur', l => enEur(l.coutUsd), formats.eur),
      c('coutUsd', l => l.coutUsd, formats.usd),
    ];
  }, [formats, t, enEur]);

  const colonnesUtilisateur: ColonneTableau<LigneUtilisateur>[] = [
    {
      id: 'nom',
      entete: t('usages.tableaux.colonnes.utilisateur'),
      valeur: l => l.utilisateur.nom,
    },
    ...colonnesMesures,
  ];
  const colonnesModele: ColonneTableau<LigneModele>[] = [
    { id: 'modele', entete: t('usages.tableaux.colonnes.modele'), valeur: l => l.modele },
    {
      id: 'fournisseur',
      entete: t('usages.tableaux.colonnes.fournisseur'),
      valeur: l => libelleFournisseur(l.fournisseur),
    },
    ...colonnesMesures,
  ];
  const colonnesMode: ColonneTableau<LigneMode>[] = [
    {
      id: 'mode',
      entete: t('usages.tableaux.colonnes.mode'),
      valeur: l => t(`modes.${l.mode}`),
    },
    ...colonnesMesures,
  ];

  const pointsTableau = useMemo(
    () => (donnees ? completerPeriodes(donnees.parPeriode, periode, filtres.groupement) : []),
    [donnees, periode, filtres.groupement]
  );

  const points: PointGraphique[] = useMemo(
    () =>
      pointsTableau.map(ligne => ({
        periode: ligne.periode,
        coutEur: ligne.coutUsd * taux,
        requetes: ligne.requetes,
        tokensEntree: ligne.tokensEntree,
        tokensSortie: ligne.tokensSortie,
      })),
    [pointsTableau, taux]
  );

  const formatAxe = useMemo(
    () => new Intl.NumberFormat(intlTag, { notation: 'compact', maximumFractionDigits: 2 }),
    [intlTag]
  );

  const series: SerieGraphique[] = useMemo(() => {
    if (metrique === 'jetons') {
      return [
        {
          cle: 'tokensEntree',
          libelle: t('usages.totaux.tokensEntree'),
          couleur: 'hsl(var(--primary))',
        },
        {
          cle: 'tokensSortie',
          libelle: t('usages.totaux.tokensSortie'),
          couleur: 'hsl(var(--info))',
        },
      ];
    }
    return [
      {
        cle: metrique,
        libelle:
          metrique === 'coutEur' ? t('usages.evolution.coutEur') : t('usages.evolution.requetes'),
        couleur: 'hsl(var(--primary))',
      },
    ];
  }, [metrique, t]);

  const vide =
    donnees !== null &&
    donnees.totaux.requetes === 0 &&
    donnees.parUtilisateur.length === 0 &&
    donnees.parModele.length === 0 &&
    donnees.parMode.length === 0;

  const tuiles: { cle: string; libelle: string; valeur: string; principale?: boolean }[] = donnees
    ? [
        {
          cle: 'coutEur',
          libelle: t('usages.totaux.coutEur'),
          valeur: formats.eur(enEur(donnees.totaux.coutUsd)),
          principale: true,
        },
        {
          cle: 'requetes',
          libelle: t('usages.totaux.requetes'),
          valeur: formats.entier(donnees.totaux.requetes),
        },
        {
          cle: 'coutUsd',
          libelle: t('usages.totaux.coutUsd'),
          valeur: formats.usd(donnees.totaux.coutUsd),
        },
        {
          cle: 'tokensEntree',
          libelle: t('usages.totaux.tokensEntree'),
          valeur: formats.entier(donnees.totaux.tokensEntree),
        },
        {
          cle: 'tokensSortie',
          libelle: t('usages.totaux.tokensSortie'),
          valeur: formats.entier(donnees.totaux.tokensSortie),
        },
        {
          cle: 'tokensCacheLecture',
          libelle: t('usages.totaux.tokensCacheLecture'),
          valeur: formats.entier(donnees.totaux.tokensCacheLecture),
        },
        {
          cle: 'tokensCacheEcriture',
          libelle: t('usages.totaux.tokensCacheEcriture'),
          valeur: formats.entier(donnees.totaux.tokensCacheEcriture),
        },
      ]
    : [];

  const titreEvolution = t(`usages.evolution.titre.${filtres.groupement}`);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor={idDebut}>{t('usages.periode.debut')}</Label>
              <ChampDate
                id={idDebut}
                value={periode.debut}
                max={periode.fin}
                aria-describedby={valide ? undefined : idOrdre}
                aria-invalid={!valide}
                onValueChange={valeur => valeur && setPeriode(p => ({ ...p, debut: valeur }))}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={idFin}>{t('usages.periode.fin')}</Label>
              <ChampDate
                id={idFin}
                value={periode.fin}
                min={periode.debut}
                aria-describedby={valide ? undefined : idOrdre}
                aria-invalid={!valide}
                onValueChange={valeur => valeur && setPeriode(p => ({ ...p, fin: valeur }))}
                className="w-44"
              />
            </div>
            <div
              role="group"
              aria-label={t('usages.periode.raccourcis')}
              className="flex flex-wrap gap-2"
            >
              {raccourcis.map(raccourci => {
                const actif = memePeriode(periode, raccourci.valeur);
                return (
                  <Button
                    key={raccourci.id}
                    type="button"
                    size="sm"
                    className="cible-tactile"
                    variant={actif ? 'default' : 'outline'}
                    aria-pressed={actif}
                    onClick={() => setPeriode(raccourci.valeur)}
                  >
                    {raccourci.libelle}
                  </Button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cible-tactile ms-auto"
              disabled={!valide || exportEnCours || chargement}
              onClick={() => void exporter()}
            >
              {exportEnCours ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {exportEnCours ? t('usages.export.enCours') : t('usages.export.bouton')}
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="w-full space-y-1.5 sm:w-auto">
              <Label htmlFor={idFournisseur} className="block">{t('usages.filtres.fournisseur')}</Label>
              <select
                id={idFournisseur}
                className={CLASSE_SELECTEUR}
                value={filtres.fournisseur}
                onChange={e =>
                  setFiltres(f => ({ ...f, fournisseur: e.target.value as Filtres['fournisseur'] }))
                }
              >
                <option value="">{t('usages.filtres.tous')}</option>
                {FOURNISSEURS.map(f => (
                  <option key={f} value={f}>
                    {t(`fournisseurs.${f}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full space-y-1.5 sm:w-auto">
              <Label htmlFor={idMode} className="block">{t('usages.filtres.mode')}</Label>
              <select
                id={idMode}
                className={CLASSE_SELECTEUR}
                value={filtres.mode}
                onChange={e => setFiltres(f => ({ ...f, mode: e.target.value as Filtres['mode'] }))}
              >
                <option value="">{t('usages.filtres.tous')}</option>
                {MODES.map(m => (
                  <option key={m} value={m}>
                    {t(`modes.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div
              role="group"
              aria-label={t('usages.groupement.libelle')}
              className="flex flex-wrap gap-2"
            >
              {GROUPEMENTS.map(g => (
                <Button
                  key={g}
                  type="button"
                  size="sm"
                  className="cible-tactile"
                  variant={filtres.groupement === g ? 'default' : 'outline'}
                  aria-pressed={filtres.groupement === g}
                  onClick={() => setFiltres(f => ({ ...f, groupement: g }))}
                >
                  {t(`usages.groupement.${g}`)}
                </Button>
              ))}
            </div>
          </div>

          {!ordreValide ? (
            <p id={idOrdre} role="alert" className="text-sm font-medium text-destructive">
              {t('usages.periode.ordreInvalide')}
            </p>
          ) : null}
          {ordreValide && tropLongue ? (
            <p id={idOrdre} role="alert" className="text-sm font-medium text-destructive">
              {t('usages.periode.tropLongue', { jours: USAGES_FENETRE_MAX_JOURS })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {valide && chargement ? (
        <div role="status" aria-live="polite" className="space-y-4" data-testid="usages-chargement">
          <span className="sr-only">{t('usages.chargement')}</span>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {valide && !chargement && erreur ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>{t('usages.erreurChargement')}</p>
            <p className="text-sm">{erreur}</p>
            <Button type="button" variant="outline" size="sm" className="cible-tactile" onClick={() => setEssai(n => n + 1)}>
              <RotateCcw aria-hidden="true" />
              {t('commun.reessayer')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {valide && !chargement && !erreur && vide ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
          <BarChart3 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">{t('usages.vide.titre')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('usages.vide.description')}</p>
        </div>
      ) : null}

      {valide && !chargement && !erreur && donnees && !vide ? (
        <>
          <section aria-labelledby={`${idDebut}-totaux`} className="space-y-3">
            <h2 id={`${idDebut}-totaux`} className="sr-only">
              {t('usages.totaux.titre')}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tuiles.map(tuile => (
                <div
                  key={tuile.cle}
                  className={cn(
                    'rounded-lg border bg-card p-4 shadow-sm',
                    tuile.principale ? 'border-primary/40 bg-accent/30' : 'border-border'
                  )}
                >
                  <dt className="text-sm text-muted-foreground">{tuile.libelle}</dt>
                  <dd
                    data-figure
                    data-testid={`total-${tuile.cle}`}
                    className={cn(
                      'mt-1 break-words font-bold tabular-nums',
                      tuile.principale ? 'text-3xl' : 'text-2xl'
                    )}
                  >
                    {tuile.valeur}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground" data-testid="usages-taux">
              {donnees.tauxSource === 'config'
                ? t('usages.totaux.tauxConfig', { taux: formats.decimal(donnees.tauxEurParUsd) })
                : t('usages.totaux.tauxDefaut', { taux: formats.decimal(donnees.tauxEurParUsd) })}
            </p>
          </section>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle>{titreEvolution}</CardTitle>
              <div
                role="group"
                aria-label={t('usages.evolution.metrique')}
                className="flex flex-wrap gap-2"
              >
                {METRIQUES.map(m => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    className="cible-tactile"
                    variant={metrique === m ? 'default' : 'outline'}
                    aria-pressed={metrique === m}
                    onClick={() => setMetrique(m)}
                  >
                    {t(`usages.evolution.${m}`)}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <GraphiqueUsages
                donnees={points}
                series={series}
                empile={metrique === 'jetons'}
                etiquetteAria={t(`usages.evolution.graphique.${filtres.groupement}`, {
                  metrique: t(`usages.evolution.${metrique}`),
                  debut: formats.jour(donnees.du),
                  fin: formats.jour(donnees.au),
                })}
                formaterPeriode={formats.jourCourt}
                formaterPeriodeLongue={formats.jour}
                formaterValeur={(cle, valeur) =>
                  cle === 'coutEur' ? formats.eur(valeur) : formats.entier(valeur)
                }
                formaterAxe={valeur => formatAxe.format(valeur)}
              />
              <details
                onToggle={e => setTableauOuvert((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer rounded-sm text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t('usages.evolution.voirTableau')}
                </summary>
                <div className="mt-3">
                  {tableauOuvert ? (
                    <TableauTrie
                      libelle={titreEvolution}
                      lignes={pointsTableau}
                      cleLigne={l => l.periode}
                      triInitial={{ id: 'periode', desc: false }}
                      colonnes={[
                        {
                          id: 'periode',
                          entete: t('usages.tableaux.colonnes.periode'),
                          valeur: l => l.periode,
                          rendu: l => formats.jour(l.periode),
                        },
                        ...colonnesMesures,
                      ]}
                    />
                  ) : null}
                </div>
              </details>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('usages.tableaux.parUtilisateur')}
            </h2>
            <TableauTrie
              libelle={t('usages.tableaux.parUtilisateur')}
              colonnes={colonnesUtilisateur}
              lignes={donnees.parUtilisateur}
              cleLigne={l => l.utilisateur.id}
              triInitial={{ id: 'coutEur', desc: true }}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">
              {t('usages.tableaux.parModele')}
            </h2>
            <TableauTrie
              libelle={t('usages.tableaux.parModele')}
              colonnes={colonnesModele}
              lignes={donnees.parModele}
              cleLigne={l => `${l.fournisseur}/${l.modele}`}
              triInitial={{ id: 'coutEur', desc: true }}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">{t('usages.tableaux.parMode')}</h2>
            <TableauTrie
              libelle={t('usages.tableaux.parMode')}
              colonnes={colonnesMode}
              lignes={donnees.parMode}
              cleLigne={l => l.mode}
              triInitial={{ id: 'coutEur', desc: true }}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
