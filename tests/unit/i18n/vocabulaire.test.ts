import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ESPACES = ['ecrans', 'sources', 'tableaux', 'historique', 'notifications', 'journal', 'glossaire', 'etatWorker'] as const
type Arbre = { [cle: string]: string | Arbre }

function aplatir(arbre: Arbre, prefixe = ''): Record<string, string> {
  const sortie: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(arbre)) {
    if (typeof valeur === 'string') sortie[prefixe + cle] = valeur
    else Object.assign(sortie, aplatir(valeur, prefixe + cle + '.'))
  }
  return sortie
}

function messages(langue: string, espace: string): Record<string, string> {
  return aplatir(JSON.parse(readFileSync(resolve(__dirname, `../../../messages/${langue}/${espace}.json`), 'utf8')))
}

/**
 * Un seul terme par notion (tableau de bord, tuile, jeu de données, source, indicateur, analyse) et par langue,
 * dans tous les espaces. Les variantes écartées sont interdites ; les clés « motsCles » (synonymes de recherche) sont exemptées.
 */
const VOCABULAIRE: Record<string, { tableauDeBord: string; interdits: RegExp[] }> = {
  en: { tableauDeBord: 'dashboard', interdits: [/\bboards?\b(?<!dash)/i, /\bwidgets?\b/i, /\bcards?\b/i] },
  es: { tableauDeBord: 'panel', interdits: [/\btableros?\b/i, /\bmosaicos?\b/i, /\bdashboards?\b/i, /cuadros? de mando/i] },
  ar: { tableauDeBord: 'لوحة المتابعة', interdits: [/لوحات? المؤشرات/, /لوحات? المعلومات/, /بلاط/] },
  hi: { tableauDeBord: 'डैशबोर्ड', interdits: [/डेटा स्रोत/, /डेटा-?सेट\b(?<!डेटासेट)/] },
  zh: { tableauDeBord: '仪表板', interdits: [/看板/, /仪表盘/, /磁贴/, /数据来源集/] },
}

describe.each(Object.entries(VOCABULAIRE))('vocabulaire cohérent (%s)', (langue, { tableauDeBord, interdits }) => {
  const tous = ESPACES.flatMap((espace) =>
    Object.entries(messages(langue, espace))
      .filter(([cle]) => !/(^|\.)motsCles$/.test(cle))
      .map(([cle, valeur]) => ({ espace, cle, valeur })))

  it.each(interdits.map((motif) => [String(motif), motif] as const))('aucune variante écartée %s', (_nom, motif) => {
    expect(tous.filter((m) => motif.test(m.valeur)).map((m) => `${m.espace}:${m.cle}`)).toEqual([])
  })

  it('emploie le terme retenu pour « tableau de bord » dans plusieurs espaces', () => {
    const espaces = new Set(tous.filter((m) => m.valeur.toLowerCase().includes(tableauDeBord)).map((m) => m.espace))
    expect(espaces.has('tableaux')).toBe(true)
    expect(espaces.size).toBeGreaterThanOrEqual(3)
  })
})
