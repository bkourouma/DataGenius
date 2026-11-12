'use client';

/**
 * Dialogue de programmation d'un rapport recurrent (envoi par e-mail d'une
 * analyse recalculee). L'heure est celle de Paris, dite explicitement : la
 * tache planifiee du serveur passe tous les quarts d'heure.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { toIntlTag } from '@/i18n/config';
import { cn } from '@/lib/utils';
import {
  FORMATS_ENVOI,
  FREQUENCES_RAPPORT,
  type FormatEnvoi,
  type FrequenceRapport,
} from '@/lib/medic-assist/contrats';
import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import { programmerRapport, useAfficherErreur } from './api-client';
import { SelecteurUtilisateurs } from './selecteur-utilisateurs';
import { useMoi } from './use-moi';

export interface DialogueProgrammerProps {
  artefactId: string;
  titre: string;
  ouvert: boolean;
  onOuvertChange: (ouvert: boolean) => void;
}

export function DialogueProgrammer({
  artefactId,
  titre,
  ouvert,
  onOuvertChange,
}: DialogueProgrammerProps) {
  const t = useTranslations('medicAssistSuivi.dialogueProgrammer');
  const listeOuverte = useRef(false);

  return (
    <Dialog open={ouvert} onOpenChange={onOuvertChange}>
      <DialogContent
        onEscapeKeyDown={e => {
          if (listeOuverte.current) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('titre', { titre })}</DialogTitle>
          <DialogDescription>{t('explication')}</DialogDescription>
        </DialogHeader>
        <FormulaireProgrammer
          artefactId={artefactId}
          onFini={() => onOuvertChange(false)}
          onListeOuverteChange={o => {
            listeOuverte.current = o;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Heures 00-23 et quarts d'heure : la tache planifiee du serveur passe toutes les 15 minutes. */
const HEURES = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const CLASSES_SELECT = cn(
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background [@media(pointer:coarse)]:min-h-11',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-60'
);

