/**
 * Agregation PURE des usages de l'assistant (aucun acces base, aucune horloge implicite).
 *
 * Entree : des lignes deja GROUPEES par (jour Paris, utilisateur, mode, fournisseur, modele)
 * par le depot, pour ne jamais charger des millions de lignes brutes. Une ligne brute est
 * un groupe d'un appel (`grouperLignesBrutes`). Sortie : `UsagesDto` du lot 0 (USD) ; le
 * taux EUR/USD est ajoute par la route (`UsagesReponse`).
 *
 * Le cout est celui ENREGISTRE sur chaque appel (`AssistantUsage.coutUsd`, Decimal non nul) :
 * aucun recalcul au tarif. Les echecs d'appel sont comptes (cout 0).
 */

import {
  FOURNISSEURS,
  MODES,
  type AgregatUsage,
  type Fournisseur,
  type Mode,
  type PersonneDto,
  type UsagesDto,
} from './imports-lot0-lot1'
import { USAGES_FENETRE_MAX_JOURS } from './types'

export const FUSEAU_USAGES = 'Europe/Paris'
export const NOM_UTILISATEUR_INCONNU = '—'

// ---------------------------------------------------------------------------
// Lignes
// ---------------------------------------------------------------------------

export interface LigneUsageBrute {
  createdAt: Date
  userId: string
  mode: string
  fournisseur: string
  modele: string
  tokensEntree: number
  tokensSortie: number
  /** Null en base pour les lignes sans cache : compte pour 0. */
  tokensCacheLecture: number | null
  tokensCacheEcriture: number | null
  /** Cout enregistre sur la ligne, en USD. */
  coutUsd: number
}

export interface LigneUsageGroupee {
  /** YYYY-MM-DD, fuseau Europe/Paris. */
  jour: string
  userId: string
  mode: string
  fournisseur: string
  modele: string
  requetes: number
  tokensEntree: number
  tokensSortie: number
  tokensCacheLecture: number
  tokensCacheEcriture: number
  coutUsd: number
}

// ---------------------------------------------------------------------------
// Dates (fuseau Europe/Paris)
// ---------------------------------------------------------------------------

const FORMAT_PARIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU_USAGES,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function partiesParis(instant: Date): Record<string, number> {
  const parties: Record<string, number> = {}
  for (const p of FORMAT_PARIS.formatToParts(instant)) {
    if (p.type !== 'literal') parties[p.type] = Number(p.value)
  }
  return parties
}

/** Jour (YYYY-MM-DD) d'un instant, vu de Paris. */
export function jourParis(instant: Date): string {
  const p = partiesParis(instant)
  const deux = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${deux(p.month)}-${deux(p.day)}`
}

function decalageParisMs(instant: Date): number {
  const p = partiesParis(instant)
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return local - Math.floor(instant.getTime() / 1000) * 1000
}

/** Instant (UTC) de minuit a Paris pour un jour YYYY-MM-DD. */
export function instantDebutJourParis(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number)
  const minuitUtc = Date.UTC(a, m - 1, j, 0, 0, 0)
  const decalage1 = decalageParisMs(new Date(minuitUtc))
  let instant = minuitUtc - decalage1
  const decalage2 = decalageParisMs(new Date(instant))
  if (decalage2 !== decalage1) instant = minuitUtc - decalage2
  return new Date(instant)
}

export function ajouterJours(jour: string, nombre: number): string {
  const [a, m, j] = jour.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j + nombre))
  return d.toISOString().slice(0, 10)
}

export function jourValide(valeur: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false
  const d = new Date(`${valeur}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur
}

/** Tous les jours de `debut` a `fin` inclus. */
export function listeJours(debut: string, fin: string): string[] {
  const jours: string[] = []
  for (let jour = debut; jour <= fin; jour = ajouterJours(jour, 1)) jours.push(jour)
  return jours
}

