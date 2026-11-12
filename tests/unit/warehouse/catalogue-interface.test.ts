import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publier } from '@/app/(dashboard)/sources/catalogue/[cle]/actions'

const { garde, charger, publierDefinition, rediriger } = vi.hoisted(() => ({
  garde: vi.fn(), charger: vi.fn(), publierDefinition: vi.fn(), rediriger: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: rediriger }))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: garde }))
vi.mock('@/lib/warehouse/catalogue-metier', () => ({
  chargerCatalogueMetier: charger,
  publierCatalogueMetier: publierDefinition,
  ErreurCatalogueMetier: class extends Error {},
}))

describe('Publication du catalogue métier depuis le formulaire', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    charger.mockResolvedValue({ colonnes: [{ nom: 'montant', description: 'Montant' }] })
  })

  it('refuse la publication sans droit d’administration', async () => {
    garde.mockResolvedValue({ ok: false })
    expect(await publier('factures', 0, {}, new FormData())).toMatchObject({ erreur: 'Accès réservé aux administrateurs.' })
    expect(charger).not.toHaveBeenCalled()
    expect(publierDefinition).not.toHaveBeenCalled()
  })

  it('transmet les champs structurés, la version et le compte de publication', async () => {
    garde.mockResolvedValue({ ok: true, contexte: { userId: 'admin' } })
    rediriger.mockImplementation(() => { throw new Error('navigation') })
    const donnees = new FormData()
    for (const [champ, valeur] of Object.entries({
      description: 'Factures', grain: 'Une ligne par facture', 'synonymes-montant': ' prix, total ',
      'colonne-date': 'emise_le', 'debut-exercice': '11',
      mesures: '2', 'cle-2': 'total_net', 'libelle-2': 'Total net', 'definition-2': 'Somme des montants',
      'colonne-2': 'montant', 'agregat-2': 'somme', 'devise-2': 'xof',
      'filtres-2': '4', 'colonne-filtre-2-4': 'statut', 'operateur-filtre-2-4': 'different', 'valeur-filtre-2-4': 'annule',
    })) donnees.append(champ, valeur)

    await expect(publier('factures', 3, {}, donnees)).rejects.toThrow('navigation')
    expect(publierDefinition).toHaveBeenCalledWith('factures', 3, expect.objectContaining({
      calendrierFiscal: { colonneDate: 'emise_le', moisDebutExercice: 11 },
      colonnes: [{ nom: 'montant', description: 'Montant', synonymes: ['prix', 'total'] }],
      mesures: [expect.objectContaining({
        cle: 'total_net', agregat: 'somme', devise: 'XOF',
        filtres: [{ colonne: 'statut', operateur: 'different', valeur: 'annule' }],
      })],
    }), 'admin')
    expect(rediriger).toHaveBeenCalledWith('/sources/catalogue/factures?publication=ok')
  })
})
