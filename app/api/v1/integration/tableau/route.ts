import { z } from 'zod'
import { consommerJeton, origineAutorisee } from '@/lib/integration/embarquement'
import { lireCorps, limiterIntegration } from '@/lib/integration/http'
import { lireTableau } from '@/lib/warehouse/tableaux'

export const dynamic = 'force-dynamic'

const filtreSchema = z.object({ cle: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), valeur: z.string().min(1).max(300) })
const remplacer: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const texte = (valeur: unknown) => String(valeur ?? '—').replace(/[&<>"']/g, c => remplacer[c])

function page(origine: string | null, contenu: string, status = 200) {
  return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data Genius</title><style>body{font:16px system-ui,sans-serif;margin:1rem;color:#162637;background:#f8fafc}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:.8rem}article{border:1px solid #ccd5df;border-radius:.5rem;background:#fff;padding:1rem;overflow-wrap:anywhere}h2{font-size:1rem;margin-top:0}strong{font-size:1.5rem}p{margin-bottom:0}</style><body>${contenu}</body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${origine ?? "'none'"}`,
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function POST(request: Request) {
  const origine = request.headers.get('origin')
  if (!origine || !origineAutorisee(origine)) return page(null, '<p>Origine interdite.</p>', 403)
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return page(origine, '<p>Format de requête non pris en charge.</p>', 415)
  }
  let corps: URLSearchParams
  try { corps = new URLSearchParams(await lireCorps(request, 4096)) } catch { return page(origine, '<p>Requête invalide.</p>', 400) }
  const jeton = corps.get('jeton')
  const aFiltre = corps.has('filtre') || corps.has('valeur')
  const filtre = aFiltre ? filtreSchema.safeParse({ cle: corps.get('filtre'), valeur: corps.get('valeur') }) : undefined
  if (!jeton || (filtre && !filtre.success)) return page(origine, '<p>Requête invalide.</p>', 400)
  const acces = await consommerJeton(jeton, origine)
  if (!acces) return page(origine, '<p>Autorisation expirée ou invalide.</p>', 403)
  if (limiterIntegration(acces.contexte.userId)) return page(origine, '<p>Réessayez dans quelques instants.</p>', 429)
  const tableau = await lireTableau(acces.id, acces.contexte, filtre?.data)
  if (!tableau) return page(origine, '<p>Tableau indisponible.</p>', 404)
  if (filtre?.data && !tableau.filtres.includes(filtre.data.cle)) return page(origine, '<p>Filtre indisponible.</p>', 400)
  const cartes = tableau.tuiles.flatMap(tuile => {
    if (tuile.type === 'indisponible') return []
    if (tuile.type === 'artefact') return filtre ? [] : [`<article><h2>${texte(tuile.artefact.titre)}</h2><p>Artefact · version ${texte(tuile.artefact.version)}</p></article>`]
    if (filtre && !tuile.filtreApplique) return []
    const valeur = tuile.resultat.lignes[0]?.[tuile.resultat.colonnes[0]?.cle]
    return [`<article><h2>${texte(tuile.libelle)}</h2><strong>${texte(valeur)}</strong> ${texte(tuile.unite ?? '')}<p>${texte(tuile.resultat.provenance.libelleSource)}</p></article>`]
  })
  return page(origine, `<h1>${texte(tableau.titre)}</h1>${cartes.length ? `<main>${cartes.join('')}</main>` : '<p>Aucun indicateur disponible.</p>'}`)
}
