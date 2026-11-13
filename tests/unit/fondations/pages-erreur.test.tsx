import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Error from '@/app/error'
import GlobalError from '@/app/global-error'

describe('app/error.tsx', () => {
  it('affiche la référence et relance au clic sur Réessayer', () => {
    const reset = vi.fn()
    const erreur = Object.assign(new globalThis.Error('détail interne secret'), { digest: 'abc123' })
    render(<Error error={erreur} reset={reset} />)

    expect(screen.getByText('abc123')).toBeInTheDocument()
    expect(screen.getByText(/Référence de l'erreur/)).toBeInTheDocument()
    expect(screen.queryByText(/détail interne secret/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toHaveAttribute('href', '/')

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("n'affiche pas de référence sans digest", () => {
    render(<Error error={new globalThis.Error('x')} reset={vi.fn()} />)
    expect(screen.queryByText(/Référence de l'erreur/)).not.toBeInTheDocument()
  })
})

describe('app/global-error.tsx', () => {
  const effacerCookie = () => {
    document.cookie = 'NEXT_LOCALE=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  }

  afterEach(() => {
    effacerCookie()
    vi.restoreAllMocks()
  })

  it('utilise le cookie de langue, avec dir rtl pour l’arabe', async () => {
    document.cookie = 'NEXT_LOCALE=ar; path=/'
    const reset = vi.fn()
    const erreur = Object.assign(new globalThis.Error('secret'), { digest: 'ref42' })
    const { container } = render(<GlobalError error={erreur} reset={reset} />)

    expect(await screen.findByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument()
    const html = container.querySelector('html')
    expect(html).toHaveAttribute('lang', 'ar')
    expect(html).toHaveAttribute('dir', 'rtl')
    expect(screen.getByText('ref42')).toBeInTheDocument()
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('retombe sur navigator.language, sinon sur le français', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('es-ES')
    const { unmount } = render(<GlobalError error={new globalThis.Error('x')} reset={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    unmount()

    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    render(<GlobalError error={new globalThis.Error('x')} reset={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toHaveAttribute('href', '/')
  })
})
