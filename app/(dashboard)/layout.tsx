import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Database } from 'lucide-react'
import { getSession } from '@/lib/auth/utils'
import { getAccessScope } from '@/lib/auth/access-scope'
import { peutUtiliserMedicAssist } from '@/lib/medic-assist/contrats/droits'
import { Deconnexion } from './deconnexion'

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user.id) redirect('/login')
  const scope = await getAccessScope(session.user.id)
  if (!scope || !peutUtiliserMedicAssist(scope.roleName, scope, null)) redirect('/login')

  return (
    <>
      <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-1 sm:flex-nowrap sm:gap-6 sm:px-6 sm:py-0">
        <Link href="/assistant" className="flex shrink-0 items-center gap-2 font-semibold">
          <Database size={19} className="text-primary" aria-hidden />
          Data Genius
        </Link>
        <nav aria-label="Espace de travail" className="order-last flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-2 pb-2 text-sm sm:order-none sm:basis-auto sm:flex-1 sm:gap-5 sm:pb-0">
          <Link className="hidden hover:underline sm:inline" href="/assistant">Conversations</Link>
          <Link className="hover:underline" href="/assistant/analyses">Analyses</Link>
          <Link className="hover:underline" href="/tableaux">Tableaux</Link>
          <Link className="hover:underline" href="/tendances">Tendances</Link>
          <Link className="hover:underline" href="/espaces">Espaces</Link>
          {scope.roleName === 'TenantAdmin' && (
            <>
              <Link className="hover:underline" href="/sources">Source</Link>
              <Link className="hover:underline" href="/utilisateurs">Utilisateurs</Link>
              <Link className="hover:underline" href="/dashboard/admin/assistant">Paramètres</Link>
            </>
          )}
        </nav>
        <div className="ml-auto"><Deconnexion /></div>
      </header>
      <main className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">{children}</main>
    </>
  )
}
