import {
  BookMarked,
  Boxes,
  LayoutDashboard,
  MessagesSquare,
  PlugZap,
  Settings2,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

export interface EntreeNavigation {
  href: string
  libelle: string
  icone: LucideIcon
  /** Mots supplementaires reconnus par la palette de commandes. */
  motsCles?: string
}

export interface GroupeNavigation {
  id: 'travail' | 'administration'
  libelle: string
  entrees: EntreeNavigation[]
}

const TRAVAIL: GroupeNavigation = {
  id: 'travail',
  libelle: 'Travail',
  entrees: [
    { href: '/medic-assist', libelle: 'Conversations', icone: MessagesSquare, motsCles: 'chat assistant question' },
    { href: '/medic-assist/analyses', libelle: 'Analyses', icone: BookMarked, motsCles: 'enregistrees partages rapports taches' },
    { href: '/tableaux', libelle: 'Tableaux de bord', icone: LayoutDashboard, motsCles: 'dashboard indicateurs alertes' },
    { href: '/tendances', libelle: 'Tendances', icone: TrendingUp, motsCles: 'evolution courbe periode' },
    { href: '/espaces', libelle: 'Espaces', icone: Boxes, motsCles: 'jeux donnees domaines' },
  ],
}

const ADMINISTRATION: GroupeNavigation = {
  id: 'administration',
  libelle: 'Administration',
  entrees: [
    { href: '/sources', libelle: 'Sources', icone: PlugZap, motsCles: 'connexion base import synchronisation postgresql mysql api fichier' },
    { href: '/sources/droits', libelle: 'Droits d’accès', icone: ShieldCheck, motsCles: 'groupes membres permissions' },
    { href: '/dashboard/admin/medic-assist', libelle: 'Paramètres', icone: Settings2, motsCles: 'configuration fournisseur ia usages avis' },
  ],
}

export function groupesNavigation(estAdmin: boolean): GroupeNavigation[] {
  return estAdmin ? [TRAVAIL, ADMINISTRATION] : [TRAVAIL]
}

/**
 * Entree active : celle dont le chemin est le plus long prefixe de la page
 * courante (`/medic-assist/analyses/x` active « Analyses », pas « Conversations »).
 */
export function entreeActive(chemin: string | null, groupes: GroupeNavigation[]): string | null {
  if (!chemin) return null
  let meilleure: string | null = null
  for (const groupe of groupes) {
    for (const { href } of groupe.entrees) {
      const correspond = chemin === href || chemin.startsWith(href + '/')
      if (correspond && (!meilleure || href.length > meilleure.length)) meilleure = href
    }
  }
  return meilleure
}

/** Deux lettres pour l'avatar : initiales du nom, a defaut de l'adresse. */
export function initiales(nom?: string | null): string {
  const mots = (nom ?? '').trim().split(/[\s@._-]+/).filter(Boolean)
  if (!mots.length) return '?'
  return (mots[0][0] + (mots[1]?.[0] ?? '')).toUpperCase()
}
