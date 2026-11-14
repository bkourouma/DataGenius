'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { getProviders, signIn } from 'next-auth/react'
import { Database, LayoutDashboard, MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MESSAGE_MOT_DE_PASSE_DEFINI, messageErreurConnexion } from './messages'
import { PasswordInput } from '@/components/ui/password-input'

export default function Connexion() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [entreprise, setEntreprise] = useState(false)
  const [succes, setSucces] = useState('')

  useEffect(() => {
    const parametres = new URLSearchParams(window.location.search)
    if (parametres.has('error')) setError(messageErreurConnexion(parametres.get('error'), 'url'))
    if (parametres.get('reinitialise') === '1') setSucces(MESSAGE_MOT_DE_PASSE_DEFINI)
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
    return '/assistant'
  }

  async function connecter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    setSucces('')
    try {
      const result = await signIn('credentials', {
        email: form.get('email'),
        password: form.get('password'),
        redirect: false,
      })
      if (result?.ok) window.location.assign(destination())
      else setError(messageErreurConnexion(result?.error, 'formulaire'))
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

  const points = [
    { icone: MessageSquare, texte: 'Posez une question en français, la réponse arrive avec ses chiffres.' },
    { icone: LayoutDashboard, texte: 'Gardez vos analyses dans des tableaux de bord prêts à partager.' },
    { icone: RefreshCw, texte: 'Travaillez sur des sources de données à jour.' },
  ]

  const marque = (
    <div className="flex items-center gap-2.5 font-semibold">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
        <Database size={18} aria-hidden />
      </span>
      Data Genius
    </div>
  )

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="rib-wall hidden flex-col justify-between p-12 text-shell-foreground lg:flex">
        {marque}
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight">
            Interrogez vos données par la conversation, retrouvez vos analyses et tableaux de bord.
          </p>
          <ul className="mt-10 grid gap-5">
            {points.map(({ icone: Icone, texte }) => (
              <li key={texte} className="flex items-start gap-3 text-sm text-shell-muted">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-shell-line text-shell-foreground">
                  <Icone size={16} aria-hidden />
                </span>
                <span className="pt-1.5">{texte}</span>
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden />
      </aside>
      <section className="grid place-items-center bg-background px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">{marque}</div>
          <h1 className="text-2xl font-bold">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">Accédez à votre espace Data Genius.</p>
          <form method="post" className="mt-6 grid gap-4" onSubmit={connecter}>
            <div className="grid gap-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="username" maxLength={254} required aria-invalid={error ? true : undefined} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Mot de passe</Label>
              <PasswordInput id="password" name="password" autoComplete="current-password" maxLength={256} required aria-invalid={error ? true : undefined} />
              <Link href="/mot-de-passe-oublie" className="text-sm text-primary underline-offset-4 hover:underline">Mot de passe oublié ?</Link>
            </div>
            {succes && <p role="status" className="text-sm text-emerald-700">{succes}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" loading={pending}>{pending ? 'Connexion…' : 'Se connecter'}</Button>
          </form>
          {entreprise && <Button className="mt-3 w-full" variant="outline" disabled={pending} onClick={connecterEntreprise}>
            Connexion entreprise
          </Button>}
        </div>
      </section>
    </main>
  )
}
