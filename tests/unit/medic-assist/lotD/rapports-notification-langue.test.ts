import { beforeEach, describe, expect, it, vi } from 'vitest'

import { creerDepotMemoire, rapportDeTest } from './_depot-memoire'

const { creerNotification, findMany, validerDestinataires, contexteDepuisCompte } = vi.hoisted(
  () => ({
    creerNotification: vi.fn(async (..._args: unknown[]) => 'notif'),
    findMany: vi.fn(),
    validerDestinataires: vi.fn(),
    contexteDepuisCompte: vi.fn(),
  })
)

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async () => ({ firstName: 'Awa', lastName: 'Diallo' })),
      findMany,
    },
  },
}))
vi.mock('@/lib/mail/transport', () => ({ envoyerMail: vi.fn() }))
vi.mock('@/lib/medic-assist/suivi/dependances', () => ({ construireExport: vi.fn() }))
vi.mock('@/lib/medic-assist/suivi/comptes', () => ({
  chargerComptesAvecAcces: vi.fn(),
  contexteDepuisCompte,
  validerDestinataires,
}))
vi.mock('@/lib/auth/data-access', () => ({ destinataireCouvrePerimetre: vi.fn(async () => true) }))
vi.mock('@/lib/medic-assist/suivi/emails-rapport', () => ({
  composerEmailRapport: vi.fn(async () => ({ sujet: 's', html: '<p>x</p>', texte: 'x' })),
}))
vi.mock('@/lib/medic-assist/suivi/notifications', () => ({
  creerNotificationSuivi: creerNotification,
}))
vi.mock('@/lib/medic-assist/suivi/depot-prisma', () => ({ obtenirDepot: vi.fn() }))

import { traiterRapportsEchus } from '@/lib/medic-assist/suivi/rapports-programmes'

const MAINTENANT = new Date('2026-11-13T09:00:00.000Z')
const QUINZE_MIN = 15 * 60 * 1000

type Notif = { userId: string; titre: string; message: string }

/** Trois echecs d'envoi consecutifs : la 3e declenche la notification d'echec definitif. */
async function declencherEchecDefinitif() {
  const depot = creerDepotMemoire([rapportDeTest()], ['admin-1'])
  const envoyer = vi.fn(async () => false)
  for (let i = 0; i < 3; i += 1) {
    await traiterRapportsEchus({
      depot,
      maintenant: new Date(MAINTENANT.getTime() + i * QUINZE_MIN),
      envoyerMail: envoyer,
      construireExport: async () => ({
        nomFichier: 'r.pdf',
        buffer: Buffer.from('x'),
        typeMime: 'application/pdf',
      }),
    })
  }
  const notifs = creerNotification.mock.calls.map(c => c[0] as Notif)
  return new Map(notifs.map(n => [n.userId, n]))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  contexteDepuisCompte.mockResolvedValue({ userId: 'proprio', scope: { donnees: {} } })
  validerDestinataires.mockImplementation(async (ids: string[]) => ({
    comptes: ids.map(id => ({ id, nom: id, email: 'a@example.test', locale: 'fr' })),
    refuses: [],
  }))
})

describe('notification d echec definitif : langue du destinataire', () => {
  it('ecrit le texte dans la locale de chaque destinataire, francais en repli', async () => {
    findMany.mockResolvedValue([
      { id: 'proprio', locale: 'en' },
      { id: 'admin-1', locale: 'klingon' },
    ])
    const notifs = await declencherEchecDefinitif()

    const anglais = notifs.get('proprio')!
    expect(anglais.titre).toBe('Scheduled report not sent')
    expect(anglais.message).toContain('could not be sent after 3 attempts')
    expect(anglais.message).toContain('Ventes du mois')

    const francais = notifs.get('admin-1')!
    expect(francais.titre).toBe('Rapport programmé non envoyé')
    expect(francais.message).toContain('après 3 tentatives')
  })

  it('lecture des langues en echec : repli francais, sans lever', async () => {
    findMany.mockRejectedValue(new Error('base indisponible'))
    const notifs = await declencherEchecDefinitif()
    expect(notifs.size).toBe(2)
    for (const n of notifs.values()) expect(n.titre).toBe('Rapport programmé non envoyé')
  })
})
