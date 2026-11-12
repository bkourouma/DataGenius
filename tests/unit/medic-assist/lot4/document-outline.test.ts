import { describe, expect, it } from 'vitest'

import {
  extraireTitres,
  planDocument,
  slugifier,
  tableDesMatieresUtile,
  texteDeTitre,
} from '@/lib/medic-assist/artefacts/document-outline'

import type { BlocDocument } from '@/lib/medic-assist/contrats'

describe('slugifier', () => {
  it('retire accents et ponctuation latins', () => {
    expect(slugifier('Côte d’Ivoire : bilan 2026 !')).toBe('cote-d-ivoire-bilan-2026')
  })

  it('garde les lettres arabes, chinoises et hindies', () => {
    expect(slugifier('نظرة عامة')).toBe('نظرة-عامة')
    expect(slugifier('销售概览')).toBe('销售概览')
    expect(slugifier('बिक्री सारांश')).toBe('बिक्री-सारांश')
  })

  it('ne rend jamais une chaîne vide', () => {
    expect(slugifier('???')).toBe('section')
  })
})

describe('texteDeTitre', () => {
  it('retire la mise en forme en ligne', () => {
    expect(texteDeTitre('**Ventes** de [Mali](/pays/ml) `2026` ##')).toBe('Ventes de Mali 2026')
  })
})

describe('extraireTitres', () => {
  it('ramène les niveaux à 2 ou 3 et note la ligne', () => {
    const titres = extraireTitres('# Un\n\ntexte\n\n## Deux\n### Trois\n#### Quatre')
    expect(titres.map(t => [t.niveau, t.texte, t.ligne])).toEqual([
      [2, 'Un', 1],
      [2, 'Deux', 5],
      [3, 'Trois', 6],
      [3, 'Quatre', 7],
    ])
  })

  it('ignore les titres dans un bloc de code et les faux titres', () => {
    const titres = extraireTitres('```\n# pas un titre\n```\n#sansespace\n## Vrai')
    expect(titres.map(t => t.texte)).toEqual(['Vrai'])
  })

  it('rend les ids uniques (doublons numérotés)', () => {
    const titres = extraireTitres('## Ventes\n## Ventes\n## ventes\n## Ventes 2')
    expect(titres.map(t => t.id)).toEqual(['ventes', 'ventes-2', 'ventes-3', 'ventes-2-2'])
    expect(new Set(titres.map(t => t.id)).size).toBe(titres.length)
  })

  it('traite l’arabe et le chinois', () => {
    const titres = extraireTitres('## نظرة عامة\n### 销售概览\n## نظرة عامة')
    expect(titres.map(t => t.id)).toEqual(['نظرة-عامة', '销售概览', 'نظرة-عامة-2'])
  })
})

describe('planDocument', () => {
  const blocs: BlocDocument[] = [
    { type: 'texte', markdown: '## Synthèse\nbla' },
    { type: 'artefact', artefactId: 'a1' },
    { type: 'texte', markdown: '## Synthèse\n### Détail' },
  ]

  it('garde l’unicité entre les blocs et indexe par bloc et par ligne', () => {
    const plan = planDocument(blocs)
    expect(plan.titres.map(t => [t.bloc, t.id])).toEqual([
      [0, 'synthese'],
      [2, 'synthese-2'],
      [2, 'detail'],
    ])
    expect(plan.idsParBloc[0][1]).toBe('synthese')
    expect(plan.idsParBloc[2][2]).toBe('detail')
    expect(plan.idsParBloc[1]).toBeUndefined()
  })

  it('est stable d’un appel à l’autre', () => {
    expect(planDocument(blocs)).toEqual(planDocument(blocs))
  })
})

describe('tableDesMatieresUtile', () => {
  it('exige 3 sections ou plus de 4 000 caractères avec au moins un titre', () => {
    const court = planDocument([{ type: 'texte', markdown: '## A\n## B' }])
    expect(tableDesMatieresUtile(court)).toBe(false)
    const troisSections = planDocument([{ type: 'texte', markdown: '## A\n## B\n### C' }])
    expect(tableDesMatieresUtile(troisSections)).toBe(true)
    const long = planDocument([{ type: 'texte', markdown: `## A\n${'x'.repeat(4001)}` }])
    expect(tableDesMatieresUtile(long)).toBe(true)
    const longSansTitre = planDocument([{ type: 'texte', markdown: 'x'.repeat(5000) }])
    expect(tableDesMatieresUtile(longSansTitre)).toBe(false)
  })
})
