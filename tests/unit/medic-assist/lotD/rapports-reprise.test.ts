import { beforeEach, describe, expect, it, vi } from 'vitest'

import { creerDepotMemoire, rapportDeTest } from './_depot-memoire'

const { creerNotification, validerDestinataires, contexteDepuisCompte, composerEmail } = vi.hoisted(
  () => ({
    creerNotification: vi.fn(async (..._args: unknown[]) => 'notif'),
    validerDestinataires: vi.fn(),
    contexteDepuisCompte: vi.fn(),
    composerEmail: vi.fn(),
  })
)

vi.mock('@/lib/db/client', () => ({
  prisma: { user: { findFirst: vi.fn(async () => ({ firstName: 'Awa', lastName: 'Diallo' })) } },
}))
vi.mock('@/lib/mail/transport', () => ({ envoyerMail: vi.fn() }))
vi.mock('@/lib/medic-assist/suivi/dependances', () => ({ construireExport: vi.fn() }))
vi.mock('@/lib/medic-assist/suivi/comptes', () => ({
  chargerComptesAvecAcces: vi.fn(),
  contexteDepuisCompte,
  validerDestinataires,
}))
vi.mock('@/lib/auth/data-access', () => ({ destinataireCouvrePerimetre: vi.fn(async () => true) }))
vi.mock('@/lib/medic-assist/suivi/emails-rapport', () => ({ composerEmailRapport: composerEmail }))
vi.mock('@/lib/medic-assist/suivi/emails', () => ({
  traducteurSuivi: vi.fn(async () => (cle: string) => cle),
}))
vi.mock('@/lib/medic-assist/suivi/notifications', () => ({
  creerNotificationSuivi: creerNotification,
}))
vi.mock('@/lib/medic-assist/suivi/depot-prisma', () => ({ obtenirDepot: vi.fn() }))

import { traiterRapportsEchus } from '@/lib/medic-assist/suivi/rapports-programmes'

const MAINTENANT = new Date('2026-11-13T09:00:00.000Z')
const QUINZE_MIN = 15 * 60 * 1000
/** 08:00 heure de Paris (UTC+1) le lendemain. */
const LENDEMAIN = new Date('2026-11-14T07:00:00.000Z')
const ADRESSE = 'secret.destinataire@example.test'
const SUJET = 'Sujet confidentiel du rapport'

const export1 = async () => ({
  nomFichier: 'r.pdf',
  buffer: Buffer.from('x'),
  typeMime: 'application/pdf',
})

function appel(depot: ReturnType<typeof creerDepotMemoire>, quand: Date, extra = {}) {
  return traiterRapportsEchus({ depot, maintenant: quand, construireExport: export1, ...extra })
}

beforeEach(() => {
  vi.clearAllMocks()
  creerNotification.mockClear()
  contexteDepuisCompte.mockResolvedValue({ userId: 'proprio', scope: { donnees: {} } })
  validerDestinataires.mockImplementation(async (ids: string[]) => ({
    comptes: ids.map(id => ({ id, nom: `Nom ${id}`, email: ADRESSE, locale: 'fr' })),
    refuses: [],
  }))
  composerEmail.mockResolvedValue({ sujet: SUJET, html: '<p>x</p>', texte: 'x' })
})

