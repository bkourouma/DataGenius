import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exigerMedicAssist, listerCommentaires, erreur } = vi.hoisted(() => ({
  exigerMedicAssist: vi.fn(),
  listerCommentaires: vi.fn(),
  erreur: vi.fn(),
}))

vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist }))
vi.mock('@/lib/journal', () => ({ journal: { info: vi.fn(), avertissement: vi.fn(), erreur } }))
vi.mock('@/components/commentaires/commentaires-client', () => ({ CommentairesClient: () => null }))
vi.mock('@/lib/commentaires/commentaires', async () => {
  const reel = await vi.importActual<typeof import('@/lib/commentaires/commentaires')>('@/lib/commentaires/commentaires')
  return { ErreurCommentaire: reel.ErreurCommentaire, listerCommentaires }
})

import { CommentairesAnalyse } from '@/components/commentaires/commentaires-analyse'
import { ErreurCommentaire } from '@/lib/commentaires/commentaires'

beforeEach(() => {
  vi.clearAllMocks()
  exigerMedicAssist.mockResolvedValue({ ok: true, contexte: { userId: 'u1' } })
})

describe('CommentairesAnalyse (composant serveur)', () => {
  it('session absente : rien n’est rendu et le service n’est pas appelé', async () => {
    exigerMedicAssist.mockResolvedValue({ ok: false })
    expect(await CommentairesAnalyse({ artefactId: 'a1' })).toBeNull()
    expect(listerCommentaires).not.toHaveBeenCalled()
  })

  it('analyse introuvable : null sans journal', async () => {
    listerCommentaires.mockRejectedValue(new ErreurCommentaire('introuvable'))
    expect(await CommentairesAnalyse({ artefactId: 'a1' })).toBeNull()
    expect(erreur).not.toHaveBeenCalled()
  })

  it('autre ErreurCommentaire ou erreur inattendue : null et journal par le nom seul', async () => {
    class PanneLecture extends Error {
      constructor() {
        super('détail confidentiel')
        this.name = 'PanneLecture'
      }
    }
    listerCommentaires.mockRejectedValue(new PanneLecture())
    expect(await CommentairesAnalyse({ artefactId: 'a1' })).toBeNull()
    expect(erreur).toHaveBeenCalledTimes(1)
    expect(erreur.mock.calls[0]![1]).toEqual({ domaine: 'commentaires', erreur: 'PanneLecture' })
    expect(JSON.stringify(erreur.mock.calls)).not.toContain('confidentiel')

    listerCommentaires.mockRejectedValue(new ErreurCommentaire('interdit'))
    expect(await CommentairesAnalyse({ artefactId: 'a1' })).toBeNull()
    expect(erreur).toHaveBeenCalledTimes(2)
  })

  it('succès : rend le composant client', async () => {
    listerCommentaires.mockResolvedValue([])
    const element = await CommentairesAnalyse({ artefactId: 'a1' })
    expect(element).not.toBeNull()
    expect(element!.props).toMatchObject({ artefactId: 'a1', commentaires: [] })
  })
})
