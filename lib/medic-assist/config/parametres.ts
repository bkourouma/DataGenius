/**
 * Lecture et écriture de la configuration Medic Assist dans `parametres_application`.
 *
 * Modèle : `lib/services/sorties-locales-delai.ts` (défaut si absent ou illisible).
 * Aucune valeur de clé API n'est lue, renvoyée ni journalisée : seulement des booléens.
 */

import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import {
  CLES_PARAMETRES,
  FOURNISSEUR_PAR_DEFAUT,
  FOURNISSEURS,
  FOURNISSEURS_TRANSCRIPTION,
  MODES_LANGAGE,
  type ConfigAdminCorps,
  type ContexteExecution,
  type FournisseurTranscription,
} from '@/lib/medic-assist/contrats'
import { estFournisseur, fournisseurDisponible, modelesParDefaut } from './fournisseurs'
import {
  ErreurConfigMedicAssist,
  type ConfigEffective,
  type ConfigMedicAssist,
  type ConfigTranscription,
  type Fournisseur,
} from './types'

export { ErreurConfigMedicAssist }

type Env = Record<string, string | undefined>

export const LONGUEUR_MAX_MODELE = 100

/** Identifiant de modèle : non vide, 100 caractères au plus, sans espace. */
const identifiantModele = z.string().min(1).max(LONGUEUR_MAX_MODELE).regex(/^\S+$/)

function estFournisseurTranscription(valeur: unknown): valeur is FournisseurTranscription {
  return (FOURNISSEURS_TRANSCRIPTION as readonly unknown[]).includes(valeur)
}

export function fournisseursDisponibles(env: Env = process.env): Fournisseur[] {
  return FOURNISSEURS.filter(f => fournisseurDisponible(f, env))
}

/** Fournisseurs de transcription dont la clé existe. */
export function fournisseursTranscriptionDisponibles(
  env: Env = process.env
): FournisseurTranscription[] {
  return FOURNISSEURS_TRANSCRIPTION.filter(f => fournisseurDisponible(f, env))
}

function modeleOuNull(brut: string | undefined): string | null {
  const valeur = brut?.trim()
  if (!valeur) return null
  return identifiantModele.safeParse(valeur).success ? valeur : null
}

/** Relit la valeur JSON stockée ; toute valeur illisible donne null (dictée du navigateur). */
export function lireTranscription(brut: string | undefined): ConfigTranscription {
  const texte = brut?.trim()
  if (!texte) return null
  try {
    const valeur: unknown = JSON.parse(texte)
    if (typeof valeur !== 'object' || valeur === null) return null
    const { fournisseur, modele } = valeur as Record<string, unknown>
    if (!estFournisseurTranscription(fournisseur)) return null
    const id = modeleOuNull(typeof modele === 'string' ? modele : undefined)
    return id ? { fournisseur, modele: id } : null
  } catch {
    return null
  }
}

export function serialiserTranscription(transcription: ConfigTranscription): string {
  return transcription
    ? JSON.stringify({ fournisseur: transcription.fournisseur, modele: transcription.modele })
    : ''
}

