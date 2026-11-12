'use client';

/**
 * Selecteur de personnes (comptes ayant acces a Medic Assist).
 *
 * Champ de recherche en combobox (ARIA 1.2) : fleches pour parcourir, Entree
 * pour choisir, Echap pour refermer la liste. Les personnes choisies sont des
 * puces portant leur NOM (jamais leur identifiant) avec un bouton de retrait.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CompteJson } from '@/lib/medic-assist/suivi/types';
import { rechercherComptes } from './api-client';

/** Nombre maximal de personnes (LIMITES.destinatairesMax). */
export const PLAFOND_SELECTION = 20;
const DELAI_ANTI_REBOND_MS = 250;

type EtatRecherche = 'repos' | 'chargement' | 'ok' | 'erreur';

export interface SelecteurUtilisateursProps {
  valeur: CompteJson[];
  onChange: (comptes: CompteJson[]) => void;
  /** Une seule personne : choisir remplace, et le champ disparait tant qu'elle est choisie. */
  unique?: boolean;
  label: string;
  disabled?: boolean;
  /** Signale l'ouverture de la liste (le dialogue parent ne se ferme alors pas sur Echap). */
  onListeOuverteChange?: (ouverte: boolean) => void;
  /** Message d'erreur de validation, affiche pres du champ. */
  erreur?: string;
  id?: string;
  /**
   * Compte de la personne connectee. Fourni : une case « Moi » s'affiche (la recherche
   * exclut l'utilisateur courant). Absent : aucun changement (cas du partage).
   */
  moi?: CompteJson | null;
}

