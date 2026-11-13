/**
 * Lecture des artefacts : acces par proprietaire, partage d'artefact, partage de conversation,
 * epingle, et aucun lien (404 identique). Verifie le `where` unique, les droits, le nom du
 * proprietaire, la selection de version et la liste d'une conversation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  assistantArtefact: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  assistantJeuDeDonnees: { findMany: vi.fn() },
  assistantConversation: { findFirst: vi.fn() },
  assistantPartage: { findMany: vi.fn() },
  assistantEpingle: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db/client', () => ({ prisma: db, default: db }))

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import {
  ErreurArtefact,
  lireArtefact,
  listerArtefactsConversation,
} from '@/lib/medic-assist/artefacts/stockage-impl'

const CONTEXTE = {
  userId: 'lecteur',
  roleName: 'ExecView',
  scope: { voitTout: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2),
} as unknown as ContexteExecution
const ADMIN = { ...CONTEXTE, roleName: 'TenantAdmin' } as ContexteExecution

const SPEC = { type: 'tableau', titre: 'CA par pays', jeuDeDonneesId: 'jeu1' }
const PROVENANCE = {
  source: 'sql',
  libelleSource: 'Ventes',
  perimetre: { pays: 'tous', libelle: 'Tous les pays' },
  filtres: [],
  regles: [],
  sql: 'SELECT 1',
  calculeA: '2026-11-01T10:00:00.000Z',
}
const T1 = new Date('2026-11-01T10:00:00.000Z')
const T2 = new Date('2026-11-02T10:00:00.000Z')

function versions(extra: Record<string, unknown> = {}) {
  return [
    {
      version: 1,
      titre: 'V1',
      type: 'tableau',
      createdAt: T1,
      auteur: 'assistant',
      enregistre: true,
      conversationId: 'c1',
    },
    {
      version: 2,
      titre: 'V2',
      type: 'tableau',
      createdAt: T2,
      auteur: 'utilisateur',
      enregistre: true,
      conversationId: 'c1',
      ...extra,
    },
  ]
}

/** Prepare une lecture reussie ; `userIdLigne` = proprietaire de l'artefact. */
function preparer(opts: {
  userIdLigne?: string
  partagesArtefact?: string[]
  partagesConversation?: string[]
  epingles?: string[]
  ligne?: unknown
}) {
  const userIdLigne = opts.userIdLigne ?? 'lecteur'
  db.assistantPartage.findMany.mockImplementation(async ({ where }) =>
    where.ressourceType === 'artefact'
      ? (opts.partagesArtefact ?? []).map(ressourceId => ({ ressourceId }))
      : (opts.partagesConversation ?? []).map(ressourceId => ({ ressourceId }))
  )
  db.assistantEpingle.findMany.mockResolvedValue(
    (opts.epingles ?? []).map(artefactRacineId => ({ artefactRacineId }))
  )
  db.assistantArtefact.findFirst
    .mockResolvedValueOnce(
      opts.ligne === undefined
        ? { id: 'racine', userId: userIdLigne, racineId: 'racine', conversationId: 'c1' }
        : opts.ligne
    )
    .mockResolvedValue({ spec: SPEC })
  db.assistantArtefact.findMany.mockImplementation(async ({ where }) =>
    where.id?.in
      ? where.id.in.map((id: string) => ({ racineId: id === 'v2' ? 'racine' : id }))
      : versions()
  )
  db.user.findUnique.mockResolvedValue({ id: userIdLigne, firstName: 'Aïcha', lastName: 'Diallo' })
  db.assistantJeuDeDonnees.findMany.mockResolvedValue([
    {
      id: 'jeu1',
      colonnes: [{ cle: 'ca', libelle: 'CA', type: 'nombre' }],
      nbLignes: 12,
      tronque: false,
      provenance: PROVENANCE,
      calculeA: T1,
    },
  ])
}

beforeEach(() => {
  vi.resetAllMocks()
  db.assistantEpingle.findMany.mockResolvedValue([])
})

