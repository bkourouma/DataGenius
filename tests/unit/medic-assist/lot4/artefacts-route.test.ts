/**
 * GET /api/medic-assist/artefacts?conversationId= : garde propagee, validation, liste.
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const garde = vi.hoisted(() => ({ exigerMedicAssist: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => garde)
vi.mock('@/lib/db/client', () => ({ prisma: {}, default: {} }))

const stockage = vi.hoisted(() => ({ listerArtefactsConversation: vi.fn() }))
vi.mock('@/lib/medic-assist/artefacts/stockage-impl', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/artefacts/stockage-impl')>()),
  listerArtefactsConversation: stockage.listerArtefactsConversation,
}))
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  lireJeu: vi.fn(),
  lignesCompletesPourExport: vi.fn(),
}))

import { GET } from '@/app/api/medic-assist/artefacts/route'
import { ErreurArtefact } from '@/lib/medic-assist/artefacts/stockage-impl'

const CONTEXTE = { userId: 'u1', roleName: 'ExecView', habilitations: null }

function connecte() {
  garde.exigerMedicAssist.mockResolvedValue({
    ok: true,
    session: { user: { id: 'u1' } },
    scope: {},
    contexte: CONTEXTE,
  })
}

const appeler = (query = '?conversationId=c1') =>
  GET(new NextRequest(`http://localhost/api/medic-assist/artefacts${query}`))

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  connecte()
})

describe('GET /api/medic-assist/artefacts', () => {
  it('propage le 401 de la garde sans rien lire', async () => {
    garde.exigerMedicAssist.mockResolvedValue({
      ok: false,
      reponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    expect((await appeler()).status).toBe(401)
    expect(stockage.listerArtefactsConversation).not.toHaveBeenCalled()
  })

  it('propage le 403 de la garde', async () => {
    garde.exigerMedicAssist.mockResolvedValue({
      ok: false,
      reponse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    })
    expect((await appeler()).status).toBe(403)
    expect(stockage.listerArtefactsConversation).not.toHaveBeenCalled()
  })

  it.each([
    ['', 'absent'],
    ['?conversationId=', 'vide'],
    ['?conversationId=a%20b', 'mal forme'],
  ])('400 si conversationId est %2$s', async query => {
    const r = await appeler(query)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('BadRequest')
    expect(stockage.listerArtefactsConversation).not.toHaveBeenCalled()
  })

  it('renvoie la liste, avec le contexte de la session et sans cache', async () => {
    const artefacts = [
      {
        id: 'a',
        racineId: 'a',
        type: 'tableau',
        titre: 'T',
        version: 1,
        majA: '2026-11-01T00:00:00Z',
      },
    ]
    stockage.listerArtefactsConversation.mockResolvedValue(artefacts)
    const r = await appeler()
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await r.json()).toEqual({ artefacts })
    expect(stockage.listerArtefactsConversation).toHaveBeenCalledWith(CONTEXTE, 'c1')
  })

  it('conversation d’un autre : liste vide, 200', async () => {
    stockage.listerArtefactsConversation.mockResolvedValue([])
    const r = await appeler('?conversationId=c-autre')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ artefacts: [] })
  })

  it('500 sans detail interne en cas d’erreur inattendue', async () => {
    stockage.listerArtefactsConversation.mockRejectedValue(new Error('SELECT * FROM secret'))
    const r = await appeler()
    expect(r.status).toBe(500)
    expect(JSON.stringify(await r.json())).not.toContain('SELECT')
  })

  it('traduit une ErreurArtefact', async () => {
    stockage.listerArtefactsConversation.mockRejectedValue(new ErreurArtefact('introuvable', 'x'))
    expect((await appeler()).status).toBe(404)
  })
})
