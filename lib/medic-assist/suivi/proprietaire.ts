/**
 * REGLE : seul le PROPRIETAIRE d'un artefact le partage, l'envoie par e-mail,
 * l'attache a une notification ou programme un rapport dessus. Un destinataire en
 * lecture seule peut seulement le voir et l'epingler.
 */

import type { DepotSuivi } from './depot'
import { ErreurSuivi } from './erreurs'
import type { ArtefactVisible } from './types'

/**
 * Renvoie l'artefact dont `userId` est proprietaire (meme where). Un artefact que
 * l'utilisateur voit sans le posseder est refuse avec `artefact_non_proprietaire` ;
 * un artefact qu'il ne voit pas du tout reste `introuvable`.
 */
export async function exigerProprietaireArtefact(
  depot: DepotSuivi,
  artefactId: string,
  userId: string
): Promise<ArtefactVisible> {
  const possede = await depot.trouverArtefactProprietaire(artefactId, userId)
  if (possede) return possede
  const visible = await depot.trouverArtefactVisible(artefactId, userId)
  throw new ErreurSuivi(visible ? 'artefact_non_proprietaire' : 'introuvable')
}

/** Controle sans acces au depot, juste avant d'ecrire des partages. */
export function exigerExpediteurProprietaire(
  artefact: { proprietaireId: string },
  expediteurId: string
): void {
  if (artefact.proprietaireId !== expediteurId) throw new ErreurSuivi('artefact_non_proprietaire')
}