describe('lireArtefact : acces', () => {
  it('une SEULE requete decide l’acces : id + OR (proprietaire, partages, epingle)', async () => {
    preparer({ partagesArtefact: ['racine'], partagesConversation: ['c9'], epingles: ['e1'] })
    await lireArtefact(CONTEXTE, 'racine')
    expect(db.assistantArtefact.findFirst).toHaveBeenCalledTimes(2) // acces + contenu de la version
    expect(db.assistantArtefact.findFirst.mock.calls[0][0].where).toEqual({
      id: 'racine',
      OR: [
        { userId: 'lecteur' },
        { racineId: { in: ['racine'] } },
        { conversationId: { in: ['c9'] } },
        { racineId: { in: ['e1'] } },
      ],
    })
  })

  it('borne les partages et les epingles au lecteur', async () => {
    preparer({})
    await lireArtefact(CONTEXTE, 'racine')
    const partages = db.assistantPartage.findMany.mock.calls.map(c => c[0].where)
    expect(partages).toEqual([
      { aUserId: 'lecteur', ressourceType: 'artefact' },
      { aUserId: 'lecteur', ressourceType: 'conversation' },
    ])
    expect(db.assistantEpingle.findMany.mock.calls[0][0].where).toEqual({ userId: 'lecteur' })
  })

  it('ordonne de façon déterministe toutes les listes bornées (tri puis départage par id)', async () => {
    preparer({})
    await lireArtefact(CONTEXTE, 'racine')
    const appels = [
      ...db.assistantPartage.findMany.mock.calls,
      ...db.assistantEpingle.findMany.mock.calls,
    ]
    expect(appels).toHaveLength(3)
    for (const [arg] of appels) {
      expect(arg.take).toBeGreaterThan(0)
      expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    }
  })

  it('proprietaire : droits complets', async () => {
    preparer({})
    const dto = await lireArtefact(CONTEXTE, 'racine')
    expect(dto.droits).toEqual({
      lecture: true,
      modification: true,
      partage: true,
      export: true,
      programmation: true,
    })
    expect(dto.enregistre).toBe(true)
  })

  it.each([
    ['partage d’artefact', { partagesArtefact: ['racine'] }],
    [
      'partage d’une version (ressourceId = id de version, ramene a la racine)',
      { partagesArtefact: ['v2'] },
    ],
    ['partage de conversation', { partagesConversation: ['c1'] }],
    ['epingle', { epingles: ['racine'] }],
  ])('lecteur non proprietaire via %s : lecture et export seulement', async (_nom, acces) => {
    preparer({ userIdLigne: 'proprio', ...acces })
    const dto = await lireArtefact(CONTEXTE, 'racine')
    expect(dto.droits).toEqual({
      lecture: true,
      modification: false,
      partage: false,
      export: true,
      programmation: false,
    })
    // « Enregistre » est propre au proprietaire, meme si la colonne est vraie.
    expect(dto.enregistre).toBe(false)
    expect(dto.proprietaire).toEqual({ id: 'proprio', nom: 'Aïcha Diallo' })
  })

  it('aucun lien : introuvable, meme erreur qu’un artefact inexistant', async () => {
    preparer({ ligne: null })
    const a = await lireArtefact(CONTEXTE, 'racine').catch(e => e)
    vi.resetAllMocks()
    preparer({ ligne: null })
    const b = await lireArtefact(CONTEXTE, 'inexistant').catch(e => e)
    expect(a).toBeInstanceOf(ErreurArtefact)
    expect(a.code).toBe('introuvable')
    expect(b.code).toBe('introuvable')
    expect(a.message).toBe(b.message)
    // Aucune autre lecture n'a eu lieu : ni versions, ni proprietaire, ni jeux.
    expect(db.assistantArtefact.findMany).not.toHaveBeenCalled()
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.assistantJeuDeDonnees.findMany).not.toHaveBeenCalled()
  })

  it('epingle : vrai quand le lecteur a epingle la racine', async () => {
    preparer({ epingles: ['racine'] })
    expect((await lireArtefact(CONTEXTE, 'racine')).epingle).toBe(true)
  })
})

