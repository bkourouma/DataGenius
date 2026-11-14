/**
 * Verrou du tour de chat (lot B, R10) : au plus UN tour à la fois par conversation et au plus
 * `TOURS_SIMULTANES_MAX` tours simultanés par utilisateur.
 *
 * Le verrou est une échéance (`assistant_conversations.tourEnCoursJusqua`) :
 * - prise : `updateMany` conditionnel (id, propriétaire, et verrou libre ou échu) qui pose
 *   `maintenant + DUREE_VERROU_MS`. PostgreSQL sérialise les UPDATE concurrents sur la même
 *   ligne : une seule prise réussit (count 1), l'autre relit la ligne verrouillée (count 0) ;
 * - libération : `updateMany` remettant null SEULEMENT si l'échéance est encore celle que nous
 *   avons posée (un verrou échu puis repris par un autre tour n'est jamais libéré par erreur) ;
 * - filet : un verrou non libéré (processus tué) expire seul après 6 minutes, au-delà de la
 *   durée maximale d'un tour (flux borné à 300 s).
 *
 * Limite par utilisateur : prise PUIS vérification a posteriori (compte des conversations de
 * l'utilisateur dont le verrou court encore) et libération si le compte dépasse la limite.
 * Deux prises simultanées au-delà de la limite peuvent ainsi se refuser l'une l'autre (les deux
 * comptent 3 et libèrent) : c'est le côté prudent (jamais plus de 2 tours payés en même temps,
 * au prix d'un 409 de trop dans une course rare ; l'utilisateur réessaie).
 *
 * L'horloge est injectable (`maintenant`) pour les tests.
 */

import { prisma } from '@/lib/db/client'

/** Durée d'un verrou : au-delà de la durée maximale d'un tour (300 s), avec une marge. */
export const DUREE_VERROU_MS = 6 * 60_000

/** Tours simultanés au plus par utilisateur (toutes conversations confondues). */
export const TOURS_SIMULTANES_MAX = 2

export interface VerrouTour {
  userId: string
  conversationId: string
  /** Échéance posée : sert de jeton pour la libération. */
  jusqua: Date
}

export type RefusVerrou = 'conversation_occupee' | 'limite_utilisateur'

export type PriseVerrou = { pris: true; verrou: VerrouTour } | { pris: false; raison: RefusVerrou }

/** Échéance d'un verrou posé à `maintenant`. */
export function echeanceVerrou(maintenant: Date): Date {
  return new Date(maintenant.getTime() + DUREE_VERROU_MS)
}

/**
 * Pose le verrou de la conversation si elle est libre (ou si son verrou est échu).
 * `null` si un tour est déjà en cours (ou si la conversation n'est pas au propriétaire).
 */
export async function prendreVerrouConversation(
  userId: string,
  conversationId: string,
  maintenant: Date = new Date()
): Promise<VerrouTour | null> {
  const jusqua = echeanceVerrou(maintenant)
  const resultat = await prisma.assistantConversation.updateMany({
    where: {
      id: conversationId,
      userId,
      OR: [{ tourEnCoursJusqua: null }, { tourEnCoursJusqua: { lt: maintenant } }],
    },
    data: { tourEnCoursJusqua: jusqua },
  })
  return resultat.count > 0 ? { userId, conversationId, jusqua } : null
}

/** Tours en cours de l'utilisateur : conversations dont le verrou court encore. */
export async function compterToursEnCours(
  userId: string,
  maintenant: Date = new Date()
): Promise<number> {
  return prisma.assistantConversation.count({
    where: { userId, tourEnCoursJusqua: { gt: maintenant } },
  })
}

/**
 * Libère le verrou s'il est encore le nôtre. Ne lève jamais : un échec est journalisé (nom
 * d'erreur seulement) et le verrou expirera seul.
 */
export async function libererVerrou(verrou: VerrouTour | null | undefined): Promise<boolean> {
  if (!verrou) return false
  try {
    const resultat = await prisma.assistantConversation.updateMany({
      where: { id: verrou.conversationId, userId: verrou.userId, tourEnCoursJusqua: verrou.jusqua },
      data: { tourEnCoursJusqua: null },
    })
    return resultat.count > 0
  } catch (erreur) {
    console.error('[datagenius] chat', {
      conversationId: verrou.conversationId,
      evenement: 'verrou_non_libere',
      erreur: erreur instanceof Error ? erreur.name : typeof erreur,
    })
    return false
  }
}

/**
 * Vérifie a posteriori la limite par utilisateur pour un verrou qu'on vient de poser ; le
 * libère et renvoie le refus si la limite est dépassée.
 */
export async function verifierLimiteUtilisateur(
  verrou: VerrouTour,
  maintenant: Date = new Date()
): Promise<PriseVerrou> {
  const enCours = await compterToursEnCours(verrou.userId, maintenant)
  if (enCours > TOURS_SIMULTANES_MAX) {
    await libererVerrou(verrou)
    return { pris: false, raison: 'limite_utilisateur' }
  }
  return { pris: true, verrou }
}

/** Prise complète sur une conversation existante : verrou de conversation puis limite. */
export async function prendreVerrouTour(
  userId: string,
  conversationId: string,
  maintenant: Date = new Date()
): Promise<PriseVerrou> {
  const verrou = await prendreVerrouConversation(userId, conversationId, maintenant)
  if (!verrou) return { pris: false, raison: 'conversation_occupee' }
  return verifierLimiteUtilisateur(verrou, maintenant)
}
