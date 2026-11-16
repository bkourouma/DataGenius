/**
 * Textes d'une alerte de tableau de bord (notification dans l'application et e-mail),
 * dans la langue du destinataire. Tout texte inséré dans le HTML est échappé.
 */

import { createTranslator } from 'next-intl'

import { defaultLocale, getDirection, isLocale, toIntlTag, type Locale } from '@/i18n/config'
import { loadMessages } from '@/i18n/messages'
import { echapper, gabarit } from '@/lib/mail/gabarit'

type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

export interface EntreeAlerte {
  locale: string
  /** Titre du tableau. */
  tableau: string
  /** Libellé de la mesure, dans la langue du destinataire. */
  mesure: string
  unite?: string | null
  valeur: number | string
  seuil: string
  sens: 'au_dessus' | 'au_dessous'
}

export interface EntreeEmailAlerte extends EntreeAlerte {
  destinataireNom: string
  /** Lien vers le tableau. */
  url: string
}

const langue = (locale: string): Locale => (isLocale(locale) ? locale : defaultLocale)

async function traducteur(locale: Locale): Promise<Traducteur> {
  return createTranslator({ locale, messages: await loadMessages(locale), namespace: 'notifications' as never }) as unknown as Traducteur
}

function formater(locale: Locale, valeur: number | string, unite?: string | null) {
  const nombre = typeof valeur === 'number' ? valeur : Number(valeur)
  const texte = Number.isFinite(nombre)
    ? new Intl.NumberFormat(toIntlTag(locale), { maximumFractionDigits: 2 }).format(nombre)
    : String(valeur)
  return unite ? `${texte} ${unite}` : texte
}

async function textes(entree: EntreeAlerte) {
  const locale = langue(entree.locale)
  const t = await traducteur(locale)
  const valeurs = {
    tableau: entree.tableau, mesure: entree.mesure, sens: entree.sens,
    valeur: formater(locale, entree.valeur, entree.unite), seuil: formater(locale, entree.seuil, entree.unite),
  }
  return { locale, t, titre: t('alerte.titre', valeurs), message: t('alerte.message', valeurs), valeurs }
}

export async function composerNotificationAlerte(entree: EntreeAlerte): Promise<{ titre: string; message: string }> {
  const { titre, message } = await textes(entree)
  return { titre, message }
}

export async function composerEmailAlerte(entree: EntreeEmailAlerte): Promise<{ sujet: string; texte: string; html: string; locale: Locale }> {
  const { locale, t, titre, message, valeurs } = await textes(entree)
  const sujet = t('email.sujet', { tableau: valeurs.tableau, mesure: valeurs.mesure })
  const salutation = t('email.salutation', { nom: entree.destinataireNom })
  const pied = t('email.pied')
  const libelleLien = t('email.lien')
  const texte = [salutation, '', message, '', `${libelleLien} : ${entree.url}`, '', pied].join('\n')
  const html = gabarit({
    titre: echapper(titre),
    corps: [echapper(salutation), echapper(message)],
    lien: { url: entree.url, libelle: echapper(libelleLien) },
    langue: locale,
    direction: getDirection(locale),
    pied: echapper(pied),
  })
  return { sujet, texte, html, locale }
}
