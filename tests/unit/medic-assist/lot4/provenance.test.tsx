import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VoletProvenance } from '@/components/medic-assist/commun/provenance'
import { estLienInterne } from '@/components/medic-assist/commun/provenance-impl'

import { provenanceTest } from './_fixtures-artefacts-ui'
import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const SQL = 'SELECT "pays", SUM("ca") FROM ventes WHERE 1=1 <script>alert(1)</script>'

async function ouvrir() {
  await userEvent.click(screen.getByRole('button', { name: /Comment j'ai calculé/ }))
}

describe('VoletProvenance', () => {
  beforeEach(() => {
    langueTest.code = 'fr'
    toast.mockReset()
  })

  it('est replié par défaut puis affiche source, période, périmètre, filtres et règles', async () => {
    render(<VoletProvenance provenance={provenanceTest()} estAdmin={false} />)
    const bouton = screen.getByRole('button', { name: /Comment j'ai calculé/ })
    expect(bouton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Ventes mensuelles')).not.toBeInTheDocument()

    await ouvrir()
    expect(bouton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Ventes mensuelles')).toBeInTheDocument()
    expect(screen.getByText('avril à octobre 2026')).toBeInTheDocument()
    expect(screen.getByText("Côte d'Ivoire")).toBeInTheDocument()
    expect(screen.getByText('Produit : Amoxicilline')).toBeInTheDocument()
    expect(screen.getByText('CA au PGHT de la ligne')).toBeInTheDocument()
    expect(screen.getByText('Hors produits inactifs')).toBeInTheDocument()
    expect(screen.getByText(/Calculé le .*2026/)).toBeInTheDocument()
  })

  it("s'ouvre d'emblée avec ouvertParDefaut", () => {
    render(<VoletProvenance provenance={provenanceTest()} estAdmin={false} ouvertParDefaut />)
    expect(screen.getByText('Ventes mensuelles')).toBeInTheDocument()
  })

  it('dit « Aucun filtre » sans filtre et omet période et règles absentes', async () => {
    render(
      <VoletProvenance
        provenance={provenanceTest({ filtres: [], regles: [], periode: undefined })}
        estAdmin={false}
        ouvertParDefaut
      />
    )
    expect(screen.getByText('Aucun filtre')).toBeInTheDocument()
    expect(screen.queryByText('Période')).not.toBeInTheDocument()
    expect(screen.queryByText('Règles appliquées')).not.toBeInTheDocument()
  })

  it('cache le SQL à un non-administrateur même si la provenance le contient', () => {
    render(
      <VoletProvenance provenance={provenanceTest({ sql: SQL })} estAdmin={false} ouvertParDefaut />
    )
    expect(screen.queryByText(/SELECT/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copier la requête' })).not.toBeInTheDocument()
  })

  it("montre le SQL à un administrateur, en texte (jamais interprété comme du HTML)", () => {
    const { container } = render(
      <VoletProvenance provenance={provenanceTest({ sql: SQL })} estAdmin ouvertParDefaut />
    )
    const code = container.querySelector('pre code')
    expect(code?.textContent).toBe(SQL)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('pre')).toHaveAttribute('dir', 'ltr')
  })

  it('un administrateur sans SQL ne voit pas de bloc de code', () => {
    const { container } = render(
      <VoletProvenance provenance={provenanceTest()} estAdmin ouvertParDefaut />
    )
    expect(container.querySelector('pre')).toBeNull()
  })

  it('copie le SQL et le signale', async () => {
    const ecrire = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(ecrire)
    render(<VoletProvenance provenance={provenanceTest({ sql: SQL })} estAdmin ouvertParDefaut />)
    await userEvent.click(screen.getByRole('button', { name: 'Copier la requête' }))
    expect(ecrire).toHaveBeenCalledWith(SQL)
    expect(toast).toHaveBeenCalledWith({ title: 'Requête copiée' })
  })

  it('affiche un toast d’échec si la copie est refusée', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('refus'))
    render(<VoletProvenance provenance={provenanceTest({ sql: SQL })} estAdmin ouvertParDefaut />)
    await userEvent.click(screen.getByRole('button', { name: 'Copier la requête' }))
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', title: 'La copie a échoué' })
    )
  })

  it('affiche le lien vers un écran interne', () => {
    render(
      <VoletProvenance
        provenance={provenanceTest({
          lienEcran: { href: '/rapports-stats/ventes?pays=CI', libelle: 'Ventes par pays' },
        })}
        estAdmin={false}
        ouvertParDefaut
      />
    )
    const lien = screen.getByRole('link', { name: 'Ventes par pays' })
    expect(lien).toHaveAttribute('href', '/rapports-stats/ventes?pays=CI')
  })

  it.each([
    'https://exemple.com/x',
    '//exemple.com/x',
    '/\\exemple.com',
    '/api/medic-assist/artefacts',
    '/apis',
    'javascript:alert(1)',
    'ventes',
    '',
  ])('ignore le lien %j', href => {
    render(
      <VoletProvenance
        provenance={provenanceTest({ lienEcran: { href, libelle: 'Lien piégé' } })}
        estAdmin={false}
        ouvertParDefaut
      />
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('Lien piégé')).not.toBeInTheDocument()
  })

  it('estLienInterne accepte un chemin simple et refuse le reste', () => {
    expect(estLienInterne('/budget')).toBe(true)
    expect(estLienInterne('/')).toBe(true)
    expect(estLienInterne(undefined)).toBe(false)
    expect(estLienInterne('/a\nb')).toBe(false)
  })

  it("lit la date de calcul sans planter si elle est invalide", () => {
    render(
      <VoletProvenance provenance={provenanceTest({ calculeA: 'pas-une-date' })} estAdmin={false} ouvertParDefaut />
    )
    expect(screen.queryByText(/Calculé le/)).not.toBeInTheDocument()
  })

  it('utilise des classes logiques et un bloc SQL toujours de gauche à droite en arabe', () => {
    langueTest.code = 'ar'
    const { container } = render(
      <VoletProvenance provenance={provenanceTest({ sql: SQL })} estAdmin ouvertParDefaut />
    )
    const html = container.innerHTML
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
    expect(within(container).getByText(SQL)).toBeInTheDocument()
  })
})
