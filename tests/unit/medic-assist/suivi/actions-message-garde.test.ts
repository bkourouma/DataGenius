import { describe, expect, it, vi } from 'vitest'

import { proposerAction } from '@/lib/medic-assist/suivi/actions'
import { ErreurSuivi } from '@/lib/medic-assist/suivi/erreurs'

// validerParametres tourne AVANT toute lecture du depot : un depot factice suffit.
const depot = { creerAction: vi.fn() } as never
const contexte = { userId: 'u', conversationId: 'c', locale: 'fr', scope: {} } as never

describe('proposerAction : message e-mail trop long', () => {
  it.each([2001, 6000])('refuse un message de %i caractères sans rien enregistrer', async n => {
    const promesse = proposerAction(
      contexte,
      {
        type: 'envoyer_email',
        parametres: {
          artefactId: 'a1',
          destinataires: ['u1'],
          formats: ['pdf'],
          message: 'x'.repeat(n),
        },
      } as never,
      { depot }
    )
    await expect(promesse).rejects.toBeInstanceOf(ErreurSuivi)
    await expect(promesse).rejects.toMatchObject({ code: 'invalide' })
    expect((depot as { creerAction: ReturnType<typeof vi.fn> }).creerAction).not.toHaveBeenCalled()
  })
})