function FormulaireProgrammer({
  artefactId,
  onFini,
  onListeOuverteChange,
}: {
  artefactId: string;
  onFini: () => void;
  onListeOuverteChange: (ouverte: boolean) => void;
}) {
  const t = useTranslations('medicAssistSuivi.dialogueProgrammer');
  const locale = useLocale();
  const { toast } = useToast();
  const afficherErreur = useAfficherErreur();

  const [frequence, setFrequence] = useState<FrequenceRapport>('quotidien');
  const [jourSemaine, setJourSemaine] = useState(1);
  const [jourMois, setJourMois] = useState(1);
  const [heures, setHeures] = useState('08');
  const [minutes, setMinutes] = useState('00');
  const heure = `${heures}:${minutes}`;
  const [destinataires, setDestinataires] = useState<CompteJson[]>([]);
  // « Moi » est coche par defaut des que le compte est charge, tant que la liste n'a pas ete touchee.
  const moi = useMoi();
  const listeTouchee = useRef(false);
  const [formats, setFormats] = useState<FormatEnvoi[]>(['xlsx']);
  const [erreurDestinataires, setErreurDestinataires] = useState<string>();
  const [erreurFormats, setErreurFormats] = useState<string>();
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (moi && !listeTouchee.current) {
      setDestinataires([moi]);
      setErreurDestinataires(undefined);
    }
  }, [moi]);

  // Lundi (1) a dimanche (7) : le 1er janvier 2024 etait un lundi.
  const nomsJours = useMemo(() => {
    const format = new Intl.DateTimeFormat(toIntlTag(locale), { weekday: 'long', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);

  function basculerFormat(format: FormatEnvoi, coche: boolean) {
    const suivants = coche
      ? FORMATS_ENVOI.filter(f => f === format || formats.includes(f))
      : formats.filter(f => f !== format);
    setFormats(suivants);
    if (suivants.length > 0) setErreurFormats(undefined);
  }

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (enCours) return;

    const erreurD = destinataires.length === 0 ? t('erreurDestinataires') : undefined;
    const erreurF = formats.length === 0 ? t('erreurFormats') : undefined;
    setErreurDestinataires(erreurD);
    setErreurFormats(erreurF);
    if (erreurD || erreurF) return;

    setEnCours(true);
    try {
      await programmerRapport({
        artefactId,
        frequence,
        ...(frequence === 'hebdomadaire' ? { jourSemaine } : {}),
        ...(frequence === 'mensuel' ? { jourMois } : {}),
        heure,
        destinataires: destinataires.map(c => c.id),
        formats,
      });
      toast({ description: t('succes') });
      onFini();
    } catch (err) {
      afficherErreur(err);
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={envoyer} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="programmer-frequence">{t('frequence')}</Label>
          <select
            id="programmer-frequence"
            className={CLASSES_SELECT}
            value={frequence}
            disabled={enCours}
            onChange={e => setFrequence(e.target.value as FrequenceRapport)}
          >
            {FREQUENCES_RAPPORT.map(f => (
              <option key={f} value={f}>
                {t(`frequences.${f}`)}
              </option>
            ))}
          </select>
        </div>

        {frequence === 'hebdomadaire' && (
          <div className="space-y-2">
            <Label htmlFor="programmer-jour-semaine">{t('jourSemaine')}</Label>
            <select
              id="programmer-jour-semaine"
              className={CLASSES_SELECT}
              value={jourSemaine}
              disabled={enCours}
              onChange={e => setJourSemaine(Number(e.target.value))}
            >
              {nomsJours.map((nom, i) => (
                <option key={i + 1} value={i + 1}>
                  {nom}
                </option>
              ))}
            </select>
          </div>
        )}

        {frequence === 'mensuel' && (
          <div className="space-y-2">
            <Label htmlFor="programmer-jour-mois">{t('jourMois')}</Label>
            <select
              id="programmer-jour-mois"
              className={CLASSES_SELECT}
              value={jourMois}
              disabled={enCours}
              aria-describedby="programmer-jour-mois-aide"
              onChange={e => setJourMois(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(j => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
            <p id="programmer-jour-mois-aide" className="text-xs text-muted-foreground">
              {t('jourMoisAide')}
            </p>
          </div>
        )}

        <fieldset className="space-y-2" aria-describedby="programmer-heure-aide">
          <legend className="text-sm font-medium">{t('heure')}</legend>
          <div className="flex items-center gap-2">
            <select
              id="programmer-heure-heures"
              aria-label={t('heureHeures')}
              className={CLASSES_SELECT}
              value={heures}
              disabled={enCours}
              onChange={e => setHeures(e.target.value)}
            >
              {HEURES.map(h => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span aria-hidden="true">:</span>
            <select
              id="programmer-heure-minutes"
              aria-label={t('heureMinutes')}
              className={CLASSES_SELECT}
              value={minutes}
              disabled={enCours}
              onChange={e => setMinutes(e.target.value)}
            >
              {MINUTES.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <p id="programmer-heure-aide" className="text-xs text-muted-foreground">
            {t('heureAide')}
          </p>
        </fieldset>

        <SelecteurUtilisateurs
          label={t('destinataires')}
          valeur={destinataires}
          moi={moi}
          onChange={c => {
            listeTouchee.current = true;
            setDestinataires(c);
            if (c.length > 0) setErreurDestinataires(undefined);
          }}
          disabled={enCours}
          erreur={erreurDestinataires}
          onListeOuverteChange={onListeOuverteChange}
        />

        <fieldset
          className="space-y-2"
          aria-describedby={erreurFormats ? 'programmer-formats-erreur' : undefined}
        >
          <legend className="text-sm font-medium">{t('formats')}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {FORMATS_ENVOI.map(format => (
              <div key={format} className="cible-tactile flex items-center gap-2">
                <Checkbox
                  id={`programmer-format-${format}`}
                  checked={formats.includes(format)}
                  disabled={enCours}
                  onCheckedChange={c => basculerFormat(format, c === true)}
                />
                <Label htmlFor={`programmer-format-${format}`} className="font-normal">
                  {t(`format.${format}`)}
                </Label>
              </div>
            ))}
          </div>
          {erreurFormats && (
            <p id="programmer-formats-erreur" className="text-xs font-medium text-destructive">
              {erreurFormats}
            </p>
          )}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onFini} disabled={enCours}>
          {t('annuler')}
        </Button>
        <Button type="submit" loading={enCours}>
          {enCours ? t('enCours') : t('programmer')}
        </Button>
      </DialogFooter>
    </form>
  );
}