describe('lireArtefact : contenu', () => {
  it('lit la derniere version par defaut et liste les versions triees', async () => {
    preparer({})
    const dto = await lireArtefact(CONTEXTE, 'racine')
    expect(dto).toMatchObject({
      id: 'racine',
      version: 2,
      titre: 'V2',
      conversationId: 'c1',
      creeA: T1.toISOString(),
      majA: T2.toISOString(),
    })
    expect(dto.versions.map(v => [v.version, v.auteur])).toEqual([
      [1, 'assistant'],
      [2, 'utilisateur'],
    ])
    expect(db.assistantArtefact.findMany.mock.calls[0][0].orderBy).toEqual({ version: 'asc' })
  })

  it('lit la version demandee', async () => {
    preparer({})
    const dto = await lireArtefact(CONTEXTE, 'racine', { version: 1 })
    expect(dto.version).toBe(1)
    expect(dto.titre).toBe('V1')
    expect(db.assistantArtefact.findFirst.mock.calls[1][0].where).toMatchObject({ version: 1 })
  })

  it('version absente : introuvable', async () => {
    preparer({})
    const e = await lireArtefact(CONTEXTE, 'racine', { version: 7 }).catch(err => err)
    expect(e).toBeInstanceOf(ErreurArtefact)
    expect(e.code).toBe('introuvable')
  })

  it('decrit les jeux sans lignes, restreints au proprietaire de l’artefact', async () => {
    preparer({ userIdLigne: 'proprio', partagesArtefact: ['racine'] })
    const dto = await lireArtefact(CONTEXTE, 'racine')
    expect(db.assistantJeuDeDonnees.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['jeu1'] },
      userId: 'proprio',
    })
    expect(db.assistantJeuDeDonnees.findMany.mock.calls[0][0].select).not.toHaveProperty('lignes')
    expect(dto.jeux).toEqual([
      {
        jeuDeDonneesId: 'jeu1',
        colonnes: [{ cle: 'ca', libelle: 'CA', type: 'nombre' }],
        nbLignes: 12,
        tronque: false,
        provenance: expect.objectContaining({ source: 'sql' }),
        calculeA: T1.toISOString(),
      },
    ])
  })

  it('SQL de la provenance retire pour un non-administrateur, conserve pour un administrateur', async () => {
    preparer({})
    expect((await lireArtefact(CONTEXTE, 'racine')).jeux[0].provenance).not.toHaveProperty('sql')
    vi.resetAllMocks()
    preparer({})
    expect((await lireArtefact(ADMIN, 'racine')).jeux[0].provenance.sql).toBe('SELECT 1')
  })
})

describe('listerArtefactsConversation', () => {
  it('liste la derniere version de chaque racine dans l’ordre de creation', async () => {
    db.assistantPartage.findMany.mockResolvedValue([])
    db.assistantArtefact.findMany
      .mockResolvedValueOnce([
        {
          id: 'b2',
          racineId: 'b',
          version: 2,
          type: 'graphique',
          titre: 'B',
          spec: { sousTitre: 'S' },
          createdAt: T2,
        },
        {
          id: 'a1',
          racineId: 'a',
          version: 1,
          type: 'tableau',
          titre: 'A',
          spec: {},
          createdAt: T1,
        },
      ])
      .mockResolvedValueOnce([
        { racineId: 'b', createdAt: new Date('2026-11-01T12:00:00Z') },
        { racineId: 'a', createdAt: T1 },
      ])
    const liste = await listerArtefactsConversation(CONTEXTE, 'c1')
    expect(liste.map(a => a.id)).toEqual(['a', 'b'])
    // Listes bornées : tri déterministe, départage par id.
    const [dernieres, premieres] = db.assistantArtefact.findMany.mock.calls.map(c => c[0])
    expect(dernieres.orderBy.at(-1)).toEqual({ id: 'asc' })
    expect(premieres.take).toBeGreaterThan(0)
    expect(premieres.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    expect(liste[1]).toEqual({
      id: 'b',
      racineId: 'b',
      type: 'graphique',
      titre: 'B',
      sousTitre: 'S',
      version: 2,
      majA: T2.toISOString(),
    })
  })

  it('le where borne au lecteur ou a une conversation qui lui est partagee', async () => {
    db.assistantPartage.findMany.mockImplementation(async ({ where }) =>
      where.ressourceType === 'conversation' ? [{ ressourceId: 'c1' }] : []
    )
    db.assistantArtefact.findMany.mockResolvedValue([])
    await listerArtefactsConversation(CONTEXTE, 'c1')
    expect(db.assistantPartage.findMany.mock.calls.map(c => c[0].where)).toContainEqual({
      aUserId: 'lecteur',
      ressourceType: 'conversation',
    })
    expect(db.assistantArtefact.findMany.mock.calls[0][0].where).toEqual({
      conversationId: 'c1',
      OR: [{ userId: 'lecteur' }, { conversationId: { in: ['c1'] } }],
    })
  })

  it('conversation d’un autre sans partage : liste vide, sans erreur', async () => {
    db.assistantPartage.findMany.mockResolvedValue([])
    db.assistantArtefact.findMany.mockResolvedValue([])
    await expect(listerArtefactsConversation(CONTEXTE, 'c-autre')).resolves.toEqual([])
  })
})

