/** Fixtures de B-1 : jeu de six lignes avec totaux, artefact d'indicateurs et document qui le cite. */
import type { ArtefactSpec, ContexteExecution } from '@/lib/medic-assist/contrats'
import { preparerExport } from '@/lib/medic-assist/artefacts/exports/preparer-export'
import { creerTraducteurServeur } from '@/lib/medic-assist/artefacts/exports/traducteur-serveur'
import type { ArtefactEnregistre, JeuComplet } from '@/lib/medic-assist/artefacts/ports'

import { PROVENANCE } from '../lot4/_export-fixtures'

export const CONTEXTE = {
  userId: 'u1',
  roleName: 'SuperAdmin',
  scope: { isGlobal: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 9, 5, 9, 30),
} as unknown as ContexteExecution

export const TOTAL = 949755.87
export const PREMIERE_LIGNE = 227504.37

/** Six lignes (pays), dont la première (Mirambie) vaut 227 504 € : le piège de B-1. */
export const JEU: JeuComplet = {
  jeuDeDonneesId: 'ventes',
  colonnes: [
    { cle: 'pays', libelle: 'Pays', type: 'texte' },
    { cle: 'ca', libelle: 'CA', type: 'montant' },
    { cle: 'ca_n1', libelle: 'CA N-1', type: 'montant' },
    { cle: 'budget', libelle: 'Budget', type: 'montant' },
  ],
  lignes: [
    { pays: 'Mirambie', ca: PREMIERE_LIGNE, ca_n1: 50000, budget: 300000 },
    { pays: 'Togo', ca: 200000, ca_n1: 150000, budget: 150000 },
    { pays: 'Mali', ca: 150000, ca_n1: 150000, budget: 150000 },
    { pays: 'Bénin', ca: 120000, ca_n1: 150000, budget: 150000 },
    { pays: 'Niger', ca: 150000, ca_n1: 150000, budget: 150000 },
    { pays: 'Gabon', ca: 102251.5, ca_n1: 164500, budget: 98757 },
  ],
  nbLignes: 6,
  tronque: false,
  totaux: { ca: TOTAL, ca_n1: 814500, budget: 998757 },
  provenance: PROVENANCE,
}

export const SPEC_INDICATEURS: ArtefactSpec = {
  type: 'indicateurs',
  titre: 'Indicateurs clés',
  cartes: [
    {
      libelle: 'CA de la période',
      source: { jeuDeDonneesId: 'ventes', colonne: 'ca' },
      format: 'montant',
      comparaison: { libelle: 'N-1', source: { jeuDeDonneesId: 'ventes', colonne: 'ca_n1' } },
      objectif: { libelle: 'Budget', source: { jeuDeDonneesId: 'ventes', colonne: 'budget' } },
    },
  ],
} as unknown as ArtefactSpec

function artefact(id: string, spec: ArtefactSpec): ArtefactEnregistre {
  return {
    id,
    racineId: id,
    version: 1,
    type: spec.type,
    titre: (spec as { titre: string }).titre,
    spec,
    conversationId: null,
    userId: 'u1',
    creeLe: new Date(2026, 9, 5),
  } as ArtefactEnregistre
}

export async function preparer(avecDocument: boolean) {
  const { traduire, rtl } = await creerTraducteurServeur('fr')
  const indicateurs = artefact('ind1', SPEC_INDICATEURS)
  const racine = avecDocument
    ? artefact('doc1', {
        type: 'document',
        titre: 'Note de synthèse',
        blocs: [
          { type: 'texte', markdown: 'Bilan.' },
          { type: 'artefact', artefactId: 'ind1' },
        ],
      } as unknown as ArtefactSpec)
    : indicateurs
  return preparerExport({
    artefact: racine,
    jeux: { ventes: JEU },
    artefactsLies: avecDocument ? { ind1: indicateurs } : undefined,
    contexte: CONTEXTE,
    traduire,
    rtl,
    exporteLe: new Date(2026, 9, 5, 10, 0),
  })
}

/** Sans espaces (normales, insécables, fines) pour comparer des montants formatés. */
export const compact = (texte: string) => texte.replace(/[\s  ]/g, '')