/** Tous les mois (YYYY-MM) touches par [debut, fin]. */
export function listeMois(debut: string, fin: string): string[] {
  const mois: string[] = []
  let [a, m] = debut.split('-').map(Number)
  const [af, mf] = fin.split('-').map(Number)
  while (a < af || (a === af && m <= mf)) {
    mois.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) {
      m = 1
      a += 1
    }
  }
  return mois
}

export interface FenetreUsages {
  debut: string
  fin: string
  /** Premier instant inclus. */
  depuis: Date
  /** Premier instant exclu (minuit suivant la fin). */
  avant: Date
}

export type ResultatFenetre =
  | { ok: true; fenetre: FenetreUsages }
  | { ok: false; code: 'periodeInvalide'; message: string }

/** Fenetre demandee, fin incluse (`du` et `au` ont deja ete valides par UsagesQuerySchema). */
export function resoudreFenetre(du: string, au: string): ResultatFenetre {
  if (!jourValide(du) || !jourValide(au) || du > au) {
    return { ok: false, code: 'periodeInvalide', message: 'Invalid period.' }
  }
  if (listeJours(du, au).length > USAGES_FENETRE_MAX_JOURS) {
    return {
      ok: false,
      code: 'periodeInvalide',
      message: `Period too long (${USAGES_FENETRE_MAX_JOURS} days maximum).`,
    }
  }
  return {
    ok: true,
    fenetre: {
      debut: du,
      fin: au,
      depuis: instantDebutJourParis(du),
      avant: instantDebutJourParis(ajouterJours(au, 1)),
    },
  }
}

// ---------------------------------------------------------------------------
// Groupement
// ---------------------------------------------------------------------------

function cleGroupe(
  l: Pick<LigneUsageGroupee, 'jour' | 'userId' | 'mode' | 'fournisseur' | 'modele'>
) {
  return JSON.stringify([l.jour, l.userId, l.mode, l.fournisseur, l.modele])
}

/** Accumulateur incremental : ajouter des lots de lignes brutes sans les retenir. */
export function creerAccumulateurUsages() {
  const groupes = new Map<string, LigneUsageGroupee>()
  return {
    ajouter(lignes: LigneUsageBrute[]) {
      for (const ligne of lignes) {
        const base = {
          jour: jourParis(ligne.createdAt),
          userId: ligne.userId,
          mode: ligne.mode,
          fournisseur: ligne.fournisseur,
          modele: ligne.modele,
        }
        const cle = cleGroupe(base)
        let g = groupes.get(cle)
        if (!g) {
          g = {
            ...base,
            requetes: 0,
            tokensEntree: 0,
            tokensSortie: 0,
            tokensCacheLecture: 0,
            tokensCacheEcriture: 0,
            coutUsd: 0,
          }
          groupes.set(cle, g)
        }
        g.requetes += 1
        g.tokensEntree += ligne.tokensEntree
        g.tokensSortie += ligne.tokensSortie
        g.tokensCacheLecture += ligne.tokensCacheLecture ?? 0
        g.tokensCacheEcriture += ligne.tokensCacheEcriture ?? 0
        g.coutUsd += ligne.coutUsd
      }
    },
    groupes(): LigneUsageGroupee[] {
      return [...groupes.values()]
    },
  }
}

export function grouperLignesBrutes(lignes: LigneUsageBrute[]): LigneUsageGroupee[] {
  const acc = creerAccumulateurUsages()
  acc.ajouter(lignes)
  return acc.groupes()
}

// ---------------------------------------------------------------------------
// Agregation
// ---------------------------------------------------------------------------

function arrondir(valeur: number, decimales = 6): number {
  const f = 10 ** decimales
  return Math.round((valeur + Number.EPSILON) * f) / f
}

function agregatVide(): AgregatUsage {
  return {
    requetes: 0,
    tokensEntree: 0,
    tokensSortie: 0,
    tokensCacheLecture: 0,
    tokensCacheEcriture: 0,
    coutUsd: 0,
  }
}

