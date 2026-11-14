/**
 * Verrou du tour de chat (lib/medic-assist/agent/verrou.ts, branché dans executer.ts) :
 * un tour à la fois par conversation, deux au plus par utilisateur, libération en fin de tour
 * et sur erreur, expiration après 6 minutes. Base Prisma en mémoire, modèle simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ajouterConversation,
  ajouterMessage,
  injecterPanne,
  reinitialiserBase,
  tables,
} from './_base-memoire'
import {
  UTILISATEUR,
  configDe,
  contexteDe,
  corpsMessage,
  erreurAuthentification,
  etapeErreur,
  etapeTexte,
  lireJusquauBout,
  modeleSimule,
  promesseControlee,
} from './_banc-chat'

// Marqueur de test : ZZLBVERROU

const h = vi.hoisted(() => ({
  creerModele: vi.fn(),
  lireConfig: vi.fn(),
  quota: vi.fn(),
}))

vi.mock('@/lib/db/client', async () => {
  const { base } = await import('./_base-memoire')
  return { prisma: base, default: base }
})
vi.mock('@/lib/medic-assist/config', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/medic-assist/config')>()),
  creerModele: h.creerModele,
  lireConfigMedicAssist: h.lireConfig,
}))
vi.mock('@/lib/medic-assist/agent/quota', () => ({ verifierQuotaJournalier: h.quota }))
vi.mock('@/lib/medic-assist/agent/reference', () => ({ genererReference: () => 'DG-TEST01' }))
vi.mock('@/lib/medic-assist/agent/outils-adaptateur', () => ({ creerOutilsReels: () => ({}) }))
vi.mock('@/lib/medic-assist/donnees/outils', () => ({
  resumeCatalogueCompact: async () => 'Catalogue de test',
}))

import { executerChat } from '@/lib/medic-assist/agent/executer'
import {
  DUREE_VERROU_MS,
  TOURS_SIMULTANES_MAX,
  compterToursEnCours,
  libererVerrou,
  prendreVerrouConversation,
  prendreVerrouTour,
  verifierLimiteUtilisateur,
} from '@/lib/medic-assist/agent/verrou'

const contexte = contexteDe()

function chat(corps: unknown, signal?: AbortSignal) {
  return executerChat({ contexte, corps, ...(signal ? { signal } : {}) })
}

beforeEach(() => {
  reinitialiserBase()
  h.lireConfig.mockResolvedValue(configDe())
  h.quota.mockResolvedValue({ autorise: true })
  h.creerModele.mockImplementation(() => modeleSimule(() => etapeTexte('Réponse')))
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('verrou.ts : prise, libération, expiration (horloge injectée)', () => {
  it('une seule prise réussit tant que le verrou court ; il expire après 6 minutes', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    const t0 = new Date('2026-11-13T10:00:00Z')

    const premier = await prendreVerrouConversation(UTILISATEUR, conv.id as string, t0)
    expect(premier?.jusqua.getTime()).toBe(t0.getTime() + DUREE_VERROU_MS)
    expect(await prendreVerrouConversation(UTILISATEUR, conv.id as string, t0)).toBeNull()

    const avantEcheance = new Date(t0.getTime() + DUREE_VERROU_MS - 1)
    expect(await prendreVerrouConversation(UTILISATEUR, conv.id as string, avantEcheance)).toBeNull()

    const apresEcheance = new Date(t0.getTime() + DUREE_VERROU_MS + 1)
    const repris = await prendreVerrouConversation(UTILISATEUR, conv.id as string, apresEcheance)
    expect(repris).not.toBeNull()

    // L'ancien détenteur (verrou échu puis repris) ne libère pas le verrou du nouveau.
    expect(await libererVerrou(premier)).toBe(false)
    expect(tables.conversations[0].tourEnCoursJusqua).toEqual(repris!.jusqua)
    expect(await libererVerrou(repris)).toBe(true)
    expect(tables.conversations[0].tourEnCoursJusqua).toBeNull()
  })

  it("ne prend pas le verrou d'une conversation d'un autre utilisateur", async () => {
    const conv = ajouterConversation({ userId: 'autre' })
    expect(await prendreVerrouConversation(UTILISATEUR, conv.id as string)).toBeNull()
    expect(tables.conversations[0].tourEnCoursJusqua).toBeNull()
  })

  it('limite par utilisateur : le 3e verrou est refusé et libéré a posteriori', async () => {
    const t0 = new Date('2026-11-13T10:00:00Z')
    const convs = [1, 2, 3].map(() => ajouterConversation({ userId: UTILISATEUR }))
    for (const c of convs.slice(0, TOURS_SIMULTANES_MAX)) {
      expect((await prendreVerrouTour(UTILISATEUR, c.id as string, t0)).pris).toBe(true)
    }
    const refus = await prendreVerrouTour(UTILISATEUR, convs[2].id as string, t0)
    expect(refus).toEqual({ pris: false, raison: 'limite_utilisateur' })
    expect(convs[2].tourEnCoursJusqua).toBeNull()
    expect(await compterToursEnCours(UTILISATEUR, t0)).toBe(2)
    // Les verrous échus ne comptent plus.
    expect(await compterToursEnCours(UTILISATEUR, new Date(t0.getTime() + DUREE_VERROU_MS + 1))).toBe(0)
  })

  it('verifierLimiteUtilisateur libère le verrou posé si la limite est dépassée', async () => {
    const t0 = new Date()
    const futur = new Date(t0.getTime() + 60_000)
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    const c = ajouterConversation({ userId: UTILISATEUR })
    const verrou = await prendreVerrouConversation(UTILISATEUR, c.id as string, t0)
    expect(await verifierLimiteUtilisateur(verrou!, t0)).toEqual({
      pris: false,
      raison: 'limite_utilisateur',
    })
    expect(c.tourEnCoursJusqua).toBeNull()
  })
})

describe('executerChat : un tour à la fois par conversation', () => {
  it('2e requête pendant un tour -> 409 tour_en_cours ; verrou libéré à la fin du tour', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    const bloque = promesseControlee()
    const appels: number[] = []
    h.creerModele.mockImplementation(() =>
      modeleSimule(async n => {
        appels.push(n)
        await bloque.promesse
        return etapeTexte('Réponse')
      })
    )

    const premier = await chat(corpsMessage('client-a', { conversationId: conv.id }))
    expect(premier.type).toBe('flux')
    expect(conv.tourEnCoursJusqua).toBeInstanceOf(Date)

    const second = await chat(corpsMessage('client-b', { conversationId: conv.id }))
    expect(second).toMatchObject({
      type: 'erreur',
      statut: 409,
      corps: { error: 'tour_en_cours', details: { reference: 'DG-TEST01' } },
    })
    // Aucun message écrit par la requête refusée.
    expect(tables.messages.filter(m => m.idClient === 'client-b')).toHaveLength(0)

    bloque.liberer()
    await lireJusquauBout(premier)
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
    expect(appels).toHaveLength(1)

    // Le tour suivant passe.
    const troisieme = await chat(corpsMessage('client-c', { conversationId: conv.id }))
    expect(troisieme.type).toBe('flux')
    await lireJusquauBout(troisieme)
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
  })

  it('nouvelle conversation : verrou posé dès la création puis libéré en fin de tour', async () => {
    const bloque = promesseControlee()
    h.creerModele.mockImplementation(() =>
      modeleSimule(async () => {
        await bloque.promesse
        return etapeTexte('Réponse')
      })
    )
    const resultat = await chat(corpsMessage('client-n'))
    if (resultat.type !== 'flux') throw new Error('flux attendu')
    expect(resultat.conversationCreee).toBe(true)
    const conv = tables.conversations.find(c => c.id === resultat.conversationId)!
    expect(conv.tourEnCoursJusqua).toBeInstanceOf(Date)

    const concurrent = await chat(corpsMessage('client-m', { conversationId: conv.id }))
    expect(concurrent).toMatchObject({ statut: 409, corps: { error: 'tour_en_cours' } })

    bloque.liberer()
    await lireJusquauBout(resultat)
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
  })

  it('verrou libéré après une erreur du fournisseur dans le flux', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    h.creerModele.mockImplementation(() => modeleSimule(() => etapeErreur(erreurAuthentification())))
    const resultat = await chat(corpsMessage('client-e', { conversationId: conv.id }))
    const texte = await lireJusquauBout(resultat)
    expect(texte).toContain('medic_assist_erreur:authentification_fournisseur')
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
    // L'usage est enregistré avec le code d'erreur.
    expect(tables.usages).toHaveLength(1)
    expect(tables.usages[0].erreur).toBe('authentification_fournisseur')
  })

  it('verrou libéré sur une erreur renvoyée avant le flux (404 de régénération)', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    ajouterMessage({ conversationId: conv.id as string, role: 'user' })
    const resultat = await chat({
      conversationId: conv.id,
      trigger: 'regenerate-message',
      messageId: 'inconnu',
    })
    expect(resultat).toMatchObject({
      statut: 404,
      corps: { error: 'not_found', details: { reference: 'DG-TEST01' } },
    })
    expect(conv.tourEnCoursJusqua).toBeNull()
  })

  it('verrou libéré sur une exception avant le flux (500, référence journalisée)', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    injecterPanne('message.create')
    const resultat = await chat(corpsMessage('client-x', { conversationId: conv.id }))
    expect(resultat).toMatchObject({
      statut: 500,
      corps: { error: 'internal', details: { reference: 'DG-TEST01' } },
    })
    expect(conv.tourEnCoursJusqua).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      '[datagenius] chat',
      expect.objectContaining({
        reference: 'DG-TEST01',
        conversationId: conv.id,
        userId: UTILISATEUR,
        code: 'internal',
      })
    )
  })

  it('verrou libéré quand le client annule le tour (réponse partielle interrompue)', async () => {
    const conv = ajouterConversation({ userId: UTILISATEUR })
    const controleur = new AbortController()
    h.creerModele.mockImplementation(() =>
      modeleSimule(async () => {
        controleur.abort()
        return etapeTexte('Réponse')
      })
    )
    const resultat = await chat(corpsMessage('client-z', { conversationId: conv.id }), controleur.signal)
    await lireJusquauBout(resultat)
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
    expect(tables.usages).toHaveLength(1)
    expect(tables.usages[0].erreur).toBe('annule')
  })

  it('un verrou échu (plus de 6 minutes) ne bloque plus la conversation', async () => {
    const conv = ajouterConversation({
      userId: UTILISATEUR,
      tourEnCoursJusqua: new Date(Date.now() - 1_000),
    })
    const resultat = await chat(corpsMessage('client-v', { conversationId: conv.id }))
    expect(resultat.type).toBe('flux')
    await lireJusquauBout(resultat)
    await vi.waitFor(() => expect(conv.tourEnCoursJusqua).toBeNull())
  })
})

describe('executerChat : deux tours simultanés au plus par utilisateur', () => {
  it('3e conversation pendant deux tours -> 409 tour_en_cours, verrou relâché', async () => {
    const futur = new Date(Date.now() + 60_000)
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    const conv = ajouterConversation({ userId: UTILISATEUR })

    const resultat = await chat(corpsMessage('client-3', { conversationId: conv.id }))
    expect(resultat).toMatchObject({
      statut: 409,
      corps: { error: 'tour_en_cours', details: { reference: 'DG-TEST01' } },
    })
    expect(conv.tourEnCoursJusqua).toBeNull()
    expect(h.creerModele).toHaveBeenCalledTimes(1) // modèle construit, jamais appelé
  })

  it('nouvelle conversation pendant deux tours -> 409, aucune conversation créée', async () => {
    const futur = new Date(Date.now() + 60_000)
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    ajouterConversation({ userId: UTILISATEUR, tourEnCoursJusqua: futur })
    const resultat = await chat(corpsMessage('client-4'))
    expect(resultat).toMatchObject({ statut: 409, corps: { error: 'tour_en_cours' } })
    expect(tables.conversations).toHaveLength(2)
    expect(tables.messages).toHaveLength(0)
  })

  it("les tours d'un autre utilisateur ne comptent pas", async () => {
    const futur = new Date(Date.now() + 60_000)
    ajouterConversation({ userId: 'autre', tourEnCoursJusqua: futur })
    ajouterConversation({ userId: 'autre', tourEnCoursJusqua: futur })
    const resultat = await chat(corpsMessage('client-5'))
    expect(resultat.type).toBe('flux')
    await lireJusquauBout(resultat)
  })
})
