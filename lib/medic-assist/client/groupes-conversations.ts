/**
 * Regroupement pur de la liste des conversations (epinglees, aujourd'hui,
 * 7 derniers jours, plus ancien). Les archivees sont exclues : le composant
 * les affiche dans leur propre groupe replie.
 */

import type { ConversationResume } from './types'

export interface GroupesConversations {
  epinglees: ConversationResume[]
  aujourdhui: ConversationResume[]
  septJours: ConversationResume[]
  plusAncien: ConversationResume[]
}

const MS_PAR_JOUR = 86_400_000

function horodatage(c: ConversationResume): number {
  const t = new Date(c.miseAJour).getTime()
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

function parDateDecroissante(a: ConversationResume, b: ConversationResume): number {
  const ta = horodatage(a)
  const tb = horodatage(b)
  if (ta === tb) return 0
  return tb > ta ? 1 : -1
}

function debutDeJourLocal(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Nombre de jours calendaires locaux entre la date et `maintenant` (null si invalide). */
function joursEcoules(miseAJour: string, maintenant: Date): number | null {
  const date = new Date(miseAJour)
  if (Number.isNaN(date.getTime())) return null
  return Math.round((debutDeJourLocal(maintenant) - debutDeJourLocal(date)) / MS_PAR_JOUR)
}

export function grouperConversations(
  conversations: ConversationResume[],
  maintenant: Date,
): GroupesConversations {
  const groupes: GroupesConversations = {
    epinglees: [],
    aujourdhui: [],
    septJours: [],
    plusAncien: [],
  }
  for (const c of conversations) {
    if (c.archivee) continue
    if (c.epinglee) {
      groupes.epinglees.push(c)
      continue
    }
    const jours = joursEcoules(c.miseAJour, maintenant)
    if (jours === null) groupes.plusAncien.push(c)
    else if (jours <= 0) groupes.aujourdhui.push(c)
    else if (jours <= 7) groupes.septJours.push(c)
    else groupes.plusAncien.push(c)
  }
  groupes.epinglees.sort(parDateDecroissante)
  groupes.aujourdhui.sort(parDateDecroissante)
  groupes.septJours.sort(parDateDecroissante)
  groupes.plusAncien.sort(parDateDecroissante)
  return groupes
}
