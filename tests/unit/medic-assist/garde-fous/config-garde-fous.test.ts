import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  parametreApplication: { findMany: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ prisma: db, default: db }))

import {
  CLE_MODELE_SECOURS,
  CLE_PLAFOND_COUT_JOURNALIER,
  PLAFOND_COUT_DEFAUT_USD,
  ecrireGardeFous,
  lireModeleSecours,
  lirePlafondCout,
  validerGardeFous,
} from '@/lib/medic-assist/config/garde-fous'
import { lireConfigMedicAssist } from '@/lib/medic-assist/config/parametres'
import { ErreurConfigMedicAssist } from '@/lib/medic-assist/config/types'
import {
  codeErreurConfig,
  construireConfigAdminReponse,
  separerTaux,
} from '@/lib/medic-assist/admin/config-admin'
import { ConfigAdminCorpsLot6Schema, type ConfigAdminReponse } from '@/lib/medic-assist/admin/types'
import {
  brouillonDepuis,
  calculerMiseAJour,
  changerSecours,
  estModifie,
  lirePlafond,
} from '@/components/medic-assist/admin/config-brouillon'

const ENV_CLAUDE = { ANTHROPIC_API_KEY: 'k' }
const ENV_TOUT = { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', DEEPSEEK_API_KEY: 'k' }

function lignes(valeurs: Record<string, string>) {
  db.parametreApplication.findMany.mockResolvedValue(
    Object.entries(valeurs).map(([cle, valeur]) => ({ cle, valeur }))
  )
}

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return (e as ErreurConfigMedicAssist).code
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  db.parametreApplication.findMany.mockResolvedValue([])
  db.parametreApplication.upsert.mockImplementation((arg: unknown) => ({ upsert: arg }))
  db.$transaction.mockResolvedValue([])
})

describe('plafond de coût journalier : lecture', () => {
  it('vaut 10 USD par défaut', async () => {
    expect(PLAFOND_COUT_DEFAUT_USD).toBe(10)
    expect((await lireConfigMedicAssist(ENV_CLAUDE)).plafondCoutJournalierUsd).toBe(10)
  })

  it('conserve 0 (désactivé) et les valeurs valides', () => {
    expect(lirePlafondCout('0')).toBe(0)
    expect(lirePlafondCout('25.5')).toBe(25.5)
  })

  it.each([undefined, '', '  ', 'abc', '-1', 'Infinity', 'NaN'])(
    'valeur %j illisible -> défaut',
    brut => {
      expect(lirePlafondCout(brut)).toBe(10)
    }
  )

  it('lit la valeur enregistrée', async () => {
    lignes({ [CLE_PLAFOND_COUT_JOURNALIER]: '0' })
    expect((await lireConfigMedicAssist(ENV_CLAUDE)).plafondCoutJournalierUsd).toBe(0)
  })
})

describe('modèle de secours : lecture', () => {
  const valeur = JSON.stringify({ fournisseur: 'openai', modele: 'gpt-6.1-sol' })

  it.each([
    undefined,
    '',
    'pas du json',
    '{"fournisseur":"x","modele":"m"}',
    '{"fournisseur":"openai"}',
  ])('illisible %j -> null', brut => {
    expect(lireModeleSecours(brut)).toBeNull()
  })

  it('relit un secours valide', () => {
    expect(lireModeleSecours(valeur)).toEqual({ fournisseur: 'openai', modele: 'gpt-6.1-sol' })
  })

  it('config effective : secours conservé quand la clé existe', async () => {
    lignes({ [CLE_MODELE_SECOURS]: valeur })
    const config = await lireConfigMedicAssist(ENV_TOUT)
    expect(config.modeleSecours).toEqual({ fournisseur: 'openai', modele: 'gpt-6.1-sol' })
  })

  it('null si la clé du fournisseur de secours a disparu', async () => {
    lignes({ [CLE_MODELE_SECOURS]: valeur })
    expect((await lireConfigMedicAssist(ENV_CLAUDE)).modeleSecours).toBeNull()
  })

  it('null si identique au principal', async () => {
    lignes({
      'medic_assist.modele.standard': 'claude-sonnet-5-5',
      'medic_assist.modele.profond': 'claude-sonnet-5-5',
      'medic_assist.modele.rapide': 'claude-sonnet-5-5',
      [CLE_MODELE_SECOURS]: JSON.stringify({
        fournisseur: 'anthropic',
        modele: 'claude-sonnet-5-5',
      }),
    })
    expect((await lireConfigMedicAssist(ENV_TOUT)).modeleSecours).toBeNull()
  })

  it('reste renseigné si le secours diffère d’au moins un mode', async () => {
    lignes({
      [CLE_MODELE_SECOURS]: JSON.stringify({
        fournisseur: 'anthropic',
        modele: 'claude-haiku-5-5',
      }),
    })
    expect((await lireConfigMedicAssist(ENV_CLAUDE)).modeleSecours).toEqual({
      fournisseur: 'anthropic',
      modele: 'claude-haiku-5-5',
    })
  })

  it('repli sur Claude : champs présents, secours sans clé ignoré', async () => {
    lignes({
      'medic_assist.fournisseur': 'openai',
      [CLE_MODELE_SECOURS]: JSON.stringify({ fournisseur: 'deepseek', modele: 'deepseek-flash' }),
    })
    const config = await lireConfigMedicAssist(ENV_CLAUDE)
    expect(config.repliSurClaude).toBe(true)
    expect(config.plafondCoutJournalierUsd).toBe(10)
    expect(config.modeleSecours).toBeNull()
  })
})

