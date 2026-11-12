'use client'

import { signOut } from 'next-auth/react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Deconnexion() {
  return (
    <Button variant="ghost" size="icon" aria-label="Se déconnecter" onClick={() => signOut({ callbackUrl: '/login' })}>
      <LogOut size={18} aria-hidden />
    </Button>
  )
}
