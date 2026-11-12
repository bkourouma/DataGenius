import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le paquet `ai` n'est pas encore installé : le module est simulé entièrement.
const generateTextMock = vi.fn()
vi.mock('ai', () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }))

import { genererTitre, nettoyerTitre, titreDeRepli } from '@/lib/medic-assist/agent/titre'

// Marqueur de test : ZZMA1TITRE

describe('titreDeRepli', () => {
  it('prend la première ligne et compacte les espaces', () => {
    expect(titreDeRepli('  Quel   est le CA\t du Cameroun ?\nDeuxième ligne')).toBe(
      'Quel est le CA du Cameroun ?',
    )
  })

  it('retire le balisage markdown', () => {
    expect(titreDeRepli('## **Ventes** par [pays](https://x.test) `2026`')).toBe(
      'Ventes par pays 2026',
    )
    expect(titreDeRepli('- une puce')).toBe('une puce')
    expect(titreDeRepli('> citation')).toBe('citation')
  })

  it('ignore les lignes vides, les séparateurs et les blocs de code', () => {
    expect(titreDeRepli('\n\n---\n```sql\nSELECT 1\n```\nVraie question')).toBe('Vraie question')
  })

  it('tronque à 60 caractères sur une frontière de mot avec une ellipse', () => {
    const titre = titreDeRepli(
      'Peux-tu me donner le détail des ventes de tous les produits par pays et par grossiste',
    )
    expect(Array.from(titre).length).toBeLessThanOrEqual(60)
    expect(titre.endsWith('…')).toBe(true)
    expect(titre).toBe('Peux-tu me donner le détail des ventes de tous les…')
  })

  it('coupe un mot unique trop long sans erreur', () => {
    const titre = titreDeRepli('a'.repeat(200))
    expect(Array.from(titre).length).toBe(60)
    expect(titre.endsWith('…')).toBe(true)
  })

  it('ne coupe pas une paire de substitution', () => {
    const titre = titreDeRepli('😀'.repeat(100))
    expect(titre).not.toMatch(/[\uD800-\uDBFF]…/)
  })

  it('ne renvoie jamais une chaîne vide', () => {
    expect(titreDeRepli('')).toBe('Data Genius')
    expect(titreDeRepli('   \n  ')).toBe('Data Genius')
    expect(titreDeRepli('```\ncode\n```', 'Nouvelle conversation')).toBe('Nouvelle conversation')
    expect(titreDeRepli('***', '')).toBe('Data Genius')
    expect(titreDeRepli(undefined as unknown as string, 'Repli')).toBe('Repli')
  })
})

describe('nettoyerTitre', () => {
  it('retire les guillemets et la ponctuation finale', () => {
    expect(nettoyerTitre('"Ventes du Cameroun en 2026."')).toBe('Ventes du Cameroun en 2026')
    expect(nettoyerTitre('« Budget par pays » ')).toBe('Budget par pays')
    expect(nettoyerTitre("'Stocks faibles !'")).toBe('Stocks faibles')
  })

  it('retire les préfixes « Titre : »', () => {
    expect(nettoyerTitre('Titre : Visas à renouveler')).toBe('Visas à renouveler')
    expect(nettoyerTitre('Title: "Sales trend"')).toBe('Sales trend')
    expect(nettoyerTitre('"Titre : Écarts au budget".')).toBe('Écarts au budget')
  })

  it('garde la première ligne et retire le markdown', () => {
    expect(nettoyerTitre('\n**Top produits**\nAutre ligne')).toBe('Top produits')
  })

  it('limite à 120 caractères', () => {
    const titre = nettoyerTitre('mot '.repeat(100))
    expect(Array.from(titre).length).toBeLessThanOrEqual(120)
    expect(titre.length).toBeGreaterThan(100)
  })

  it('renvoie une chaîne vide pour une sortie vide', () => {
    expect(nettoyerTitre('')).toBe('')
    expect(nettoyerTitre('  "" . ')).toBe('')
    expect(nettoyerTitre(undefined as unknown as string)).toBe('')
  })

  it('gère les titres non latins', () => {
    expect(nettoyerTitre('"مبيعات الكاميرون."')).toBe('مبيعات الكاميرون')
    expect(nettoyerTitre('标题：销售趋势。')).toBe('销售趋势')
  })
})

describe('genererTitre', () => {
  const base = {
    modele: {} as never,
    question: 'Quel est le CA du Cameroun ?',
    reponse: 'Voici…',
    locale: 'fr' as const,
  }

  beforeEach(() => generateTextMock.mockReset())

  it('renvoie le titre nettoyé et limite le prompt et les jetons', async () => {
    generateTextMock.mockResolvedValue({ text: '"Titre : CA du Cameroun."' })
    const titre = await genererTitre({
      ...base,
      question: 'q'.repeat(5_000),
      reponse: 'r'.repeat(5_000),
    })
    expect(titre).toBe('CA du Cameroun')
    const appel = generateTextMock.mock.calls[0]![0] as { prompt: string; maxOutputTokens: number }
    expect(appel.maxOutputTokens).toBeLessThanOrEqual(50)
    expect(appel.prompt.length).toBeLessThan(3_600)
  })

  it('retombe sur le repli si le modèle échoue ou répond vide', async () => {
    generateTextMock.mockRejectedValue(new Error('boom'))
    expect(await genererTitre(base)).toBe('Quel est le CA du Cameroun ?')
    generateTextMock.mockResolvedValue({ text: '  "" ' })
    expect(await genererTitre({ ...base, question: '', repli: 'Nouvelle conversation' })).toBe(
      'Nouvelle conversation',
    )
  })
})