describe('garde-fous : écriture validée', () => {
  const ecrire = (e: Parameters<typeof validerGardeFous>[0], env = ENV_TOUT) =>
    ecrireGardeFous('user-1', e, env)

  it("refuse un plafond positif sous 0,01 (l'arrondi le ferait passer à 0 = désactivé)", () => {
    expect(code(() => validerGardeFous({ plafondCoutJournalierUsd: 0.004 }))).toBe('plafond_invalide')
    expect(validerGardeFous({ plafondCoutJournalierUsd: 0.01 }).plafondCoutJournalierUsd).toBe(0.01)
  })

  it('refuse un plafond négatif, non fini ou trop grand', () => {
    expect(code(() => validerGardeFous({ plafondCoutJournalierUsd: -1 }))).toBe('plafond_invalide')
    expect(code(() => validerGardeFous({ plafondCoutJournalierUsd: Infinity }))).toBe(
      'plafond_invalide'
    )
    expect(code(() => validerGardeFous({ plafondCoutJournalierUsd: 10001 }))).toBe(
      'plafond_invalide'
    )
  })

  it('refuse un modèle de secours inconnu', () => {
    expect(
      code(() =>
        validerGardeFous(
          { modeleSecours: { fournisseur: 'openai', modele: 'gpt-fantome' } },
          ENV_TOUT
        )
      )
    ).toBe('modele_secours_inconnu')
  })

  it('refuse un identifiant mal formé et un fournisseur inconnu', () => {
    expect(
      code(() =>
        validerGardeFous({ modeleSecours: { fournisseur: 'openai', modele: 'a b' } }, ENV_TOUT)
      )
    ).toBe('modele_invalide')
    expect(
      code(() =>
        validerGardeFous(
          { modeleSecours: { fournisseur: 'zzz' as never, modele: 'm' } },
          ENV_TOUT
        )
      )
    ).toBe('fournisseur_inconnu')
  })

  it('refuse un secours dont la clé est absente', () => {
    expect(
      code(() =>
        validerGardeFous(
          { modeleSecours: { fournisseur: 'openai', modele: 'gpt-6.1-sol' } },
          ENV_CLAUDE
        )
      )
    ).toBe('fournisseur_indisponible')
  })

  it('arrondit à 2 décimales, accepte 0 et null', async () => {
    const r = await ecrire({ plafondCoutJournalierUsd: 7.456, modeleSecours: null })
    expect(r).toEqual({ plafondCoutJournalierUsd: 7.46, modeleSecours: null })
    const appels = db.parametreApplication.upsert.mock.calls.map(c => c[0])
    expect(appels.find(a => a.where.cle === CLE_PLAFOND_COUT_JOURNALIER).update.valeur).toBe('7.46')
    expect(appels.find(a => a.where.cle === CLE_MODELE_SECOURS).update.valeur).toBe('')
    expect(validerGardeFous({ plafondCoutJournalierUsd: 0 }).plafondCoutJournalierUsd).toBe(0)
  })

  it('enregistre un secours valide en JSON, rien si tout est absent', async () => {
    await ecrire({ modeleSecours: { fournisseur: 'openai', modele: 'gpt-6.1-sol' } })
    const appel = db.parametreApplication.upsert.mock.calls[0][0]
    expect(JSON.parse(appel.update.valeur)).toEqual({
      fournisseur: 'openai',
      modele: 'gpt-6.1-sol',
    })
    db.$transaction.mockClear()
    await ecrire({})
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it("n'écrit rien si la validation échoue", async () => {
    await expect(ecrire({ plafondCoutJournalierUsd: -5 })).rejects.toBeInstanceOf(
      ErreurConfigMedicAssist
    )
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('codes mappés vers une 400 par codeErreurConfig', () => {
    expect(codeErreurConfig({ code: 'plafond_invalide' })).toBe('validationInvalide')
    expect(codeErreurConfig({ code: 'modele_secours_inconnu' })).toBe('validationInvalide')
    expect(codeErreurConfig({ code: 'fournisseur_indisponible' })).toBe('fournisseurIndisponible')
  })
})

const CORPS_BASE = {
  fournisseur: 'anthropic',
  modeles: { standard: 'a', profond: 'b', rapide: 'c' },
  transcription: null,
} as const

describe('schéma du PUT', () => {
  it('champs absents = valides (inchangés)', () => {
    expect(ConfigAdminCorpsLot6Schema.safeParse(CORPS_BASE).success).toBe(true)
  })

  it('accepte plafond 0, secours objet ou null', () => {
    expect(
      ConfigAdminCorpsLot6Schema.safeParse({
        ...CORPS_BASE,
        plafondCoutJournalierUsd: 0,
        modeleSecours: null,
      }).success
    ).toBe(true)
    expect(
      ConfigAdminCorpsLot6Schema.safeParse({
        ...CORPS_BASE,
        modeleSecours: { fournisseur: 'openai', modele: 'gpt-6.1-sol' },
      }).success
    ).toBe(true)
  })

  it.each([-1, Infinity, 10001, '5', 0.004])('refuse le plafond %j', v => {
    expect(
      ConfigAdminCorpsLot6Schema.safeParse({ ...CORPS_BASE, plafondCoutJournalierUsd: v }).success
    ).toBe(false)
  })

  it('refuse un secours mal formé', () => {
    expect(
      ConfigAdminCorpsLot6Schema.safeParse({
        ...CORPS_BASE,
        modeleSecours: { fournisseur: 'zzz', modele: 'm' },
      }).success
    ).toBe(false)
  })

  it('separerTaux isole les garde-fous présents seulement', () => {
    const corps = ConfigAdminCorpsLot6Schema.parse({ ...CORPS_BASE, plafondCoutJournalierUsd: 3 })
    const { config, gardeFous } = separerTaux(corps)
    expect(gardeFous).toEqual({ plafondCoutJournalierUsd: 3 })
    expect(config).toEqual(CORPS_BASE)
  })
})

describe('réponse admin et brouillon', () => {
  const reponse: ConfigAdminReponse = construireConfigAdminReponse(
    {
      fournisseur: 'anthropic',
      modeles: {
        standard: 'claude-sonnet-5-5',
        profond: 'claude-opus-5-5',
        rapide: 'claude-haiku-5-5',
      },
      transcription: null,
      plafondCoutJournalierUsd: 10,
      modeleSecours: null,
    },
    null,
    { majA: null, majPar: null }
  )

  it('la réponse porte le plafond, son défaut et le secours', () => {
    expect(reponse.plafondCoutJournalierUsd).toBe(10)
    expect(reponse.plafondParDefaut).toBe(10)
    expect(reponse.modeleSecours).toBeNull()
  })

  it('brouillon : pas de modification au départ ; lecture du plafond', () => {
    const b = brouillonDepuis(reponse, 'fr-FR')
    expect(b.plafond).toBe('10')
    expect(estModifie(reponse, b, 'fr-FR')).toBe(false)
    expect(calculerMiseAJour(reponse, b)).toBeNull()
    expect(lirePlafond('0')).toBe(0)
    expect(lirePlafond('7,5')).toBe(7.5)
    expect(lirePlafond('-1')).toBeNull()
    expect(lirePlafond('abc')).toBeNull()
    expect(lirePlafond('10001')).toBeNull()
    expect(lirePlafond('0,004')).toBeNull()
    expect(lirePlafond('0,01')).toBe(0.01)
    expect(lirePlafond('0')).toBe(0)
  })

  it('brouillon : un plafond changé est envoyé, seul', () => {
    const b = { ...brouillonDepuis(reponse, 'fr-FR'), plafond: '0' }
    expect(estModifie(reponse, b, 'fr-FR')).toBe(true)
    expect(calculerMiseAJour(reponse, b)?.plafondCoutJournalierUsd).toBe(0)
    expect(calculerMiseAJour(reponse, b)).not.toHaveProperty('modeleSecours')
  })

  it('brouillon : plafond invalide -> pas de corps', () => {
    const b = { ...brouillonDepuis(reponse, 'fr-FR'), plafond: 'x' }
    expect(estModifie(reponse, b, 'fr-FR')).toBe(true)
    expect(calculerMiseAJour(reponse, b)).toBeNull()
  })

  it('brouillon : choix et retrait du secours', () => {
    const avecDefauts: ConfigAdminReponse = {
      ...reponse,
      modelesParDefaut: {
        ...reponse.modelesParDefaut,
        openai: { standard: 'gpt-6.1-sol', profond: null, rapide: null },
      },
    }
    const b1 = changerSecours(brouillonDepuis(avecDefauts, 'fr-FR'), avecDefauts, 'openai')
    expect(b1.modeleSecours).toEqual({ fournisseur: 'openai', modele: 'gpt-6.1-sol' })
    expect(calculerMiseAJour(avecDefauts, b1)?.modeleSecours).toEqual({
      fournisseur: 'openai',
      modele: 'gpt-6.1-sol',
    })
    const vide = { ...b1, modeleSecours: { fournisseur: 'openai' as const, modele: ' ' } }
    expect(calculerMiseAJour(avecDefauts, vide)).toBeNull()

    const avecSecours: ConfigAdminReponse = {
      ...avecDefauts,
      modeleSecours: { fournisseur: 'openai', modele: 'gpt-6.1-sol' },
    }
    const retire = changerSecours(brouillonDepuis(avecSecours, 'fr-FR'), avecSecours, null)
    expect(calculerMiseAJour(avecSecours, retire)?.modeleSecours).toBeNull()
  })
})
