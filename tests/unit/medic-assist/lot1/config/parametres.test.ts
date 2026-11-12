import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  parametreApplication: { findMany: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ prisma: db, default: db }))

import {
  ErreurConfigMedicAssist,
  ecrireConfigMedicAssist,
  fournisseursDisponibles,
  fournisseursTranscriptionDisponibles,
  lireConfigMedicAssist,
  lireTranscription,
} from '@/lib/medic-assist/config/parametres'
import { fournisseurDisponible } from '@/lib/medic-assist/config/fournisseurs'
import type { ConfigAdminCorps, ContexteExecution } from '@/lib/medic-assist/contrats'

const CLE_SECRETE = 'sk-ZZMA1-secret-ne-doit-jamais-sortir'
const ENV_CLAUDE = { ANTHROPIC_API_KEY: CLE_SECRETE }
const ENV_TOUT = {
  ANTHROPIC_API_KEY: CLE_SECRETE,
  OPENAI_API_KEY: CLE_SECRETE,
  GOOGLE_GENERATIVE_AI_API_KEY: CLE_SECRETE,
  DEEPSEEK_API_KEY: CLE_SECRETE,
}
const CONTEXTE = { userId: 'user-1' } as ContexteExecution

function lignes(valeurs: Record<string, string>) {
  db.parametreApplication.findMany.mockResolvedValue(
    Object.entries(valeurs).map(([cle, valeur]) => ({ cle, valeur }))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  db.parametreApplication.findMany.mockResolvedValue([])
  db.parametreApplication.upsert.mockImplementation((arg: unknown) => ({ upsert: arg }))
  db.$transaction.mockResolvedValue([])
})

