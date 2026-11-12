/**
 * Fenetre de dates des rapports de ventes, sans dependance serveur : l'ecran et
 * l'export s'en servent tous deux.
 *
 * Sans dates choisies, un rapport montre le dernier mois CLOS, comme le tableau
 * de bord et la Revue du mois : une agence declare le mois ecoule jusqu'au jour
 * limite de saisie (le 10 par defaut). Du 1er au 10 novembre, octobre est encore
 * en saisie et le defaut reste septembre ; il bascule sur octobre le 11.
 * L'export, lui, partait sans borne et sortait tout l'historique : les deux
 * suivent desormais la meme regle.
 *
 * Le jour limite est un parametre en base : le serveur le lit (`lireJourLimite`),
 * l'ecran le recoit du gabarit (`useJourLimite`). A defaut, le 10.
 *
 * Tout est calcule en heure locale : `toISOString()` bascule en UTC et peut
 * reculer d'un jour (donc d'un mois) le 1er du mois a minuit.
 */

import { dernierMoisClos } from '@/lib/services/revue-mensuelle/calendrier';
import { JOUR_LIMITE_DEFAUT } from '@/lib/utils/delai-saisie';
import { exerciceDePeriode, periodesEntre } from '@/lib/utils/exercice';

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` en heure locale. */
export function dateLocaleISO(date: Date): string {
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** Premier et dernier jour d'une periode `YYYY-MM`. */
function bornesDuMois(periode: string): { dateDebut: string; dateFin: string } {
  const [annee, mois] = periode.split('-').map(Number);
  return {
    dateDebut: dateLocaleISO(new Date(annee, mois - 1, 1)),
    dateFin: dateLocaleISO(new Date(annee, mois, 0)),
  };
}

/** Dernier mois clos `YYYY-MM` : defaut des ecrans a filtre mensuel. */
export function moisParDefaut(maintenant: Date = new Date(), jourLimite: number = JOUR_LIMITE_DEFAUT): string {
  return dernierMoisClos(maintenant, jourLimite);
}

/** Premier et dernier jour du dernier mois clos. */
export function plageVentesParDefaut(
  maintenant: Date = new Date(),
  jourLimite: number = JOUR_LIMITE_DEFAUT
): { dateDebut: string; dateFin: string } {
  return bornesDuMois(moisParDefaut(maintenant, jourLimite));
}

/**
 * Exercice ouvert d'office par les rapports d'exercice : celui du dernier mois
 * clos, comme le tableau de bord. Avril, premier mois d'un exercice, n'est clos
 * que le 10 mai : jusque-la l'exercice qui s'acheve reste affiche, plutot qu'un
 * exercice neuf encore sans ventes.
 */
export function exerciceParDefaut(maintenant: Date = new Date(), jourLimite: number = JOUR_LIMITE_DEFAUT): number {
  return exerciceDePeriode(moisParDefaut(maintenant, jourLimite));
}

/**
 * Mois civil precedent `YYYY-MM`. Ce n'est pas un defaut de rapport : la grille
 * des sorties locales ouvre sur le mois que les agences sont en train de declarer.
 */
export function moisCivilPrecedent(maintenant: Date = new Date()): string {
  const precedent = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
  return `${precedent.getFullYear()}-${deuxChiffres(precedent.getMonth() + 1)}`;
}

/** Dernier jour du mois d'une date `YYYY-MM-DD`. */
function finDuMois(iso: string): string {
  const [annee, mois] = iso.slice(0, 7).split('-').map(Number);
  return dateLocaleISO(new Date(annee, mois, 0));
}

/**
 * Fenetre effective d'un rapport : les dates choisies, et pour celles qui
 * manquent le dernier mois clos. Une seule borne choisie ne doit jamais croiser
 * la borne par defaut (debut en octobre seul -> fin au 30/09 -> erreur 400) :
 * la borne manquante se cale alors sur le mois de la borne choisie.
 */
export function fenetreVentes(
  dateDebut?: string,
  dateFin?: string,
  maintenant: Date = new Date(),
  jourLimite: number = JOUR_LIMITE_DEFAUT
): { dateDebut: string; dateFin: string } {
  const defaut = plageVentesParDefaut(maintenant, jourLimite);
  let debut = dateDebut || defaut.dateDebut;
  let fin = dateFin || defaut.dateFin;
  if (debut > fin) {
    if (!dateFin) fin = finDuMois(debut);
    else if (!dateDebut) debut = `${fin.slice(0, 7)}-01`;
  }
  return { dateDebut: debut, dateFin: fin };
}

/** Duree maximale d'une fenetre, la meme que celle refusee par /api/rapports/ventes. */
const DUREE_MAX_JOURS = 730;

/**
 * Ce qui fait refuser la fenetre par le serveur (erreur 400), ou `null`.
 * L'ecran le signale au lieu d'envoyer la demande.
 */
export function anomaliePeriodeVentes(
  dateDebut: string,
  dateFin: string
): 'inversee' | 'tropLongue' | null {
  if (dateDebut > dateFin) return 'inversee';
  const jours = (Date.parse(dateFin) - Date.parse(dateDebut)) / 86_400_000;
  return jours > DUREE_MAX_JOURS ? 'tropLongue' : null;
}

/**
 * Libelle court de la fenetre affichee, au mois pres : « 09/26 », ou
 * « 04/26 – 09/26 », le meme dans toutes les langues. Les ventes sont
 * mensuelles : le jour choisi dans le filtre ne change rien aux lignes retenues.
 */
export function libellePeriodeVentes(dateDebut: string, dateFin: string): string {
  // Lu dans la chaine `YYYY-MM-DD` : pas de Date, donc pas de decalage de fuseau.
  const mois = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
  const debut = mois(dateDebut);
  const fin = mois(dateFin);
  return debut === fin ? debut : `${debut} – ${fin}`;
}

/** Premiere periode couverte quand seule une date de fin est donnee. */
const PREMIERE_PERIODE = '2020-01';

/**
 * Periodes `YYYY-MM` couvertes par une fenetre de dates `YYYY-MM-DD`.
 * Les chaines sont lues telles quelles : `new Date('2026-09-01')` vaut minuit UTC
 * et, a l'ouest de Greenwich, tombe encore en aout.
 */
export function periodesDeLaFenetre(
  dateDebut?: string,
  dateFin?: string,
  maintenant: Date = new Date()
): string[] {
  if (!dateDebut && !dateFin) return [];
  const debut = dateDebut ? dateDebut.slice(0, 7) : PREMIERE_PERIODE;
  const fin = dateFin
    ? dateFin.slice(0, 7)
    : `${maintenant.getFullYear()}-${deuxChiffres(maintenant.getMonth() + 1)}`;
  return periodesEntre(debut, fin);
}
