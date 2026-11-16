import { getLocale, getTranslations } from 'next-intl/server'

/**
 * Traduction des messages d'erreur français levés par lib/warehouse/tableaux*.ts (sans code).
 * lib ne peut pas être modifié : on reconnaît le message français (motifs ancrés) et on le
 * rend dans la langue courante à partir du groupe de messages `tableaux.erreursLib`.
 * En français, le texte rendu est exactement le message de lib.
 */

export type MotifErreurTableau = { cle: string }

// Table ORDONNÉE : le premier motif qui correspond l'emporte. Messages sans paramètre : égalité stricte.
const MOTIFS: { cle: string; message: string }[] = [
  { cle: 'formulaireInvalide', message: 'Vérifiez le titre, les lecteurs et les paramètres des tuiles.' },
  { cle: 'artefactIndisponible', message: 'Un artefact est indisponible.' },
  { cle: 'indicateurDimensionIndisponible', message: 'Un indicateur ou une dimension de détail est indisponible.' },
  { cle: 'compteIndisponible', message: 'Un compte sélectionné est indisponible.' },
  { cle: 'tableauIndisponible', message: 'Tableau indisponible.' },
  { cle: 'tableauModifie', message: 'Ce tableau a été modifié depuis son ouverture. Rechargez-le.' },
  { cle: 'indicateurIndisponible', message: 'Indicateur indisponible.' },
  { cle: 'dejaVersionActuelle', message: 'Cette version est déjà la version actuelle.' },
  { cle: 'versionIntrouvable', message: 'Version introuvable.' },
  { cle: 'versionIncompatible', message: 'Cette version n’est plus compatible avec le tableau actuel : elle ne peut pas être restaurée.' },
  { cle: 'destinatairesLecteurs', message: 'Chaque destinataire d’une alerte doit être lecteur du tableau.' },
  // tableaux-alertes.ts (ErreurAlerte)
  { cle: 'webhookAdmin', message: 'Seul un administrateur peut configurer un webhook d’alerte.' },
]

export function trouverMotifErreurTableau(message: string): MotifErreurTableau | null {
  const trouve = MOTIFS.find(motif => motif.message === message)
  return trouve ? { cle: trouve.cle } : null
}

/**
 * Message d'erreur de lib rendu dans la langue courante. Message inconnu : brut en français
 * (comportement historique), message générique traduit dans les autres langues.
 */
export async function messageErreurTableau(message: string): Promise<string> {
  const [t, locale] = await Promise.all([getTranslations('tableaux.erreursLib'), getLocale()])
  const motif = trouverMotifErreurTableau(message)
  if (motif) return t(motif.cle as never)
  return locale === 'fr' ? message : t('generique')
}
