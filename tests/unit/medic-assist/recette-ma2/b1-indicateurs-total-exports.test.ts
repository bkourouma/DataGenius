/**
 * B-1 (recette MA2) : une carte qui vise un jeu de plusieurs lignes sans `ligne` précisée doit
 * afficher le TOTAL du jeu, à l'écran comme dans les quatre exports (CSV, XLSX, PDF, PPTX),
 * jamais la valeur de la première ligne. Idem pour les indicateurs cités par un document.
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { valeurSansLigne, resoudreIndicateurs } from '@/lib/medic-assist/artefacts/indicateurs'
import { construireCsv } from '@/lib/medic-assist/artefacts/exports/csv'
import { construirePptx } from '@/lib/medic-assist/artefacts/exports/pptx'
import { construireXlsx } from '@/lib/medic-assist/artefacts/exports/xlsx'
import { construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option'
import type { ContexteGraphique, JeuClient } from '@/lib/medic-assist/artefacts/types-rendu'

import { preparerEnvironnementServeur } from '../lot4/_export-serveur'
import { lireClasseur, lignesDeFeuille } from '../lot4/_export-fixtures'
import { compact, JEU, PREMIERE_LIGNE, preparer, SPEC_INDICATEURS, TOTAL } from './_b1-fixtures'

preparerEnvironnementServeur()

async function texteDuPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const textes: string[] = []
  for (const nom of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(nom)) continue
    const xml = await zip.files[nom].async('string')
    for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)) textes.push(m[1])
  }
  return textes.join('\n')
}

describe.each([
  ['artefact « indicateurs »', false],
  ['document qui cite des indicateurs', true],
])('B-1 : %s', (_nom, avecDocument) => {
  it('la carte porte le total du jeu, pas la première ligne', async () => {
    const prep = await preparer(avecDocument)
    const bloc = prep.blocs.find(b => b.type === 'indicateurs')
    expect(bloc?.type).toBe('indicateurs')
    if (bloc?.type !== 'indicateurs') return
    const [carte] = bloc.indicateurs
    expect(carte.valeur).toBe(TOTAL)
    expect(carte.comparaison?.valeur).toBe(814500)
    expect(carte.comparaison?.variationPct).toBeCloseTo(16.6, 1)
    expect(carte.objectif?.valeur).toBe(998757)
    expect(carte.objectif?.taux).toBeCloseTo(95.1, 1)
  })

  it('XLSX : total présent, première ligne absente', async () => {
    const classeur = await lireClasseur(await construireXlsx(await preparer(avecDocument)))
    const cellules = classeur.worksheets
      .flatMap(f => lignesDeFeuille(f))
      .flat()
      .filter((v): v is number => typeof v === 'number')
    expect(cellules).toContain(TOTAL)
    expect(cellules).toContain(998757)
    expect(cellules).not.toContain(PREMIERE_LIGNE)
  })

  it('PPTX : total présent, première ligne absente', async () => {
    const texte = compact(await texteDuPptx(await construirePptx(await preparer(avecDocument))))
    expect(texte).toContain('949756€')
    expect(texte).not.toContain('227504')
  })
})

describe('B-1 : CSV d’un artefact « indicateurs »', () => {
  it('contient 949755,87, +16,6 %, 998757 et 95,1', async () => {
    const csv = construireCsv(await preparer(false)).toString('utf8')
    expect(csv).toContain('949755,87')
    expect(csv).toContain('814500')
    expect(csv).toContain('998757')
    expect(csv).toContain('16,606')
    expect(csv).toContain('95,0937')
    expect(csv).not.toContain('227504')
  })
})

describe('B-1 : règle unique de résolution sans ligne', () => {
  const colonnes = JEU.colonnes
  const jeu = (surcharge: Partial<JeuClient>): JeuClient => ({ ...JEU, ...surcharge })

  it('total du jeu en priorité', () => {
    expect(valeurSansLigne(jeu({}), 'ca')).toBe(TOTAL)
  })

  it('jeu d’une seule ligne sans total : cette ligne', () => {
    const un = jeu({ lignes: [JEU.lignes[0]], totaux: undefined, nbLignes: 1 })
    expect(valeurSansLigne(un, 'ca')).toBe(PREMIERE_LIGNE)
  })

  it('jeu de plusieurs lignes sans total : aucune valeur, jamais la première ligne', () => {
    const sansTotal = jeu({ totaux: undefined })
    expect(valeurSansLigne(sansTotal, 'ca')).toBeNull()
    const [carte] = resoudreIndicateurs(
      (SPEC_INDICATEURS as unknown as { cartes: never[] }).cartes,
      { ventes: sansTotal },
      'fr'
    )
    expect(carte.valeur).toBeNull()
    expect(carte.valeurFormatee).toBe('')
    expect(colonnes.length).toBeGreaterThan(0)
  })

  it('jauge : même règle (total, sinon rien pour un jeu multi-lignes)', () => {
    const contexte = {
      locale: 'fr',
      theme: 'clair',
      rtl: false,
      traduire: (cle: string) => cle,
    } as unknown as ContexteGraphique
    const spec = { forme: 'jauge', y: [{ cle: 'ca' }] } as never
    const avec = construireOptionGraphique(spec, jeu({}), contexte)
    const sans = construireOptionGraphique(spec, jeu({ totaux: undefined }), contexte)
    expect(JSON.stringify(avec)).toContain(String(TOTAL))
    expect(JSON.stringify(avec)).not.toContain(String(PREMIERE_LIGNE))
    expect(sans === null || !JSON.stringify(sans).includes(String(PREMIERE_LIGNE))).toBe(true)
  })
})
