import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envoyerMail, findUnique } = vi.hoisted(() => ({
  envoyerMail: vi.fn(async () => true),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/mail/transport', () => ({ envoyerMail }))
vi.mock('@/lib/db/client', () => ({ prisma: { user: { findUnique } } }))

import { envoyerInvitation, envoyerReinitialisation } from '@/lib/mail/comptes'

const LIEN = 'https://app.exemple.test/definir-mot-de-passe?jeton=abc'

function dernierMail() {
  const appels = envoyerMail.mock.calls as unknown as [{ to: string; subject: string; text: string; html: string }][]
  return appels[appels.length - 1][0]
}

beforeEach(() => {
  envoyerMail.mockClear()
  findUnique.mockReset()
  findUnique.mockResolvedValue({ locale: 'fr' })
})

describe('e-mails de compte en français (texte inchangé)', () => {
  it('invitation avec nom de l’administrateur', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale: 'fr' }, LIEN, 'Ada Lovelace')
    const m = dernierMail()
    expect(m.to).toBe('awa@x.test')
    expect(m.subject).toBe('Votre invitation à Data Genius')
    expect(m.text).toBe([
      'Bonjour Awa,', '', 'Ada Lovelace vous invite à rejoindre Data Genius.',
      'Choisissez votre mot de passe pour activer votre compte :', LIEN, '',
      "Ce lien est valable 7 jours et ne peut servir qu'une fois.",
    ].join('\n'))
    expect(m.html).toContain('lang="fr" dir="ltr"')
    expect(m.html).toContain('Activez votre compte')
    expect(m.html).toContain('Ce lien est valable 7 jours et ne peut servir qu’une fois.')
    expect(m.html).toContain('Choisir mon mot de passe')
    expect(m.html).toContain('Message automatique — merci de ne pas y répondre.')
  })

  it('invitation sans nom d’administrateur', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale: 'fr' }, LIEN)
    expect(dernierMail().text).toContain('Un administrateur vous invite à rejoindre Data Genius.')
  })

  it('réinitialisation', async () => {
    await envoyerReinitialisation({ email: 'awa@x.test', prenom: 'Awa', locale: 'fr' }, LIEN)
    const m = dernierMail()
    expect(m.subject).toBe('Réinitialisation de votre mot de passe Data Genius')
    expect(m.text).toBe([
      'Bonjour Awa,', '',
      'Une réinitialisation de votre mot de passe a été demandée. Pour en choisir un nouveau :', LIEN, '',
      'Ce lien est valable 1 heure.',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    ].join('\n'))
    expect(m.html).toContain('Réinitialiser votre mot de passe')
    expect(m.html).toContain('Choisir un nouveau mot de passe')
    expect(m.html).toContain('Ce lien est valable 1 heure.')
    expect(m.html).toContain('Si vous n’êtes pas à l’origine de cette demande')
  })
})

describe('e-mails de compte traduits', () => {
  it.each([
    ['en', 'Your invitation to Data Genius', 'Reset your Data Genius password', 'Hello Awa,'],
    ['es', 'Tu invitación a Data Genius', 'Restablecimiento de tu contraseña de Data Genius', 'Hola Awa:'],
    ['zh', '您收到了 Data Genius 的邀请', '重置您的 Data Genius 密码', 'Awa，您好：'],
    ['hi', 'Data Genius के लिए आपका आमंत्रण', 'आपके Data Genius पासवर्ड का रीसेट', 'नमस्ते Awa,'],
  ])('%s : sujets, salutation et lien', async (locale, sujetInvitation, sujetReinit, salutation) => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale }, LIEN, 'Ada')
    const invitation = dernierMail()
    expect(invitation.subject).toBe(sujetInvitation)
    expect(invitation.text).toContain(salutation)
    expect(invitation.text).toContain(LIEN)
    expect(invitation.text).toContain('Ada')
    expect(invitation.html).toContain(`lang="${locale}" dir="ltr"`)
    expect(invitation.html).toContain(LIEN)
    expect(invitation.text).not.toContain('Bonjour')
    expect(invitation.html).not.toContain('Message automatique')

    await envoyerReinitialisation({ email: 'awa@x.test', prenom: 'Awa', locale }, LIEN)
    const reinit = dernierMail()
    expect(reinit.subject).toBe(sujetReinit)
    expect(reinit.text).toContain(LIEN)
    expect(reinit.text).not.toContain('réinitialisation')
    expect(reinit.html).toContain(LIEN)
  })

  it('ar : direction droite à gauche et langue arabe dans le HTML', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale: 'ar' }, LIEN)
    const m = dernierMail()
    expect(m.subject).toBe('دعوتك إلى Data Genius')
    expect(m.html).toContain('lang="ar"')
    expect(m.html).toContain('dir="rtl"')
    expect(m.html).toContain('رسالة آلية')
    expect(m.text).toContain(LIEN)
  })

  it('les noms de marque restent tels quels', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale: 'en' }, LIEN)
    expect(dernierMail().html).toContain('Data Genius')
  })
})

describe('langue du destinataire', () => {
  it('lit User.locale quand la langue n’est pas fournie', async () => {
    findUnique.mockResolvedValue({ locale: 'en' })
    await envoyerReinitialisation({ email: '  Awa@X.test ', prenom: 'Awa' }, LIEN)
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'awa@x.test' }, select: { locale: true } })
    expect(dernierMail().subject).toBe('Reset your Data Genius password')
  })

  it('ne consulte pas la base si la langue est fournie', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa', locale: 'es' }, LIEN)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it.each([
    ['valeur invalide en base', () => findUnique.mockResolvedValue({ locale: 'klingon' })],
    ['compte introuvable', () => findUnique.mockResolvedValue(null)],
    ['base en échec', () => findUnique.mockRejectedValue(new Error('base indisponible'))],
  ])('repli français : %s', async (_cas, preparer) => {
    preparer()
    await envoyerInvitation({ email: 'awa@x.test', prenom: 'Awa' }, LIEN)
    const m = dernierMail()
    expect(m.subject).toBe('Votre invitation à Data Genius')
    expect(m.html).toContain('lang="fr" dir="ltr"')
  })

  it('repli français quand la langue fournie est invalide', async () => {
    await envoyerReinitialisation({ email: 'awa@x.test', prenom: 'Awa', locale: 'xx' }, LIEN)
    expect(dernierMail().subject).toBe('Réinitialisation de votre mot de passe Data Genius')
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('échappement', () => {
  it('échappe le prénom et le nom de l’administrateur dans le HTML, pas dans le texte', async () => {
    await envoyerInvitation({ email: 'awa@x.test', prenom: '<b>Awa</b> & "Co"', locale: 'fr' }, LIEN, '<i>Ada</i>')
    const m = dernierMail()
    expect(m.html).not.toContain('<b>Awa</b>')
    expect(m.html).not.toContain('<i>Ada</i>')
    expect(m.html).toContain('&lt;b&gt;Awa&lt;/b&gt; &amp; &quot;Co&quot;')
    expect(m.html).toContain('&lt;i&gt;Ada&lt;/i&gt;')
    expect(m.text).toContain('<b>Awa</b> & "Co"')
  })

  it('échappe aussi le prénom dans la réinitialisation, dans toutes les langues', async () => {
    for (const locale of ['fr', 'en', 'ar', 'zh']) {
      await envoyerReinitialisation({ email: 'awa@x.test', prenom: '<script>x</script>', locale }, LIEN)
      expect(dernierMail().html).not.toContain('<script>')
      expect(dernierMail().html).toContain('&lt;script&gt;')
    }
  })
})
