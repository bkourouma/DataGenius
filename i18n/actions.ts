'use server'

import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/utils'
import { prisma } from '@/lib/db/client'
import { journal } from '@/lib/journal'
import { defaultLocale, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from './config'
import { langueChoisie } from './langue-choisie'

/**
 * Pose le cookie de langue. Il reste lisible côté navigateur (httpOnly false) :
 * app/global-error.tsx, qui remplace le layout racine, le lit via document.cookie.
 */
function poserCookie(langue: Locale) {
  cookies().set(LOCALE_COOKIE, langue, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  })
}

/** Nom de l’erreur seul : le message d’une erreur de base peut contenir des valeurs personnelles. */
function nomErreur(erreur: unknown): string {
  return erreur instanceof Error ? erreur.name : typeof erreur
}

/**
 * Change la langue de l'interface : cookie d'abord (la page se traduit dès le
 * rafraîchissement), puis enregistrement dans le profil si l'utilisateur est connecté.
 * Une valeur inconnue est refusée sans aucun effet. Un échec de la base est
 * journalisé mais ne remet pas en cause le changement de langue.
 */
export async function changerLangue(valeur: string): Promise<{ ok: boolean }> {
  if (!isLocale(valeur)) return { ok: false }
  poserCookie(valeur)
  try {
    const session = await getSession()
    const id = session?.user?.id
    if (id) await prisma.user.update({ where: { id }, data: { locale: valeur } })
  } catch (erreur) {
    journal.erreur('Langue : enregistrement dans le profil impossible', { domaine: 'langue', erreur: nomErreur(erreur) })
  }
  return { ok: true }
}

/**
 * Applique la langue enregistrée dans le profil quand aucun cookie n'existe
 * (premier accès depuis cet appareil, connexion entreprise). Sans effet si le
 * cookie est déjà là, sans session, ou si la langue enregistrée est le français
 * (langue par défaut).
 */
export async function appliquerLangueEnregistree(): Promise<{ ok: boolean }> {
  if (langueChoisie()) return { ok: true }
  try {
    const session = await getSession()
    const id = session?.user?.id
    if (!id) return { ok: true }
    const utilisateur = await prisma.user.findUnique({ where: { id }, select: { locale: true } })
    const langue = utilisateur?.locale
    if (isLocale(langue) && langue !== defaultLocale) poserCookie(langue)
    return { ok: true }
  } catch (erreur) {
    journal.erreur('Langue : lecture du profil impossible', { domaine: 'langue', erreur: nomErreur(erreur) })
    return { ok: false }
  }
}
