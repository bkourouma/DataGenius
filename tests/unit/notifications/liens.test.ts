import { describe, expect, it } from 'vitest'
import { lienNotification } from '@/lib/notifications/liens'

describe('lienNotification', () => {
  const uuid = '3f1c2b4a-1111-4222-8333-444455556666'

  it('construit le lien de chaque type d’entité', () => {
    expect(lienNotification('tableau_alerte', 'tableau', uuid)).toBe(`/tableaux/${uuid}`)
    expect(lienNotification('x', 'conversation', 'abc_123')).toBe('/assistant?c=abc_123')
    expect(lienNotification('x', 'artefact', 'abc')).toBe('/assistant/analyses?onglet=partages')
    expect(lienNotification('x', 'tache', 'abc')).toBe('/assistant/analyses?onglet=taches')
  })

  it('renvoie null sans entité ou avec une entité inconnue', () => {
    expect(lienNotification('x', null, null)).toBeNull()
    expect(lienNotification('x', 'tableau', null)).toBeNull()
    expect(lienNotification('x', 'inconnue', 'abc')).toBeNull()
  })

  it.each(['//evil.test', 'http:', '../', 'a b', 'a/b', 'a?b=c', '', 'x'.repeat(101), 'https://evil.test'])(
    'rejette l’identifiant malveillant %j',
    id => {
      expect(lienNotification('x', 'tableau', id)).toBeNull()
      expect(lienNotification('x', 'conversation', id)).toBeNull()
    }
  )

  it('ne produit que des liens relatifs', () => {
    const liens = [
      lienNotification('x', 'tableau', uuid),
      lienNotification('x', 'conversation', 'ok-1'),
      lienNotification('x', 'artefact', 'ok'),
      lienNotification('x', 'tache', 'ok'),
    ]
    for (const lien of liens) {
      expect(lien).toMatch(/^\/(?!\/)/)
      expect(lien).not.toMatch(/^\/\\/)
    }
  })
})
