import { NextResponse } from 'next/server'
import { lireTexteBorne } from '@/lib/http/corps-borne'
import { LimiteurDebit } from '@/lib/medic-assist/donnees/limite-debit'

const limite = new LimiteurDebit({ max: 60, fenetreMs: 60_000 })

export function jsonPrive(valeur: unknown, status = 200, autres: Record<string, string> = {}) {
  return NextResponse.json(valeur, { status, headers: { 'Cache-Control': 'private, no-store', ...autres } })
}

export function limiterIntegration(cle: string) {
  const resultat = limite.consommer(cle)
  return resultat.accepte ? undefined : jsonPrive({ erreur: 'limite_debit' }, 429, {
    'Retry-After': String(Math.ceil(resultat.reessayerDansMs / 1000)),
  })
}

export async function lireCorps(request: Request, maximum = 16_384) {
  return lireTexteBorne(request, maximum)
}
