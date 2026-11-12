/**
 * Fixtures des tests d'interface du panneau d'artefacts (lot 4) : artefacts clients,
 * réponses de l'API simulée par un `fetch` factice.
 */
import type {
  ArtefactSpec,
  Provenance,
  TypeArtefact,
} from '@/lib/medic-assist/contrats'
import type { ArtefactReponse } from '@/lib/medic-assist/artefacts/reponse'
import type { ArtefactClient, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

export function provenanceTest(surcharge: Partial<Provenance> = {}): Provenance {
  return {
    source: 'semantique',
    libelleSource: 'Ventes mensuelles',
    periode: { debut: '2026-04-01', fin: '2026-10-31', libelle: 'avril à octobre 2026' },
    perimetre: { pays: ['CI'], libelle: "Côte d'Ivoire" },
    filtres: [{ libelle: 'Produit', valeur: 'Amoxicilline' }],
    regles: ['CA au PGHT de la ligne', 'Hors produits inactifs'],
    calculeA: '2026-11-02T09:30:00.000Z',
    ...surcharge,
  }
}

export function jeuTest(id = 'jeu-1', provenance: Provenance = provenanceTest()): JeuClient {
  return {
    jeuDeDonneesId: id,
    colonnes: [
      { cle: 'pays', libelle: 'Pays', type: 'texte' },
      { cle: 'ca', libelle: 'CA', type: 'montant' },
    ],
    lignes: [
      { pays: 'CI', ca: 1200 },
      { pays: 'SN', ca: 800 },
    ],
    nbLignes: 2,
    tronque: false,
    provenance,
  }
}

const SPECS: Record<TypeArtefact, ArtefactSpec> = {
  tableau: { type: 'tableau', titre: 'CA par pays', jeuDeDonneesId: 'jeu-1' },
  graphique: {
    type: 'graphique',
    titre: 'CA par pays',
    jeuDeDonneesId: 'jeu-1',
    graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
  },
  indicateurs: {
    type: 'indicateurs',
    titre: 'Indicateurs',
    cartes: [{ libelle: 'CA', source: { jeuDeDonneesId: 'jeu-1', colonne: 'ca' } }],
  },
  document: { type: 'document', titre: 'Rapport', blocs: [{ type: 'texte', markdown: 'Bonjour' }] },
}

export function artefactTest(
  type: TypeArtefact = 'tableau',
  surcharge: Partial<ArtefactClient> = {}
): ArtefactClient {
  const spec = SPECS[type]
  return {
    id: `art-${type}`,
    racineId: `art-${type}`,
    version: 1,
    versions: [{ version: 1, creeLe: '2026-11-02T08:00:00.000Z' }],
    type,
    titre: spec.titre,
    spec,
    jeux: { 'jeu-1': jeuTest() },
    conversationId: 'conv-1',
    creeLe: '2026-11-02T08:00:00.000Z',
    modifiable: true,
    ...surcharge,
  }
}

/**
 * Inverse de `reponseVersClient` : la réponse HTTP (`ArtefactReponse`) qu'enverrait
 * GET|PATCH /api/medic-assist/artefacts/[id] pour cet artefact client. `racineId` (champ
 * facultatif hors DTO) y figure quand `avecRacine` est vrai (par défaut).
 */
export function reponseApi(a: ArtefactClient, avecRacine = true): ArtefactReponse {
  const reponse: ArtefactReponse & { racineId?: string } = {
    id: a.id,
    conversationId: a.conversationId ?? '',
    type: a.type,
    titre: a.titre,
    spec: a.sousTitre ? ({ ...a.spec, sousTitre: a.sousTitre } as ArtefactSpec) : a.spec,
    version: a.version,
    versions: a.versions.map(v => ({
      version: v.version,
      titre: a.titre,
      type: a.type,
      creeA: v.creeLe,
      auteur: 'assistant' as const,
    })),
    jeux: Object.values(a.jeux).map(j => ({
      jeuDeDonneesId: j.jeuDeDonneesId,
      colonnes: j.colonnes,
      nbLignes: j.nbLignes,
      tronque: j.tronque,
      provenance: j.provenance,
      calculeA: j.provenance.calculeA,
    })),
    donnees: Object.fromEntries(
      Object.values(a.jeux).map(j => [
        j.jeuDeDonneesId,
        { lignes: j.lignes as never, ...(j.totaux ? { totaux: j.totaux } : {}) },
      ])
    ),
    enregistre: false,
    epingle: false,
    droits: {
      lecture: true,
      modification: a.modifiable,
      partage: a.modifiable,
      export: true,
      programmation: a.modifiable,
    },
    proprietaire: { id: 'u-1', nom: 'Awa Traoré' },
    creeA: a.creeLe,
    majA: a.creeLe,
  }
  if (avecRacine) reponse.racineId = a.racineId
  if (a.artefactsLies) {
    reponse.artefactsLies = Object.fromEntries(
      Object.entries(a.artefactsLies).map(([id, lie]) => [id, reponseApi(lie, avecRacine)])
    )
  }
  return reponse
}

export function reponseJson(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Comme `mockNextIntl`, avec un fuseau fixe (UTC) pour des dates stables et sans avertissement. */
export async function mockIntlUi(actual: typeof import('next-intl')) {
  const { mockNextIntl, langueTest } = await import('./_intl')
  const base = await mockNextIntl(actual)
  return {
    ...base,
    useFormatter: () => actual.createFormatter({ locale: langueTest.code, timeZone: 'UTC' }),
  }
}
