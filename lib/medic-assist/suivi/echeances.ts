/**
 * Calcul PUR de l'echeance d'un rapport programme : aucune base, aucune horloge
 * cachee (l'instant de reference est toujours passe par l'appelant).
 *
 * Les heures sont des heures de Paris. Le calcul passe par Intl (pas de
 * dependance de fuseau), donc il est identique quel que soit le fuseau du
 * serveur et respecte les changements d'heure :
 * - heure inexistante a la bascule de mars (02:00 le dernier dimanche) : on
 *   prend la meme minute de l'heure suivante (02:30 devient 03:30 de Paris) ;
 * - heure doublee a la bascule d'octobre : premiere occurrence.
 */

import { FREQUENCES_RAPPORT, type FrequenceRapport } from '@/lib/medic-assist/contrats'
import { ErreurSuivi } from './erreurs'

export const FUSEAU_RAPPORTS = 'Europe/Paris'

export interface Planning {
  frequence: FrequenceRapport
  /** 1 = lundi ... 7 = dimanche (ISO) ; exige pour 'hebdomadaire'. */
  jourSemaine?: number | null
  /** 1 a 28 ; exige pour 'mensuel' (borne du contrat : le jour existe tous les mois). */
  jourMois?: number | null
  /** 'HH:mm', heure de Paris (minutes comprises). */
  heure: string
}

const HEURE_MS = 3_600_000
/** Plus long intervalle entre deux echeances (mensuel) + marge : garde-fou de boucle. */
const JOURS_MAX_RECHERCHE = 400

const formateur = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU_RAPPORTS,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

interface DatePlace {
  annee: number
  mois: number
  jour: number
}

/** Heure murale de Paris d'un instant, exprimee comme un horodatage "UTC" (sans decalage). */
function murPourParis(instant: number): number {
  const parties: Record<string, number> = {}
  for (const p of formateur.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parties[p.type] = Number(p.value)
  }
  return Date.UTC(
    parties.year,
    parties.month - 1,
    parties.day,
    parties.hour,
    parties.minute,
    parties.second
  )
}

function dateParis(instant: Date): DatePlace {
  const mur = new Date(murPourParis(instant.getTime()))
  return { annee: mur.getUTCFullYear(), mois: mur.getUTCMonth() + 1, jour: mur.getUTCDate() }
}

const FORMAT_HEURE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** Heures et minutes d'une chaine 'HH:mm', ou null si le format est invalide. */
function lireHeure(heure: unknown): { h: number; m: number } | null {
  if (typeof heure !== 'string' || !FORMAT_HEURE.test(heure)) return null
  const [h, m] = heure.split(':').map(Number)
  return { h, m }
}

/** Instant UTC dont l'heure murale de Paris est `jour` a `h`:`m` (voir regles en tete). */
function instantParis(jour: DatePlace, h: number, m: number): Date {
  const mur = Date.UTC(jour.annee, jour.mois - 1, jour.jour, h, m, 0)
  // Paris est a UTC+1 (hiver) ou UTC+2 (ete) : deux candidats suffisent.
  const candidats = [mur - 2 * HEURE_MS, mur - HEURE_MS].filter((t) => murPourParis(t) === mur)
  // Deux candidats = heure doublee d'octobre : le premier (heure d'ete). Aucun =
  // heure sautee de mars : le decalage d'hiver donne l'instant juste apres le saut.
  return new Date(candidats[0] ?? mur - HEURE_MS)
}

function jourSemaineIso(jour: DatePlace): number {
  const dimancheZero = new Date(Date.UTC(jour.annee, jour.mois - 1, jour.jour)).getUTCDay()
  return dimancheZero === 0 ? 7 : dimancheZero
}

function joursDansLeMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate()
}

function ajouterJours(jour: DatePlace, n: number): DatePlace {
  const d = new Date(Date.UTC(jour.annee, jour.mois - 1, jour.jour + n))
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate() }
}

function entierDans(valeur: unknown, min: number, max: number): valeur is number {
  return typeof valeur === 'number' && Number.isInteger(valeur) && valeur >= min && valeur <= max
}

/** Refuse un planning incomplet ou hors bornes. Le quotidien ignore les jours. */
export function validerPlanning(p: Planning): void {
  if (!(FREQUENCES_RAPPORT as readonly string[]).includes(p.frequence)) {
    throw new ErreurSuivi('invalide', 'frequence inconnue')
  }
  if (!lireHeure(p.heure)) {
    throw new ErreurSuivi('invalide', 'heure : format HH:mm attendu (00:00 a 23:59)')
  }
  if (p.frequence === 'hebdomadaire' && !entierDans(p.jourSemaine, 1, 7)) {
    throw new ErreurSuivi('invalide', 'jourSemaine : entier de 1 (lundi) a 7 (dimanche) attendu')
  }
  if (p.frequence === 'mensuel' && !entierDans(p.jourMois, 1, 28)) {
    throw new ErreurSuivi('invalide', 'jourMois : entier de 1 a 28 attendu')
  }
}

function jourConvient(planning: Planning, jour: DatePlace): boolean {
  switch (planning.frequence) {
    case 'quotidien':
      return true
    case 'hebdomadaire':
      return jourSemaineIso(jour) === planning.jourSemaine
    case 'mensuel':
      return (
        jour.jour === Math.min(planning.jourMois as number, joursDansLeMois(jour.annee, jour.mois))
      )
  }
}

/**
 * Premier instant STRICTEMENT apres `apres` qui tombe a `planning.heure` (HH:mm),
 * heure de Paris, un jour qui convient au planning. L'envoi est du des que
 * `maintenant >= prochainEnvoiA` : la tache planifiee passe chaque heure, donc une
 * heure avec minutes part au passage suivant.
 */
export function prochainEnvoiA(planning: Planning, apres: Date): Date {
  validerPlanning(planning)
  const { h, m } = lireHeure(planning.heure) as { h: number; m: number }
  // On part de la veille : l'heure murale de Paris peut etre en avance sur UTC.
  const debut = ajouterJours(dateParis(apres), -1)
  for (let i = 0; i <= JOURS_MAX_RECHERCHE; i += 1) {
    const jour = ajouterJours(debut, i)
    if (!jourConvient(planning, jour)) continue
    const instant = instantParis(jour, h, m)
    if (instant.getTime() > apres.getTime()) return instant
  }
  // Inatteignable pour un planning valide.
  throw new ErreurSuivi('invalide', `aucune echeance dans les ${JOURS_MAX_RECHERCHE} jours`)
}

/**
 * Fin de la journee civile `YYYY-MM-DD` a Paris (23:59:59.999) : valeur de
 * Task.dueDate pour une echeance donnee en date civile. Une tache n'est donc
 * « en retard » qu'une fois le jour entier ecoule.
 */
export function finDeJourneeParis(dateCivile: string): Date {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateCivile)
  if (!morceaux) throw new ErreurSuivi('invalide', 'echeance : date AAAA-MM-JJ attendue')
  const [, annee, mois, jour] = morceaux
  const debut = instantParis({ annee: Number(annee), mois: Number(mois), jour: Number(jour) }, 23, 59)
  return new Date(debut.getTime() + 59_999)
}
