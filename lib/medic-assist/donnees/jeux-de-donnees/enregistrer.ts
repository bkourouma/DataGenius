/**
 * Enregistrement d'un jeu de données : plafond de stockage, aperçu, totaux exacts, empreinte
 * du périmètre, rattachement au lecteur (et à sa conversation).
 */

import type { NombreAnalytique } from '@/lib/medic-assist/contrats/numerique'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/client'
import {
  LIMITES,
  type ColonneJeu,
  type ContexteExecution,
  type LigneJeu,
  type Provenance,
  type ResultatJeu,
  type SourceJeu,
} from '@/lib/medic-assist/contrats'
import { calculerTotaux, estAdditive, lignesVersCellules } from './agregats'
import { empreintePerimetre } from './empreinte'
import { CLE_TOTAUX_STOCKES, retirerSql } from './provenance'

/** Contenu normalisé d'un calcul, prêt à être stocké ou renvoyé. */
export interface ContenuJeu {
  colonnes: ColonneJeu[]
  lignes: LigneJeu[]
  tronque: boolean
  totaux?: Record<string, NombreAnalytique>
  provenance: Provenance
}

export interface EntreeContenu {
  source: SourceJeu
  colonnes: readonly ColonneJeu[]
  lignes: readonly Record<string, unknown>[]
  tronque?: boolean
  /** Totaux du moteur (`null` : le moteur n'en a pas) ; absent : on les calcule. */
  totaux?: Record<string, NombreAnalytique> | null
  provenance: Provenance
  /** Nombre maximal de lignes gardées (LIMITES.lignesMaxStockees par défaut ; un export, plus). */
  plafond?: number
  colonnesNonAdditives?: ReadonlySet<string>
}

/** Plafonne, convertit en cellules et totalise (exactement) un calcul. */
export function preparerContenu(entree: EntreeContenu): ContenuJeu {
  const colonnes = [...entree.colonnes]
  const plafond = entree.plafond ?? LIMITES.lignesMaxStockees
  const gardees = entree.lignes.slice(0, plafond)
  const lignes = lignesVersCellules(colonnes, gardees)
  const tronque = entree.tronque === true || entree.lignes.length > plafond

  let totaux: Record<string, NombreAnalytique> | undefined
  if (entree.totaux === null) totaux = undefined
  else if (entree.totaux !== undefined) totaux = entree.totaux
  else {
    totaux = calculerTotaux(
      colonnes.filter(c => estAdditive(c.type)),
      lignes,
      entree.colonnesNonAdditives
    )
  }
  return {
    colonnes,
    lignes,
    tronque,
    ...(totaux && Object.keys(totaux).length > 0 ? { totaux } : {}),
    provenance: entree.provenance,
  }
}

/** Provenance telle que stockée : SQL conservé (route admin), totaux sous la clé privée. */
export function provenanceAStocker(contenu: ContenuJeu): Prisma.InputJsonValue {
  return {
    ...contenu.provenance,
    ...(contenu.totaux ? { [CLE_TOTAUX_STOCKES]: contenu.totaux } : {}),
  } as unknown as Prisma.InputJsonValue
}

/** Date de calcul d'une provenance (à défaut, maintenant). */
export function dateDeCalcul(provenance: Provenance): Date {
  const date = new Date(provenance.calculeA)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export interface EntreeEnregistrement extends EntreeContenu {
  /** Spécification rejouable, stockée telle quelle. */
  requete: unknown
  empreinteSource?: string
}

/** Enregistre le jeu pour `contexte.userId` ; renvoie ce que voit le MODÈLE (jamais le SQL). */
export async function enregistrerJeu(
  contexte: ContexteExecution,
  entree: EntreeEnregistrement
): Promise<ResultatJeu> {
  const contenu = preparerContenu(entree)
  const cree = await prisma.assistantJeuDeDonnees.create({
    data: {
      userId: contexte.userId,
      conversationId: contexte.conversationId ?? null,
      source: entree.source,
      empreinteSource: entree.empreinteSource ?? null,
      requete: (entree.requete ?? {}) as Prisma.InputJsonValue,
      colonnes: contenu.colonnes as unknown as Prisma.InputJsonValue,
      lignes: contenu.lignes as unknown as Prisma.InputJsonValue,
      nbLignes: contenu.lignes.length,
      tronque: contenu.tronque,
      provenance: provenanceAStocker(contenu),
      empreintePerimetre: empreintePerimetre(contexte),
      calculeA: dateDeCalcul(contenu.provenance),
    },
    select: { id: true },
  })
  return {
    jeuDeDonneesId: cree.id,
    colonnes: contenu.colonnes,
    apercu: contenu.lignes.slice(0, LIMITES.lignesApercu),
    nbLignes: contenu.lignes.length,
    tronque: contenu.tronque,
    ...(contenu.totaux ? { totaux: contenu.totaux } : {}),
    provenance: retirerSql(contenu.provenance),
  }
}
