import { NextResponse } from 'next/server'
import { getSession } from './utils'

export function reponseInterdite(message = 'Insufficient permissions') {
  return NextResponse.json({ error: 'Forbidden', message }, { status: 403 })
}

export async function exigerSession() {
  const session = await getSession()
  if (!session?.user?.id) {
    return {
      ok: false as const,
      reponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { ok: true as const, session }
}
