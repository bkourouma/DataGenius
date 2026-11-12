/**
 * GET|PATCH /api/medic-assist/artefacts/[id] : garde propagee, validation, codes HTTP.
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => garde)
vi.mock('@/lib/db/client', () => ({ prisma: {}, default: {} }))
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  lireJeu: vi.fn(),
  lignesCompletesPourExport: vi.fn(),
}))

const stockage = vi.hoisted(() => ({ modifierArtefactParUtilisateur: vi.fn() }))
vi.mock('@/lib/medic-assist/artefacts/stockage-impl', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/stockage-impl')>()),
  modifierArtefactParUtilisateur: stockage.modifierArtefactParUtilisateur,
}))

const service = vi.hoisted(() => ({ construireReponseArtefact: vi.fn() }))
vi.mock('@/lib/medic-assist/artefacts/service-reponse', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/service-reponse')>()),
  construireReponseArtefact: service.construireReponseArtefact,
}))

import { GET, PATCH } from '@/app/api/medic-assist/artefacts/[id]/route'
import { ErreurArtefact } from '@/lib/medic-assist/artefacts/stockage-impl'

const CONTEXTE = { userId: 'u1', roleName: 'ExecView', habilitations: null }
const SPEC = { type: 'tableau', titre: 'CA', jeuDeDonneesId: 'jeu1' }
const REPONSE = { id: 'a1', version: 2, titre: 'CA', donnees: {} }

function connecte() {
  garde.exigerMedicAssist.mockResolvedValue({
    ok: true,
    session: { user: { id: 'u1' } },
    scope: {},
    contexte: CONTEXTE,
  })
}
function refuse(status: number) {
  garde.exigerMedicAssist.mockResolvedValue({
    ok: false,
    reponse: NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status }
    ),
  })
}

const lire = (query = '', id = 'a1') =>
  GET(new NextRequest(`http://localhost/api/medic-assist/artefacts/${id}${query}`), {
    params: { id },
  })
const modifier = (corps: unknown, id = 'a1', entetes: Record<string, string> = {}) =>
  PATCH(
    new NextRequest(`http://localhost/api/medic-assist/artefacts/${id}`, {
      method: 'PATCH',
      body: typeof corps === 'string' ? corps : JSON.stringify(corps),
      headers: { 'content-type': 'application/json', ...entetes },
    }),
    { params: { id } }
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  connecte()
})

describe('GET /api/medic-assist/artefacts/[id]', () => {
  it.each([401, 403])('propage le %s de la garde', async status => {
    refuse(status)
    expect((await lire()).status).toBe(status)
    expect(service.construireReponseArtefact).not.toHaveBeenCalled()
  })

  it('renvoie l’ArtefactReponse, sans cache, version demandee', async () => {
    service.construireReponseArtefact.mockResolvedValue(REPONSE)
    const r = await lire('?version=2')
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await r.json()).toEqual(REPONSE)
    expect(service.construireReponseArtefact).toHaveBeenCalledWith(CONTEXTE, 'a1', { version: 2 })
  })

  it('derniere version par defaut', async () => {
    service.construireReponseArtefact.mockResolvedValue(REPONSE)
    await lire()
    expect(service.construireReponseArtefact).toHaveBeenCalledWith(CONTEXTE, 'a1', {
      version: undefined,
    })
  })

  it.each(['?version=0', '?version=abc', '?version=-1'])('400 pour %s', async query => {
    expect((await lire(query)).status).toBe(400)
    expect(service.construireReponseArtefact).not.toHaveBeenCalled()
  })

  it('404 pour un artefact inaccessible, message neutre', async () => {
    service.construireReponseArtefact.mockRejectedValue(new ErreurArtefact('introuvable', 'x'))
    const r = await lire()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'NotFound', message: 'Artefact introuvable.' })
  })

  it('404 pour un identifiant mal forme, sans interroger le stockage', async () => {
    expect((await lire('', 'a%20b%27--')).status).toBe(404)
    expect(service.construireReponseArtefact).not.toHaveBeenCalled()
  })

  it('500 sans detail interne', async () => {
    service.construireReponseArtefact.mockRejectedValue(new Error('SELECT secret'))
    const r = await lire()
    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toContain('SELECT')
  })
})

describe('PATCH /api/medic-assist/artefacts/[id]', () => {
  beforeEach(() => {
    stockage.modifierArtefactParUtilisateur.mockResolvedValue({
      artefactId: 'a1',
      version: 2,
      type: 'tableau',
      titre: 'CA',
    })
    service.construireReponseArtefact.mockResolvedValue(REPONSE)
  })

  it.each([401, 403])('propage le %s de la garde sans lire le corps', async status => {
    refuse(status)
    expect((await modifier({ spec: SPEC })).status).toBe(status)
    expect(stockage.modifierArtefactParUtilisateur).not.toHaveBeenCalled()
  })

  it('ecrit une nouvelle version et renvoie l’ArtefactReponse de CETTE version', async () => {
    const r = await modifier({ spec: SPEC, versionAttendue: 1 })
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await r.json()).toEqual(REPONSE)
    expect(stockage.modifierArtefactParUtilisateur).toHaveBeenCalledWith(CONTEXTE, 'a1', {
      spec: SPEC,
      versionAttendue: 1,
    })
    expect(service.construireReponseArtefact).toHaveBeenCalledWith(CONTEXTE, 'a1', { version: 2 })
  })

  it('restaure une version', async () => {
    await modifier({ restaurerVersion: 1 })
    expect(stockage.modifierArtefactParUtilisateur).toHaveBeenCalledWith(CONTEXTE, 'a1', {
      restaurerVersion: 1,
    })
  })

  it.each([
    ['JSON invalide', '{pas du json'],
    ['corps vide', ''],
    ['corps sans spec', {}],
    [
      'spec invalide',
      { spec: { type: 'tableau', titre: '<script>x</script>', jeuDeDonneesId: 'j' } },
    ],
    ['champ inconnu', { spec: SPEC, admin: true }],
    ['version a restaurer invalide', { restaurerVersion: 0 }],
  ])('400 : %s', async (_nom, corps) => {
    const r = await modifier(corps)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'BadRequest', message: 'Requête invalide.' })
    expect(stockage.modifierArtefactParUtilisateur).not.toHaveBeenCalled()
  })

  it('413 au-dela de 1 Mo (en-tete annonce)', async () => {
    const r = await modifier({ spec: SPEC }, 'a1', { 'content-length': '1000001' })
    expect(r.status).toBe(413)
    expect(stockage.modifierArtefactParUtilisateur).not.toHaveBeenCalled()
  })

  it('413 au-dela de 1 Mo (corps reel)', async () => {
    const r = await modifier(JSON.stringify({ spec: SPEC, remplissage: 'x'.repeat(1_000_001) }))
    expect(r.status).toBe(413)
    expect(stockage.modifierArtefactParUtilisateur).not.toHaveBeenCalled()
  })

  it.each([
    ['introuvable', 404],
    ['interdit', 403],
    ['conflit', 409],
    ['spec_invalide', 400],
    ['jeu_inaccessible', 400],
  ] as const)('code %s -> HTTP %i', async (code, status) => {
    stockage.modifierArtefactParUtilisateur.mockRejectedValue(
      new ErreurArtefact(code, 'detail interne : SELECT x')
    )
    const r = await modifier({ spec: SPEC })
    expect(r.status).toBe(status)
    const texte = JSON.stringify(await r.json())
    expect(texte).not.toContain('SELECT')
    expect(texte).toContain('"error"')
    expect(texte).toContain('"message"')
  })

  it('404 pour un identifiant mal forme', async () => {
    expect((await modifier({ spec: SPEC }, 'a%20b')).status).toBe(404)
    expect(stockage.modifierArtefactParUtilisateur).not.toHaveBeenCalled()
  })

  it('500 sans detail interne', async () => {
    stockage.modifierArtefactParUtilisateur.mockRejectedValue(new Error('boom SELECT'))
    const r = await modifier({ spec: SPEC })
    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toContain('SELECT')
  })
})
