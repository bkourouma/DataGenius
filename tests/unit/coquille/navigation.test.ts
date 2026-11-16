import { describe, expect, it } from 'vitest'
import { entreeActive, groupesNavigation, initiales } from '@/components/coquille/navigation'

describe('groupesNavigation', () => {
  it('membre : un seul groupe, sans texte en dur', () => {
    const groupes = groupesNavigation(false)
    expect(groupes.map((g) => g.id)).toEqual(['travail'])
    expect(groupes[0].entrees.map((e) => e.cle)).toEqual([
      'conversations', 'analyses', 'tableaux', 'tendances', 'espaces', 'recherche', 'glossaire',
    ])
  })

  it('administrateur : travail puis administration', () => {
    const groupes = groupesNavigation(true)
    expect(groupes.map((g) => g.id)).toEqual(['travail', 'administration'])
    expect(groupes[1].entrees.map((e) => e.href)).toEqual([
      '/sources', '/utilisateurs', '/sources/droits', '/dashboard/admin/assistant', '/journal',
    ])
  })
})

describe('entreeActive', () => {
  const groupes = groupesNavigation(true)
  it('retient le plus long préfixe', () => {
    expect(entreeActive('/assistant/analyses/x', groupes)).toBe('/assistant/analyses')
    expect(entreeActive('/assistant', groupes)).toBe('/assistant')
    expect(entreeActive('/sources/droits', groupes)).toBe('/sources/droits')
    expect(entreeActive('/sources/abc', groupes)).toBe('/sources')
  })
  it('aucune entrée pour un chemin inconnu ou vide', () => {
    expect(entreeActive('/inconnu', groupes)).toBeNull()
    expect(entreeActive('/assistantx', groupes)).toBeNull()
    expect(entreeActive(null, groupes)).toBeNull()
  })
})

describe('initiales', () => {
  it('deux lettres du nom, ou de l’adresse à défaut', () => {
    expect(initiales('Awa Koné')).toBe('AK')
    expect(initiales('awa@x.fr')).toBe('AX')
    expect(initiales('Awa')).toBe('A')
    expect(initiales('')).toBe('?')
    expect(initiales(null)).toBe('?')
  })
})
