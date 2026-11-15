import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Etat = { etat: boolean; verifie_a: Date }
  const bd = {
    tableaux: [] as { id: string; proprietaire_id: string; version: number; definition: unknown }[],
    lecteurs: new Set<string>(),
    etats: new Map<string, Etat>(),
    notifications: [] as Record<string, unknown>[],
    comptes: new Map<string, { email: string; firstName: string; lastName: string }>(),
  }
  const sql = (chaines: TemplateStringsArray) => chaines.join('?')
  const executeur = {
    async $queryRaw(chaines: TemplateStringsArray, ...v: unknown[]) {
      const texte = sql(chaines)
      if (texte.includes('jsonb_path_exists')) return bd.tableaux
      if (texte.includes('lecteurs_tableaux')) return [...bd.lecteurs].filter(c => c.startsWith(v[0] + '|')).map(c => ({ utilisateur_id: c.split('|')[1] }))
      if (texte.includes('FOR UPDATE')) { const t = bd.tableaux.find(x => x.id === v[0]); return t ? [{ version: t.version }] : [] }
      if (texte.includes('etat_alertes_tableaux')) { const e = bd.etats.get(v.join('|')); return e ? [e] : [] }
      throw new Error('requête inconnue : ' + texte)
    },
    async $executeRaw(chaines: TemplateStringsArray, ...v: unknown[]) {
      const texte = sql(chaines)
      if (texte.includes('INSERT INTO warehouse.etat_alertes_tableaux')) bd.etats.set(v.slice(0, 3).join('|'), { etat: v[3] as boolean, verifie_a: v[4] as Date })
      else if (texte.includes('DELETE FROM warehouse.etat_alertes_tableaux')) {
        for (const cle of [...bd.etats.keys()]) {
          const [t, tuile, u] = cle.split('|')
          if (t === v[0] && tuile === v[1] && !(v[2] as string[]).includes(u)) bd.etats.delete(cle)
        }
      } else if (!texte.includes('UPDATE warehouse.tableaux')) throw new Error('commande inconnue : ' + texte)
      return 1
    },
    notification: { async create({ data }: { data: Record<string, unknown> }) { bd.notifications.push(data); return data } },
  }
  const prisma = { ...executeur, $transaction: async (fn: (tx: typeof executeur) => unknown) => fn(executeur),
    user: { async findUnique({ where }: { where: { id: string } }) { return bd.comptes.get(where.id) ?? null } } }
  class ErreurTableau extends Error {}
  return {
    bd, prisma, ErreurTableau, registre: { marqueur: 'registre-brut' },
    valeurs: new Map<string, number | 'indisponible'>(), contextes: new Map<string, unknown>(),
    calculerTuile: vi.fn(), contexteDepuisCompte: vi.fn(), envoyerMail: vi.fn(), envoyerWebhook: vi.fn(),
  }
})

vi.mock('@/lib/db/client', () => ({ prisma: h.prisma }))
vi.mock('@/lib/warehouse/tableaux', () => ({ ErreurTableau: h.ErreurTableau, calculerTuile: h.calculerTuile }))
vi.mock('@/lib/medic-assist/suivi/comptes', () => ({ contexteDepuisCompte: h.contexteDepuisCompte }))
vi.mock('@/lib/medic-assist/donnees/catalogue/registre', () => ({ registrePostgres: vi.fn(async () => h.registre) }))
vi.mock('@/lib/mail/transport', () => ({ envoyerMail: h.envoyerMail }))
vi.mock('@/lib/notifications/webhook', () => ({ envoyerWebhook: h.envoyerWebhook }))

import { ErreurAlerte, traiterAlertesTableaux, verifierAlertesDefinition } from '@/lib/warehouse/tableaux-alertes'

const TABLEAU = '11111111-1111-4111-8111-111111111111'
const TUILE = '22222222-2222-4222-8222-222222222222'
const WEBHOOK = 'https://hooks.example.org/alerte'

type AlerteTest = { sens: 'au_dessus' | 'au_dessous'; seuil: string; destinataires?: string[]; email?: boolean; webhook?: string }

function contexte(userId: string, roleName = 'Member', locale = 'fr') {
  return { userId, roleName, locale, scope: {}, habilitations: null, maintenant: new Date() }
}

