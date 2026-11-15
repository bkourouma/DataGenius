import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((chemin: string) => { throw new Error(`REDIRECT:${chemin}`) }),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (cle: string, valeurs?: Record<string, unknown>) =>
    valeurs ? `${cle} ${JSON.stringify(valeurs)}` : cle),
  getLocale: vi.fn(async () => 'fr'),
}))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerAdminMedicAssist: vi.fn() }))
vi.mock('@/lib/audit/lecture', () => ({ listerAudit: vi.fn(), lireAuditPourExport: vi.fn() }))
vi.mock('@/lib/audit/enregistrer', () => ({ enregistrerAudit: vi.fn(async () => undefined) }))
vi.mock('@/lib/journal', () => ({ journal: { erreur: vi.fn(), info: vi.fn(), avertissement: vi.fn(), enfant: vi.fn() } }))

import JournalPage from '@/app/(dashboard)/journal/page'
import { GET } from '@/app/(dashboard)/journal/export/route'
import { enregistrerAudit } from '@/lib/audit/enregistrer'
import { lireAuditPourExport, listerAudit } from '@/lib/audit/lecture'
import type { LigneAudit } from '@/lib/audit/types'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'

const ligne = (surcharge: Partial<LigneAudit> = {}): LigneAudit => ({
  id: '1',
  faitA: new Date('2025-03-01T10:00:00.000Z'),
  acteurId: 'u1',
  acteurNom: 'Marie',
  action: 'source.creation',
  cibleType: 'source',
  cibleId: 's1',
  cibleLibelle: '=1+1',
  resultat: 'succes',
  details: { note: '<b>x</b>' },
  ip: '10.0.0.1',
  ...surcharge,
})

describe('page Journal d’audit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuse un non-administrateur sans lire le journal', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: false, reponse: {} } as never)
    await expect(JournalPage({ searchParams: {} })).rejects.toThrow('REDIRECT:/assistant')
    const { redirect } = await import('next/navigation')
    expect(redirect).toHaveBeenCalledWith('/assistant')
    expect(listerAudit).not.toHaveBeenCalled()
  })

  it('affiche les événements pour un administrateur (searchParams en Promise)', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: true, contexte: { userId: 'moi' } } as never)
    vi.mocked(listerAudit).mockResolvedValue({
      lignes: [ligne(), ligne({ id: '2', acteurId: null, acteurNom: null })],
      total: 120,
      page: 2,
      pages: 3,
    })
    const element = await JournalPage({ searchParams: Promise.resolve({ famille: 'source', page: '2' }) })
    expect(listerAudit).toHaveBeenCalledWith({ famille: 'source' }, 2)
    const html = renderToStaticMarkup(element)
    expect(html).toContain('actions.source_creation')
    expect(html).toContain('acteurInconnu')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('/journal/export?famille=source')
    expect(html).toContain('href="/journal?famille=source"')
  })

  it('affiche l’état vide', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: true, contexte: { userId: 'moi' } } as never)
    vi.mocked(listerAudit).mockResolvedValue({ lignes: [], total: 0, page: 1, pages: 0 })
    const html = renderToStaticMarkup(await JournalPage({}))
    expect(html).toContain('vide')
  })
})

describe('export CSV du journal', () => {
  beforeEach(() => vi.clearAllMocks())

  const requete = () => new NextRequest('http://localhost/journal/export?du=2025-01-01')

  it('renvoie la réponse du garde sans lire les données', async () => {
    const reponse = new Response('interdit', { status: 403 })
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: false, reponse } as never)
    const res = await GET(requete())
    expect(res).toBe(reponse)
    expect(lireAuditPourExport).not.toHaveBeenCalled()
    expect(enregistrerAudit).not.toHaveBeenCalled()
  })

  it('produit un CSV neutralisé et enregistre l’export', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: true, contexte: { userId: 'moi' } } as never)
    vi.mocked(lireAuditPourExport).mockResolvedValue({ lignes: [ligne()], tronque: true })
    const res = await GET(requete())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="journal-audit-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Export-Tronque')).toBe('1')
    const octets = new Uint8Array(await res.arrayBuffer())
    expect([...octets.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const texte = new TextDecoder('utf-8', { ignoreBOM: true }).decode(octets)
    expect(texte.startsWith('﻿export.colonnes.date,export.colonnes.acteur,')).toBe(true)
    expect(texte).toContain("'=1+1")
    expect(lireAuditPourExport).toHaveBeenCalledWith({ depuis: new Date('2025-01-01T00:00:00.000Z') })
    expect(enregistrerAudit).toHaveBeenCalledWith({
      acteurId: 'moi',
      action: 'journal.export',
      cible: { type: 'journal' },
      details: { lignes: 1, tronque: true },
    })
  })

  it('renvoie une 500 générique en cas d’erreur', async () => {
    vi.mocked(exigerAdminMedicAssist).mockResolvedValue({ ok: true, contexte: { userId: 'moi' } } as never)
    vi.mocked(lireAuditPourExport).mockRejectedValue(new Error('secret interne'))
    const res = await GET(requete())
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
