import Link from 'next/link'
import { Database } from 'lucide-react'
import { verifierJeton } from '@/lib/auth/comptes'
import { FormulaireDefinition } from './formulaire'

// Le jeton est dans l'URL : pas de Referer, pas d'indexation, pas de cache.
export const metadata = { title: 'Définir le mot de passe', referrer: 'no-referrer', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function DefinirMotDePasse({ searchParams }: { searchParams: { jeton?: string | string[] } }) {
  const brut = searchParams?.jeton
  const jeton = typeof brut === 'string' ? brut : ''
  const resultat = jeton ? await verifierJeton(jeton) : { valide: false as const }
  const lien = 'text-sm text-primary underline-offset-4 hover:underline'

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/50 px-4">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2 font-semibold">
          <Database size={20} className="text-primary" aria-hidden />
          Data Genius
        </div>
        {resultat.valide ? (
          <>
            <h1 className="text-2xl font-bold">
              {resultat.type === 'invitation' ? `Bienvenue, ${resultat.prenom}` : 'Nouveau mot de passe'}
            </h1>
            {resultat.type === 'invitation' && <p className="mt-1 text-sm text-muted-foreground">Choisissez votre mot de passe</p>}
            <div className="mt-5">
              <FormulaireDefinition jeton={jeton} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mb-3 text-2xl font-bold">Lien invalide</h1>
            <p role="alert" className="text-sm text-destructive">Ce lien est invalide ou a expiré.</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link href="/mot-de-passe-oublie" className={lien}>Demander un nouveau lien</Link>
              <Link href="/login" className={lien}>Retour à la connexion</Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
