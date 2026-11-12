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
      <header className="flex h-14 items-center gap-3 border-b bg-card px-3 sm:gap-6 sm:px-6">
        <Link href="/medic-assist" className="flex shrink-0 items-center gap-2 font-semibold">
          <Database size={19} className="text-primary" aria-hidden />
          Data Genius
        </Link>
        <nav aria-label="Espace de travail" className="flex min-w-0 flex-1 items-center gap-3 text-sm sm:gap-5">
          <Link className="hidden hover:underline sm:inline" href="/medic-assist">Conversations</Link>
          <Link className="hover:underline" href="/medic-assist/analyses">Analyses</Link>
          {scope.roleName === 'TenantAdmin' && (
            <>
              <Link className="hover:underline" href="/sources">Source</Link>
              <Link className="hover:underline" href="/dashboard/admin/medic-assist">Paramètres</Link>
            </>
          )}
        </nav>
        <Deconnexion />
      </header>
      <main className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8">{children}</main>
    </>
  )
}
