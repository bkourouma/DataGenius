import { NextResponse, type NextRequest } from 'next/server'
import { getTranslations } from 'next-intl/server'

import { construireCsv } from '@/lib/audit/csv'
import { analyserFiltres } from '@/lib/audit/filtres'
import { enregistrerAudit } from '@/lib/audit/enregistrer'
import { lireAuditPourExport } from '@/lib/audit/lecture'
import { journal } from '@/lib/journal'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COLONNES = ['date', 'acteur', 'acteurId', 'action', 'cibleType', 'cibleId', 'cibleLibelle', 'resultat', 'ip', 'details'] as const

export async function GET(request: NextRequest) {
  const garde = await exigerAdminMedicAssist()
  if (!garde.ok) return garde.reponse

  try {
    const { filtres } = analyserFiltres(request.nextUrl.searchParams)
    const [{ lignes, tronque }, t] = await Promise.all([lireAuditPourExport(filtres), getTranslations('journal')])

    const csv = construireCsv(
      COLONNES.map(c => t(`export.colonnes.${c}`)),
      lignes.map(l => [
        l.faitA,
        l.acteurNom,
        l.acteurId,
        l.action,
        l.cibleType,
        l.cibleId,
        l.cibleLibelle,
        l.resultat,
        l.ip,
        l.details && Object.keys(l.details).length > 0 ? JSON.stringify(l.details) : '',
      ]),
    )

    // Tracé après la lecture : l'export lui-même est une action auditée.
    await enregistrerAudit({
      acteurId: garde.contexte.userId,
      action: 'journal.export',
      cible: { type: 'journal' },
      details: { lignes: lignes.length, tronque },
    })

    const jour = new Date().toISOString().slice(0, 10)
    const entetes: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-audit-${jour}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (tronque) entetes['X-Export-Tronque'] = '1'
    return new NextResponse(csv, { status: 200, headers: entetes })
  } catch (erreur) {
    journal.erreur('Export du journal d’audit impossible', {
      domaine: 'audit',
      erreur: erreur instanceof Error ? erreur.name : typeof erreur,
    })
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
