import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/utils'
import { getAccessScope } from '@/lib/auth/access-scope'
import { peutUtiliserMedicAssist } from '@/lib/medic-assist/contrats/droits'
import { Coquille } from '@/components/coquille/coquille'
import { exigerMedicAssist } from '@/lib/medic-assist/acces'
import { listerTableaux } from '@/lib/warehouse/tableaux'

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session?.user.id) redirect('/login')
  const scope = await getAccessScope(session.user.id)
  if (!scope || !peutUtiliserMedicAssist(scope.roleName, scope, null)) redirect('/login')

  // Tableaux accessibles, pour les retrouver depuis la palette (Ctrl K) ; une erreur n'empeche pas la page.
  const acces = await exigerMedicAssist().catch(() => null)
  const tableaux = acces?.ok
    ? (await listerTableaux(acces.contexte).catch(() => [])).map(({ id, titre }) => ({ id: String(id), titre: String(titre ?? '') }))
    : []

  return (
    <Coquille estAdmin={scope.roleName === 'TenantAdmin'} nom={session.user.name} courriel={session.user.email} tableaux={tableaux}>
      {children}
    </Coquille>
  )
}
