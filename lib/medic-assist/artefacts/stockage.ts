/**
 * Stockage des artefacts : signatures figees par le lot 0 (architecture §4, §6), implementees
 * dans `stockage-impl.ts` (lot 4). Les lots 1 (outils de l'agent), 5 et 6 importent d'ici.
 *
 * - `creerArtefact(contexte, entree) -> ArtefactCree` : version 1 dans `contexte.conversationId`,
 *   specification revalidee par zod, jeux et artefacts cites appartenant au lecteur.
 * - `modifierArtefact(contexte, entree) -> ArtefactCree` : nouvelle version (proprietaire seul).
 * - `lireArtefact(contexte, artefactId, options?) -> ArtefactDto` : proprietaire OU partage OU
 *   epingle, verifie dans le meme `where`.
 *
 * Erreurs : `ErreurArtefact` (codes spec_invalide, jeu_inaccessible, introuvable, interdit,
 * conflit), re-exportee d'ici pour que l'appelant n'importe pas l'implementation.
 */

export { creerArtefact, modifierArtefact, lireArtefact, ErreurArtefact } from './stockage-impl'
export type { CodeErreurArtefact } from './stockage-impl'
