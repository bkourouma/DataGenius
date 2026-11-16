import {
  BookMarked,
  BookOpen,
  Boxes,
  LayoutDashboard,
  MessagesSquare,
  PlugZap,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Clé d'une entrée dans messages ecrans.coquille.nav : libellé et mots-clés de la palette y sont traduits. */
export type CleNavigation =
  | 'conversations'
  | 'analyses'
  | 'tableaux'
  | 'tendances'
  | 'espaces'
  | 'recherche'
  | 'glossaire'
  | 'sources'
  | 'utilisateurs'
  | 'droits'
  | 'parametres'
  | 'journal'

export interface EntreeNavigation {
  href: string
  cle: CleNavigation
  icone: LucideIcon
}

export interface GroupeNavigation {
  id: 'travail' | 'administration'
  entrees: EntreeNavigation[]
}

const TRAVAIL: GroupeNavigation = {
  id: 'travail',
  entrees: [
    { href: '/assistant', cle: 'conversations', icone: MessagesSquare },
    { href: '/assistant/analyses', cle: 'analyses', icone: BookMarked },
    { href: '/tableaux', cle: 'tableaux', icone: LayoutDashboard },
    { href: '/tendances', cle: 'tendances', icone: TrendingUp },
    { href: '/espaces', cle: 'espaces', icone: Boxes },
    { href: '/recherche', cle: 'recherche', icone: Search },
    { href: '/glossaire', cle: 'glossaire', icone: BookOpen },
  ],
}

const ADMINISTRATION: GroupeNavigation = {
  id: 'administration',
  entrees: [
    { href: '/sources', cle: 'sources', icone: PlugZap },
    { href: '/utilisateurs', cle: 'utilisateurs', icone: Users },
    { href: '/sources/droits', cle: 'droits', icone: ShieldCheck },
    { href: '/dashboard/admin/assistant', cle: 'parametres', icone: Settings2 },
    { href: '/journal', cle: 'journal', icone: ScrollText },
  ],
}

export function groupesNavigation(estAdmin: boolean): GroupeNavigation[] {
  return estAdmin ? [TRAVAIL, ADMINISTRATION] : [TRAVAIL]
}

/**
 * Entree active : celle dont le chemin est le plus long prefixe de la page
 * courante (`/assistant/analyses/x` active « Analyses », pas « Conversations »).
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
