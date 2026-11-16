import { describe, expect, it } from 'vitest'
import { listerGlossaire } from '@/lib/glossaire/glossaire'
import { contexte, droits, GROUPE, registreVentes } from './registre-test'

const registre = registreVentes()
const cles = (entrees: Awaited<ReturnType<typeof listerGlossaire>>) => entrees.map(e => `${e.jeu.cle}/${e.indicateur.cle}`)

describe('listerGlossaire', () => {
  it('liste tous les indicateurs d’un jeu sans restriction, avec formule structurée, unité et ancre', async () => {
    const entrees = await listerGlossaire(contexte('Member'), {}, { registre, complements: [] })
    expect(cles(entrees).sort()).toEqual(['ventes/ca', 'ventes/mois_max', 'ventes/taux_marge'])
    const ca = entrees.find(e => e.indicateur.cle === 'ca')!
    expect(ca).toMatchObject({
      definition: 'Montant hors taxe vendu.', unite: 'EUR', synonymes: [], ancre: 'ventes-ca',
      formule: { agregat: 'somme', colonne: 'montant_ht', regles: [] },
    })
    expect(entrees.find(e => e.indicateur.cle === 'taux_marge')?.unite).toBe('EUR')
  })

  it('utilise le libellé de la locale du contexte', async () => {
    const entrees = await listerGlossaire(contexte('Member', undefined, 'en'), {}, { registre, complements: [] })
    expect(entrees.find(e => e.indicateur.cle === 'ca')?.indicateur.libelle).toBe('Revenue')
    expect(entrees[0]?.jeu.libelle).toBe('Sales')
  })

  it('cache tout indicateur d’un jeu dont la règle exclut le membre', async () => {
    const entrees = await listerGlossaire(contexte('Member', droits({ groupes: [], regle: {} })), {}, { registre, complements: [] })
    expect(entrees).toEqual([])
  })

  it('cache l’indicateur dépendant d’une colonne masquée et la colonne de toute formule', async () => {
    const ctx = contexte('Member', droits({ groupes: [GROUPE], regle: { masquer: ['mois'] } }))
    const entrees = await listerGlossaire(ctx, {}, { registre, complements: [] })
    expect(cles(entrees).sort()).toEqual(['ventes/ca', 'ventes/taux_marge'])
    expect(JSON.stringify(entrees)).not.toContain('mois')
  })

  it('ne montre jamais la colonne ni la valeur d’un filtre de ligne', async () => {
    const ctx = contexte('Member', droits({ groupes: [GROUPE], regle: { filtre: { colonne: 'agence', valeur: 'Secret-42' } } }))
    const entrees = await listerGlossaire(ctx, {}, { registre, complements: [] })
    expect(entrees.length).toBe(3)
    expect(JSON.stringify(entrees)).not.toContain('Secret-42')
  })

  it('montre tout à un administrateur malgré les règles', async () => {
    const ctx = contexte('TenantAdmin', droits({ administrateur: true, groupes: [], regle: { masquer: ['mois'] } }))
    expect(await listerGlossaire(ctx, {}, { registre, complements: [] })).toHaveLength(3)
  })

  it('préfère le complément non vide, garde la définition du catalogue sinon, et expose les synonymes', async () => {
    const complements = [
      { jeu: 'ventes', indicateur: 'ca', definition: '  Définition maison  ', synonymes: ['Turnover', 'CA HT'] },
      { jeu: 'ventes', indicateur: 'taux_marge', definition: '', synonymes: ['Marge relative'] },
    ]
    const entrees = await listerGlossaire(contexte('TenantAdmin'), {}, { registre, complements })
    const ca = entrees.find(e => e.indicateur.cle === 'ca')!
    expect(ca).toMatchObject({ definition: 'Définition maison', complement: 'Définition maison', synonymes: ['Turnover', 'CA HT'] })
    const taux = entrees.find(e => e.indicateur.cle === 'taux_marge')!
    expect(taux).toMatchObject({ definition: 'Marge sur chiffre d’affaires.', complement: '', synonymes: ['Marge relative'] })
  })

  it('cherche sans tenir compte de la casse ni des accents, dans libellé, définition, synonymes et jeu', async () => {
    const complements = [{ jeu: 'ventes', indicateur: 'mois_max', definition: '', synonymes: ['Échéance récente'] }]
    const chercher = async (recherche: string) =>
      cles(await listerGlossaire(contexte('Member'), { recherche }, { registre, complements })).sort()
    expect(await chercher('MONTANT HORS TAXE')).toEqual(['ventes/ca'])
    expect(await chercher('chiffre d’affaires')).toEqual(['ventes/ca', 'ventes/taux_marge'])
    expect(await chercher('marge sur')).toEqual(['ventes/taux_marge'])
    expect(await chercher('echeance RECENTE')).toEqual(['ventes/mois_max'])
    expect(await chercher('sales')).toEqual([])
    expect(await chercher('ventes')).toHaveLength(3)
    expect(await chercher('introuvable')).toEqual([])
  })
})
