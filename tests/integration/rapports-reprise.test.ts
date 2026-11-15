import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { obtenirDepot } from '@/lib/medic-assist/suivi/depot-prisma'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Rapports programmes : bail et reprise', () => {
  afterAll(() => prisma.$disconnect())

  it('reserve par compare-and-set avec bail, reprend apres expiration et leve le bail au resultat', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser uniquement les bases de recette PostgreSQL.')
    }
    const depot = obtenirDepot()
    const compte = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, firstName: 'Recette', passwordHash: 'fixture' },
    })
    const echeance = new Date('2026-11-13T07:00:00.000Z')
    const maintenant = new Date('2026-11-13T09:00:00.000Z')
    const bail = new Date(maintenant.getTime() + 10 * 60_000)
    const rapport = await prisma.assistantRapportProgramme.create({
      data: {
        userId: compte.id, titre: 'Rapport recette', artefactRacineId: randomUUID(), frequence: 'quotidien',
        heure: '08:00', destinataires: [], formats: ['pdf'], prochainEnvoiA: echeance,
      },
    })
    try {
      expect((await depot.listerRapportsEchus(maintenant, 500)).map(r => r.id)).toContain(rapport.id)

      // Deux reservations simultanees : une seule gagne.
      const attendu = { prochainEnvoiA: echeance, essais: 0 }
      const gains = await Promise.all([
        depot.reserverRapport(rapport.id, attendu, maintenant, bail, 0),
        depot.reserverRapport(rapport.id, attendu, maintenant, bail, 0),
      ])
      expect(gains.filter(Boolean)).toHaveLength(1)

      // Bail en cours : ni liste, ni reservable ; l'echeance n'a pas avance.
      expect((await depot.listerRapportsEchus(maintenant, 500)).map(r => r.id)).not.toContain(rapport.id)
      expect(await depot.reserverRapport(rapport.id, attendu, maintenant, bail, 0)).toBe(false)
      expect((await prisma.assistantRapportProgramme.findUniqueOrThrow({ where: { id: rapport.id } })).prochainEnvoiA)
        .toEqual(echeance)

      // Bail expire : de nouveau liste et reservable (un plantage compte un essai).
      const plusTard = new Date(bail.getTime() + 1)
      expect((await depot.listerRapportsEchus(plusTard, 500)).map(r => r.id)).toContain(rapport.id)
      expect(await depot.reserverRapport(rapport.id, attendu, plusTard, new Date(plusTard.getTime() + 600_000), 1)).toBe(true)

      // Echec reessayable : echeance inchangee, bail leve, essais enregistres.
      await depot.enregistrerResultatRapport(rapport.id, {
        dernierEnvoiA: plusTard, statut: 'echec', erreur: 'envoi_impossible', essais: 2,
      })
      let ligne = await prisma.assistantRapportProgramme.findUniqueOrThrow({ where: { id: rapport.id } })
      expect(ligne).toMatchObject({ essais: 2, enCoursJusqua: null, dernierErreur: 'envoi_impossible' })
      expect(ligne.prochainEnvoiA).toEqual(echeance)

      // Succes : echeance avancee, essais remis a zero.
      expect(await depot.reserverRapport(rapport.id, { prochainEnvoiA: echeance, essais: 2 }, plusTard, bail, 2)).toBe(true)
      const suivante = new Date('2026-11-14T07:00:00.000Z')
      await depot.enregistrerResultatRapport(rapport.id, {
        dernierEnvoiA: plusTard, statut: 'ok', erreur: null, essais: 0, prochainEnvoiA: suivante,
      })
      ligne = await prisma.assistantRapportProgramme.findUniqueOrThrow({ where: { id: rapport.id } })
      expect(ligne).toMatchObject({ essais: 0, enCoursJusqua: null })
      expect(ligne.prochainEnvoiA).toEqual(suivante)

      // Desactivation : leve aussi le bail.
      await prisma.assistantRapportProgramme.update({ where: { id: rapport.id }, data: { enCoursJusqua: bail } })
      await depot.mettreAJourRapport(rapport.id, compte.id, { actif: false })
      ligne = await prisma.assistantRapportProgramme.findUniqueOrThrow({ where: { id: rapport.id } })
      expect(ligne).toMatchObject({ actif: false, enCoursJusqua: null })
    } finally {
      await prisma.assistantRapportProgramme.deleteMany({ where: { id: rapport.id } })
      await prisma.user.deleteMany({ where: { id: compte.id } })
    }
  })
})
