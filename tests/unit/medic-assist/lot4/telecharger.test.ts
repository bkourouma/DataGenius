import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ErreurTelechargement,
  nomDepuisContentDisposition,
  telechargerDepuisUrl,
  urlExport,
} from '@/lib/medic-assist/artefacts/telecharger'

describe('urlExport', () => {
  it("construit l'URL de l'export et encode l'identifiant", () => {
    expect(urlExport('abc', 'xlsx')).toBe('/api/medic-assist/artefacts/abc/export?format=xlsx')
    expect(urlExport('a/b?c', 'pdf')).toBe('/api/medic-assist/artefacts/a%2Fb%3Fc/export?format=pdf')
  })

  it("ajoute ?version=n quand une version est fournie, et l'ignore si elle est invalide", () => {
    expect(urlExport('abc', 'xlsx', 3)).toBe(
      '/api/medic-assist/artefacts/abc/export?format=xlsx&version=3'
    )
    expect(urlExport('abc', 'xlsx', 0)).toBe('/api/medic-assist/artefacts/abc/export?format=xlsx')
    expect(urlExport('abc', 'xlsx', 1.5)).toBe('/api/medic-assist/artefacts/abc/export?format=xlsx')
  })
})

describe('nomDepuisContentDisposition', () => {
  it('lit filename entre guillemets', () => {
    expect(nomDepuisContentDisposition('attachment; filename="CA par pays.xlsx"')).toBe(
      'CA par pays.xlsx'
    )
  })

  it("préfère filename* (UTF-8) à filename", () => {
    const entete =
      'attachment; filename="CA par pays 2026-11-02.xlsx"; filename*=UTF-8\'\'CA%20par%20pays%20%E2%80%93%20C%C3%B4te%20d%27Ivoire.xlsx'
    expect(nomDepuisContentDisposition(entete)).toBe("CA par pays – Côte d'Ivoire.xlsx")
  })

  it('retire les séparateurs de chemin', () => {
    expect(nomDepuisContentDisposition('attachment; filename="../../etc/passwd"')).toBe(
      '.._.._etc_passwd'
    )
  })

  it('renvoie null sans nom exploitable', () => {
    expect(nomDepuisContentDisposition(null)).toBeNull()
    expect(nomDepuisContentDisposition('attachment')).toBeNull()
  })
})

describe('telechargerDepuisUrl', () => {
  let noms: string[]
  const revoquer = vi.fn()

  beforeEach(() => {
    noms = []
    vi.useFakeTimers()
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = revoquer
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      noms.push(this.download)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    revoquer.mockReset()
  })

  function reponse(statut: number, entetes: Record<string, string> = {}) {
    return new Response('contenu', { status: statut, headers: entetes })
  }

  it('télécharge avec le nom du serveur, sans laisser de lien, et libère le Blob', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reponse(200, { 'Content-Disposition': 'attachment; filename="Export serveur.csv"' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await telechargerDepuisUrl('/api/x', 'repli.csv')

    expect(fetchMock).toHaveBeenCalledWith('/api/x', { credentials: 'same-origin' })
    expect(noms).toEqual(['Export serveur.csv'])
    expect(document.querySelector('a[download]')).toBeNull()
    vi.runAllTimers()
    expect(revoquer).toHaveBeenCalledWith('blob:test')
  })

  it("utilise le nom de repli quand le serveur n'en donne pas", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(200)))
    await telechargerDepuisUrl('/api/x', 'Mon titre.pdf')
    expect(noms).toEqual(['Mon titre.pdf'])
  })

  it.each([
    [401, 'refuse'],
    [403, 'refuse'],
    [404, 'introuvable'],
    [400, 'format'],
    [413, 'trop_de_lignes'],
    [500, 'echec'],
  ])('statut %i donne le code %s', async (statut, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponse(statut)))
    await expect(telechargerDepuisUrl('/api/x', 'r.csv')).rejects.toMatchObject({
      name: 'ErreurTelechargement',
      code,
    })
    expect(noms).toEqual([])
  })

  it('signale un serveur injoignable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const erreur = await telechargerDepuisUrl('/api/x', 'r.csv').catch(e => e)
    expect(erreur).toBeInstanceOf(ErreurTelechargement)
    expect(erreur.code).toBe('reseau')
  })
})
