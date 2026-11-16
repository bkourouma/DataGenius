import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { envoyerMail, envoyerWebhook } = vi.hoisted(() => ({
  envoyerMail: vi.fn(async (_message: { to: string | string[]; subject: string; html: string; text: string }) => true),
  envoyerWebhook: vi.fn(async (_adresse: string, _charge: unknown) => ({ ok: true as const })),
}))
vi.mock('@/lib/mail/transport', () => ({ envoyerMail }))
vi.mock('@/lib/notifications/webhook', () => ({ envoyerWebhook }))

import { prisma } from '@/lib/db/client'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { enregistrerTableau, lireTableau } from '@/lib/warehouse/tableaux'
import { listerAlertesTableaux, traiterAlertesTableaux } from '@/lib/warehouse/tableaux-alertes'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'

const WEBHOOK = 'https://hooks.example.org/alerte'
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const espaces = (texte: string) => texte.replace(/[  ]/g, ' ')

class Retour extends Error {}

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Alertes de tableaux par destinataire', () => {
  beforeEach(() => { envoyerMail.mockClear(); envoyerWebhook.mockClear() })
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('notifie propriétaire et destinataire avec leur propre valeur, une seule fois, et la migration conserve l’état', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') throw new Error('Utiliser la base fictive dg_app.')
    const comptes: string[] = []
    const acteur = randomUUID()
    let groupe: string | undefined
    async function creerCompte(roleName: string) {
      const email = `${randomUUID()}@example.test`
      const compte = await prisma.user.create({ data: { email, firstName: 'Alerte', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return { contexte, email }
    }
    try {
      await synchroniserEntrepot({ jeu: 'ventes' })
      const proprietaire = await creerCompte('TenantAdmin')
      const lecteurA = await creerCompte('Member')
      const lecteurB = await creerCompte('Member')
      const nonLecteur = await creerCompte('Member')

      const nom = `Alertes ${randomUUID()}`
      groupe = await creerGroupe(acteur, nom)
      await modifierGroupe(acteur, groupe, nom, [lecteurA.contexte.userId])
      await modifierRegle(acteur, 'ventes', { groupes: [groupe], masquer: [], filtre: { colonne: 'agence', valeur: 'Lagune' } })
      const restreintA = (await contexteDepuisCompte(lecteurA.contexte.userId))!

      const tuile = { id: randomUUID(), type: 'mesure' as const, jeu: 'ventes', mesure: 'ca_eur', dimensions: [] as string[],
        alerte: { sens: 'au_dessus' as const, seuil: '1', email: true, webhook: WEBHOOK,
          destinataires: [lecteurA.contexte.userId] } }
      const definition: DefinitionTableau = { titre: 'Alertes du pilote', lecteurs: [lecteurA.contexte.userId, lecteurB.contexte.userId], tuiles: [tuile] }
      const tableau = await enregistrerTableau(proprietaire.contexte, definition)

      const valeur = async (contexte: Awaited<ReturnType<typeof contexteDepuisCompte>>) => {
        const lu = await lireTableau(tableau, contexte!)
        const t = lu?.tuiles[0] as { type: string; resultat: { lignes: Record<string, number>[] } }
        expect(t.type).toBe('mesure')
        return t.resultat.lignes[0].ca_eur
      }
      const valeurProprietaire = await valeur(proprietaire.contexte)
      const valeurA = await valeur(restreintA)
      expect(valeurA).not.toBe(valeurProprietaire)
      const formater = (n: number) => espaces(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n))

      const premier = await traiterAlertesTableaux()
      expect(premier).toMatchObject({ tableaux: expect.any(Number), erreurs: 0 })
      await pause(15)
      const second = await traiterAlertesTableaux()
      expect(second).toMatchObject({ erreurs: 0, notifications: 0, emails: 0, webhooks: 0 })
      expect(premier).toMatchObject({ notifications: 2, emails: 2, webhooks: 1 })

      const notifications = await prisma.notification.findMany({ where: { userId: { in: comptes }, type: 'tableau_alerte' } })
      expect(notifications.map(n => n.userId).sort()).toEqual([proprietaire.contexte.userId, lecteurA.contexte.userId].sort())
      for (const n of notifications) {
        expect(n).toMatchObject({ channel: 'in_app', status: 'sent', relatedEntityType: 'tableau', relatedEntityId: tableau })
      }
      const deProprietaire = notifications.find(n => n.userId === proprietaire.contexte.userId)!
      const deA = notifications.find(n => n.userId === lecteurA.contexte.userId)!
      expect(espaces(deProprietaire.message)).toContain(formater(valeurProprietaire))
      expect(espaces(deA.message)).toContain(formater(valeurA))
      expect(espaces(deA.message)).not.toContain(formater(valeurProprietaire))

      const etats = await prisma.$queryRaw<{ utilisateur_id: string; etat: boolean }[]>`
        SELECT utilisateur_id, etat FROM warehouse.etat_alertes_tableaux WHERE tableau_id = ${tableau}::uuid ORDER BY utilisateur_id
      `
      expect(etats.map(e => e.utilisateur_id).sort()).toEqual([proprietaire.contexte.userId, lecteurA.contexte.userId].sort())
      expect(etats.every(e => e.etat)).toBe(true)

      expect(envoyerMail.mock.calls.map(([m]) => m.to).sort()).toEqual([proprietaire.email, lecteurA.email].sort())
      expect(envoyerWebhook).toHaveBeenCalledTimes(1)
      const [adresse, charge] = envoyerWebhook.mock.calls[0]
      expect(adresse).toBe(WEBHOOK)
      expect(charge).toMatchObject({ evenement: 'tableau_alerte', tableau: { id: tableau, titre: 'Alertes du pilote' }, tuile: { id: tuile.id, mesure: 'ca_eur' } })
      expect(JSON.stringify(charge)).not.toContain(String(valeurProprietaire))

      expect(await listerAlertesTableaux(restreintA)).toMatchObject([{ tableau, titre: 'Alertes du pilote' }])
      expect(await listerAlertesTableaux((await contexteDepuisCompte(lecteurB.contexte.userId))!)).toEqual([])
      expect(await listerAlertesTableaux((await contexteDepuisCompte(nonLecteur.contexte.userId))!)).toEqual([])

      // Migration : rejoue le script sur une table à l’ancien format et vérifie que l’état du propriétaire est conservé.
      const script = readFileSync(join(process.cwd(), 'prisma/migrations/20261115010000_alertes_par_destinataire/migration.sql'), 'utf8')
      const instructions = script.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
      let apres: { utilisateur_id: string; etat: boolean }[] = []
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('DELETE FROM warehouse.etat_alertes_tableaux')
        await tx.$executeRawUnsafe('ALTER TABLE warehouse.etat_alertes_tableaux DROP COLUMN utilisateur_id')
        await tx.$executeRawUnsafe('ALTER TABLE warehouse.etat_alertes_tableaux ADD PRIMARY KEY (tableau_id, tuile_id)')
        await tx.$executeRaw`
          INSERT INTO warehouse.etat_alertes_tableaux (tableau_id, tuile_id, etat, verifie_a) VALUES (${tableau}::uuid, ${tuile.id}::uuid, true, now())
        `
        for (const instruction of instructions) await tx.$executeRawUnsafe(instruction)
        apres = await tx.$queryRaw<{ utilisateur_id: string; etat: boolean }[]>`
          SELECT utilisateur_id, etat FROM warehouse.etat_alertes_tableaux WHERE tableau_id = ${tableau}::uuid
        `
        throw new Retour()
      }, { timeout: 30_000 })).rejects.toBeInstanceOf(Retour)
      expect(apres).toEqual([{ utilisateur_id: proprietaire.contexte.userId, etat: true }])
      // La transaction annulée laisse la table dans son état migré.
      expect(await prisma.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_schema = 'warehouse' AND table_name = 'etat_alertes_tableaux' AND column_name = 'utilisateur_id'`).toHaveLength(1)
    } finally {
      if (groupe) {
        await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = 'ventes'`
        await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupe}::uuid`
      }
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.notification.deleteMany({ where: { userId: { in: comptes } } })
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    }
  }, 60_000)
})
