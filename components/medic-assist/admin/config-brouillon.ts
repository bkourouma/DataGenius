/**
 * Etat du formulaire de configuration : brouillon saisi, comparaison avec la
 * configuration du serveur, corps du PUT (configuration COMPLETE). Fonctions pures.
 */

import {
  PLAFOND_COUT_MAX_USD_ADMIN,
  type ConfigAdminCorpsLot6,
  type ConfigAdminReponse,
} from '@/lib/medic-assist/admin/types';
import {
  FORMAT_IDENTIFIANT_MODELE,
  LONGUEUR_MAX_IDENTIFIANT_MODELE,
  SUGGESTION_MODELE_TRANSCRIPTION,
} from './constantes';
import { MODES_LANGAGE } from './dependances';
import type {
  ConfigTranscription,
  Fournisseur,
  FournisseurTranscription,
  ModeLangage,
  TarifModele,
} from './dependances';

export interface Brouillon {
  fournisseur: Fournisseur;
  modeles: Record<ModeLangage, string>;
  /** null = dictee du navigateur seulement. */
  transcription: ConfigTranscription;
  /** Texte saisi (virgule ou point accepte). */
  taux: string;
  /** Plafond de cout IA par utilisateur et par jour, texte saisi (0 = desactive). */
  plafond: string;
  /** Modele de secours facultatif : null = aucun. */
  modeleSecours: ModeleSecoursBrouillon;
}

export type ModeleSecoursBrouillon = { fournisseur: Fournisseur; modele: string } | null;

/** Texte d'un plafond dans la langue : « 10 » ou « 7,5 ». */
export function textePlafond(plafond: number, intlTag: string): string {
  return new Intl.NumberFormat(intlTag, { maximumFractionDigits: 2, useGrouping: false }).format(
    plafond
  );
}

/** Plafond saisi (0 accepte), ou null s'il n'est pas un nombre entre 0 et le maximum. */
export function lirePlafond(saisie: string): number | null {
  const texte = saisie.trim().replace(/\s/g, '').replace(',', '.');
  if (texte === '' || !/^\d*\.?\d+$|^\d+\.$/.test(texte)) return null;
  const valeur = Number(texte);
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > PLAFOND_COUT_MAX_USD_ADMIN) return null;
  // Strictement positif sous 0,01 : refusé (l'arrondi le ferait passer à 0 = désactivé).
  if (valeur > 0 && valeur < 0.01) return null;
  return Math.round(valeur * 100) / 100;
}

function memeSecours(a: ModeleSecoursBrouillon, b: ModeleSecoursBrouillon): boolean {
  if (a === null || b === null) return a === b;
  return a.fournisseur === b.fournisseur && a.modele.trim() === b.modele.trim();
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
    plafond: textePlafond(config.plafondCoutJournalierUsd, intlTag),
    modeleSecours: config.modeleSecours ? { ...config.modeleSecours } : null,
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

/** Probleme du modele de secours saisi (null si aucun secours choisi ou s'il est valide). */
export function secoursEnErreur(brouillon: Brouillon): ProblemeModele | null {
  return brouillon.modeleSecours ? problemeModele(brouillon.modeleSecours.modele) : null;
}

export function transcriptionEnErreur(brouillon: Brouillon): ProblemeModele | null {
  return brouillon.transcription ? problemeModele(brouillon.transcription.modele) : null;
}

/** Vrai si le brouillon peut etre envoye tel quel au serveur. */
export function brouillonValide(brouillon: Brouillon): boolean {
  return (
    modelesEnErreur(brouillon).length === 0 &&
    transcriptionEnErreur(brouillon) === null &&
    secoursEnErreur(brouillon) === null &&
    lireTaux(brouillon.taux) !== null &&
    lirePlafond(brouillon.plafond) !== null
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
  if (!memeSecours(brouillon.modeleSecours, serveur.modeleSecours)) return true;
  const plafond = lirePlafond(brouillon.plafond);
  if (plafond === null) {
    if (brouillon.plafond.trim() !== textePlafond(serveur.plafondCoutJournalierUsd, intlTag)) {
      return true;
    }
  } else if (plafond !== serveur.plafondCoutJournalierUsd) {
    return true;
  }
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
  const plafond = lirePlafond(brouillon.plafond) as number;
  const plafondModifie = plafond !== serveur.plafondCoutJournalierUsd;
  const secours: ModeleSecoursBrouillon = brouillon.modeleSecours
    ? { fournisseur: brouillon.modeleSecours.fournisseur, modele: brouillon.modeleSecours.modele.trim() }
    : null;
  const secoursModifie = !memeSecours(secours, serveur.modeleSecours);

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
    ...(plafondModifie ? { plafondCoutJournalierUsd: plafond } : {}),
    ...(secoursModifie ? { modeleSecours: secours } : {}),
  };

  const identique =
    corps.fournisseur === serveur.fournisseur &&
    MODES_LANGAGE.every(mode => corps.modeles[mode] === serveur.modeles[mode]) &&
    memeTranscription(corps.transcription, serveur.transcription) &&
    !tauxModifie &&
    !plafondModifie &&
    !secoursModifie;
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

/**
 * Choix du fournisseur du modele de secours : null = aucun. Un fournisseur retrouve le
 * secours enregistre pour lui, sinon le modele standard par defaut du fournisseur.
 */
export function changerSecours(
  brouillon: Brouillon,
  config: ConfigAdminReponse,
  choix: Fournisseur | null
): Brouillon {
  if (choix === null) return { ...brouillon, modeleSecours: null };
  if (brouillon.modeleSecours?.fournisseur === choix) return brouillon;
  const enregistre = config.modeleSecours?.fournisseur === choix ? config.modeleSecours.modele : null;
  return {
    ...brouillon,
    modeleSecours: {
      fournisseur: choix,
      modele: enregistre ?? config.modelesParDefaut[choix]?.standard ?? '',
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
