import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exigerAdmin = vi.fn()
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: () => exigerAdmin() }))
const lireEtatWorker = vi.fn()
const lireExecutionsEnEchec = vi.fn()
vi.mock('@/lib/warehouse/etat-worker', () => ({
  lireEtatWorker: () => lireEtatWorker(),
  lireExecutionsEnEchec: (...args: unknown[]) => lireExecutionsEnEchec(...args),
}))
const avertissement = vi.fn()
vi.mock('@/lib/journal', () => ({
  journal: { info: vi.fn(), avertissement: (...args: unknown[]) => avertissement(...args), erreur: vi.fn() },
}))
const redirect = vi.fn((chemin: string) => { throw new Error('REDIRECT:' + chemin) })
vi.mock('next/navigation', () => ({ redirect: (chemin: string) => redirect(chemin) }))

import PageWorker from '@/app/(dashboard)/sources/worker/page'

beforeEach(() => {
  exigerAdmin.mockReset()
  lireEtatWorker.mockReset()
  lireExecutionsEnEchec.mockReset()
  avertissement.mockReset()
  redirect.mockClear()
})

describe('page /sources/worker', () => {
  it('redirige un non-administrateur vers /assistant sans lire la base', async () => {
    exigerAdmin.mockResolvedValue({ ok: false })
    await expect(PageWorker()).rejects.toThrow('REDIRECT:/assistant')
    expect(redirect).toHaveBeenCalledWith('/assistant')
    expect(lireEtatWorker).not.toHaveBeenCalled()
  })

  it('affiche le message d’indisponibilité si la lecture échoue', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockRejectedValue(new Error('postgres://u:secret@h'))
    lireExecutionsEnEchec.mockResolvedValue([])
    render(await PageWorker())
    expect(screen.getByRole('status')).toHaveTextContent('L’état du worker est indisponible')
    expect(JSON.stringify(avertissement.mock.calls)).not.toContain('secret')
  })

  it('affiche l’état, le dernier tour et les échecs', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    const date = new Date('2026-11-15T09:00:00Z')
    lireEtatWorker.mockResolvedValue({
      statut: 'marche', silenceMs: 4000,
      instance: { hote: 'serveur1', version: '0.2.0', demarreA: date, dernierSigneA: date, dernierTour: { a: date, dureeMs: 420, jeux: 3, erreurs: 1 } },
    })
    lireExecutionsEnEchec.mockResolvedValue([{ jeu: 'ventes', code: 'source', verifieA: date, dureeMs: 80 }])
    render(await PageWorker())
    expect(screen.getByText('En marche')).toBeInTheDocument()
    expect(screen.getByText('serveur1')).toBeInTheDocument()
    expect(screen.getByText('ventes')).toBeInTheDocument()
    expect(screen.getByText('source')).toHaveClass('font-mono')
  })
})
