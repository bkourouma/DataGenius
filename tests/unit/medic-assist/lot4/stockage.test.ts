/**
 * Stockage des artefacts : creation, modification (assistant et utilisateur), validation de la
 * specification, controle des jeux / artefacts cites / conversation, versions et conflit.
 * Prisma est une doublure ; les `where` envoyes a la base sont verifies.
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
  creerArtefact,
  ErreurArtefact,
  modifierArtefact,
  modifierArtefactParUtilisateur,
  validerSpec,
} from '@/lib/medic-assist/artefacts/stockage-impl'

const CONTEXTE = {
  userId: 'u1',
  roleName: 'TenantAdmin',
  scope: { voitTout: true },
  habilitations: null,
  locale: 'fr',
  maintenant: new Date(2026, 10, 2),
} as unknown as ContexteExecution

const TABLEAU = { type: 'tableau', titre: 'CA par pays', jeuDeDonneesId: 'jeu1' } as const
const GRAPHIQUE = {
  type: 'graphique',
  titre: 'CA par pays',
  jeuDeDonneesId: 'jeu1',
  graphique: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
} as const
const INDICATEURS = {
  type: 'indicateurs',
  titre: 'Indicateurs',
  cartes: [{ libelle: 'CA du mois', source: { jeuDeDonneesId: 'jeu1', colonne: 'ca' } }],
} as const
const DOCUMENT = {
  type: 'document',
  titre: 'Analyse',
  blocs: [
    { type: 'texte', markdown: 'Le chiffre d’affaires progresse.' },
    { type: 'tableau', spec: { titre: 'Détail', jeuDeDonneesId: 'jeu2' } },
    { type: 'artefact', artefactId: 'art-cite' },
  ],
} as const

async function erreurDe(promesse: Promise<unknown>): Promise<ErreurArtefact> {
  try {
    await promesse
  } catch (e) {
    return e as ErreurArtefact
  }
  throw new Error('aucune erreur levee')
}

beforeEach(() => {
  vi.resetAllMocks()
  db.assistantJeuDeDonnees.findMany.mockImplementation(async ({ where }) =>
    where.id.in.map((id: string) => ({ id }))
  )
  db.assistantArtefact.findMany.mockImplementation(async ({ where }) =>
    where.id.in.map((id: string) => ({ id }))
  )
  db.assistantArtefact.create.mockResolvedValue({ id: 'x' })
})

describe('validerSpec', () => {
  it.each([
    ['tableau', TABLEAU],
    ['graphique', GRAPHIQUE],
    ['indicateurs', INDICATEURS],
    ['document', DOCUMENT],
  ])('accepte un artefact %s', (_type, spec) => {
    expect(validerSpec(spec).type).toBe(spec.type)
  })

  it('refuse un type inconnu', () => {
    expect(() => validerSpec({ type: 'carte', titre: 'x' })).toThrow(ErreurArtefact)
  })

  it('refuse du HTML dans un titre, avec le chemin du champ fautif', () => {
    const e = (() => {
      try {
        validerSpec({ ...TABLEAU, titre: '<script>alert(1)</script>' })
      } catch (err) {
        return err as ErreurArtefact
      }
    })()
    expect(e).toBeInstanceOf(ErreurArtefact)
    expect(e?.code).toBe('spec_invalide')
    expect(e?.message).toContain('titre')
  })

  it('refuse une URL externe dans un bloc de texte', () => {
    const spec = {
      ...DOCUMENT,
      blocs: [{ type: 'texte', markdown: '![x](https://exemple.test/pixel.png)' }],
    }
    expect(() => validerSpec(spec)).toThrow(ErreurArtefact)
  })

  it('refuse un graphique mal forme (secteurs avec deux series)', () => {
    const spec = {
      ...GRAPHIQUE,
      graphique: { forme: 'secteurs', x: 'pays', y: [{ cle: 'ca' }, { cle: 'qte' }] },
    }
    try {
      validerSpec(spec)
      throw new Error('attendu : erreur')
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurArtefact)
      expect((e as ErreurArtefact).message).toContain('graphique.y')
    }
  })

  it('refuse un champ inconnu (objet strict)', () => {
    expect(() => validerSpec({ ...TABLEAU, html: '<b>x</b>' })).toThrow(ErreurArtefact)
  })
})

describe('creerArtefact', () => {
  it('cree la version 1 avec racineId = id, auteur assistant et la liste des jeux', async () => {
    const sortie = await creerArtefact(CONTEXTE, { spec: DOCUMENT })
    const { data } = db.assistantArtefact.create.mock.calls[0][0]
    expect(data.id).toBe(data.racineId)
    expect(data).toMatchObject({
      userId: 'u1',
      version: 1,
      type: 'document',
      titre: 'Analyse',
      auteur: 'assistant',
      conversationId: null,
      jeuxDeDonneesIds: ['jeu2'],
    })
    expect(sortie).toEqual({
      artefactId: data.id,
      version: 1,
      type: 'document',
      titre: 'Analyse',
    })
  })

  it('verifie que chaque jeu appartient au lecteur (userId dans le where)', async () => {
    await creerArtefact(CONTEXTE, { spec: INDICATEURS })
    expect(db.assistantJeuDeDonnees.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['jeu1'] }, userId: 'u1' } })
    )
  })

  it("refuse le jeu d'un autre utilisateur, sans rien ecrire", async () => {
    db.assistantJeuDeDonnees.findMany.mockResolvedValue([])
    const e = await erreurDe(creerArtefact(CONTEXTE, { spec: TABLEAU }))
    expect(e.code).toBe('jeu_inaccessible')
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('donne le meme message pour un jeu inexistant et pour un jeu etranger', async () => {
    db.assistantJeuDeDonnees.findMany.mockResolvedValue([])
    const a = await erreurDe(creerArtefact(CONTEXTE, { spec: TABLEAU }))
    const b = await erreurDe(
      creerArtefact(CONTEXTE, { spec: { ...TABLEAU, jeuDeDonneesId: 'zz' } })
    )
    expect(a.message).toBe(b.message)
  })

  it('refuse un jeu sur deux manquant (compte different)', async () => {
    db.assistantJeuDeDonnees.findMany.mockResolvedValue([{ id: 'jeu1' }])
    const spec = {
      ...INDICATEURS,
      cartes: [
        { libelle: 'A', source: { jeuDeDonneesId: 'jeu1', colonne: 'ca' } },
        { libelle: 'B', source: { jeuDeDonneesId: 'jeu9', colonne: 'ca' } },
      ],
    }
    expect((await erreurDe(creerArtefact(CONTEXTE, { spec }))).code).toBe('jeu_inaccessible')
  })

  it("refuse un artefact cite qui n'est pas au lecteur", async () => {
    db.assistantArtefact.findMany.mockResolvedValue([])
    const e = await erreurDe(creerArtefact(CONTEXTE, { spec: DOCUMENT }))
    expect(e.code).toBe('spec_invalide')
    expect(db.assistantArtefact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['art-cite'] }, userId: 'u1' } })
    )
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('verifie que la conversation appartient au lecteur', async () => {
    db.assistantConversation.findFirst.mockResolvedValue({ id: 'c1' })
    await creerArtefact({ ...CONTEXTE, conversationId: 'c1' }, { spec: TABLEAU })
    expect(db.assistantConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', userId: 'u1' } })
    )
    expect(db.assistantArtefact.create.mock.calls[0][0].data.conversationId).toBe('c1')
  })

  it("refuse la conversation d'un autre utilisateur", async () => {
    db.assistantConversation.findFirst.mockResolvedValue(null)
    const e = await erreurDe(
      creerArtefact({ ...CONTEXTE, conversationId: 'c-autre' }, { spec: TABLEAU })
    )
    expect(e.code).toBe('introuvable')
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('refuse une specification invalide avant toute requete', async () => {
    const e = await erreurDe(
      creerArtefact(CONTEXTE, { spec: { type: 'tableau', titre: '' } as never })
    )
    expect(e.code).toBe('spec_invalide')
    expect(db.assistantJeuDeDonnees.findMany).not.toHaveBeenCalled()
  })
})

describe('modifierArtefact (assistant)', () => {
  const derniere = (extra = {}) => ({
    version: 2,
    conversationId: 'c1',
    description: 'Note',
    enregistre: true,
    enregistreA: new Date('2026-11-01'),
    ...extra,
  })

  it('cree la version suivante, reprend enregistre / description et garde la racine', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce(derniere())
    const sortie = await modifierArtefact(CONTEXTE, { artefactId: 'v2id', spec: GRAPHIQUE })
    const proprio = db.assistantArtefact.findFirst.mock.calls[0][0]
    expect(proprio.where).toEqual({ id: 'v2id', userId: 'u1' })
    const { data } = db.assistantArtefact.create.mock.calls[0][0]
    expect(data).toMatchObject({
      racineId: 'racine',
      version: 3,
      type: 'graphique',
      auteur: 'assistant',
      conversationId: 'c1',
      description: 'Note',
      enregistre: true,
      enregistreA: new Date('2026-11-01'),
      userId: 'u1',
    })
    expect(sortie).toEqual({
      artefactId: 'racine',
      version: 3,
      type: 'graphique',
      titre: 'CA par pays',
    })
  })

  it("traite l'artefact d'un autre comme introuvable", async () => {
    db.assistantArtefact.findFirst.mockResolvedValueOnce(null)
    const e = await erreurDe(modifierArtefact(CONTEXTE, { artefactId: 'autre', spec: TABLEAU }))
    expect(e.code).toBe('introuvable')
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('retente apres un conflit P2002 en recalculant la version', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce(derniere({ version: 2 }))
      .mockResolvedValueOnce(derniere({ version: 3 }))
    db.assistantArtefact.create
      .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
      .mockResolvedValueOnce({ id: 'x' })
    const sortie = await modifierArtefact(CONTEXTE, { artefactId: 'racine', spec: TABLEAU })
    expect(sortie.version).toBe(4)
    expect(db.assistantArtefact.create.mock.calls.map(c => c[0].data.version)).toEqual([3, 4])
  })

  it('abandonne en conflit apres trois essais', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValue(derniere())
    db.assistantArtefact.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    const e = await erreurDe(modifierArtefact(CONTEXTE, { artefactId: 'racine', spec: TABLEAU }))
    expect(e.code).toBe('conflit')
    expect(db.assistantArtefact.create).toHaveBeenCalledTimes(3)
  })

  it('ne masque pas une autre erreur de la base', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValue(derniere())
    db.assistantArtefact.create.mockRejectedValue(new Error('connexion perdue'))
    await expect(
      modifierArtefact(CONTEXTE, { artefactId: 'racine', spec: TABLEAU })
    ).rejects.toThrow('connexion perdue')
    expect(db.assistantArtefact.create).toHaveBeenCalledTimes(1)
  })

  it("refuse le jeu d'un autre utilisateur", async () => {
    db.assistantArtefact.findFirst.mockResolvedValueOnce({ racineId: 'racine' })
    db.assistantJeuDeDonnees.findMany.mockResolvedValue([])
    const e = await erreurDe(modifierArtefact(CONTEXTE, { artefactId: 'racine', spec: TABLEAU }))
    expect(e.code).toBe('jeu_inaccessible')
  })
})

describe('modifierArtefactParUtilisateur', () => {
  const derniere = {
    version: 3,
    conversationId: 'c1',
    description: null,
    enregistre: false,
    enregistreA: null,
  }

  it("ecrit une version d'auteur utilisateur", async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce(derniere)
    const sortie = await modifierArtefactParUtilisateur(CONTEXTE, 'racine', {
      spec: TABLEAU,
      versionAttendue: 3,
    })
    expect(sortie.version).toBe(4)
    expect(db.assistantArtefact.create.mock.calls[0][0].data.auteur).toBe('utilisateur')
  })

  it('renvoie un conflit si versionAttendue est perimee', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce(derniere)
    const e = await erreurDe(
      modifierArtefactParUtilisateur(CONTEXTE, 'racine', { spec: TABLEAU, versionAttendue: 2 })
    )
    expect(e.code).toBe('conflit')
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('restaure une version : nouvelle version recopiant la specification demandee', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce({ spec: TABLEAU })
      .mockResolvedValueOnce(derniere)
    const sortie = await modifierArtefactParUtilisateur(CONTEXTE, 'racine', { restaurerVersion: 1 })
    expect(db.assistantArtefact.findFirst.mock.calls[1][0].where).toEqual({
      racineId: 'racine',
      userId: 'u1',
      version: 1,
    })
    const { data } = db.assistantArtefact.create.mock.calls[0][0]
    expect(data).toMatchObject({ version: 4, type: 'tableau', auteur: 'utilisateur' })
    expect(data.spec).toEqual(TABLEAU)
    expect(sortie.version).toBe(4)
  })

  it('renvoie introuvable pour une version a restaurer inexistante', async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce({ racineId: 'racine' })
      .mockResolvedValueOnce(null)
    const e = await erreurDe(
      modifierArtefactParUtilisateur(CONTEXTE, 'racine', { restaurerVersion: 9 })
    )
    expect(e.code).toBe('introuvable')
  })

  it("renvoie interdit au lecteur qui voit l'artefact sans le posseder", async () => {
    db.assistantArtefact.findFirst
      .mockResolvedValueOnce(null) // pas proprietaire
      .mockResolvedValueOnce({ id: 'a', userId: 'autre', racineId: 'a', conversationId: null })
    db.assistantPartage.findMany.mockResolvedValue([{ ressourceId: 'a' }])
    db.assistantEpingle.findMany.mockResolvedValue([])
    const e = await erreurDe(modifierArtefactParUtilisateur(CONTEXTE, 'a', { spec: TABLEAU }))
    expect(e.code).toBe('interdit')
    expect(db.assistantArtefact.create).not.toHaveBeenCalled()
  })

  it('renvoie introuvable quand le lecteur ne voit rien', async () => {
    db.assistantArtefact.findFirst.mockResolvedValue(null)
    db.assistantPartage.findMany.mockResolvedValue([])
    db.assistantEpingle.findMany.mockResolvedValue([])
    const e = await erreurDe(modifierArtefactParUtilisateur(CONTEXTE, 'a', { spec: TABLEAU }))
    expect(e.code).toBe('introuvable')
  })
})