function installer(alerte: AlerteTest, opts: { proprietaire?: string; roles?: Record<string, string>; locales?: Record<string, string> } = {}) {
  const proprietaire = opts.proprietaire ?? 'proprio'
  h.bd.tableaux = [{ id: TABLEAU, proprietaire_id: proprietaire, version: 1, definition: {
    titre: 'Suivi du pilote', lecteurs: [],
    tuiles: [{ id: TUILE, type: 'mesure', jeu: 'ventes', mesure: 'ca_eur', dimensions: [], alerte }],
  } }]
  for (const id of [proprietaire, 'a', 'b', 'c']) {
    h.contextes.set(id, contexte(id, opts.roles?.[id] ?? (id === proprietaire ? 'TenantAdmin' : 'Member'), opts.locales?.[id] ?? 'fr'))
    h.bd.comptes.set(id, { email: `${id}@exemple.test`, firstName: id.toUpperCase(), lastName: 'Test' })
  }
}

const cle = (u: string) => `${TABLEAU}|${TUILE}|${u}`
const notifies = () => h.bd.notifications.map(n => n.userId)
const sorties: unknown[][] = []
let heure = Date.parse('2026-11-15T10:00:00Z')
const passe = async () => { heure += 60_000; vi.setSystemTime(heure); return traiterAlertesTableaux() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  sorties.length = 0
  for (const niveau of ['info', 'warn', 'error', 'log'] as const) vi.spyOn(console, niveau).mockImplementation((...args) => { sorties.push(args) })
  Object.assign(h.bd, { tableaux: [], lecteurs: new Set(), etats: new Map(), notifications: [], comptes: new Map() })
  h.valeurs.clear(); h.contextes.clear()
  h.calculerTuile.mockReset()
  h.calculerTuile.mockImplementation(async (tuile: { mesure: string }, ctx: { userId: string; locale: string }) => {
    const valeur = h.valeurs.get(ctx.userId)
    if (valeur === 'indisponible' || valeur === undefined) throw new h.ErreurTableau('Indicateur indisponible.')
    return { libelle: `Mesure ${ctx.locale}`, unite: '€', filtreApplique: false, resultat: { lignes: [{ [tuile.mesure]: valeur }] } }
  })
  h.contexteDepuisCompte.mockReset()
  h.contexteDepuisCompte.mockImplementation(async (id: string) => h.contextes.get(id) ?? null)
  h.envoyerMail.mockReset(); h.envoyerMail.mockResolvedValue(true)
  h.envoyerWebhook.mockReset(); h.envoyerWebhook.mockResolvedValue({ ok: true })
  vi.setSystemTime(heure)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('alertes de tableaux par destinataire', () => {
  it('déclenche au passage normal puis ne répète pas tant que l’état reste déclenché', async () => {
    installer({ sens: 'au_dessus', seuil: '100' })
    h.valeurs.set('proprio', 150)
    const premier = await passe()
    expect(premier).toEqual({ tableaux: 1, notifications: 1, erreurs: 0, emails: 0, webhooks: 0 })
    expect(h.bd.notifications).toEqual([expect.objectContaining({
      userId: 'proprio', type: 'tableau_alerte', channel: 'in_app', status: 'sent', relatedEntityType: 'tableau', relatedEntityId: TABLEAU,
    })])
    expect((await passe()).notifications).toBe(0)
    h.valeurs.set('proprio', 50)
    await passe()
    expect(h.bd.etats.get(cle('proprio'))?.etat).toBe(false)
    h.valeurs.set('proprio', 150)
    expect((await passe()).notifications).toBe(1)
    expect(h.bd.notifications).toHaveLength(2)
    expect(h.calculerTuile).toHaveBeenCalledWith(expect.objectContaining({ id: TUILE }), h.contextes.get('proprio'), undefined, false, h.registre)
  })

  it('calcule chaque destinataire avec son contexte et ne notifie que celui qui franchit le seuil', async () => {
    installer({ sens: 'au_dessus', seuil: '100', destinataires: ['a', 'b'] }, { locales: { b: 'en' } })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`, `${TABLEAU}|b`])
    h.valeurs.set('proprio', 5000)
    h.valeurs.set('a', 40)
    h.valeurs.set('b', 1234.5678)
    const bilan = await passe()
    expect(bilan.notifications).toBe(2)
    expect(notifies().sort()).toEqual(['b', 'proprio'])
    for (const id of ['proprio', 'a', 'b']) {
      expect(h.calculerTuile).toHaveBeenCalledWith(expect.anything(), h.contextes.get(id), undefined, false, h.registre)
    }
    const deB = h.bd.notifications.find(n => n.userId === 'b')!
    expect(deB.message).toContain('1,234.57')
    expect(deB.message).not.toContain('5,000')
    expect(deB.title).toContain('Mesure en')
    const dePro = h.bd.notifications.find(n => n.userId === 'proprio')!
    expect(String(dePro.message).replace(/\s/g, ' ')).toContain('5 000')
    expect(dePro.message).not.toContain('1234')
    expect([...h.bd.etats].map(([k, v]) => [k.split('|')[2], v.etat]).sort()).toEqual([['a', false], ['b', true], ['proprio', true]])
    expect((await passe()).notifications).toBe(0)
    expect(h.bd.notifications).toHaveLength(2)
  })

  it('exclut un destinataire désigné qui n’est plus lecteur et purge son état', async () => {
    installer({ sens: 'au_dessus', seuil: '100', destinataires: ['a', 'c'] })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`])
    h.valeurs.set('proprio', 10); h.valeurs.set('a', 10); h.valeurs.set('c', 999)
    h.bd.etats.set(cle('c'), { etat: true, verifie_a: new Date(0) })
    h.bd.etats.set(cle('b'), { etat: false, verifie_a: new Date(0) })
    await passe()
    expect(notifies()).toEqual([])
    expect(h.contexteDepuisCompte).not.toHaveBeenCalledWith('c')
    expect(h.calculerTuile.mock.calls.map(c => c[1].userId).sort()).toEqual(['a', 'proprio'])
    expect([...h.bd.etats.keys()].sort()).toEqual([cle('a'), cle('proprio')])
  })

  it('exclut un destinataire sans contexte (compte inactif ou sans accès)', async () => {
    installer({ sens: 'au_dessus', seuil: '100', destinataires: ['a'] })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`])
    h.valeurs.set('proprio', 500); h.valeurs.set('a', 500)
    h.contextes.delete('a')
    const bilan = await passe()
    expect(bilan).toMatchObject({ notifications: 1, erreurs: 0 })
    expect(notifies()).toEqual(['proprio'])
  })

  it('saute sans erreur un destinataire pour qui l’indicateur est indisponible', async () => {
    installer({ sens: 'au_dessous', seuil: '100', destinataires: ['a'] })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`])
    h.valeurs.set('proprio', 10); h.valeurs.set('a', 'indisponible')
    const bilan = await passe()
    expect(bilan).toMatchObject({ notifications: 1, erreurs: 0 })
    expect(h.bd.etats.has(cle('a'))).toBe(false)
  })

  it('compte une erreur inattendue sans bloquer les autres destinataires', async () => {
    installer({ sens: 'au_dessus', seuil: '100', destinataires: ['a'] })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`])
    h.valeurs.set('proprio', 500); h.valeurs.set('a', 500)
    h.calculerTuile.mockImplementationOnce(async () => { throw new Error('panne') })
    const bilan = await passe()
    expect(bilan).toMatchObject({ notifications: 1, erreurs: 1 })
    expect(notifies()).toEqual(['a'])
  })

  it('envoie le webhook une fois pour un propriétaire TenantAdmin, jamais pour un Member', async () => {
    installer({ sens: 'au_dessus', seuil: '100', webhook: WEBHOOK, destinataires: ['a'] })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`])
    h.valeurs.set('proprio', 777); h.valeurs.set('a', 888)
    const bilan = await passe()
    expect(bilan.webhooks).toBe(1)
    expect(h.envoyerWebhook).toHaveBeenCalledTimes(1)
    const [adresse, charge] = h.envoyerWebhook.mock.calls[0]
    expect(adresse).toBe(WEBHOOK)
    expect(charge).toEqual({
      evenement: 'tableau_alerte', tableau: { id: TABLEAU, titre: 'Suivi du pilote' }, tuile: { id: TUILE, mesure: 'ca_eur' },
      sens: 'au_dessus', seuil: '100', declencheA: expect.any(String), lien: expect.stringMatching(new RegExp(`/tableaux/${TABLEAU}$`)),
    })
    expect(JSON.stringify(charge)).not.toMatch(/777|888/)
    await passe()
    expect(h.envoyerWebhook).toHaveBeenCalledTimes(1)

    installer({ sens: 'au_dessus', seuil: '100', webhook: WEBHOOK }, { roles: { proprio: 'Member' } })
    h.bd.etats.clear(); h.envoyerWebhook.mockClear()
    const sansDroit = await passe()
    expect(sansDroit).toMatchObject({ notifications: 1, webhooks: 0 })
    expect(h.envoyerWebhook).not.toHaveBeenCalled()
    expect(JSON.stringify(sorties)).not.toContain('example.org')
  })

  it('compose l’e-mail dans la langue de chaque destinataire déclenché, sans adresse dans les journaux', async () => {
    installer({ sens: 'au_dessus', seuil: '100', email: true, destinataires: ['a', 'b'] }, { locales: { proprio: 'fr', a: 'en', b: 'es' } })
    h.bd.lecteurs = new Set([`${TABLEAU}|a`, `${TABLEAU}|b`])
    h.valeurs.set('proprio', 500); h.valeurs.set('a', 500); h.valeurs.set('b', 3)
    const bilan = await passe()
    expect(bilan).toMatchObject({ notifications: 2, emails: 2 })
    expect(h.envoyerMail).toHaveBeenCalledTimes(2)
    const parDestinataire = Object.fromEntries(h.envoyerMail.mock.calls.map(([m]) => [m.to, m]))
    expect(Object.keys(parDestinataire).sort()).toEqual(['a@exemple.test', 'proprio@exemple.test'])
    expect(parDestinataire['a@exemple.test'].html).toContain('lang="en"')
    expect(parDestinataire['a@exemple.test'].subject).toContain('Dashboard alert')
    expect(parDestinataire['a@exemple.test'].text).toContain('A Test')
    expect(parDestinataire['proprio@exemple.test'].html).toContain('lang="fr"')
    expect(parDestinataire['proprio@exemple.test'].subject).toContain('Alerte')
    expect(parDestinataire['a@exemple.test'].text).toContain(`/tableaux/${TABLEAU}`)
    await passe()
    expect(h.envoyerMail).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(sorties)).not.toContain('exemple.test')
  })

  it('n’envoie aucun e-mail sans l’option email', async () => {
    installer({ sens: 'au_dessus', seuil: '100' })
    h.valeurs.set('proprio', 500)
    await passe()
    expect(h.envoyerMail).not.toHaveBeenCalled()
  })

  it('un échec d’e-mail ou de webhook ne lève pas, garde la notification et n’est pas rejoué', async () => {
    installer({ sens: 'au_dessus', seuil: '100', email: true, webhook: WEBHOOK })
    h.valeurs.set('proprio', 500)
    h.envoyerMail.mockRejectedValue(new Error('SMTP en panne'))
    h.envoyerWebhook.mockRejectedValue(new Error('réseau'))
    const premier = await passe()
    expect(premier).toEqual({ tableaux: 1, notifications: 1, erreurs: 0, emails: 0, webhooks: 0 })
    expect(h.bd.notifications).toHaveLength(1)
    await passe()
    expect(h.envoyerMail).toHaveBeenCalledTimes(1)
    expect(h.envoyerWebhook).toHaveBeenCalledTimes(1)

    installer({ sens: 'au_dessus', seuil: '100', email: true, webhook: WEBHOOK })
    h.bd.etats.clear(); h.bd.notifications.length = 0
    h.envoyerMail.mockReset(); h.envoyerMail.mockResolvedValue(false)
    h.envoyerWebhook.mockReset(); h.envoyerWebhook.mockResolvedValue({ ok: false, raison: 'statut' })
    expect(await passe()).toEqual({ tableaux: 1, notifications: 1, erreurs: 0, emails: 0, webhooks: 0 })
    await passe()
    expect(h.envoyerMail).toHaveBeenCalledTimes(1)
    expect(h.envoyerWebhook).toHaveBeenCalledTimes(1)
  })
})

