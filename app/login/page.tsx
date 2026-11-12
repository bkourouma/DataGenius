'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { getProviders, signIn } from 'next-auth/react'
import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Connexion() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [entreprise, setEntreprise] = useState(false)

  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (parametres.has('error')) setError('Connexion impossible. Vérifiez que votre compte est autorisé.')
    void getProviders().then(fournisseurs => setEntreprise(Boolean(fournisseurs?.entreprise)), () => setEntreprise(false))
  }, [])

  function destination() {
    const parametre = new URLSearchParams(window.location.search).get('retour')
    try {
      const retour = parametre ? new URL(parametre, window.location.origin) : null
      if (retour?.origin === window.location.origin && retour.pathname === '/integration/autoriser') {
        return retour.pathname + retour.search
      }
    } catch {
      // Un retour invalide utilise l'accueil de l'application.
    }
    return '/medic-assist'
  }

  async function connecter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      const result = await signIn('credentials', {
        email: form.get('email'),
        password: form.get('password'),
        redirect: false,
      })
      if (result?.ok) window.location.assign(destination())
      else setError('Identifiants invalides.')
    } catch {
      setError('Connexion indisponible. Réessayez.')
    } finally {
      setPending(false)
    }
  }

  async function connecterEntreprise() {
    setPending(true)
    setError('')
    try {
      await signIn('entreprise', { callbackUrl: destination() })
    } catch {
      setError('Connexion entreprise indisponible. Réessayez.')
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/50 px-4">
      <section className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2 font-semibold">
          <Database size={20} className="text-primary" aria-hidden />
          Data Genius
        </div>
        <h1 className="mb-5 text-2xl font-bold">Connexion</h1>
        <form method="post" className="grid gap-4" onSubmit={connecter}>
          <div className="grid gap-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" maxLength={256} required />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending}>{pending ? 'Connexion…' : 'Se connecter'}</Button>
        </form>
        {entreprise && <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={connecterEntreprise}>
          Connexion entreprise
        </Button>}
      </section>
    </main>
  )
}

