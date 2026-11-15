import { exigerMedicAssist } from '@/lib/medic-assist/acces';
import { listerCommentaires } from '@/lib/commentaires/commentaires';

import { CommentairesClient } from './commentaires-client';

/** Commentaires d'une analyse : rien n'est rendu si l'analyse n'est pas visible. */
export async function CommentairesAnalyse({ artefactId }: { artefactId: string }) {
  const acces = await exigerMedicAssist();
  if (!acces.ok) return null;
  try {
    const commentaires = await listerCommentaires(acces.contexte, artefactId);
    return <CommentairesClient artefactId={artefactId} commentaires={commentaires} />;
  } catch {
    // « introuvable » ou erreur de lecture : l'analyse reste affichée sans commentaires.
    return null;
  }
}