export function SelecteurUtilisateurs({
  valeur,
  onChange,
  unique = false,
  label,
  disabled = false,
  onListeOuverteChange,
  erreur,
  id,
  moi,
}: SelecteurUtilisateursProps) {
  const t = useTranslations('medicAssistSuivi.selecteurUtilisateurs');
  const idAuto = useId();
  const base = id ?? idAuto;
  const idChamp = `${base}-champ`;
  const idListe = `${base}-liste`;
  const idAide = `${base}-aide`;
  const idErreur = `${base}-erreur`;
  const idMoi = `${base}-moi`;

  const [saisie, setSaisie] = useState('');
  const [resultats, setResultats] = useState<CompteJson[]>([]);
  const [etat, setEtat] = useState<EtatRecherche>('repos');
  const [ouverte, setOuverte] = useState(false);
  const [actif, setActif] = useState(-1);
  const [relance, setRelance] = useState(0);
  const champRef = useRef<HTMLInputElement>(null);
  const valeurRef = useRef(valeur);
  const minuteurFermetureRef = useRef<ReturnType<typeof setTimeout>>();
  valeurRef.current = valeur;

  const plafond = valeur.length >= PLAFOND_SELECTION;
  const masquerChamp = unique && valeur.length >= 1;
  const termine = saisie.trim();

  const fermer = useCallback(() => {
    setOuverte(false);
    setActif(-1);
  }, []);

  useEffect(() => {
    onListeOuverteChange?.(ouverte);
  }, [ouverte, onListeOuverteChange]);

  // Une fermeture differee (perte de focus) ne doit jamais survivre au composant
  // ni a un retour dans le champ.
  useEffect(() => () => clearTimeout(minuteurFermetureRef.current), []);

  // Recherche avec anti-rebond ; une frappe annule la requete precedente.
  useEffect(() => {
    if (!termine || plafond || masquerChamp) {
      setEtat('repos');
      setResultats([]);
      return;
    }
    setEtat('chargement');
    const controleur = new AbortController();
    const minuteur = setTimeout(async () => {
      try {
        const comptes = await rechercherComptes(termine, controleur.signal);
        const dejaChoisis = new Set(valeurRef.current.map(c => c.id));
        setResultats(comptes.filter(c => !dejaChoisis.has(c.id)));
        setEtat('ok');
        setActif(-1);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setResultats([]);
        setEtat('erreur');
      }
    }, DELAI_ANTI_REBOND_MS);
    return () => {
      clearTimeout(minuteur);
      controleur.abort();
    };
  }, [termine, plafond, masquerChamp, relance]);

  function choisir(compte: CompteJson) {
    if (valeur.some(c => c.id === compte.id)) return;
    onChange(unique ? [compte] : [...valeur, compte]);
    setSaisie('');
    setResultats([]);
    fermer();
    champRef.current?.focus();
  }

  const moiCoche = !!moi && valeur.some(c => c.id === moi.id);

  function basculerMoi(coche: boolean) {
    if (!moi) return;
    if (!coche) {
      onChange(valeur.filter(c => c.id !== moi.id));
    } else if (!moiCoche) {
      if (unique) onChange([moi]);
      else if (valeur.length < PLAFOND_SELECTION) onChange([...valeur, moi]);
    }
  }

  function retirer(compte: CompteJson) {
    onChange(valeur.filter(c => c.id !== compte.id));
    // Le champ est reapparu (mode unique) ou toujours la : on lui rend le focus.
    requestAnimationFrame(() => champRef.current?.focus());
  }

  function surTouche(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (resultats.length === 0) return;
      setOuverte(true);
      setActif(i => (i + 1) % resultats.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (resultats.length === 0) return;
      setOuverte(true);
      setActif(i => (i <= 0 ? resultats.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Jamais de soumission du formulaire parent depuis la recherche.
      if (ouverte) e.preventDefault();
      if (ouverte && actif >= 0 && resultats[actif]) choisir(resultats[actif]);
    } else if (e.key === 'Escape') {
      if (ouverte) fermer();
    }
  }

  const listeVisible = ouverte && !!termine && !plafond;
  const idOption = (i: number) => `${base}-option-${i}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={idChamp}>{label}</Label>

      {moi && (
        <div className="cible-tactile flex items-center gap-2">
          <Checkbox
            id={idMoi}
            checked={moiCoche}
            disabled={disabled || (!moiCoche && !unique && plafond)}
            onCheckedChange={c => basculerMoi(c === true)}
            aria-describedby={`${idMoi}-aide`}
          />
          <Label htmlFor={idMoi} className="font-normal">
            {t('moi')}
          </Label>
          <span id={`${idMoi}-aide`} className="sr-only">
            {t('moiAide')}
          </span>
        </div>
      )}

      {valeur.length > 0 ? (
        <ul aria-label={t('selectionLabel')} className="flex flex-wrap gap-2">
          {valeur.map(compte => (
            <li
              key={compte.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary ps-2.5 text-sm"
            >
              <span className="min-w-0 break-words py-1">{compte.nom}</span>
              <button
                type="button"
                onClick={() => retirer(compte)}
                disabled={disabled}
                aria-label={t('retirer', { nom: compte.nom })}
                title={t('retirer', { nom: compte.nom })}
                className="cible-tactile inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('aucuneSelection')}</p>
      )}

      {!masquerChamp && (
        <div className="relative">
          <Input
            ref={champRef}
            id={idChamp}
            role="combobox"
            aria-expanded={listeVisible}
            aria-controls={idListe}
            aria-autocomplete="list"
            aria-activedescendant={listeVisible && actif >= 0 ? idOption(actif) : undefined}
            aria-describedby={cnIds(idAide, erreur ? idErreur : undefined)}
            aria-invalid={erreur ? true : undefined}
            autoComplete="off"
            placeholder={t('placeholder')}
            value={saisie}
            disabled={disabled || plafond}
            onChange={e => {
              clearTimeout(minuteurFermetureRef.current);
              setSaisie(e.target.value);
              setOuverte(true);
            }}
            onFocus={() => {
              clearTimeout(minuteurFermetureRef.current);
              if (termine) setOuverte(true);
            }}
            onBlur={() => {
              // Laisse passer le clic sur une option avant de refermer la liste.
              clearTimeout(minuteurFermetureRef.current);
              minuteurFermetureRef.current = setTimeout(fermer, 120);
            }}
            onKeyDown={surTouche}
            // Toujours fourni : un `trailing` qui apparait ferait changer la structure du
            // champ et le recreerait, ce qui lui ferait perdre le focus a chaque frappe.
            trailing={
              <Loader2
                className={cn(
                  'h-4 w-4 animate-spin text-muted-foreground',
                  etat !== 'chargement' && 'invisible'
                )}
                aria-hidden="true"
              />
            }
          />

          {listeVisible && (
            <div
              className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-card shadow-lg"
              onMouseDown={e => e.preventDefault()}
            >
              {etat === 'ok' && resultats.length > 0 && (
                <ul id={idListe} role="listbox" aria-label={t('listeLabel')}>
                  {resultats.map((compte, i) => (
                    <li
                      key={compte.id}
                      id={idOption(i)}
                      role="option"
                      aria-selected={i === actif}
                      onClick={() => choisir(compte)}
                      onMouseEnter={() => setActif(i)}
                      className={cn(
                        'cible-tactile flex cursor-pointer flex-col px-3 py-2 text-sm',
                        i === actif && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <span className="font-medium">{compte.nom}</span>
                      <span className="text-xs text-muted-foreground">{compte.email}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Etats sans resultat : message annonce, pas une liste d'options. */}
              {!(etat === 'ok' && resultats.length > 0) && (
                <div role="status" className="px-3 py-2 text-sm">
                  {etat === 'chargement' && (
                    <span className="text-muted-foreground">{t('chargement')}</span>
                  )}
                  {etat === 'ok' && (
                    <span className="text-muted-foreground">{t('aucunResultat')}</span>
                  )}
                  {etat === 'erreur' && (
                    <span className="flex flex-wrap items-center gap-2 text-destructive">
                      {t('erreur')}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRelance(n => n + 1)}
                      >
                        {t('reessayer')}
                      </Button>
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p id={idAide} className="text-xs text-muted-foreground">
        {plafond ? t('plafond', { max: PLAFOND_SELECTION }) : t('aide')}
      </p>
      {erreur && (
        <p id={idErreur} className="text-xs font-medium text-destructive">
          {erreur}
        </p>
      )}

      {/* Annonces pour les lecteurs d'ecran : nombre de resultats et de personnes choisies. */}
      <div className="sr-only" role="status" aria-live="polite">
        {listeVisible && etat === 'ok' ? t('resultats', { nombre: resultats.length }) : null}
        {!listeVisible ? t('selection', { nombre: valeur.length }) : null}
      </div>
    </div>
  );
}

function cnIds(...ids: Array<string | undefined>): string | undefined {
  const liste = ids.filter(Boolean).join(' ');
  return liste || undefined;
}