describe('verifierAlertesDefinition', () => {
  const definition = (webhook?: string) => ({ titre: 'T', lecteurs: [], tuiles: [{ id: TUILE, type: 'mesure' as const, jeu: 'ventes', mesure: 'ca_eur',
    dimensions: [], alerte: { sens: 'au_dessus' as const, seuil: '1', ...(webhook ? { webhook } : {}) } }] })

  it('refuse un webhook à un non-administrateur et l’accepte à un TenantAdmin', () => {
    expect(() => verifierAlertesDefinition(contexte('x', 'Member') as never, definition(WEBHOOK))).toThrow(ErreurAlerte)
    expect(() => verifierAlertesDefinition(contexte('x', 'TenantAdmin') as never, definition(WEBHOOK))).not.toThrow()
    expect(() => verifierAlertesDefinition(contexte('x', 'Member') as never, definition())).not.toThrow()
  })

  it('tolère un webhook inchangé pour un non-administrateur, pas un webhook modifié ou ajouté', () => {
    const membre = contexte('x', 'Member') as never
    expect(() => verifierAlertesDefinition(membre, definition(WEBHOOK), definition(WEBHOOK))).not.toThrow()
    expect(() => verifierAlertesDefinition(membre, definition(WEBHOOK + 'x'), definition(WEBHOOK))).toThrow(ErreurAlerte)
    expect(() => verifierAlertesDefinition(membre, definition(WEBHOOK), definition())).toThrow(ErreurAlerte)
  })
})
