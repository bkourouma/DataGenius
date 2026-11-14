/**
 * Garde-fous de l'assistant IA : plafond de coût journalier par utilisateur et modèle de
 * secours. Clés `parametres_application` définies ICI (pas dans les contrats).
 *
 * Lecture tolérante (valeur absente ou illisible -> défaut), écriture validée.
 * Aucune valeur de clé API n'est lue ni renvoyée : seulement des booléens.
 */

import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { FOURNISSEURS } from '@/lib/medic-assist/contrats'
import { REGISTRE_FOURNISSEURS, estFournisseur, fournisseurDisponible } from './fournisseurs'
import { TARIFS_AVEC_SOURCE } from './tarifs'
import { ErreurConfigMedicAssist, type Fournisseur, type ModeleSecours } from './types'

type Env = Record<string, string | undefined>

export const CLE_PLAFOND_COUT_JOURNALIER = 'medic_assist.plafond_cout_journalier_usd'
export const CLE_MODELE_SECOURS = 'medic_assist.modele_secours'

/** Plafond par défaut : 10 USD par utilisateur et par jour. 0 = désactivé. */
export const PLAFOND_COUT_DEFAUT_USD = 10
export const PLAFOND_COUT_MAX_USD = 10000
/** Plus petit plafond positif accepté (une valeur plus petite serait arrondie à 0 = désactivé). */
export const PLAFOND_COUT_MIN_POSITIF_USD = 0.01

export const LONGUEUR_MAX_MODELE = 100

/** Identifiant de modèle : non vide, 100 caractères au plus, sans espace. */
export const identifiantModele = z.string().min(1).max(LONGUEUR_MAX_MODELE).regex(/^\S+$/)

/** Plafond relu : absent, illisible, négatif ou non fini -> défaut ; 0 est conservé. */
export function lirePlafondCout(brut: string | undefined): number {
  const texte = brut?.trim()
  if (!texte) return PLAFOND_COUT_DEFAUT_USD
  const valeur = Number(texte)
  if (!Number.isFinite(valeur) || valeur < 0) return PLAFOND_COUT_DEFAUT_USD
  return valeur
}

/** Modèle de secours relu ; toute valeur illisible donne null (aucun secours). */
export function lireModeleSecours(brut: string | undefined): ModeleSecours | null {
  const texte = brut?.trim()
  if (!texte) return null
  try {
    const valeur: unknown = JSON.parse(texte)
    if (typeof valeur !== 'object' || valeur === null) return null
    const { fournisseur, modele } = valeur as Record<string, unknown>
    if (!estFournisseur(fournisseur)) return null
    const id = identifiantModele.safeParse(typeof modele === 'string' ? modele.trim() : modele)
    return id.success ? { fournisseur, modele: id.data } : null
  } catch {
    return null
  }
}

export function serialiserModeleSecours(secours: ModeleSecours | null): string {
  return secours ? JSON.stringify({ fournisseur: secours.fournisseur, modele: secours.modele }) : ''
}

/** Modèle connu du dépôt : tarifé, ou proposé / par défaut du fournisseur. */
export function modeleConnu(fournisseur: Fournisseur, modele: string): boolean {
  if (`${fournisseur}/${modele}` in TARIFS_AVEC_SOURCE) return true
  const fiche = REGISTRE_FOURNISSEURS[fournisseur]
  return (
    fiche.modelesProposes.some(m => m.id === modele) ||
    Object.values(fiche.modelesParDefaut).includes(modele)
  )
}

export interface GardeFousEntree {
  plafondCoutJournalierUsd?: number
  /** undefined = inchangé ; null = aucun modèle de secours. */
  modeleSecours?: ModeleSecours | null
}

export type GardeFousValides = GardeFousEntree

/** Valide sans écrire (appelable avant toute écriture). Lève ErreurConfigMedicAssist. */
export function validerGardeFous(
  entree: GardeFousEntree,
  env: Env = process.env
): GardeFousValides {
  const valides: GardeFousValides = {}

  if (entree.plafondCoutJournalierUsd !== undefined) {
    const p = entree.plafondCoutJournalierUsd
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > PLAFOND_COUT_MAX_USD) {
      throw new ErreurConfigMedicAssist(
        'plafond_invalide',
        `Le plafond doit être un nombre entre 0 et ${PLAFOND_COUT_MAX_USD}`
      )
    }
    // Un plafond strictement positif sous 0,01 serait arrondi à 0 (= désactivé) : refusé.
    if (p > 0 && p < PLAFOND_COUT_MIN_POSITIF_USD) {
      throw new ErreurConfigMedicAssist(
        'plafond_invalide',
        `Un plafond positif doit valoir au moins ${PLAFOND_COUT_MIN_POSITIF_USD} (0 désactive le plafond)`
      )
    }
    valides.plafondCoutJournalierUsd = Math.round(p * 100) / 100
  }

  if (entree.modeleSecours !== undefined) {
    const secours = entree.modeleSecours
    if (secours === null) {
      valides.modeleSecours = null
    } else {
      if (!(FOURNISSEURS as readonly unknown[]).includes(secours.fournisseur)) {
        throw new ErreurConfigMedicAssist('fournisseur_inconnu', 'Fournisseur de secours inconnu')
      }
      const modele = typeof secours.modele === 'string' ? secours.modele.trim() : secours.modele
      if (!identifiantModele.safeParse(modele).success) {
        throw new ErreurConfigMedicAssist('modele_invalide', 'Modèle de secours invalide')
      }
      if (!modeleConnu(secours.fournisseur, modele)) {
        throw new ErreurConfigMedicAssist(
          'modele_secours_inconnu',
          `Modèle de secours inconnu pour ${secours.fournisseur}`
        )
      }
      if (!fournisseurDisponible(secours.fournisseur, env)) {
        throw new ErreurConfigMedicAssist(
          'fournisseur_indisponible',
          `Aucune clé d'environnement pour le fournisseur de secours ${secours.fournisseur}`
        )
      }
      valides.modeleSecours = { fournisseur: secours.fournisseur, modele }
    }
  }
  return valides
}

/**
 * Valide puis enregistre les garde-fous présents (absent = inchangé). Renvoie ce qui a
 * été enregistré. L'appelant a déjà vérifié les droits d'administration.
 */
export async function ecrireGardeFous(
  userId: string,
  entree: GardeFousEntree,
  env: Env = process.env
): Promise<GardeFousValides> {
  const valides = validerGardeFous(entree, env)
  const entrees: [string, string][] = []
  if (valides.plafondCoutJournalierUsd !== undefined) {
    entrees.push([CLE_PLAFOND_COUT_JOURNALIER, String(valides.plafondCoutJournalierUsd)])
  }
  if (valides.modeleSecours !== undefined) {
    entrees.push([CLE_MODELE_SECOURS, serialiserModeleSecours(valides.modeleSecours)])
  }
  if (entrees.length === 0) return valides

  await prisma.$transaction(
    entrees.map(([cle, valeur]) =>
      prisma.parametreApplication.upsert({
        where: { cle },
        create: { cle, valeur, updatedBy: userId },
        update: { valeur, updatedBy: userId },
      })
    )
  )
  return valides
}