describe('fournisseurDisponible / fournisseursDisponibles', () => {
  it('exige une cle presente et non vide', () => {
    expect(fournisseurDisponible('openai', {})).toBe(false)
    expect(fournisseurDisponible('openai', { OPENAI_API_KEY: '' })).toBe(false)
    expect(fournisseurDisponible('openai', { OPENAI_API_KEY: '   ' })).toBe(false)
    expect(fournisseurDisponible('openai', { OPENAI_API_KEY: 'x' })).toBe(true)
  })

  it('liste les fournisseurs avec cle, sous forme de noms seulement', () => {
    const liste = fournisseursDisponibles({ ...ENV_CLAUDE, DEEPSEEK_API_KEY: 'k' })
    expect(liste).toEqual(['anthropic', 'deepseek'])
    expect(JSON.stringify(liste)).not.toContain(CLE_SECRETE)
  })

  it('liste les fournisseurs de transcription (openai, google) avec cle', () => {
    expect(fournisseursTranscriptionDisponibles(ENV_CLAUDE)).toEqual([])
    expect(fournisseursTranscriptionDisponibles(ENV_TOUT)).toEqual(['openai', 'google'])
    expect(fournisseursTranscriptionDisponibles({ GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toEqual([
      'google',
    ])
  })
})

describe('lireTranscription', () => {
  it('relit le JSON enregistre', () => {
    expect(lireTranscription('{"fournisseur":"openai","modele":"gpt-4o-mini-transcribe"}')).toEqual(
      { fournisseur: 'openai', modele: 'gpt-4o-mini-transcribe' }
    )
  })

  it.each([
    ['absent', undefined],
    ['vide', ''],
    ['blanc', '   '],
    ['ancienne chaine simple', 'whisper-x'],
    ['JSON invalide', '{"fournisseur":'],
    ['fournisseur non transcripteur', '{"fournisseur":"anthropic","modele":"m"}'],
    ['modele manquant', '{"fournisseur":"openai"}'],
    ['modele avec espace', '{"fournisseur":"openai","modele":"a b"}'],
    ['pas un objet', '42'],
    ['null', 'null'],
  ])('lecture tolerante : %s donne null', (_nom, brut) => {
    expect(lireTranscription(brut)).toBeNull()
  })
})

describe('lireConfigMedicAssist', () => {
  it('renvoie les defauts Claude sans parametre', async () => {
    const config = await lireConfigMedicAssist(ENV_CLAUDE)
    expect(config).toEqual({
      fournisseur: 'anthropic',
      modeles: {
        standard: 'claude-sonnet-5-5',
        profond: 'claude-opus-5-5',
        rapide: 'claude-haiku-5-5',
      },
      transcription: null,
      repliSurClaude: false,
      fournisseurDemande: 'anthropic',
    })
  })

  it('lit les valeurs enregistrees, transcription JSON comprise', async () => {
    lignes({
      'medic_assist.fournisseur': 'openai',
      'medic_assist.modele.standard': 'gpt-6.1-terra',
      'medic_assist.transcription': '{"fournisseur":"google","modele":"chirp-x"}',
    })
    const config = await lireConfigMedicAssist(ENV_TOUT)
    expect(config.fournisseur).toBe('openai')
    expect(config.modeles.standard).toBe('gpt-6.1-terra')
    // modele non renseigne = defaut du fournisseur
    expect(config.modeles.profond).toBe('gpt-6-astra')
    expect(config.modeles.rapide).toBe('gpt-6-luna')
    expect(config.transcription).toEqual({ fournisseur: 'google', modele: 'chirp-x' })
    expect(config.repliSurClaude).toBe(false)
  })

  it('une transcription illisible donne null', async () => {
    lignes({ 'medic_assist.transcription': 'whisper-x' })
    expect((await lireConfigMedicAssist(ENV_CLAUDE)).transcription).toBeNull()
  })

  it('traite un modele vide ou illisible comme le defaut', async () => {
    lignes({
      'medic_assist.fournisseur': 'deepseek',
      'medic_assist.modele.standard': '',
      'medic_assist.modele.profond': 'a b',
      'medic_assist.modele.rapide': 'x'.repeat(101),
    })
    const config = await lireConfigMedicAssist(ENV_TOUT)
    expect(config.modeles).toEqual({
      standard: 'deepseek-flash',
      profond: 'deepseek-v4-pro',
      rapide: 'deepseek-flash',
    })
  })

  it('retombe sur Claude si le fournisseur est inconnu', async () => {
    lignes({ 'medic_assist.fournisseur': 'mistral' })
    const config = await lireConfigMedicAssist(ENV_CLAUDE)
    expect(config.fournisseur).toBe('anthropic')
    expect(config.repliSurClaude).toBe(false)
  })

  it('replie sur Claude et ses modeles par defaut si la cle du fournisseur a disparu', async () => {
    lignes({
      'medic_assist.fournisseur': 'openai',
      'medic_assist.modele.standard': 'gpt-6.1-terra',
    })
    const config = await lireConfigMedicAssist(ENV_CLAUDE)
    expect(config.fournisseur).toBe('anthropic')
    expect(config.modeles.standard).toBe('claude-sonnet-5-5')
    expect(config.repliSurClaude).toBe(true)
    expect(config.fournisseurDemande).toBe('openai')
  })

  it('garde le fournisseur configure si Claude n a pas de cle non plus', async () => {
    lignes({ 'medic_assist.fournisseur': 'google' })
    const config = await lireConfigMedicAssist({})
    expect(config.fournisseur).toBe('google')
    expect(config.repliSurClaude).toBe(false)
  })

  it('ne laisse jamais fuiter la valeur d une cle', async () => {
    lignes({ 'medic_assist.fournisseur': 'openai' })
    const config = await lireConfigMedicAssist(ENV_CLAUDE)
    expect(JSON.stringify(config)).not.toContain(CLE_SECRETE)
  })
})

describe('ecrireConfigMedicAssist', () => {
  const valide: ConfigAdminCorps = {
    fournisseur: 'openai',
    modeles: { standard: 'gpt-6.1-sol', profond: 'gpt-6-astra', rapide: 'gpt-6-luna' },
    transcription: null,
  }

  function valeurEcrite(cle: string): string {
    const appel = db.parametreApplication.upsert.mock.calls.find(c => c[0].where.cle === cle)
    return appel?.[0].update.valeur
  }

  it('enregistre les 5 cles dans une transaction avec updatedBy = contexte.userId', async () => {
    const resultat = await ecrireConfigMedicAssist(CONTEXTE, valide, ENV_TOUT)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.parametreApplication.upsert).toHaveBeenCalledTimes(5)
    const appels = db.parametreApplication.upsert.mock.calls.map(c => c[0])
    expect(appels.map(a => a.where.cle).sort()).toEqual([
      'medic_assist.fournisseur',
      'medic_assist.modele.profond',
      'medic_assist.modele.rapide',
      'medic_assist.modele.standard',
      'medic_assist.transcription',
    ])
    for (const a of appels) {
      expect(a.create.updatedBy).toBe('user-1')
      expect(a.update.updatedBy).toBe('user-1')
    }
    expect(valeurEcrite('medic_assist.fournisseur')).toBe('openai')
    expect(valeurEcrite('medic_assist.transcription')).toBe('')
    expect(resultat).toEqual(valide)
    expect(JSON.stringify(appels)).not.toContain(CLE_SECRETE)
  })

  it('ecrit la transcription en JSON et la renvoie', async () => {
    const config: ConfigAdminCorps = {
      ...valide,
      transcription: { fournisseur: 'openai', modele: 'gpt-4o-mini-transcribe' },
    }
    const resultat = await ecrireConfigMedicAssist(CONTEXTE, config, ENV_TOUT)
    expect(JSON.parse(valeurEcrite('medic_assist.transcription'))).toEqual({
      fournisseur: 'openai',
      modele: 'gpt-4o-mini-transcribe',
    })
    expect(resultat.transcription).toEqual(config.transcription)
  })

  it('refuse un fournisseur de transcription sans cle', async () => {
    const config: ConfigAdminCorps = {
      ...valide,
      transcription: { fournisseur: 'google', modele: 'chirp-x' },
    }
    await expect(
      ecrireConfigMedicAssist(CONTEXTE, config, { OPENAI_API_KEY: 'k' })
    ).rejects.toMatchObject({ code: 'transcription_indisponible' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuse un fournisseur de transcription inconnu', async () => {
    const config = {
      ...valide,
      transcription: { fournisseur: 'anthropic', modele: 'm' },
    } as unknown as ConfigAdminCorps
    await expect(ecrireConfigMedicAssist(CONTEXTE, config, ENV_TOUT)).rejects.toMatchObject({
      code: 'fournisseur_inconnu',
    })
  })

  it('refuse un fournisseur sans cle d environnement', async () => {
    await expect(ecrireConfigMedicAssist(CONTEXTE, valide, ENV_CLAUDE)).rejects.toMatchObject({
      name: 'ErreurConfigMedicAssist',
      code: 'fournisseur_indisponible',
    })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuse un fournisseur inconnu', async () => {
    const config = { ...valide, fournisseur: 'mistral' } as unknown as ConfigAdminCorps
    await expect(ecrireConfigMedicAssist(CONTEXTE, config, ENV_TOUT)).rejects.toMatchObject({
      code: 'fournisseur_inconnu',
    })
  })

  it.each([
    ['vide', ''],
    ['avec espace', 'gpt 6'],
    ['trop long', 'x'.repeat(101)],
  ])('refuse un modele %s', async (_nom, modele) => {
    const config = { ...valide, modeles: { ...valide.modeles, rapide: modele } }
    const promesse = ecrireConfigMedicAssist(CONTEXTE, config, ENV_TOUT)
    await expect(promesse).rejects.toBeInstanceOf(ErreurConfigMedicAssist)
    await expect(promesse).rejects.toMatchObject({ code: 'modele_invalide' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuse un modele de transcription invalide', async () => {
    const config: ConfigAdminCorps = {
      ...valide,
      transcription: { fournisseur: 'openai', modele: 'a b' },
    }
    await expect(ecrireConfigMedicAssist(CONTEXTE, config, ENV_TOUT)).rejects.toMatchObject({
      code: 'modele_invalide',
    })
  })

  it('le message d erreur ne contient pas la cle', async () => {
    const erreur = await ecrireConfigMedicAssist(CONTEXTE, valide, {
      ANTHROPIC_API_KEY: CLE_SECRETE,
    }).catch(e => e as Error)
    expect(erreur.message).not.toContain(CLE_SECRETE)
  })
})
