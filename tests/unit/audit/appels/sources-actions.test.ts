import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  audit: vi.fn(), garde: vi.fn(),
  ajouterSource: vi.fn(), ajouterSourceMySql: vi.fn(), ajouterSourceRest: vi.fn(), ajouterSourceFichier: vi.fn(),
  remplacerSourceFichier: vi.fn(), chargerConnexionSource: vi.fn(), modifierSource: vi.fn(), supprimerSource: vi.fn(),
  synchroniser: vi.fn(), dernierCode: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' + url }) },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (cle: string) => cle }))
vi.mock('@/lib/audit/session', () => ({ enregistrerAuditSession: m.audit }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn() } }))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: m.garde }))
vi.mock('@/lib/warehouse/synchronisation', () => ({ synchroniserEntrepot: m.synchroniser }))
vi.mock('@/lib/warehouse/jeux-admin', () => ({ dernierCodeExecution: m.dernierCode }))
vi.mock('@/lib/warehouse/connecteurs/fichier', () => ({ MAX_FICHIER: 1_000_000 }))
vi.mock('@/app/(dashboard)/sources/erreurs-lib', () => ({ messageErreurLib: async (x: string) => x }))
vi.mock('@/app/(dashboard)/sources/retour-synchro', () => ({ retourSynchroTraduit: () => ({ succes: 'ok' }) }))
vi.mock('@/lib/warehouse/sources-admin', () => {
  class ErreurAdministrationSource extends Error {}
  return {
    ErreurAdministrationSource,
    ajouterSource: m.ajouterSource, ajouterSourceMySql: m.ajouterSourceMySql, ajouterSourceRest: m.ajouterSourceRest,
    ajouterSourceFichier: m.ajouterSourceFichier, remplacerSourceFichier: m.remplacerSourceFichier,
    creerImport: vi.fn(), modifierFrequence: vi.fn(), chargerConnexionSource: m.chargerConnexionSource,
    modifierSource: m.modifierSource, supprimerSource: m.supprimerSource, renommerImport: vi.fn(), supprimerImport: vi.fn(),
  }
})

import {
  actualiserJeu, ajouterConnexion, ajouterConnexionRest, importerFichierSource, modifierConnexion, supprimerConnexion,
} from '@/app/(dashboard)/sources/actions'

const MOTEURS = ['postgresql', 'mysql', 'rest', 'fichier', 'connexion']

function form(valeurs: Record<string, string | File>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(valeurs)) f.set(k, v)
  return f
}

async function lancer<T>(p: Promise<T>): Promise<T | 'redirect'> {
  try { return await p } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') return 'redirect'
    throw e
  }
}

