/**
 * MarkdownRendu contre le VRAI react-markdown 10 / remark-gfm (aucun double) : ancres de
 * titres (position.start.line fournie), tableau GFM, `urlTransform` strict, HTML ignoré.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  cibleAutorisee,
  estLienInterne,
  MarkdownRendu,
  transformerUrl,
} from '@/components/medic-assist/artefacts/markdown-rendu'

vi.mock('next-intl', async importOriginal =>
  (await import('./_intl')).mockNextIntl(await importOriginal())
)

describe('MarkdownRendu (react-markdown réel)', () => {
  it('rend titres ancrés (numéro de ligne fourni), tableau GFM, lien interne, et neutralise le reste', () => {
    const markdown = [
      '# Titre',
      '',
      'Un [lien interne](/pays/ml), un [lien externe](https://exemple.org) et ![img](https://exemple.org/i.png).',
      '',
      '<script>alert(1)</script>',
      '',
      '## Suite',
      '',
      '| Pays | CA |',
      '| --- | ---: |',
      '| Mali | 300 |',
    ].join('\n')
    render(<MarkdownRendu markdown={markdown} idsTitres={{ 1: 'titre', 7: 'suite' }} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Titre' })).toHaveAttribute('id', 'titre')
    expect(screen.getByRole('heading', { level: 2, name: 'Suite' })).toHaveAttribute('id', 'suite')
    const liens = screen.getAllByRole('link')
    expect(liens).toHaveLength(1)
    expect(liens[0]).toHaveAttribute('href', '/pays/ml')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('exemple.org')
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('rend en texte sans href toute cible hors chemin interne et ancre', () => {
    const cibles = [
      'https://exemple.org',
      'http://exemple.org',
      'mailto:a@b.test',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PGI+eDwvYj4=',
      '//evil.test',
      '/api/medic-assist/artefacts',
      '/api',
      'relatif/page',
      './page',
      'page.html',
    ]
    const markdown = cibles.map((c, i) => `[lien${i}](<${c}>)`).join('\n\n')
    const { container } = render(<MarkdownRendu markdown={markdown} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    // Le texte du lien reste lisible.
    for (let i = 0; i < cibles.length; i++) {
      expect(screen.getByText(`lien${i}`)).toBeInTheDocument()
    }
  })

  it('une cible « /\\hote » est encodée par le parseur en chemin interne inoffensif', () => {
    render(<MarkdownRendu markdown={'[x](</\\evil.test>)'} />)
    const href = screen.getByRole('link').getAttribute('href') ?? ''
    expect(href.startsWith('/')).toBe(true)
    expect(href.startsWith('//')).toBe(false)
    expect(href.includes('\\')).toBe(false)
  })

  it('refuse les cibles écrites avec des références d’entités HTML', () => {
    const cibles = [
      '&#47;&#47;evil.example',
      '&sol;&sol;evil.example',
      '&#x2F;&#x2F;evil.example',
      'javascript&colon;alert(1)',
      '/&Tab;x',
      '/&#47;evil.example',
    ]
    const markdown = cibles.map((c, i) => `[ent${i}](${c})`).join('\n\n')
    const { container } = render(<MarkdownRendu markdown={markdown} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.querySelectorAll('[href]')).toHaveLength(0)
    for (let i = 0; i < cibles.length; i++) {
      expect(screen.getByText(`ent${i}`)).toBeInTheDocument()
    }
  })

  it('garde les chemins internes et les ancres', () => {
    render(<MarkdownRendu markdown="[a](/pays/ml?x=1#haut) et [b](#section)" />)
    const liens = screen.getAllByRole('link')
    expect(liens.map(l => l.getAttribute('href'))).toEqual(['/pays/ml?x=1#haut', '#section'])
  })
})

describe('cibleAutorisee / transformerUrl', () => {
  it.each([
    ['/pays/ml', true],
    ['/', true],
    ['/pays/ml?a=1#b', true],
    ['#section', true],
    ['/apiary', true],
    ['//evil.test', false],
    ['/\\evil.test', false],
    ['/api', false],
    ['/api/x', false],
    ['/API/x', false],
    ['/api?x=1', false],
    ['/a b', false],
    ['/a\tb', false],
    ['/a\u0000b', false],
    ['/a\nb', false],
    ['/a b', false],
    ['https://x.test', false],
    ['mailto:a@b.test', false],
    ['javascript:alert(1)', false],
    ['data:text/plain,x', false],
    ['page', false],
    ['', false],
    ['&#47;&#47;evil.example', false],
    ['/&#47;evil.example', false],
    ['/&sol;evil.example', false],
    ['javascript&colon;alert(1)', false],
    ['/&#x2F;x', false],
    ['/&Tab;x', false],
    ['/a&amp;b', false],
    ['/p?a=1&b=2', true],
  ])('%j → %s', (cible, attendu) => {
    expect(cibleAutorisee(cible)).toBe(attendu)
    expect(transformerUrl(cible)).toBe(attendu ? cible : '')
  })

  it('estLienInterne : chemins seulement, pas les ancres', () => {
    expect(estLienInterne('/pays/ml')).toBe(true)
    expect(estLienInterne('#x')).toBe(false)
    expect(estLienInterne(undefined)).toBe(false)
  })
})
