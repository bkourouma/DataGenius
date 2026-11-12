import { NextRequest, NextResponse } from 'next/server'

import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import {
  construireExport,
  creerTraducteurServeur,
  enteteContentDisposition,
} from '@/lib/medic-assist/artefacts/exports'
import { ErreurExport, type CodeErreurExport } from '@/lib/medic-assist/artefacts/ports'
import { ExportArtefactQuerySchema, IdentifiantSchema } from '@/lib/medic-assist/contrats'
import {
  CODE_LIMITE_DEBIT_DONNEES,
  minutesAvantReessai,
} from '@/lib/medic-assist/donnees/limite-debit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { id: string }
}

/** Code HTTP, nom d'erreur et clé de message (traduisible) de chaque erreur d'export. */
const REPONSES_ERREUR: Record<
  CodeErreurExport,
  { status: number; error: string; cle: string; repli: string }
> = {
  // Artefact absent, non partagé avec le lecteur ou jeu inaccessible : même réponse,
  // pour ne jamais révéler l'existence d'un artefact.
  introuvable: { status: 404, error: 'NotFound', cle: 'introuvable', repli: 'Artifact not found' },
  jeu_indisponible: {
    status: 404,
    error: 'NotFound',
    cle: 'introuvable',
    repli: 'Artifact not found',
  },
  format_non_supporte: {
    status: 400,
    error: 'UnsupportedFormat',
    cle: 'formatNonSupporte',
    repli: 'Export format not available for this artifact',
  },
  trop_de_lignes: {
    status: 413,
    error: 'PayloadTooLarge',
    cle: 'tropDeLignes',
    repli: 'Too many rows to export',
  },
  limite_debit: {
    status: 429,
    error: 'TooManyRequests',
    cle: 'limiteDebit',
    repli: 'Too many recalculations. Try again in a few minutes.',
  },
  echec: { status: 500, error: 'ExportFailed', cle: 'echec', repli: 'Export failed' },
}

async function message(
  locale: Parameters<typeof creerTraducteurServeur>[0] | undefined,
  cle: string,
  repli: string,
  valeurs?: Record<string, string | number>
): Promise<string> {
  try {
    const { traduire } = await creerTraducteurServeur(locale ?? 'fr')
    const texte = traduire(`exports.erreurs.${cle}`, valeurs)
    return texte.startsWith('exports.') ? repli : texte
  } catch {
    return repli
  }
}

/**
 * GET /api/medic-assist/artefacts/[id]/export?format=xlsx|csv|pdf|pptx[&version=n]
 *
 * Télécharge un artefact Medic Assist (tableau, graphique, indicateurs, document) dans le
 * format demandé, avec les données COMPLÈTES recalculées dans le périmètre du lecteur.
 * `version` : version à exporter, la dernière par défaut.
 *
 * - Accès : `exigerMedicAssist()` (401 sans session, 403 sans droit). Le contexte
 *   (utilisateur, rôle, périmètre, langue) vient de la session, jamais du client.
 * - 400 : identifiant invalide, format absent ou inconnu, `version` invalide, ou format non disponible pour cet artefact (csv d'un document).
 * - 404 : artefact introuvable, d'un autre utilisateur non partagé, ou jeu inaccessible
 *   (même réponse dans les trois cas).
 * - 413 : plus de 100 000 lignes. 429 : trop de rejeux de jeux (limite de débit), avec
 *   `Retry-After` en secondes et le code `limite_debit_donnees`. 500 : échec, sans détail interne.
 * - Réponse : fichier binaire, `Content-Disposition: attachment` (nom ASCII + `filename*`
 *   UTF-8, RFC 5987), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const garde = await exigerMedicAssist()
  if (!garde.ok) return garde.reponse
  const { contexte } = garde

  // Identifiant invalide : refusé avant tout accès aux données.
  const id = IdentifiantSchema.safeParse(params.id)
  if (!id.success) {
    return NextResponse.json(
      { error: 'BadRequest', message: 'Requête invalide.' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    )
  }

  const parametres = new URL(request.url).searchParams
  const lecture = ExportArtefactQuerySchema.safeParse({
    format: parametres.get('format') ?? undefined,
    version: parametres.get('version') ?? undefined,
  })
  if (!lecture.success) {
    return NextResponse.json(
      {
        error: 'BadRequest',
        message: await message(
          contexte.locale,
          'formatInvalide',
          'Unknown export format (xlsx, csv, pdf, pptx)'
        ),
      },
      { status: 400 }
    )
  }

  try {
    const resultat = await construireExport(contexte, id.data, lecture.data.format, {
      version: lecture.data.version,
      exportePar: garde.session.user.name ?? undefined,
    })
    const corps = new Uint8Array(
      resultat.buffer.buffer,
      resultat.buffer.byteOffset,
      resultat.buffer.byteLength
    )
    return new NextResponse(corps as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': resultat.typeMime,
        'Content-Disposition': enteteContentDisposition(resultat.nomFichier),
        'Content-Length': String(resultat.buffer.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (erreur) {
    const code: CodeErreurExport = erreur instanceof ErreurExport ? erreur.code : 'echec'
    if (code === 'echec') {
      // Ni titre, ni données, ni message d'origine : seulement le type de l'erreur.
      const cause = erreur instanceof ErreurExport ? (erreur as { cause?: unknown }).cause : erreur
      console.error(
        '[medic-assist] export en échec',
        cause instanceof Error ? cause.name : typeof cause
      )
    }
    const r = REPONSES_ERREUR[code]
    if (code === 'limite_debit') {
      const ms = (erreur as ErreurExport).reessayerDansMs ?? 60_000
      return NextResponse.json(
        {
          error: r.error,
          code: CODE_LIMITE_DEBIT_DONNEES,
          message: await message(contexte.locale, r.cle, r.repli, {
            minutes: minutesAvantReessai(ms),
          }),
        },
        {
          status: r.status,
          headers: { 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) },
        }
      )
    }
    return NextResponse.json(
      { error: r.error, message: await message(contexte.locale, r.cle, r.repli) },
      { status: r.status }
    )
  }
}
