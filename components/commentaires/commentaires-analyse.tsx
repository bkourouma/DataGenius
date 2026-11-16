import { exigerMedicAssist } from '@/lib/medic-assist/acces';
import { ErreurCommentaire, listerCommentaires } from '@/lib/commentaires/commentaires';
import { journal } from '@/lib/journal';

import { CommentairesClient } from './commentaires-client';

/** Commentaires d'une analyse : rien n'est rendu si l'analyse n'est pas visible. */
export async function CommentairesAnalyse({ artefactId }: { artefactId: string }) {
  const acces = await exigerMedicAssist();
  if (!acces.ok) return null;
  try {
    const commentaires = await listerCommentaires(acces.contexte, artefactId);
    return <CommentairesClient artefactId={artefactId} commentaires={commentaires} />;
  } catch (erreur) {
    // « introuvable » : analyse non visible, rien à signaler. Autre erreur : journalisée par son nom
    // seulement, l'analyse reste affichée sans commentaires.
    if (!(erreur instanceof ErreurCommentaire && erreur.code === 'introuvable')) {
      journal.erreur('Lecture des commentaires impossible', {
        domaine: 'commentaires', erreur: erreur instanceof Error ? erreur.name : 'inconnue',
      });
    }
    return null;
  }
}