/** Configuration appliquée : valeurs de la base, défauts, puis repli sur Claude si besoin. */
export async function lireConfigMedicAssist(env: Env = process.env): Promise<ConfigEffective> {
  const lignes = await prisma.parametreApplication.findMany({
    where: { cle: { in: Object.values(CLES_PARAMETRES) } },
    select: { cle: true, valeur: true },
  })
  const valeurs = new Map<string, string>(lignes.map(l => [l.cle, l.valeur]))

  const brut = valeurs.get(CLES_PARAMETRES.fournisseur)?.trim()
  const fournisseurDemande: Fournisseur = estFournisseur(brut) ? brut : FOURNISSEUR_PAR_DEFAUT

  const transcription = lireTranscription(valeurs.get(CLES_PARAMETRES.transcription))

  const defauts = modelesParDefaut(fournisseurDemande)
  const modeles = {
    standard: modeleOuNull(valeurs.get(CLES_PARAMETRES.modeleStandard)) ?? defauts.standard,
    profond: modeleOuNull(valeurs.get(CLES_PARAMETRES.modeleProfond)) ?? defauts.profond,
    rapide: modeleOuNull(valeurs.get(CLES_PARAMETRES.modeleRapide)) ?? defauts.rapide,
  }

  const repli =
    fournisseurDemande !== 'anthropic' &&
    !fournisseurDisponible(fournisseurDemande, env) &&
    fournisseurDisponible('anthropic', env)

  if (repli) {
    return {
      fournisseur: 'anthropic',
      modeles: modelesParDefaut('anthropic'),
      transcription,
      repliSurClaude: true,
      fournisseurDemande,
    }
  }

  return {
    fournisseur: fournisseurDemande,
    modeles,
    transcription,
    repliSurClaude: false,
    fournisseurDemande,
  }
}

/**
 * Valide puis enregistre la configuration (5 clés, une transaction) et renvoie ce qui a
 * été enregistré. L'appelant a déjà vérifié les droits d'administration.
 */
export async function ecrireConfigMedicAssist(
  contexte: ContexteExecution,
  config: ConfigAdminCorps,
  env: Env = process.env
): Promise<ConfigMedicAssist> {
  if (!estFournisseur(config.fournisseur)) {
    throw new ErreurConfigMedicAssist('fournisseur_inconnu', 'Fournisseur inconnu')
  }
  if (!fournisseurDisponible(config.fournisseur, env)) {
    throw new ErreurConfigMedicAssist(
      'fournisseur_indisponible',
      `Aucune clé d'environnement pour le fournisseur ${config.fournisseur}`
    )
  }

  for (const mode of MODES_LANGAGE) {
    if (!identifiantModele.safeParse(config.modeles?.[mode]).success) {
      throw new ErreurConfigMedicAssist('modele_invalide', `Modèle invalide pour le mode ${mode}`)
    }
  }

  const transcription = config.transcription
  if (transcription !== null) {
    if (!estFournisseurTranscription(transcription.fournisseur)) {
      throw new ErreurConfigMedicAssist(
        'fournisseur_inconnu',
        'Fournisseur de transcription inconnu'
      )
    }
    if (!identifiantModele.safeParse(transcription.modele).success) {
      throw new ErreurConfigMedicAssist('modele_invalide', 'Modèle de transcription invalide')
    }
    if (!fournisseurDisponible(transcription.fournisseur, env)) {
      throw new ErreurConfigMedicAssist(
        'transcription_indisponible',
        `Aucune clé d'environnement pour la transcription ${transcription.fournisseur}`
      )
    }
  }

  const enregistree: ConfigMedicAssist = {
    fournisseur: config.fournisseur,
    modeles: {
      standard: config.modeles.standard,
      profond: config.modeles.profond,
      rapide: config.modeles.rapide,
    },
    transcription: transcription
      ? { fournisseur: transcription.fournisseur, modele: transcription.modele }
      : null,
  }

  const entrees: [string, string][] = [
    [CLES_PARAMETRES.fournisseur, enregistree.fournisseur],
    [CLES_PARAMETRES.modeleStandard, enregistree.modeles.standard],
    [CLES_PARAMETRES.modeleProfond, enregistree.modeles.profond],
    [CLES_PARAMETRES.modeleRapide, enregistree.modeles.rapide],
    [CLES_PARAMETRES.transcription, serialiserTranscription(enregistree.transcription)],
  ]

  await prisma.$transaction(
    entrees.map(([cle, valeur]) =>
      prisma.parametreApplication.upsert({
        where: { cle },
        create: { cle, valeur, updatedBy: contexte.userId },
        update: { valeur, updatedBy: contexte.userId },
      })
    )
  )

  return enregistree
}
