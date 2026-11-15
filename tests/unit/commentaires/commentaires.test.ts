import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requeteBrute, executionBrute, ressourceDansPerimetre, trouverArtefactVisible } = vi.hoisted(() => ({
  requeteBrute: vi.fn(),
  executionBrute: vi.fn(),
  ressourceDansPerimetre: vi.fn(),
  trouverArtefactVisible: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ prisma: { $queryRaw: requeteBrute, $executeRaw: executionBrute } }))
vi.mock('@/lib/journal', () => ({ journal: { info: vi.fn(), avertissement: vi.fn(), erreur: vi.fn() } }))
vi.mock('@/lib/medic-assist/suivi/depot-prisma', () => ({ obtenirDepot: () => ({ trouverArtefactVisible }) }))
vi.mock('@/lib/medic-assist/suivi/perimetre-ressource', () => ({ ressourceDansPerimetre }))

import { journal } from '@/lib/journal'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import {
  ajouterCommentaire,
  analyseVisible,
  ErreurCommentaire,
  listerCommentaires,
  LONGUEUR_MAX_COMMENTAIRE,
  normaliserTexte,
  peutSupprimer,
  supprimerCommentaire,
} from '@/lib/commentaires/commentaires'

function contexte(userId = 'u1', roleName = 'Member'): ContexteExecution {
  return { userId, roleName, scope: {} as never, habilitations: null, locale: 'fr', maintenant: new Date() }
}
const voit = { analyseVisible: async () => true }
const nevoitPas = { analyseVisible: async () => false }

async function codeDe(promesse: Promise<unknown>) {
  try {
    await promesse
  } catch (erreur) {
    return erreur instanceof ErreurCommentaire ? erreur.code : 'autre'
  }
  return 'aucune'
}

beforeEach(() => vi.clearAllMocks())

describe('normaliserTexte', () => {
  it('retire les espaces de bordure et normalise les fins de ligne', () => {
    expect(normaliserTexte('  a\r\nb\rc\n  ')).toBe('a\nb\nc')
  })

  it('retire les caractères de contrôle sauf \\n et \\t', () => {
    expect(normaliserTexte('a\u0000b\u0007c\td\ne\u007Ff\u0085')).toBe('abc\td\nef')
  })

  it('conserve le HTML tel quel, comme du texte', () => {
    expect(normaliserTexte('<script>x</script> & "ok"')).toBe('<script>x</script> & "ok"')
  })

  it('refuse un texte vide ou réduit à des blancs ou contrôles', () => {
    expect(() => normaliserTexte('')).toThrow(ErreurCommentaire)
    expect(() => normaliserTexte(' \n\t ')).toThrow(ErreurCommentaire)
    expect(() => normaliserTexte('\u0000\u0001')).toThrow(ErreurCommentaire)
    expect(() => normaliserTexte(undefined)).toThrow(ErreurCommentaire)
  })

  it('accepte 1 et 2000 caractères, refuse 2001', () => {
    expect(normaliserTexte('a')).toBe('a')
    expect(normaliserTexte('a'.repeat(LONGUEUR_MAX_COMMENTAIRE))).toHaveLength(2000)
    expect(() => normaliserTexte('a'.repeat(2001))).toThrow(ErreurCommentaire)
  })

  it('compte en points de code, comme char_length', () => {
    expect(normaliserTexte('😀'.repeat(2000))).toHaveLength(4000)
    expect(() => normaliserTexte('😀'.repeat(2001))).toThrow(ErreurCommentaire)
  })

  it('retire les substituts isolés', () => {
    expect(normaliserTexte('a\uD800b')).toBe('ab')
  })
})

describe('règles de suppression', () => {
  it('autorise l’auteur et le TenantAdmin, pas un tiers', () => {
    expect(peutSupprimer(contexte('u1'), 'u1')).toBe(true)
    expect(peutSupprimer(contexte('admin', 'TenantAdmin'), 'u1')).toBe(true)
    expect(peutSupprimer(contexte('u2'), 'u1')).toBe(false)
    expect(peutSupprimer(contexte('u2', 'SuperAdmin'), 'u1')).toBe(false)
  })
})

describe('analyseVisible', () => {
  it('exige la visibilité de l’analyse puis le périmètre par jeu', async () => {
    trouverArtefactVisible.mockResolvedValue({ id: 'a' })
    ressourceDansPerimetre.mockResolvedValue(true)
    expect(await analyseVisible(contexte(), 'a')).toBe(true)
    expect(ressourceDansPerimetre).toHaveBeenCalledWith(expect.anything(), 'artefact', 'a')
  })

  it('refuse si le périmètre par jeu ne couvre pas l’auteur', async () => {
    trouverArtefactVisible.mockResolvedValue({ id: 'a' })
    ressourceDansPerimetre.mockResolvedValue(false)
    expect(await analyseVisible(contexte(), 'a')).toBe(false)
  })

  it('refuse sans accès propriétaire ni partage, sans interroger le périmètre', async () => {
    trouverArtefactVisible.mockResolvedValue(null)
    expect(await analyseVisible(contexte(), 'a')).toBe(false)
    expect(ressourceDansPerimetre).not.toHaveBeenCalled()
  })
})

