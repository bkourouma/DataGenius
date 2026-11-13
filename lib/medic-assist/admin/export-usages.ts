/**
 * Classeur Excel des usages : une feuille par vue (Resume, Par jour ou Par mois, Par
 * utilisateur, Par modele, Par mode), a la charte de lib/excel/mise-en-forme.ts, libelles
 * dans la langue du contexte, montants en USD (enregistres) et en EUR (au taux affiche).
 */

import ExcelJS from 'exceljs'

import type { Locale } from '@/i18n/config'
import { classeurEnBuffer, construireFeuille, type OptionsColonne } from '@/lib/excel/mise-en-forme'

import type { AgregatUsage } from './dependances'
import { TEXTES_EXPORT_USAGES, type TextesExportUsages } from './textes-export'
import type { UsagesReponse } from './types'

type LigneFeuille = Record<string, unknown>

/** Arrondi au centime de millieme d'euro : 6 decimales suffisent au rapprochement. */
const arrondir = (valeur: number) => Math.round(valeur * 1_000_000) / 1_000_000

function formats(t: TextesExportUsages, texte: string[]): Record<string, OptionsColonne> {
  const c = t.colonnes
  const sortie: Record<string, OptionsColonne> = {
    [c.appels]: { format: 'entier' },
    [c.tokensEntree]: { format: 'entier' },
    [c.tokensSortie]: { format: 'entier' },
    [c.tokensCacheLecture]: { format: 'entier' },
    [c.tokensCacheEcriture]: { format: 'entier' },
    [c.coutUsd]: { format: 'montant', seuils: false },
    [c.coutEur]: { format: 'montant', seuils: false },
    [c.taux]: { format: 'decimal', seuils: false },
  }
  for (const libelle of texte) sortie[libelle] = { format: 'texte' }
  return sortie
}

function mesures(t: TextesExportUsages, a: AgregatUsage, taux: number): LigneFeuille {
  const c = t.colonnes
  return {
    [c.appels]: a.requetes,
    [c.tokensEntree]: a.tokensEntree,
    [c.tokensSortie]: a.tokensSortie,
    [c.tokensCacheLecture]: a.tokensCacheLecture,
    [c.tokensCacheEcriture]: a.tokensCacheEcriture,
    [c.coutUsd]: a.coutUsd,
    [c.coutEur]: arrondir(a.coutUsd * taux),
  }
}

export function nomFichierUsages(dto: Pick<UsagesReponse, 'du' | 'au'>): string {
  return `medic-assist-usages-${dto.du}_${dto.au}.xlsx`
}

export async function genererClasseurUsages(
  dto: UsagesReponse,
  locale: Locale,
  groupement: 'jour' | 'mois' = 'jour',
  dateExport: Date = new Date()
): Promise<Buffer> {
  const t = TEXTES_EXPORT_USAGES[locale] ?? TEXTES_EXPORT_USAGES.fr
  const c = t.colonnes
  const taux = dto.tauxEurParUsd
  const source = dto.tauxSource === 'config' ? t.sourceTauxConfig : t.sourceTauxDefaut
  const classeur = new ExcelJS.Workbook()

  const commun = {
    sousTitre: [t.periode(dto.du, dto.au), t.taux(taux, source)],
    libelles: { exporteLe: t.exporteLe, pagination: t.pagination },
    estLigneTotal: (cellules: unknown[]) => cellules[0] === t.total,
    dateExport,
  }

  const avecTotal = (lignes: LigneFeuille[], premiere: string): LigneFeuille[] => [
    ...lignes,
    { [premiere]: t.total, ...mesures(t, dto.totaux, taux) },
  ]

  construireFeuille(
    classeur,
    t.feuilles.resume,
    [
      {
        [c.debut]: dto.du,
        [c.fin]: dto.au,
        [c.taux]: taux,
        ...mesures(t, dto.totaux, taux),
      },
    ],
    {
      ...commun,
      titre: t.titre,
      colonnes: formats(t, [c.debut, c.fin]),
      estLigneTotal: () => false,
    }
  )

  const colonnePeriode = groupement === 'mois' ? c.mois : c.jour
  const feuillePeriode = groupement === 'mois' ? t.feuilles.parMois : t.feuilles.parJour
  construireFeuille(
    classeur,
    feuillePeriode,
    avecTotal(
      dto.parPeriode.map(l => ({ [colonnePeriode]: l.periode, ...mesures(t, l, taux) })),
      colonnePeriode
    ),
    { ...commun, titre: `${t.titre} - ${feuillePeriode}`, colonnes: formats(t, [colonnePeriode]) }
  )

  construireFeuille(
    classeur,
    t.feuilles.parUtilisateur,
    avecTotal(
      dto.parUtilisateur.map(l => ({ [c.utilisateur]: l.utilisateur.nom, ...mesures(t, l, taux) })),
      c.utilisateur
    ),
    {
      ...commun,
      titre: `${t.titre} - ${t.feuilles.parUtilisateur}`,
      colonnes: formats(t, [c.utilisateur]),
    }
  )

  construireFeuille(
    classeur,
    t.feuilles.parModele,
    avecTotal(
      dto.parModele.map(l => ({
        [c.fournisseur]: l.fournisseur,
        [c.modele]: l.modele,
        ...mesures(t, l, taux),
      })),
      c.fournisseur
    ),
    {
      ...commun,
      titre: `${t.titre} - ${t.feuilles.parModele}`,
      colonnes: formats(t, [c.fournisseur, c.modele]),
    }
  )

  construireFeuille(
    classeur,
    t.feuilles.parMode,
    avecTotal(
      dto.parMode.map(l => ({ [c.mode]: t.modes[l.mode], ...mesures(t, l, taux) })),
      c.mode
    ),
    { ...commun, titre: `${t.titre} - ${t.feuilles.parMode}`, colonnes: formats(t, [c.mode]) }
  )

  return classeurEnBuffer(classeur)
}
