/**
 * Etat du formulaire de configuration : brouillon saisi, comparaison avec la
 * configuration du serveur, corps du PUT (configuration COMPLETE). Fonctions pures.
 */

import type { ConfigAdminCorpsLot6, ConfigAdminReponse } from '@/lib/medic-assist/admin/types';
import {
  FORMAT_IDENTIFIANT_MODELE,
  LONGUEUR_MAX_IDENTIFIANT_MODELE,
  SUGGESTION_MODELE_TRANSCRIPTION,
} from './constantes';
import { MODES_LANGAGE } from './imports-lot0';
import type {
  ConfigTranscription,
  Fournisseur,
  FournisseurTranscription,
  ModeLangage,
  TarifModele,
} from './imports-lot0';

export interface Brouillon {
  fournisseur: Fournisseur;
  modeles: Record<ModeLangage, string>;
  /** null = dictee du navigateur seulement. */
  transcription: ConfigTranscription;
  /** Texte saisi (virgule ou point accepte). */
  taux: string;
}

/** Texte d'un taux dans la langue : « 0,92 » en francais. */
export function texteTaux(taux: number, intlTag: string): string {
  return new Intl.NumberFormat(intlTag, { maximumFractionDigits: 6, useGrouping: false }).format(
    taux
  );
}

export function brouillonDepuis(config: ConfigAdminReponse, intlTag: string): Brouillon {
  return {
    fournisseur: config.fournisseur,
    modeles: { ...config.modeles },
    transcription: config.transcription ? { ...config.transcription } : null,
    taux: texteTaux(config.tauxEurParUsd, intlTag),
  };
}

/** Taux saisi, ou null s'il n'est pas un nombre strictement positif. */
export function lireTaux(saisie: string): number | null {
  const texte = saisie.trim().replace(/\s/g, '').replace(',', '.');
  if (texte === '' || !/^\d*\.?\d+$|^\d+\.$/.test(texte)) return null;
  const valeur = Number(texte);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : null;
}

export type ProblemeModele = 'vide' | 'invalide';

/** Un identifiant de modele est non vide et au format accepte par le serveur. */
export function problemeModele(saisie: string): ProblemeModele | null {
  const texte = saisie.trim();
  if (texte === '') return 'vide';
  if (texte.length > LONGUEUR_MAX_IDENTIFIANT_MODELE || !FORMAT_IDENTIFIANT_MODELE.test(texte)) {
    return 'invalide';
  }
  return null;
}

/** Modes dont le modele est vide ou mal forme. */
export function modelesEnErreur(brouillon: Brouillon): ModeLangage[] {
  return MODES_LANGAGE.filter(mode => problemeModele(brouillon.modeles[mode]) !== null);
}

export function transcriptionEnErreur(brouillon: Brouillon): ProblemeModele | null {
  return brouillon.transcription ? problemeModele(brouillon.transcription.modele) : null;
}

/** Vrai si le brouillon peut etre envoye tel quel au serveur. */
export function brouillonValide(brouillon: Brouillon): boolean {
  return (
    modelesEnErreur(brouillon).length === 0 &&
    transcriptionEnErreur(brouillon) === null &&
    lireTaux(brouillon.taux) !== null
  );
}

function memeTranscription(a: ConfigTranscription, b: ConfigTranscription): boolean {
  if (a === null || b === null) return a === b;
  return a.fournisseur === b.fournisseur && a.modele.trim() === b.modele.trim();
}

/** Vrai si le brouillon differe de la configuration du serveur (saisie invalide comprise). */
export function estModifie(
  serveur: ConfigAdminReponse,
  brouillon: Brouillon,
  intlTag: string
): boolean {
  if (brouillon.fournisseur !== serveur.fournisseur) return true;
  if (MODES_LANGAGE.some(mode => brouillon.modeles[mode].trim() !== serveur.modeles[mode])) {
    return true;
  }
  if (!memeTranscription(brouillon.transcription, serveur.transcription)) return true;
  const taux = lireTaux(brouillon.taux);
  if (taux === null) return brouillon.taux.trim() !== texteTaux(serveur.tauxEurParUsd, intlTag);
  return Math.abs(taux - serveur.tauxEurParUsd) > 1e-9;
}

