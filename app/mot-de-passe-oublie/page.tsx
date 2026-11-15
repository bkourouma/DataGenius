import Link from 'next/link'
import { Database } from 'lucide-react'
import { FormulaireDemande } from './formulaire'

export const metadata = { title: 'Mot de passe oublié', robots: { index: false, follow: false } }

export default function MotDePasseOublie() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/50 px-4">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2 font-semibold">
          <Database size={20} className="text-primary" aria-hidden />
          Data Genius
        </div>
        <h1 className="mb-2 text-2xl font-bold">Mot de passe oublié</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Saisissez votre adresse e-mail pour recevoir un lien de réinitialisation.
        </p>
        <FormulaireDemande />
        <p className="mt-4 text-sm text-muted-foreground">
          Si votre entreprise gère votre connexion, utilisez la connexion entreprise depuis la page de connexion.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Retour à la connexion
        </Link>
      </section>
    </main>
  )
}
