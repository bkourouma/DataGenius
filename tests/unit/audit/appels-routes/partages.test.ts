/**
 * Appels d'audit des routes de partage : POST (partage.creation) et DELETE (partage.retrait).
 * Garde, service de partage et audit sont doublés.
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exigerMedicAssist: vi.fn(),
  partager: vi.fn(),
  retirerPartage: vi.fn(),
  enregistrerAudit: vi.fn(),
}))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist: mocks.exigerMedicAssist }))
vi.mock('@/lib/medic-assist/suivi/partages', () => ({
  partager: mocks.partager,
  retirerPartage: mocks.retirerPartage,
  listerPartagesEnvoyes: vi.fn(),
  listerPartagesRecus: vi.fn(),
}))
vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: mocks.enregistrerAudit }))
vi.mock('@/lib/audit/ip', () => ({ ipRequeteCourante: () => '203.0.113.9' }))

import { POST } from '@/app/api/medic-assist/partages/route'
import { DELETE } from '@/app/api/medic-assist/partages/[id]/route'
import { ErreurSuivi } from '@/lib/medic-assist/suivi/erreurs'

const CONTEXTE = { userId: 'u1', roleName: 'CountryLead', locale: 'fr' }

function connecte() {
  mocks.exigerMedicAssist.mockResolvedValue({ ok: true, session: { user: { id: 'u1' } }, contexte: CONTEXTE })
}
function refuse(statut: number) {
  mocks.exigerMedicAssist.mockResolvedValue({
    ok: false,
    reponse: NextResponse.json({ error: 'x', message: 'x' }, { status: statut }),
  })
}
const post = (corps: unknown) =>
  POST(
    new NextRequest('http://localhost/api/medic-assist/partages', {
      method: 'POST',
      body: typeof corps === 'string' ? corps : JSON.stringify(corps),
    })
  )
const supprimer = (id = 'p1') =>
  DELETE(new NextRequest(`http://localhost/api/medic-assist/partages/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.enregistrerAudit.mockResolvedValue(undefined)
  connecte()
})

describe('POST /api/medic-assist/partages : audit', () => {
  it('journalise une seule fois partage.creation, après partager, sans e-mail ni message', async () => {
    mocks.partager.mockResolvedValue({ partages: 2 })
    const r = await post({
      objet: 'artefact',
      objetId: 'art1',
      destinataires: ['d1', 'd2', 'd3'],
      message: 'Bonjour, voici mon rapport confidentiel',
    })
    expect(r.status).toBe(201)
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
    const entree = mocks.enregistrerAudit.mock.calls[0][0]
    expect(entree.action).toBe('partage.creation')
    expect(entree.acteurId).toBe('u1')
    expect(entree.cible).toEqual({ type: 'artefact', id: 'art1' })
    expect(entree.details).toEqual({ destinataires: 3, nouveaux: 2 })
    expect(mocks.partager.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enregistrerAudit.mock.invocationCallOrder[0]
    )
    const texte = JSON.stringify(mocks.enregistrerAudit.mock.calls)
    expect(texte).not.toContain('@')
    expect(texte).not.toContain('confidentiel')
  })

  it('accepte la forme {cible} et reprend le type et l’id de la cible', async () => {
    mocks.partager.mockResolvedValue({ partages: 1 })
    const r = await post({ cible: { type: 'conversation', id: 'c9' }, destinataires: ['d1'] })
    expect(r.status).toBe(201)
    expect(mocks.enregistrerAudit.mock.calls[0][0].cible).toEqual({ type: 'conversation', id: 'c9' })
  })

  it('corps invalide : aucun audit', async () => {
    expect((await post('pas du json')).status).toBe(400)
    expect((await post({ objet: 'artefact', destinataires: ['d1'] })).status).toBe(400)
    expect((await post({ objet: 'artefact', objetId: 'a1', destinataires: [] })).status).toBe(400)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it('ErreurSuivi introuvable : aucun audit', async () => {
    mocks.partager.mockRejectedValue(new ErreurSuivi('introuvable'))
    const r = await post({ objet: 'artefact', objetId: 'a1', destinataires: ['d1'] })
    expect(r.status).toBe(404)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it.each([401, 403])('refus du garde (%i) : ni partage ni audit', async statut => {
    refuse(statut)
    const r = await post({ objet: 'artefact', objetId: 'a1', destinataires: ['d1'] })
    expect(r.status).toBe(statut)
    expect(mocks.partager).not.toHaveBeenCalled()
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/medic-assist/partages/[id] : audit', () => {
  it('journalise partage.retrait après retirerPartage', async () => {
    mocks.retirerPartage.mockResolvedValue(undefined)
    const r = await supprimer('p42')
    expect(r.status).toBe(200)
    expect(mocks.enregistrerAudit).toHaveBeenCalledTimes(1)
    const entree = mocks.enregistrerAudit.mock.calls[0][0]
    expect(entree).toEqual({ acteurId: 'u1', action: 'partage.retrait', cible: { type: 'partage', id: 'p42' } })
    expect(mocks.retirerPartage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enregistrerAudit.mock.invocationCallOrder[0]
    )
  })

  it('partage inexistant (ErreurSuivi) : aucun audit', async () => {
    mocks.retirerPartage.mockRejectedValue(new ErreurSuivi('introuvable'))
    expect((await supprimer()).status).toBe(404)
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })

  it.each([401, 403])('refus du garde (%i) : aucun audit', async statut => {
    refuse(statut)
    expect((await supprimer()).status).toBe(statut)
    expect(mocks.retirerPartage).not.toHaveBeenCalled()
    expect(mocks.enregistrerAudit).not.toHaveBeenCalled()
  })
})
