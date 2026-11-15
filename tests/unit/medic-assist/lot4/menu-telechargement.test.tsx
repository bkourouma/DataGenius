import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MenuTelechargement,
  nomBaseFichier,
} from '@/components/medic-assist/artefacts/menu-telechargement'
import { ErreurTelechargement } from '@/lib/medic-assist/artefacts/telecharger'

import { langueTest } from './_intl'

vi.mock('next-intl', async importOriginal =>
  (await import('./_fixtures-artefacts-ui')).mockIntlUi(await importOriginal())
)

const { toast, telechargerDepuisUrl } = vi.hoisted(() => ({
  toast: vi.fn(),
  telechargerDepuisUrl: vi.fn(),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/lib/medic-assist/artefacts/telecharger', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/telecharger')>()),
  telechargerDepuisUrl,
}))

async function ouvrirMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
}

describe('MenuTelechargement', () => {
  beforeEach(() => {
    langueTest.code = 'fr'
    toast.mockReset()
    telechargerDepuisUrl.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    ['Excel (.xlsx)', 'xlsx'],
    ['CSV (.csv)', 'csv'],
    ['PDF (.pdf)', 'pdf'],
    ['PowerPoint (.pptx)', 'pptx'],
  ])("%s appelle l'URL d'export attendue", async (libelle, format) => {
    render(<MenuTelechargement artefactId="art-1" titre="CA par pays" type="tableau" />)
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: libelle }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(telechargerDepuisUrl).toHaveBeenCalledWith(
      `/api/medic-assist/artefacts/art-1/export?format=${format}`,
      `CA par pays.${format}`
    )
    expect(toast).toHaveBeenCalledWith({ title: `${libelle} téléchargé` })
  })

  it("ajoute la version affichée à l'URL d'export", async () => {
    render(<MenuTelechargement artefactId="art-1" titre="CA" type="tableau" version={2} />)
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(telechargerDepuisUrl).toHaveBeenCalledWith(
      '/api/medic-assist/artefacts/art-1/export?format=pdf&version=2',
      'CA.pdf'
    )
  })

  it("n'affiche pas PNG sans rendu de graphique", async () => {
    render(<MenuTelechargement artefactId="art-1" titre="CA" type="tableau" />)
    await ouvrirMenu()
    await screen.findByRole('menuitem', { name: 'PDF (.pdf)' })
    expect(screen.queryByRole('menuitem', { name: 'Image PNG (.png)' })).not.toBeInTheDocument()
  })

  it('masque le CSV pour un document', async () => {
    render(<MenuTelechargement artefactId="art-1" titre="Rapport" type="document" />)
    await ouvrirMenu()
    await screen.findByRole('menuitem', { name: 'PDF (.pdf)' })
    expect(screen.queryByRole('menuitem', { name: 'CSV (.csv)' })).not.toBeInTheDocument()
  })

  it("passe par le rendu du graphique pour l'image PNG, sans appel réseau", async () => {
    const telechargerPng = vi.fn().mockResolvedValue(undefined)
    render(
      <MenuTelechargement
        artefactId="art-1"
        titre='CA: pays / "2026"'
        type="graphique"
        onTelechargerPng={telechargerPng}
      />
    )
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Image PNG (.png)' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(telechargerPng).toHaveBeenCalledWith('CA pays 2026')
    expect(telechargerDepuisUrl).not.toHaveBeenCalled()
  })

  it("affiche un toast d'échec traduit quand le téléchargement échoue", async () => {
    telechargerDepuisUrl.mockRejectedValue(new ErreurTelechargement('trop_de_lignes', 413))
    render(<MenuTelechargement artefactId="art-1" titre="CA" type="tableau" />)
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Excel (.xlsx)' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Le téléchargement a échoué',
      description: expect.stringContaining('trop de lignes'),
    })
    // Le bouton redevient disponible.
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeEnabled()
  })

  it("signale l'échec de l'image PNG", async () => {
    render(
      <MenuTelechargement
        artefactId="art-1"
        titre="CA"
        type="graphique"
        onTelechargerPng={() => Promise.reject(new Error('canvas'))}
      />
    )
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Image PNG (.png)' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: "L'image du graphique n'a pas pu être créée.",
      })
    )
  })

  it('désactive le bouton avec un indicateur pendant le téléchargement', async () => {
    let finir!: () => void
    telechargerDepuisUrl.mockReturnValue(new Promise<void>(r => (finir = r)))
    render(<MenuTelechargement artefactId="art-1" titre="CA" type="tableau" />)
    await ouvrirMenu()
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF (.pdf)' }))

    const bouton = await screen.findByRole('button', { name: /Téléchargement en cours/ })
    expect(bouton).toBeDisabled()
    expect(bouton).toHaveAttribute('aria-busy', 'true')

    finir()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Télécharger' })).toBeEnabled())
  })
})

describe('nomBaseFichier', () => {
  it('retire les caractères interdits et borne la longueur', () => {
    expect(nomBaseFichier('a<b>:c|d?')).toBe('a b c d')
    expect(nomBaseFichier('   ')).toBe('Data Genius')
    expect(nomBaseFichier('x'.repeat(200))).toHaveLength(80)
  })
})
