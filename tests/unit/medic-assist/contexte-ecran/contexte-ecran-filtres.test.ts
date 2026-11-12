import { describe, expect, it } from 'vitest'
import {
  construireContexteFiltres,
  libelleDateISO,
  libelleMoisAAAAMM,
  libellePeriodeDates,
  valeurFiltreVide,
} from '@/lib/medic-assist/client/contexte-ecran-filtres'
import { ContexteEcranSchema } from '@/lib/medic-assist/contrats/chat'

describe('valeurFiltreVide', () => {
  it('considere vides null, undefined, chaine blanche, liste vide et nombre non fini', () => {
    for (const v of [null, undefined, '', '  ', [], Number.NaN]) expect(valeurFiltreVide(v)).toBe(true)
  })
  it('garde 0 et false', () => {
    expect(valeurFiltreVide(0)).toBe(false)
    expect(valeurFiltreVide(false)).toBe(false)
    expect(valeurFiltreVide(['a'])).toBe(false)
  })
})

describe('construireContexteFiltres', () => {
  it('retourne null quand rien n est filtre', () => {
    expect(
      construireContexteFiltres({
        titre: 'Ventes',
        champs: [
          { cle: 'pays', etiquette: 'Pays', valeur: [] },
          { cle: 'produit', etiquette: 'Produit', valeur: undefined },
        ],
      }),
    ).toBeNull()
  })

  it('garde les valeurs brutes, ajoute les noms et omet les filtres vides', () => {
    const ctx = construireContexteFiltres({
      titre: 'Synthese par pays',
      locale: 'fr',
      champs: [
        { cle: 'exercice', etiquette: 'Exercice', valeur: 2026, affichage: '2026/2027' },
        { cle: 'pays', etiquette: 'Pays', valeur: ['p1', 'p2'], noms: ['Senegal', 'Mali'] },
        { cle: 'produits', etiquette: 'Produits', valeur: [] },
      ],
    })
    expect(ctx?.filtres).toEqual({ exercice: 2026, pays: ['p1', 'p2'], paysNoms: ['Senegal', 'Mali'] })
    expect(ctx?.titre).toBe('Synthese par pays')
    expect(ctx?.libelle).toContain('Exercice : 2026/2027')
    expect(ctx?.libelle).toContain('Pays : Senegal')
    expect(ctx?.libelle).toContain('Mali')
    expect(ctx?.libelle).not.toContain('p1')
    expect(ctx?.libelle).not.toContain('Produits')
    expect(ContexteEcranSchema.safeParse({ chemin: '/x', ...ctx }).success).toBe(true)
  })

  it('resume au-dela du nombre de noms maximal et respecte horsLibelle', () => {
    const ctx = construireContexteFiltres({
      titre: 'T',
      nomsMaxDansLibelle: 2,
      champs: [
        { cle: 'pays', etiquette: 'Pays', valeur: ['1', '2', '3', '4'], noms: ['A', 'B', 'C', 'D'] },
        { cle: 'fin', etiquette: 'Fin', valeur: '2026-09', horsLibelle: true },
      ],
    })
    expect(ctx?.libelle).toContain('+2')
    expect(ctx?.libelle).not.toContain('C')
    expect(ctx?.libelle).not.toContain('Fin')
    expect(ctx?.filtres?.fin).toBe('2026-09')
  })

  it('reste dans les bornes du contrat avec une tres longue liste', () => {
    const ids = Array.from({ length: 800 }, (_, i) => `identifiant-long-${i}`)
    const ctx = construireContexteFiltres({
      titre: 'T',
      champs: [{ cle: 'produits', etiquette: 'Produits', valeur: ids, noms: ids }],
    })
    expect(ctx?.libelle?.length).toBeLessThanOrEqual(300)
    expect(ContexteEcranSchema.safeParse({ chemin: '/x', ...ctx }).success).toBe(true)
  })
})

describe('libelleMoisAAAAMM', () => {
  it('met en forme un mois valide et laisse le reste', () => {
    expect(libelleMoisAAAAMM('2026-09', 'fr')).toMatch(/2026/)
    expect(libelleMoisAAAAMM('septembre', 'fr')).toBe('septembre')
  })
})

describe('libellePeriodeDates', () => {
  it('dates lisibles dans la langue, sans ISO brut', () => {
    const fr = libellePeriodeDates('2026-09-01', '2026-09-30', 'fr-FR')
    expect(fr).not.toMatch(/2026-09/)
    expect(fr).toMatch(/1.*sept.*2026.*30.*sept.*2026/)
    expect(libellePeriodeDates('2026-09-01', '2026-09-30', 'en-US')).toMatch(/Sep 1, 2026/)
  })
  it('une seule date si debut = fin ; valeur inchangee si pas ISO', () => {
    expect(libellePeriodeDates('2026-09-01', '2026-09-01', 'fr-FR')).not.toContain('–')
    expect(libelleDateISO('abc', 'fr-FR')).toBe('abc')
  })
  it('le libelle du contexte est lisible alors que filtres reste en ISO', () => {
    const c = construireContexteFiltres({
      titre: 'Rapports de Ventes',
      locale: 'fr-FR',
      champs: [
        { cle: 'dateDebut', etiquette: 'Période', valeur: '2026-09-01', affichage: libellePeriodeDates('2026-09-01', '2026-09-30', 'fr-FR') },
        { cle: 'dateFin', etiquette: 'Période', valeur: '2026-09-30', horsLibelle: true },
      ],
    })
    expect(c?.libelle).not.toMatch(/2026-09/)
    expect(c?.filtres).toMatchObject({ dateDebut: '2026-09-01', dateFin: '2026-09-30' })
  })
})
