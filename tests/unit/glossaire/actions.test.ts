import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exigerMedicAssist, enregistrerComplementGlossaire, revalidatePath, erreur } = vi.hoisted(() => ({
  exigerMedicAssist: vi.fn(),
  enregistrerComplementGlossaire: vi.fn(),
  revalidatePath: vi.fn(),
  erreur: vi.fn(),
}))

vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/journal', () => ({ journal: { info: vi.fn(), avertissement: vi.fn(), erreur } }))
vi.mock('@/lib/glossaire/complement', async () => {
  const reel = await vi.importActual<typeof import('@/lib/glossaire/complement')>('@/lib/glossaire/complement')
  return { ErreurGlossaire: reel.ErreurGlossaire, enregistrerComplementGlossaire }
})

import { enregistrerComplement } from '@/app/(dashboard)/glossaire/actions'
import { ErreurGlossaire } from '@/lib/glossaire/complement'

function formulaire(valeurs: Record<string, string> = {}) {
  const f = new FormData()
  const base = { jeu: 'ventes', indicateur: 'total', definition: 'Une définition', synonymes: 'a\n\n  b  \r\nc', ...valeurs }
  for (const [cle, valeur] of Object.entries(base)) f.set(cle, valeur)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  exigerMedicAssist.mockResolvedValue({ ok: true, contexte: { userId: 'u1', roleName: 'TenantAdmin' } })
})

describe('action enregistrerComplement du glossaire', () => {
  it('session absente : code session sans appeler le service', async () => {
    exigerMedicAssist.mockResolvedValue({ ok: false })
    expect(await enregistrerComplement({}, formulaire())).toEqual({ erreur: 'session' })
    expect(enregistrerComplementGlossaire).not.toHaveBeenCalled()
  })

  it('champ manquant : invalide', async () => {
    const f = formulaire()
    f.delete('definition')
    expect(await enregistrerComplement({}, f)).toEqual({ erreur: 'invalide' })
    expect(enregistrerComplementGlossaire).not.toHaveBeenCalled()
  })

  it('rôle Member : le refus du service (interdit) est renvoyé tel quel', async () => {
    exigerMedicAssist.mockResolvedValue({ ok: true, contexte: { userId: 'u2', roleName: 'Member' } })
    enregistrerComplementGlossaire.mockRejectedValue(new ErreurGlossaire('interdit'))
    expect(await enregistrerComplement({}, formulaire())).toEqual({ erreur: 'interdit' })
    expect(erreur).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('TenantAdmin : succès, synonymes nettoyés, page revalidée', async () => {
    enregistrerComplementGlossaire.mockResolvedValue(undefined)
    expect(await enregistrerComplement({}, formulaire())).toEqual({ succes: true })
    expect(enregistrerComplementGlossaire).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: 'TenantAdmin' }),
      { jeu: 'ventes', indicateur: 'total', definition: 'Une définition', synonymes: ['a', 'b', 'c'] },
    )
    expect(revalidatePath).toHaveBeenCalledWith('/glossaire')
  })

  it('erreur inattendue : echec, journalisée par son nom seulement', async () => {
    class PanneBase extends Error {
      constructor() {
        super('détail confidentiel')
        this.name = 'PanneBase'
      }
    }
    enregistrerComplementGlossaire.mockRejectedValue(new PanneBase())
    expect(await enregistrerComplement({}, formulaire())).toEqual({ erreur: 'echec' })
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(erreur.mock.calls[0]![1]).toEqual({ domaine: 'glossaire', erreur: 'PanneBase' })
    expect(JSON.stringify(erreur.mock.calls)).not.toContain('confidentiel')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
