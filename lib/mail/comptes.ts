import { createTranslator } from 'next-intl'

import { defaultLocale, getDirection, isLocale, type Locale } from '@/i18n/config'
import { loadMessages } from '@/i18n/messages'
import { prisma } from '@/lib/db/client'
import { echapper, gabarit } from '@/lib/mail/gabarit'
import { envoyerMail } from '@/lib/mail/transport'

interface Destinataire {
  email: string
  prenom: string
  /** Langue du message ; à défaut, celle du compte (User.locale), sinon le français. */
  locale?: string
}

type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

/** Langue fournie, sinon celle du compte ; toute valeur absente, invalide ou illisible donne le français. */
async function langueDestinataire(destinataire: Destinataire): Promise<Locale> {
  if (destinataire.locale !== undefined) return isLocale(destinataire.locale) ? destinataire.locale : defaultLocale
  try {
    const compte = await prisma.user.findUnique({
      where: { email: destinataire.email.trim().toLowerCase() },
      select: { locale: true },
    })
    return isLocale(compte?.locale) ? compte.locale : defaultLocale
  } catch {
    return defaultLocale
  }
}

async function traducteurMails(locale: Locale): Promise<Traducteur> {
  return createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: 'ecrans.mails' as never,
  }) as unknown as Traducteur
}

export async function envoyerInvitation(destinataire: Destinataire, lien: string, invitePar?: string): Promise<boolean> {
  const locale = await langueDestinataire(destinataire)
  const t = await traducteurMails(locale)
  const par = invitePar?.trim()
  const intro = par ? t('invitation.introPar', { par }) : t('invitation.introAdmin')
  return envoyerMail({
    to: destinataire.email,
    subject: t('invitation.sujet'),
    text: [
      t('bonjour', { prenom: destinataire.prenom }), '', intro,
      t('invitation.choisir'), lien, '',
      t('invitation.validite'),
    ].join('\n'),
    html: gabarit({
      titre: t('invitation.titre'),
      corps: [
        t('bonjour', { prenom: echapper(destinataire.prenom) }),
        echapper(intro),
        t('invitation.corps'),
      ],
      lien: { url: lien, libelle: t('invitation.bouton') },
      langue: locale,
      direction: getDirection(locale),
      pied: t('pied'),
    }),
  })
}

export async function envoyerReinitialisation(destinataire: Destinataire, lien: string): Promise<boolean> {
  const locale = await langueDestinataire(destinataire)
  const t = await traducteurMails(locale)
  return envoyerMail({
    to: destinataire.email,
    subject: t('reinitialisation.sujet'),
    text: [
      t('bonjour', { prenom: destinataire.prenom }), '',
      t('reinitialisation.intro'), lien, '',
      t('reinitialisation.validite'),
      t('reinitialisation.ignorer'),
    ].join('\n'),
    html: gabarit({
      titre: t('reinitialisation.titre'),
      corps: [
        t('bonjour', { prenom: echapper(destinataire.prenom) }),
        t('reinitialisation.corps'),
        t('reinitialisation.ignorerHtml'),
      ],
      lien: { url: lien, libelle: t('reinitialisation.bouton') },
      langue: locale,
      direction: getDirection(locale),
      pied: t('pied'),
    }),
  })
}
