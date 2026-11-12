/**
 * B-1 (recette MA2), export PDF : le total du jeu figure dans le document, pas la première ligne.
 * Fichier à part : pdfmake exige le Uint8Array de Node, que jszip (PPTX) refuse.
 */
import { describe, expect, it } from 'vitest'

import {
  importerSansDocument,
  preparerEnvironnementServeur,
  utiliserUint8ArrayNode,
} from '../lot4/_export-serveur'
import { compact, preparer } from './_b1-fixtures'

preparerEnvironnementServeur()
utiliserUint8ArrayNode()
await importerSansDocument(() => import('pdfmake'))

function texteDe(racine: unknown): string {
  const morceaux: string[] = []
  const pile: unknown[] = [racine]
  while (pile.length > 0) {
    const n = pile.pop()
    if (Array.isArray(n)) pile.push(...n)
    else if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>
      if (typeof o.text === 'string') morceaux.push(o.text)
      for (const v of Object.values(o)) if (v && typeof v === 'object') pile.push(v)
    }
  }
  return morceaux.join(' ')
}

describe.each([
  ['artefact « indicateurs »', false],
  ['document qui cite des indicateurs', true],
])('B-1 PDF : %s', (_nom, avecDocument) => {
  it('total présent, première ligne absente', async () => {
    const { definitionPdf } = await import('@/lib/medic-assist/artefacts/exports/pdf')
    const texte = compact(texteDe(await definitionPdf(await preparer(avecDocument))))
    expect(texte).toContain('949756€')
    expect(texte).not.toContain('227504')
  })
})