describe('services', () => {
  it('refuse en « introuvable » liste et ajout à qui ne voit pas l’analyse', async () => {
    expect(await codeDe(listerCommentaires(contexte(), 'a', nevoitPas))).toBe('introuvable')
    expect(await codeDe(ajouterCommentaire(contexte(), 'a', 'bonjour', nevoitPas))).toBe('introuvable')
    expect(requeteBrute).not.toHaveBeenCalled()
  })

  it('refuse un texte trop long ou vide en « invalide » sans écrire', async () => {
    expect(await codeDe(ajouterCommentaire(contexte(), 'a', 'x'.repeat(2001), voit))).toBe('invalide')
    expect(await codeDe(ajouterCommentaire(contexte(), 'a', '   ', voit))).toBe('invalide')
    expect(requeteBrute).not.toHaveBeenCalled()
  })

  it('ne révèle pas l’invalidité à qui ne voit pas l’analyse', async () => {
    expect(await codeDe(ajouterCommentaire(contexte(), 'a', '', nevoitPas))).toBe('introuvable')
  })

  it('ajoute et journalise sans le texte', async () => {
    requeteBrute.mockResolvedValue([{ id: 'x' }])
    const { id } = await ajouterCommentaire(contexte(), 'a', 'secret de test', voit)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const appel = vi.mocked(journal.info).mock.calls[0]
    expect(appel[1]).toEqual({ artefactId: 'a', commentaireId: id })
    expect(JSON.stringify(appel)).not.toContain('secret de test')
  })

  it('signale « limite_debit » quand l’insertion conditionnelle ne renvoie rien', async () => {
    requeteBrute.mockResolvedValue([])
    expect(await codeDe(ajouterCommentaire(contexte(), 'a', 'bonjour', voit))).toBe('limite_debit')
    expect(journal.info).not.toHaveBeenCalled()
  })

  it('calcule « supprimable » côté serveur et rend la date en ISO', async () => {
    requeteBrute.mockResolvedValue([
      { id: 'c1', texte: 'un', auteur_id: 'u1', prenom: 'Awa', nom: 'Koné', cree_a: new Date('2026-01-02T03:04:05Z') },
      { id: 'c2', texte: 'deux', auteur_id: 'u2', prenom: 'Moi', nom: '', cree_a: new Date('2026-01-03T00:00:00Z') },
    ])
    const liste = await listerCommentaires(contexte('u1'), 'a', voit)
    expect(liste.map((c) => c.supprimable)).toEqual([true, false])
    expect(liste[0]).toMatchObject({ auteurNom: 'Awa Koné', creeLe: '2026-01-02T03:04:05.000Z', auteurId: 'u1' })
    expect(liste[1].auteurNom).toBe('Moi')
    const admin = await listerCommentaires(contexte('adm', 'TenantAdmin'), 'a', voit)
    expect(admin.every((c) => c.supprimable)).toBe(true)
  })

  it('supprime un commentaire inexistant : « introuvable »', async () => {
    requeteBrute.mockResolvedValue([])
    expect(await codeDe(supprimerCommentaire(contexte(), 'zz', voit))).toBe('introuvable')
  })

  it('supprime par l’auteur sans contrôle de visibilité, et par un TenantAdmin', async () => {
    requeteBrute.mockResolvedValue([{ artefact_id: 'a', auteur_id: 'u1' }])
    expect(await supprimerCommentaire(contexte('u1'), 'c1', nevoitPas)).toEqual({ artefactId: 'a' })
    expect(await supprimerCommentaire(contexte('adm', 'TenantAdmin'), 'c1', nevoitPas)).toEqual({ artefactId: 'a' })
    expect(executionBrute).toHaveBeenCalledTimes(2)
  })

  it('refuse un tiers : « interdit » s’il voit l’analyse, « introuvable » sinon', async () => {
    requeteBrute.mockResolvedValue([{ artefact_id: 'a', auteur_id: 'u1' }])
    expect(await codeDe(supprimerCommentaire(contexte('u2'), 'c1', voit))).toBe('interdit')
    expect(await codeDe(supprimerCommentaire(contexte('u2'), 'c1', nevoitPas))).toBe('introuvable')
    expect(executionBrute).not.toHaveBeenCalled()
  })
})