function cumuler(cible: AgregatUsage, g: LigneUsageGroupee) {
  cible.requetes += g.requetes
  cible.tokensEntree += g.tokensEntree
  cible.tokensSortie += g.tokensSortie
  cible.tokensCacheLecture += g.tokensCacheLecture
  cible.tokensCacheEcriture += g.tokensCacheEcriture
  cible.coutUsd += g.coutUsd
}

const finaliser = (agregat: AgregatUsage): AgregatUsage => ({
  ...agregat,
  coutUsd: arrondir(agregat.coutUsd),
})

const estFournisseur = (valeur: string): valeur is Fournisseur =>
  (FOURNISSEURS as readonly string[]).includes(valeur)
const estMode = (valeur: string): valeur is Mode => (MODES as readonly string[]).includes(valeur)

export interface EntreeAgregation {
  lignes: LigneUsageGroupee[]
  /** Premier et dernier jour inclus, YYYY-MM-DD. */
  debut: string
  fin: string
  groupement: 'jour' | 'mois'
  /** userId -> nom affiche (jamais l'identifiant seul). */
  nomsUtilisateurs: ReadonlyMap<string, string>
}

export function agregerUsages(entree: EntreeAgregation): UsagesDto {
  const { lignes, groupement } = entree
  const totaux = agregatVide()
  const periodes =
    groupement === 'mois'
      ? listeMois(entree.debut, entree.fin)
      : listeJours(entree.debut, entree.fin)
  const parPeriode = new Map<string, AgregatUsage>(periodes.map(p => [p, agregatVide()]))
  const parUtilisateur = new Map<string, AgregatUsage>()
  const parModele = new Map<
    string,
    { fournisseur: Fournisseur; modele: string; agregat: AgregatUsage }
  >()
  const parMode = new Map<Mode, AgregatUsage>()

  for (const g of lignes) {
    cumuler(totaux, g)

    const periode = parPeriode.get(groupement === 'mois' ? g.jour.slice(0, 7) : g.jour)
    if (periode) cumuler(periode, g)

    let u = parUtilisateur.get(g.userId)
    if (!u) parUtilisateur.set(g.userId, (u = agregatVide()))
    cumuler(u, g)

    if (estFournisseur(g.fournisseur)) {
      const cle = `${g.fournisseur}\u0000${g.modele}`
      let m = parModele.get(cle)
      if (!m) {
        m = { fournisseur: g.fournisseur, modele: g.modele, agregat: agregatVide() }
        parModele.set(cle, m)
      }
      cumuler(m.agregat, g)
    }

    if (estMode(g.mode)) {
      let mo = parMode.get(g.mode)
      if (!mo) parMode.set(g.mode, (mo = agregatVide()))
      cumuler(mo, g)
    }
  }

  const parCoutPuisRequetes = (x: AgregatUsage, y: AgregatUsage) =>
    y.coutUsd - x.coutUsd || y.requetes - x.requetes

  return {
    du: entree.debut,
    au: entree.fin,
    totaux: finaliser(totaux),
    parPeriode: [...parPeriode.entries()].map(([periode, agregat]) => ({
      periode,
      ...finaliser(agregat),
    })),
    parUtilisateur: [...parUtilisateur.entries()]
      .sort(([, x], [, y]) => parCoutPuisRequetes(x, y))
      .map(([id, agregat]): UsagesDto['parUtilisateur'][number] => {
        const utilisateur: PersonneDto = {
          id,
          nom: entree.nomsUtilisateurs.get(id) ?? NOM_UTILISATEUR_INCONNU,
        }
        return { utilisateur, ...finaliser(agregat) }
      }),
    parModele: [...parModele.values()]
      .sort((x, y) => parCoutPuisRequetes(x.agregat, y.agregat))
      .map(({ fournisseur, modele, agregat }) => ({ fournisseur, modele, ...finaliser(agregat) })),
    parMode: MODES.flatMap(mode => {
      const agregat = parMode.get(mode)
      return agregat ? [{ mode, ...finaliser(agregat) }] : []
    }),
  }
}
