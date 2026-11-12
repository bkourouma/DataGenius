import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export interface AccessScope {
  roleName: string
  voitTout: boolean
}

export const ACCESS_SCOPE_INCLUDE = { roleName: true } as const

export function buildAccessScope(user: { roleName: string }): AccessScope {
  // Tous les membres actifs de cette installation utilisent les mêmes vues approuvées.
  return { roleName: user.roleName, voitTout: true }
}

export async function getAccessScope(id: string): Promise<AccessScope | null> {
  const user = await prisma.user.findFirst({
    where: { id, status: 'active', deletedAt: null },
    select: ACCESS_SCOPE_INCLUDE,
  })
  return user ? buildAccessScope(user) : null
}

export function reponseSessionPerimee(body: { error: string }) {
  return NextResponse.json(body, { status: 401 })
}
