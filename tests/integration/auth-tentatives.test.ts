import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  cleEmail, FENETRE_MINUTES, magasinPrisma, reinitialiser, reserverTentative, SEUIL_EMAIL,
} from '@/lib/auth/limite-connexion'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Limitation des tentatives de connexion', () => {
  const email = `recette-${Date.now()}@example.test`
  const cle = cleEmail(email)
  const ligne = () => prisma.tentativeConnexion.findUnique({ where: { cle } })
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await prisma.tentativeConnexion.deleteMany({ where: { cle } })
  })
  afterAll(async () => {
    await prisma.tentativeConnexion.deleteMany({ where: { cle } })
    await prisma.$disconnect()
  })

  it('12 réservations concurrentes : exactement 5 autorisées, blocage posé, compteur figé', async () => {
    const resultats = await Promise.all(Array.from({ length: 12 }, () => reserverTentative({ email })))
    expect(resultats.filter(Boolean)).toHaveLength(SEUIL_EMAIL)
    const l = await ligne()
    expect(l?.echecs).toBe(SEUIL_EMAIL + 1)
    expect(l?.bloqueJusqua).not.toBeNull()
    expect(await reserverTentative({ email })).toBe(false)
    expect((await ligne())?.echecs).toBe(SEUIL_EMAIL + 1)
  })

  it('ne bloque pas sous le seuil puis réinitialise sur succès', async () => {
    for (let i = 0; i < SEUIL_EMAIL - 1; i++) expect(await reserverTentative({ email })).toBe(true)
    expect((await ligne())?.bloqueJusqua).toBeNull()
    await reinitialiser({ email })
    expect(await ligne()).toBeNull()
  })

  it('redémarre à 1 quand la fenêtre et le blocage ont expiré', async () => {
    for (let i = 0; i < SEUIL_EMAIL + 1; i++) await reserverTentative({ email })
    await prisma.tentativeConnexion.update({
      where: { cle },
      data: { fenetreDebut: new Date(Date.now() - 20 * 60_000), bloqueJusqua: new Date(Date.now() - 60_000) },
    })
    expect(await reserverTentative({ email })).toBe(true)
    const l = await ligne()
    expect(l?.echecs).toBe(1)
    expect(l?.bloqueJusqua).toBeNull()
    expect(l!.fenetreDebut.getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('un blocage actif survit à l’expiration de la fenêtre', async () => {
    for (let i = 0; i < SEUIL_EMAIL + 1; i++) await reserverTentative({ email })
    await prisma.tentativeConnexion.update({
      where: { cle },
      data: { fenetreDebut: new Date(Date.now() - (FENETRE_MINUTES + 1) * 60_000) },
    })
    expect(await reserverTentative({ email })).toBe(false)
  })

  it('la purge supprime les lignes expirées sans blocage et garde les blocages actifs', async () => {
    const vieille = `${cle}-vieille`
    const bloquee = `${cle}-bloquee`
    const ancien = new Date(Date.now() - 60 * 60_000)
    await prisma.tentativeConnexion.createMany({
      data: [
        { cle: vieille, echecs: 3, fenetreDebut: ancien, bloqueJusqua: null },
        { cle: bloquee, echecs: 6, fenetreDebut: ancien, bloqueJusqua: new Date(Date.now() + 60_000) },
      ],
    })
    try {
      await magasinPrisma.purger()
      expect(await prisma.tentativeConnexion.findUnique({ where: { cle: vieille } })).toBeNull()
      expect(await prisma.tentativeConnexion.findUnique({ where: { cle: bloquee } })).not.toBeNull()
    } finally {
      await prisma.tentativeConnexion.deleteMany({ where: { cle: { in: [vieille, bloquee] } } })
    }
  })

  it('rend une réservation IP sans descendre sous zéro', async () => {
    await magasinPrisma.enregistrer(cle, 30)
    await magasinPrisma.liberer(cle)
    await magasinPrisma.liberer(cle)
    expect((await ligne())?.echecs).toBe(0)
  })
})