describe('rapports programmes : reprise', () => {
  it('(a) envoi OK : echeance avancee, essais 0, un mail par destinataire', async () => {
    const depot = creerDepotMemoire([rapportDeTest({ destinataires: ['d1', 'd2'] })])
    const envoyer = vi.fn(async () => true)
    const bilan = await appel(depot, MAINTENANT, { envoyerMail: envoyer })
    const ligne = depot.rapports.get('rap-1')!
    expect(bilan).toMatchObject({ echus: 1, envoyes: 1, echecs: 0, restants: 0 })
    expect(envoyer).toHaveBeenCalledTimes(2)
    expect(ligne.prochainEnvoiA).toEqual(LENDEMAIN)
    expect(ligne.essais).toBe(0)
    expect(ligne.enCoursJusqua).toBeNull()
    expect(ligne.dernierStatut).toBe('ok')
  })

  it('(b) SMTP en panne : pas d avance, essai +1, bail leve, repris, 3e echec = avance + notifications', async () => {
    const depot = creerDepotMemoire([rapportDeTest()], ['admin-1', 'proprio'])
    const envoyer = vi.fn(async () => false)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    let bilan = await appel(depot, MAINTENANT, { envoyerMail: envoyer })
    let ligne = depot.rapports.get('rap-1')!
    expect(bilan.echecs).toBe(1)
    expect(ligne.prochainEnvoiA).toEqual(new Date('2026-11-13T07:00:00.000Z'))
    expect(ligne.essais).toBe(1)
    expect(ligne.enCoursJusqua).toBeNull()
    expect(ligne.derniereErreur).toBe('envoi_impossible')

    bilan = await appel(depot, new Date(MAINTENANT.getTime() + QUINZE_MIN), { envoyerMail: envoyer })
    ligne = depot.rapports.get('rap-1')!
    expect(bilan.echus).toBe(1)
    expect(ligne.essais).toBe(2)
    expect(creerNotification).not.toHaveBeenCalled()

    const t3 = new Date(MAINTENANT.getTime() + 2 * QUINZE_MIN)
    await appel(depot, t3, { envoyerMail: envoyer })
    ligne = depot.rapports.get('rap-1')!
    expect(envoyer).toHaveBeenCalledTimes(3)
    expect(ligne.essais).toBe(0)
    expect(ligne.prochainEnvoiA).toEqual(LENDEMAIN)
    // Proprietaire + admin, dedoublonnes ; aucune notification de type e-mail.
    const destinataires = creerNotification.mock.calls.map(c => (c[0] as { userId: string }).userId)
    expect(destinataires.sort()).toEqual(['admin-1', 'proprio'])
    const premiere = creerNotification.mock.calls[0][0] as { message: string; titre: string }
    expect(premiere.message).toContain('Ventes du mois')
    expect(envoyer).toHaveBeenCalledTimes(3) // pas d'e-mail pour la notification
  })

  it('(c) export qui leve : meme mecanique', async () => {
    const depot = creerDepotMemoire([rapportDeTest()], ['admin-1'])
    const envoyer = vi.fn(async () => true)
    const export_ko = vi.fn(async () => {
      throw new Error('boum')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 3; i += 1) {
      await appel(depot, new Date(MAINTENANT.getTime() + i * QUINZE_MIN), {
        envoyerMail: envoyer,
        construireExport: export_ko,
      })
      const essais = depot.rapports.get('rap-1')!.essais
      expect(essais).toBe(i < 2 ? i + 1 : 0)
    }
    expect(envoyer).not.toHaveBeenCalled()
    expect(depot.rapports.get('rap-1')!.prochainEnvoiA).toEqual(LENDEMAIN)
    expect(creerNotification).toHaveBeenCalledTimes(2) // proprietaire + 1 admin
  })

  it('(d) bail expire = repris (compte un essai) ; bail non expire = ignore', async () => {
    const envoyer = vi.fn(async () => true)
    const vivant = creerDepotMemoire([
      rapportDeTest({ enCoursJusqua: new Date(MAINTENANT.getTime() + 60_000) }),
    ])
    const bilanVivant = await appel(vivant, MAINTENANT, { envoyerMail: envoyer })
    expect(bilanVivant.echus).toBe(0)
    expect(envoyer).not.toHaveBeenCalled()

    const expire = creerDepotMemoire([
      rapportDeTest({ enCoursJusqua: new Date(MAINTENANT.getTime() - 60_000), essais: 1 }),
    ])
    const bilan = await appel(expire, MAINTENANT, { envoyerMail: envoyer })
    expect(bilan.envoyes).toBe(1)
    expect(envoyer).toHaveBeenCalledTimes(1)
    expect(expire.rapports.get('rap-1')!.essais).toBe(0)
  })

  it('(d) plantages repetes : bornes a 3, l echeance est abandonnee sans envoi', async () => {
    const envoyer = vi.fn(async () => true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const depot = creerDepotMemoire(
      [rapportDeTest({ enCoursJusqua: new Date(MAINTENANT.getTime() - 1), essais: 2 })],
      ['admin-1']
    )
    const bilan = await appel(depot, MAINTENANT, { envoyerMail: envoyer })
    expect(bilan.echecs).toBe(1)
    expect(envoyer).not.toHaveBeenCalled()
    const ligne = depot.rapports.get('rap-1')!
    expect(ligne.prochainEnvoiA).toEqual(LENDEMAIN)
    expect(ligne.essais).toBe(0)
    expect(creerNotification).toHaveBeenCalledTimes(2)
  })

  it('(e) deux appels simultanes : un seul envoi', async () => {
    const depot = creerDepotMemoire([rapportDeTest()])
    const envoyer = vi.fn(async () => true)
    const [a, b] = await Promise.all([
      appel(depot, MAINTENANT, { envoyerMail: envoyer }),
      appel(depot, MAINTENANT, { envoyerMail: envoyer }),
    ])
    expect(envoyer).toHaveBeenCalledTimes(1)
    expect(a.envoyes + b.envoyes).toBe(1)
    expect(a.ignores + b.ignores).toBe(1)
    // Appel successif : echeance avancee, plus rien d'echu.
    const c = await appel(depot, new Date(MAINTENANT.getTime() + QUINZE_MIN), { envoyerMail: envoyer })
    expect(c.echus).toBe(0)
    expect(envoyer).toHaveBeenCalledTimes(1)
  })

  it('(f) budget depasse : les rapports restants ne sont pas touches', async () => {
    const depot = creerDepotMemoire([
      rapportDeTest({ id: 'r1', prochainEnvoiA: new Date('2026-11-13T05:00:00.000Z') }),
      rapportDeTest({ id: 'r2', prochainEnvoiA: new Date('2026-11-13T06:00:00.000Z') }),
      rapportDeTest({ id: 'r3', prochainEnvoiA: new Date('2026-11-13T06:30:00.000Z') }),
    ])
    const envoyer = vi.fn(async () => true)
    let t = 0
    // Chaque lecture d'horloge avance de 100 ms : debut=0, 1er rapport 100 (<150), 2e 200 (>=150).
    const horloge = () => {
      t += 100
      return t
    }
    const bilan = await appel(depot, MAINTENANT, { envoyerMail: envoyer, budgetMs: 150, horloge })
    expect(bilan).toMatchObject({ echus: 3, envoyes: 1, restants: 2 })
    expect(depot.rapports.get('r1')!.prochainEnvoiA).toEqual(LENDEMAIN)
    for (const id of ['r2', 'r3']) {
      const ligne = depot.rapports.get(id)!
      expect(ligne.enCoursJusqua).toBeNull()
      expect(ligne.essais).toBe(0)
      expect(ligne.prochainEnvoiA!.getTime()).toBeLessThan(MAINTENANT.getTime())
    }
  })

  it('(g) le journal ne contient ni adresse e-mail ni sujet', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {})
    const depot = creerDepotMemoire([rapportDeTest({ destinataires: ['d1', 'd2'] })])
    let n = 0
    const envoyer = vi.fn(async () => {
      n += 1
      if (n === 2) throw new Error(`SMTP refuse ${ADRESSE} ${SUJET}`)
      return true
    })
    await appel(depot, MAINTENANT, { envoyerMail: envoyer })
    const lignes = JSON.stringify([...info.mock.calls, ...erreur.mock.calls])
    expect(lignes).not.toContain(ADRESSE)
    expect(lignes).not.toContain('example.test')
    expect(lignes).not.toContain(SUJET)
    expect(info).toHaveBeenCalledWith(
      '[datagenius] rapports',
      expect.objectContaining({ rapportId: 'rap-1', destinataireId: 'd1', resultat: 'ok', essai: 1 })
    )
    expect(erreur).toHaveBeenCalledWith(
      '[datagenius] rapports',
      expect.objectContaining({ destinataireId: 'd2', resultat: 'echec', essai: 1 })
    )
  })

  it('partiel : terminal, echeance avancee, pas de reprise', async () => {
    const depot = creerDepotMemoire([rapportDeTest({ destinataires: ['d1', 'd2'] })])
    let n = 0
    const envoyer = vi.fn(async () => ++n === 1)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bilan = await appel(depot, MAINTENANT, { envoyerMail: envoyer })
    expect(bilan.partiels).toBe(1)
    const ligne = depot.rapports.get('rap-1')!
    expect(ligne.prochainEnvoiA).toEqual(LENDEMAIN)
    expect(ligne.essais).toBe(0)
  })
})
