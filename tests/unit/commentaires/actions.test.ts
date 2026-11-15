import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exigerMedicAssist, ajouterCommentaire, supprimerCommentaire, revalidatePath, erreur } = vi.hoisted(() => ({
  exigerMedicAssist: vi.fn(),
  ajouterCommentaire: vi.fn(),
  supprimerCommentaire: vi.fn(),
  revalidatePath: vi.fn(),
  erreur: vi.fn(),
}))

vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/lib/journal', () => ({ journal: { info: vi.fn(), avertissement: vi.fn(), erreur } }))
vi.mock('@/lib/commentaires/commentaires', async () => {
  const reel = await vi.importActual<typeof import('@/lib/commentaires/commentaires')>('@/lib/commentaires/commentaires')
  return { ErreurCommentaire: reel.ErreurCommentaire, ajouterCommentaire, supprimerCommentaire }
})

import { ajouter, supprimer } from '@/lib/commentaires/actions'
import { ErreurCommentaire } from '@/lib/commentaires/commentaires'

const contexte = { userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  exigerMedicAssist.mockResolvedValue({ ok: true, contexte })
})

describe('actions des commentaires', () => {
  it.each([
    ['ajouter', () => ajouter('a1', 'texte')],
    ['supprimer', () => supprimer('c1')],
  ])('%s : session absente renvoie introuvable sans appeler le service', async (_nom, appel) => {
    exigerMedicAssist.mockResolvedValue({ ok: false })
    expect(await appel()).toEqual({ erreur: 'introuvable' })
    expect(ajouterCommentaire).not.toHaveBeenCalled()
    expect(supprimerCommentaire).not.toHaveBeenCalled()
  })

  it('renvoie le code d’une ErreurCommentaire sans journaliser', async () => {
    ajouterCommentaire.mockRejectedValue(new ErreurCommentaire('limite_debit'))
    expect(await ajouter('a1', 'x')).toEqual({ erreur: 'limite_debit' })
    supprimerCommentaire.mockRejectedValue(new ErreurCommentaire('interdit'))
    expect(await supprimer('c1')).toEqual({ erreur: 'interdit' })
    expect(erreur).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('erreur inattendue : interne, journalisée par son nom seulement', async () => {
    class PanneBase extends Error {
      constructor() {
        super('mot de passe secret du serveur')
        this.name = 'PanneBase'
      }
    }
    ajouterCommentaire.mockRejectedValue(new PanneBase())
    expect(await ajouter('a1', 'x')).toEqual({ erreur: 'interne' })
    expect(erreur).toHaveBeenCalledTimes(1)
    const champs = erreur.mock.calls[0]![1] as Record<string, unknown>
    expect(champs).toEqual({ domaine: 'commentaires', action: 'ajouter', erreur: 'PanneBase' })
    expect(JSON.stringify(erreur.mock.calls)).not.toContain('secret')

    supprimerCommentaire.mockRejectedValue('chaîne brute')
    expect(await supprimer('c1')).toEqual({ erreur: 'interne' })
    expect(erreur.mock.calls[1]![1]).toEqual({ domaine: 'commentaires', action: 'supprimer', erreur: 'inconnue' })
  })

  it('succès : ok et revalidation de la page de l’analyse', async () => {
    ajouterCommentaire.mockResolvedValue({ id: 'c9' })
    expect(await ajouter('a1', 'bonjour')).toEqual({ ok: true })
    expect(ajouterCommentaire).toHaveBeenCalledWith(contexte, 'a1', 'bonjour')
    expect(revalidatePath).toHaveBeenCalledWith('/assistant/analyses/a1')

    supprimerCommentaire.mockResolvedValue({ artefactId: 'a2' })
    expect(await supprimer('c1')).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/assistant/analyses/a2')
  })
})
