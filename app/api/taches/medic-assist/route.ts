/**
 * POST /api/taches/medic-assist
 *
 * Envoie les rapports programmes de Medic Assist qui sont arrives a echeance
 * (voir lib/medic-assist/suivi/rapports-programmes.ts). Idempotente : deux
 * appels simultanes n'envoient chaque rapport qu'une fois.
 *
 * Appelee toutes les 15 minutes par la tache planifiee Windows du serveur
 * (deploy/windows/tache-medic-assist.ps1), donc sans session : elle
 * s'authentifie par l'en-tete `Authorization: Bearer <JETON_TACHES_PLANIFIEES>`.
 * Sans jeton configure, elle reste fermee : un poste de developpement, dont la
 * base est une copie de la production, ne peut pas ecrire aux utilisateurs.
 */

import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

import { purgerPiecesJointes } from '@/lib/medic-assist/pieces-jointes/purge'
import { traiterRapportsEchus } from '@/lib/medic-assist/suivi/rapports-programmes'
import { nomErreur } from '@/lib/medic-assist/suivi/erreurs'
import { traiterAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'

export const dynamic = 'force-dynamic'
/** Secondes : le traitement des rapports peut etre long (exports + envois). */
export const maxDuration = 300

/** Au-dela, la boucle des rapports ne commence plus de rapport (le reste est repris a l'appel suivant). */
const BUDGET_RAPPORTS_MS = 240_000

/** En dessous, un jeton se devine : la route le traite comme absent. */
const LONGUEUR_MIN_JETON = 32

function jetonValide(entete: string | null, attendu: string): boolean {
  const recu = entete?.startsWith('Bearer ') ? entete.slice('Bearer '.length) : ''
  // Comparaison a temps constant, sur des empreintes de meme longueur.
  const empreinte = (valeur: string) => createHash('sha256').update(valeur).digest()
  return timingSafeEqual(empreinte(recu), empreinte(attendu))
}

export async function POST(request: NextRequest) {
  const attendu = process.env.JETON_TACHES_PLANIFIEES?.trim() ?? ''
  if (attendu.length < LONGUEUR_MIN_JETON) {
    return NextResponse.json(
      { error: 'Tâches planifiées désactivées : JETON_TACHES_PLANIFIEES absent ou trop court' },
      { status: 503 }
    )
  }
  if (!jetonValide(request.headers.get('authorization'), attendu)) {
    return NextResponse.json({ error: 'Jeton invalide' }, { status: 401 })
  }

  try {
    const [bilan, alertes] = await Promise.all([
      traiterRapportsEchus({ budgetMs: BUDGET_RAPPORTS_MS }),
      traiterAlertesTableaux(),
    ])
    console.info('[medic-assist] Rapports programmés :', JSON.stringify(bilan))

    // Purge des pieces jointes : un echec ne fait echouer ni le reste ni la reponse.
    let purge: { lignesSupprimees: number; fichiersSupprimes: number } | { erreur: true } = {
      erreur: true,
    }
    try {
      purge = await purgerPiecesJointes()
      console.info('[datagenius] taches', { tache: 'purge-pieces-jointes', ...purge })
    } catch (error) {
      console.error('[datagenius] taches', {
        tache: 'purge-pieces-jointes',
        resultat: 'echec',
        nomErreur: nomErreur(error),
      })
    }
    return NextResponse.json({ ...bilan, alertes, purge })
  } catch (error) {
    console.error('[medic-assist] Rapports programmés interrompus :', nomErreur(error))
    return NextResponse.json(
      { error: "Erreur lors de l'envoi des rapports programmés" },
      { status: 500 }
    )
  }
}