/**
 * Corps du PUT : la configuration COMPLETE (fournisseur, 3 modeles, transcription),
 * plus le taux seulement s'il a change. Renvoie null s'il n'y a rien a enregistrer ou
 * si le brouillon est invalide (le bouton Enregistrer est alors desactive).
 */
export function calculerMiseAJour(
  serveur: ConfigAdminReponse,
  brouillon: Brouillon
): ConfigAdminCorpsLot6 | null {
  if (!brouillonValide(brouillon)) return null;
  const taux = lireTaux(brouillon.taux) as number;
  const tauxModifie = Math.abs(taux - serveur.tauxEurParUsd) > 1e-9;

  const corps: ConfigAdminCorpsLot6 = {
    fournisseur: brouillon.fournisseur,
    modeles: {
      standard: brouillon.modeles.standard.trim(),
      profond: brouillon.modeles.profond.trim(),
      rapide: brouillon.modeles.rapide.trim(),
    },
    transcription: brouillon.transcription
      ? {
          fournisseur: brouillon.transcription.fournisseur,
          modele: brouillon.transcription.modele.trim(),
        }
      : null,
    ...(tauxModifie ? { tauxEurParUsd: taux } : {}),
  };

  const identique =
    corps.fournisseur === serveur.fournisseur &&
    MODES_LANGAGE.every(mode => corps.modeles[mode] === serveur.modeles[mode]) &&
    memeTranscription(corps.transcription, serveur.transcription) &&
    !tauxModifie;
  return identique ? null : corps;
}

/**
 * Changement de fournisseur : un modele laisse a la valeur par defaut de l'ancien
 * fournisseur suit le nouveau (vide si le nouveau n'en a pas : « a choisir ») ;
 * un modele saisi a la main est conserve.
 */
export function changerFournisseur(
  brouillon: Brouillon,
  config: ConfigAdminReponse,
  suivant: Fournisseur
): Brouillon {
  const defautsAvant = config.modelesParDefaut[brouillon.fournisseur];
  const defautsApres = config.modelesParDefaut[suivant];
  const modeles = { ...brouillon.modeles };
  for (const mode of MODES_LANGAGE) {
    const ancien = defautsAvant?.[mode] ?? null;
    if (ancien !== null && modeles[mode].trim() === ancien) {
      modeles[mode] = defautsApres?.[mode] ?? '';
    }
  }
  return { ...brouillon, fournisseur: suivant, modeles };
}

/**
 * Choix du moteur de transcription : null = dictee du navigateur seulement. Un
 * fournisseur retrouve le modele deja saisi pour lui dans la configuration du
 * serveur, sinon la suggestion.
 */
export function changerTranscription(
  brouillon: Brouillon,
  config: ConfigAdminReponse,
  choix: FournisseurTranscription | null
): Brouillon {
  if (choix === null) return { ...brouillon, transcription: null };
  if (brouillon.transcription?.fournisseur === choix) return brouillon;
  const enregistre =
    config.transcription?.fournisseur === choix ? config.transcription.modele : null;
  return {
    ...brouillon,
    transcription: {
      fournisseur: choix,
      modele: enregistre ?? SUGGESTION_MODELE_TRANSCRIPTION[choix],
    },
  };
}

/** Tarif connu du modele pour un fournisseur, ou null (le cout n'est alors pas estime). */
export function tarifDuModele(
  tarifs: readonly TarifModele[],
  fournisseur: Fournisseur,
  modele: string
): TarifModele | null {
  const nom = modele.trim();
  return tarifs.find(t => t.fournisseur === fournisseur && t.modele === nom) ?? null;
}
