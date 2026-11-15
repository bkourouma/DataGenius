import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exigerAdmin = vi.fn()
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: () => exigerAdmin() }))
const lireEtatWorker = vi.fn()
vi.mock('@/lib/warehouse/etat-worker', () => ({ lireEtatWorker: () => lireEtatWorker() }))
const avertissement = vi.fn()
vi.mock('@/lib/journal', () => ({
  journal: { info: vi.fn(), avertissement: (...args: unknown[]) => avertissement(...args), erreur: vi.fn() },
}))

import { BandeauEtatWorker } from '@/components/etat-worker/bandeau-etat-worker'
import { formaterDuree } from '@/components/etat-worker/duree'

const instance = {
  hote: 'serveur1', version: '0.2.0', demarreA: new Date(), dernierSigneA: new Date(), dernierTour: null,
}

beforeEach(() => {
  exigerAdmin.mockReset()
  lireEtatWorker.mockReset()
  avertissement.mockReset()
})

describe('BandeauEtatWorker', () => {
  it('non-administrateur : rien, et aucune lecture', async () => {
    exigerAdmin.mockResolvedValue({ ok: false })
    const { container } = render(await BandeauEtatWorker())
    expect(container).toBeEmptyDOMElement()
    expect(lireEtatWorker).not.toHaveBeenCalled()
  })

  it('administrateur + arrêté : alerte avec la durée de silence', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockResolvedValue({ statut: 'arrete', silenceMs: 12 * 60_000 + 5000, instance })
    render(await BandeauEtatWorker())
    expect(screen.getByRole('alert')).toHaveTextContent('Le worker ne tourne plus depuis 12 minutes')
    expect(screen.getByText('Arrêté')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir le détail' })).toHaveAttribute('href', '/sources/worker')
  })

  it('administrateur + marche : pastille sans alerte', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockResolvedValue({ statut: 'marche', silenceMs: 4000, instance })
    render(await BandeauEtatWorker())
    expect(screen.getByText('En marche')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('link', { name: 'Détails du worker' })).toHaveAttribute('href', '/sources/worker')
  })

  it('en retard : pastille avec son texte, sans alerte', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockResolvedValue({ statut: 'en_retard', silenceMs: 60_000, instance })
    render(await BandeauEtatWorker())
    expect(screen.getByText('En retard')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('jamais vu : pas d’alerte, phrase d’aide neutre', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockResolvedValue({ statut: 'jamais_vu', silenceMs: null, instance: null })
    render(await BandeauEtatWorker())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Jamais vu')).toBeInTheDocument()
    expect(screen.getByText('Le worker n’a pas encore signalé sa présence.')).toBeInTheDocument()
  })

  it('lecture en erreur : rien, avertissement journalisé, pas d’exception', async () => {
    exigerAdmin.mockResolvedValue({ ok: true })
    lireEtatWorker.mockRejectedValue(new Error('postgres://u:secret@h'))
    const { container } = render(await BandeauEtatWorker())
    expect(container).toBeEmptyDOMElement()
    expect(avertissement).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(avertissement.mock.calls)).not.toContain('secret')
  })
})

describe('formaterDuree', () => {
  const langues = ['fr', 'en', 'es', 'ar', 'hi', 'zh']
  const cas = [
    { unite: 'seconde', ms: 45_000, nombre: '45' },
    { unite: 'minute', ms: 12 * 60_000 + 59_000, nombre: '12' },
    { unite: 'heure', ms: 3 * 3_600_000 + 1000, nombre: '3' },
    { unite: 'jour', ms: 3 * 86_400_000 + 5_000_000, nombre: '3' },
  ]

  for (const { unite, ms, nombre } of cas) {
    it(`unité ${unite} : texte non vide, avec le nombre, différent selon la langue`, () => {
      const textes = langues.map(l => formaterDuree(ms, l))
      for (const texte of textes) {
        expect(texte.length).toBeGreaterThan(0)
        expect(texte).toContain(nombre)
      }
      expect(new Set(textes).size).toBeGreaterThanOrEqual(5)
      for (const l of ['es', 'ar', 'hi', 'zh']) expect(formaterDuree(ms, l), l).not.toBe(formaterDuree(ms, 'fr'))
    })
  }

  it('arrondit à l’entier inférieur et borne à zéro', () => {
    expect(formaterDuree(59_999, 'fr')).toBe(formaterDuree(59_000, 'fr'))
    expect(formaterDuree(-5, 'fr')).toBe(formaterDuree(0, 'fr'))
    expect(formaterDuree(60_000, 'fr')).toContain('1')
    expect(formaterDuree(60_000, 'fr')).toContain('minute')
  })
  it('langue inconnue : repli sur le français', () => {
    expect(formaterDuree(720_000, 'xx')).toBe(formaterDuree(720_000, 'fr'))
  })
  it('français : « 12 minutes »', () => {
    expect(formaterDuree(12 * 60_000, 'fr')).toBe('12 minutes')
  })
})
