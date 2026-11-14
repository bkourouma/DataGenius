import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { DemarrageProvider } from '@/components/medic-assist/chat/demarrage'
import { EspaceChat } from '@/components/medic-assist/chat/espace-chat'
import { getAccessScope } from '@/lib/auth/access-scope'
import { authOptions } from '@/lib/auth/config'
import { exigerAdminMedicAssist, exigerMedicAssist } from '@/lib/medic-assist/acces'
import { peutUtiliserMedicAssist } from '@/lib/medic-assist/contrats/droits'
import { etatDemarrage, valeurDemarrage, type ValeurDemarrage } from '@/lib/medic-assist/demarrage'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const t = await getTranslations('medicAssist')
    return { title: t('titre') }
  } catch {
    // Catalogue pas encore charge : le nom du produit sert de titre.
    return { title: 'Data Genius' }
  }
}

/**
 * Garde SERVEUR de la page (le middleware ne filtre que les comptes Agency) :
 * meme regle que `exigerMedicAssist()` des API, a savoir perimetre siege ET
 * habilitation « medicAssist » pour un compte a profil. Session absente ou
 * perimee -> /login ; compte sans droit -> /dashboard.
 */
export default async function MedicAssistPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login')

  const scope = await getAccessScope(session.user.id)
  if (!scope) redirect('/login')

  // Role relu en base par getAccessScope : la session peut etre en retard.
  const habilitations = session.user.habilitations ?? null
  if (!peutUtiliserMedicAssist(scope.roleName, scope, habilitations)) redirect('/dashboard')

  // Le guide ne doit jamais empecher l'affichage de la page.
  let guide: ValeurDemarrage | null = null
  try {
    const admin = await exigerAdminMedicAssist()
    const acces = admin.ok ? admin : await exigerMedicAssist()
    if (acces.ok) {
      const etat = await etatDemarrage({
        userId: session.user.id,
        roleName: scope.roleName,
        contexte: acces.contexte,
        admin: admin.ok,
      })
      guide = valeurDemarrage(etat)
    }
  } catch {
    guide = null
  }

  return (
    <DemarrageProvider valeur={guide}>
      <EspaceChat />
    </DemarrageProvider>
  )
}
