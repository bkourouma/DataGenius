import { afterEach, describe, expect, it } from 'vitest'

import { LimiteurDebit } from '@/lib/medic-assist/donnees/limite-debit'
import {
  LIMITE_TRANSCRIPTIONS,
  limiteurTranscription,
  reinitialiserLimiteurTranscription,
} from '@/lib/medic-assist/transcription/limite'

afterEach(() => reinitialiserLimiteurTranscription())

describe('limite de transcription', () => {
  it('vaut 20 dictées par 10 minutes', () => {
    expect(LIMITE_TRANSCRIPTIONS).toEqual({ max: 20, fenetreMs: 600_000 })
  })

  it('est une instance unique par processus', () => {
    expect(limiteurTranscription()).toBe(limiteurTranscription())
  })

  it('refuse la 21e dictée, sans toucher un autre utilisateur', () => {
    const limiteur = limiteurTranscription()
    for (let i = 0; i < 20; i += 1) expect(limiteur.consommer('u1').accepte).toBe(true)
    const refus = limiteur.consommer('u1')
    expect(refus.accepte).toBe(false)
    if (!refus.accepte) expect(refus.reessayerDansMs).toBeGreaterThan(0)
    expect(limiteur.consommer('u2').accepte).toBe(true)
  })

  it("libère le crédit quand la fenêtre s'écoule", () => {
    let t = 0
    const limiteur = new LimiteurDebit(LIMITE_TRANSCRIPTIONS, () => t)
    for (let i = 0; i < 20; i += 1) limiteur.consommer('u1')
    expect(limiteur.consommer('u1').accepte).toBe(false)
    t = 10 * 60 * 1000 + 1
    expect(limiteur.consommer('u1').accepte).toBe(true)
  })
})
