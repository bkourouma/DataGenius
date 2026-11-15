import { echapper, gabarit } from '@/lib/mail/gabarit'
import { envoyerMail } from '@/lib/mail/transport'

interface Destinataire {
  email: string
  prenom: string
}

export async function envoyerInvitation(destinataire: Destinataire, lien: string, invitePar?: string): Promise<boolean> {
  const par = invitePar?.trim()
  const intro = par
    ? `${par} vous invite à rejoindre Data Genius.`
    : 'Un administrateur vous invite à rejoindre Data Genius.'
  return envoyerMail({
    to: destinataire.email,
    subject: 'Votre invitation à Data Genius',
    text: [
      `Bonjour ${destinataire.prenom},`, '', intro,
      'Choisissez votre mot de passe pour activer votre compte :', lien, '',
      "Ce lien est valable 7 jours et ne peut servir qu'une fois.",
    ].join('\n'),
    html: gabarit({
      titre: 'Activez votre compte',
      corps: [
        `Bonjour ${echapper(destinataire.prenom)},`,
        echapper(intro),
        'Choisissez votre mot de passe pour activer votre compte. Ce lien est valable 7 jours et ne peut servir qu’une fois.',
      ],
      lien: { url: lien, libelle: 'Choisir mon mot de passe' },
    }),
  })
}

export async function envoyerReinitialisation(destinataire: Destinataire, lien: string): Promise<boolean> {
  return envoyerMail({
    to: destinataire.email,
    subject: 'Réinitialisation de votre mot de passe Data Genius',
    text: [
      `Bonjour ${destinataire.prenom},`, '',
      'Une réinitialisation de votre mot de passe a été demandée. Pour en choisir un nouveau :', lien, '',
      'Ce lien est valable 1 heure.',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    ].join('\n'),
    html: gabarit({
      titre: 'Réinitialiser votre mot de passe',
      corps: [
        `Bonjour ${echapper(destinataire.prenom)},`,
        'Une réinitialisation de votre mot de passe a été demandée. Ce lien est valable 1 heure.',
        'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.',
      ],
      lien: { url: lien, libelle: 'Choisir un nouveau mot de passe' },
    }),
  })
}
