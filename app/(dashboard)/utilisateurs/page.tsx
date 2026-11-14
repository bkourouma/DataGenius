import { redirect } from 'next/navigation'
import { listerComptes } from '@/lib/auth/comptes'
import { exigerAdminMedicAssist } from '@/lib/medic-assist/acces'
import { FormulaireInvitation, ListeComptes } from './composants'

export const dynamic = 'force-dynamic'

export default async function UtilisateursPage() {
  const acces = await exigerAdminMedicAssist()
  if (!acces.ok) redirect('/medic-assist')
  const comptes = await listerComptes()
  const serialisables = comptes.map(c => ({ ...c, invitationExpireA: c.invitationExpireA?.toISOString() ?? null }))
  return <section className="mx-auto max-w-5xl space-y-8 py-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold">Utilisateurs</h1>
      <p className="text-sm text-muted-foreground">
        Invitez des personnes, gérez leur rôle et désactivez les comptes qui n’ont plus besoin d’accéder à Data Genius.
      </p>
    </header>
    <section className="space-y-3" aria-labelledby="inviter">
      <h2 id="inviter" className="text-lg font-semibold">Inviter un utilisateur</h2>
      <FormulaireInvitation />
    </section>
    <section className="space-y-3" aria-labelledby="comptes">
      <h2 id="comptes" className="text-lg font-semibold">Comptes ({comptes.length})</h2>
      <ListeComptes comptes={serialisables} utilisateurCourantId={acces.contexte.userId} />
    </section>
  </section>
}