const ordre = (f: ReturnType<typeof vi.fn>) => f.mock.invocationCallOrder[0]!
// jsdom ne fournit pas File.arrayBuffer : on l'ajoute sur l'instance.
const fichier = () => {
  const f = new File([new Uint8Array([1, 2, 3])], 'donnees.csv', { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  return f
}

beforeEach(() => {
  vi.resetAllMocks()
  m.garde.mockResolvedValue({ ok: true, contexte: { userId: 'admin-1' } })
  m.audit.mockResolvedValue(undefined)
})

describe('ajouterConnexion', () => {
  it.each([['postgresql', undefined], ['mysql', 'mysql']])('moteur %s : un appel après la création', async (moteur, champ) => {
    m.ajouterSource.mockResolvedValue('src1')
    m.ajouterSourceMySql.mockResolvedValue('src1')
    const f = form({ titre: 'Ma base', ...(champ ? { moteur: champ } : {}) })
    expect(await lancer(ajouterConnexion({}, f))).toBe('redirect')
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'source.creation', cible: { type: 'source', id: 'src1', libelle: 'Ma base' }, details: { moteur },
    }))
    const metier = champ ? m.ajouterSourceMySql : m.ajouterSource
    expect(ordre(metier)).toBeLessThan(ordre(m.audit))
  })

  it('moteur forgé : reste dans la liste fermée', async () => {
    m.ajouterSource.mockResolvedValue('src1')
    await lancer(ajouterConnexion({}, form({ titre: 't', moteur: 'x<script>' })))
    const { details } = m.audit.mock.calls[0]![0]
    expect(MOTEURS).toContain(details.moteur)
  })

  it('échec métier : aucun appel', async () => {
    m.ajouterSource.mockRejectedValue(new Error('boom'))
    expect(await ajouterConnexion({}, form({ titre: 't' }))).toEqual({ erreur: 'connexionImpossible' })
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('non-admin : aucun appel', async () => {
    m.garde.mockResolvedValue({ ok: false })
    await ajouterConnexion({}, form({ titre: 't' }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})

describe('ajouterConnexionRest', () => {
  it('succès : un appel rest après la création', async () => {
    m.ajouterSourceRest.mockResolvedValue('r1')
    expect(await lancer(ajouterConnexionRest({}, form({ titre: 'API', moteur: 'x<script>' })))).toBe('redirect')
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'source.creation', cible: { type: 'source', id: 'r1', libelle: 'API' }, details: { moteur: 'rest' },
    }))
    expect(ordre(m.ajouterSourceRest)).toBeLessThan(ordre(m.audit))
  })

  it('échec métier et non-admin : aucun appel', async () => {
    m.ajouterSourceRest.mockRejectedValue(new Error('boom'))
    await ajouterConnexionRest({}, form({ titre: 'API' }))
    m.garde.mockResolvedValue({ ok: false })
    await ajouterConnexionRest({}, form({ titre: 'API' }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})

describe('importerFichierSource', () => {
  it('création : source.creation moteur fichier, après l’import', async () => {
    m.ajouterSourceFichier.mockResolvedValue('f1')
    expect(await lancer(importerFichierSource({}, form({ titre: 'Fichier', fichier: fichier(), moteur: 'x<script>' })))).toBe('redirect')
    expect(m.audit).toHaveBeenCalledTimes(1)
    const arg = m.audit.mock.calls[0]![0]
    expect(arg).toMatchObject({ action: 'source.creation', cible: { type: 'source', id: 'f1', libelle: 'Fichier' }, details: { moteur: 'fichier' } })
    expect(ordre(m.ajouterSourceFichier)).toBeLessThan(ordre(m.audit))
  })

  it('remplacement : source.modification sur la source existante', async () => {
    m.remplacerSourceFichier.mockResolvedValue(undefined)
    const etat = await importerFichierSource({}, form({ sourceId: 'f9', fichier: fichier() }))
    expect(etat).toEqual({ succes: 'fichierRemplace' })
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls[0]![0]).toMatchObject({ action: 'source.modification', cible: { type: 'source', id: 'f9' }, details: { moteur: 'fichier' } })
    expect(ordre(m.remplacerSourceFichier)).toBeLessThan(ordre(m.audit))
  })

  it('échec métier, fichier invalide et non-admin : aucun appel', async () => {
    m.ajouterSourceFichier.mockRejectedValue(new Error('boom'))
    m.remplacerSourceFichier.mockRejectedValue(new Error('boom'))
    await importerFichierSource({}, form({ titre: 'x', fichier: fichier() }))
    await importerFichierSource({}, form({ sourceId: 'f9', fichier: fichier() }))
    await importerFichierSource({}, form({ titre: 'x' }))
    m.garde.mockResolvedValue({ ok: false })
    await importerFichierSource({}, form({ titre: 'x', fichier: fichier() }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})

describe('modifierConnexion', () => {
  it('succès : source.modification moteur connexion après modifierSource', async () => {
    m.chargerConnexionSource.mockResolvedValue({ type: 'postgresql' })
    m.modifierSource.mockResolvedValue(undefined)
    expect(await modifierConnexion({}, form({ sourceId: 's1', titre: 't', moteur: 'x<script>' }))).toEqual({ succes: 'connexionModifiee' })
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'source.modification', cible: { type: 'source', id: 's1' }, details: { moteur: 'connexion' } }))
    expect(ordre(m.modifierSource)).toBeLessThan(ordre(m.audit))
  })

  it('échec métier, source introuvable et non-admin : aucun appel', async () => {
    m.chargerConnexionSource.mockResolvedValue({ type: 'rest' })
    m.modifierSource.mockRejectedValue(new Error('boom'))
    await modifierConnexion({}, form({ sourceId: 's1' }))
    m.chargerConnexionSource.mockResolvedValue(null)
    await modifierConnexion({}, form({ sourceId: 's1' }))
    m.garde.mockResolvedValue({ ok: false })
    await modifierConnexion({}, form({ sourceId: 's1' }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})

describe('supprimerConnexion', () => {
  it('succès : source.suppression après supprimerSource', async () => {
    m.supprimerSource.mockResolvedValue(undefined)
    expect(await lancer(supprimerConnexion({}, form({ sourceId: 's1', confirmation: 'on' })))).toBe('redirect')
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith({ action: 'source.suppression', cible: { type: 'source', id: 's1' } })
    expect(ordre(m.supprimerSource)).toBeLessThan(ordre(m.audit))
  })

  it('échec, sans confirmation et non-admin : aucun appel', async () => {
    m.supprimerSource.mockRejectedValue(new Error('boom'))
    await supprimerConnexion({}, form({ sourceId: 's1', confirmation: 'on' }))
    await supprimerConnexion({}, form({ sourceId: 's1' }))
    m.garde.mockResolvedValue({ ok: false })
    await supprimerConnexion({}, form({ sourceId: 's1', confirmation: 'on' }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})

describe('actualiserJeu', () => {
  it('succès : source.synchronisation resultat succes après la synchro', async () => {
    m.synchroniser.mockResolvedValue([{ jeu: 'ventes', statut: 'ok' }])
    await actualiserJeu({}, form({ jeu: 'ventes' }))
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'source.synchronisation', cible: { type: 'jeu', id: 'ventes' }, resultat: 'succes' }))
    expect(ordre(m.synchroniser)).toBeLessThan(ordre(m.audit))
  })

  it('statut echec : resultat echec', async () => {
    m.synchroniser.mockResolvedValue([{ jeu: 'ventes', statut: 'echec', code: 'x' }])
    await actualiserJeu({}, form({ jeu: 'ventes' }))
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls[0]![0].resultat).toBe('echec')
  })

  it('la synchro lève, jeu invalide, résultat vide, non-admin : aucun appel', async () => {
    m.synchroniser.mockRejectedValueOnce(new Error('boom'))
    await actualiserJeu({}, form({ jeu: 'ventes' }))
    await actualiserJeu({}, form({ jeu: 'Pas valide!' }))
    m.synchroniser.mockResolvedValueOnce([])
    await actualiserJeu({}, form({ jeu: 'ventes' }))
    m.garde.mockResolvedValue({ ok: false })
    await actualiserJeu({}, form({ jeu: 'ventes' }))
    expect(m.audit).not.toHaveBeenCalled()
  })
})
