import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { GET as catalogue } from '@/app/api/v1/catalogue/route'
import { POST as indicateurs } from '@/app/api/v1/indicateurs/route'
import { POST as autorisation } from '@/app/api/v1/integration/autorisation/route'
import { POST as embarquer } from '@/app/api/v1/integration/tableau/route'
import { prisma } from '@/lib/db/client'
import { consommerJeton, delivrerJeton } from '@/lib/integration/embarquement'
import { creerCleApi, revoquerCleApi, tournerCleApi } from '@/lib/integration/cles-api'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { creerGroupe, modifierGroupe, modifierRegle } from '@/lib/warehouse/droits-admin'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import { enregistrerTableau } from '@/lib/warehouse/tableaux'

const { garde } = vi.hoisted(() => ({ garde: vi.fn() }))
vi.mock('@/lib/medic-assist/acces', () => ({ exigerMedicAssist: garde }))

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('API et intégration embarquée', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('vérifie la session, l’origine, les droits à la lecture et l’usage unique', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') throw new Error('Utiliser la base fictive dg_app.')
    const origine = 'http://127.0.0.1:3130'
    const autre = 'https://autre.example'
    const application = 'http://localhost:3120'
    const comptes: string[] = []
    let groupe: string | undefined
    const acteur = randomUUID()
    vi.stubEnv('DATAGENIUS_EMBED_ORIGINS', `${origine},${autre}`)
    vi.stubEnv('NEXTAUTH_URL', application)
    async function creerCompte(roleName: string) {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Intégration', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return contexte
    }
    function demandeJson(corps: unknown, origineRequete = application) {
      return new Request(application + '/api/v1', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origineRequete }, body: JSON.stringify(corps) })
    }
    function demandeCadre(jeton: string, origineRequete = origine) {
      return new Request(application + '/api/v1/integration/tableau', { method: 'POST', headers: { Origin: origineRequete },
        body: new URLSearchParams({ jeton, filtre: 'mois', valeur: '2026-10' }) })
    }
    try {
      await synchroniserEntrepot({ jeu: 'ventes' })
      const proprietaire = await creerCompte('TenantAdmin')
      const membre = await creerCompte('Member')
      const exclu = await creerCompte('Member')
      const tableau = await enregistrerTableau(proprietaire, { titre: 'Ventes <pilote>', lecteurs: [membre.userId], tuiles: [
        { id: randomUUID(), type: 'mesure', jeu: 'ventes', mesure: 'ca_eur', dimensions: ['agence'] },
      ] })
      const nom = `Intégration ${randomUUID()}`
      groupe = await creerGroupe(acteur, nom)
      await modifierGroupe(acteur, groupe, nom, [membre.userId])
      await modifierRegle(acteur, 'ventes', { groupes: [groupe], masquer: [], filtre: { colonne: 'agence', valeur: 'Lagune' } })
      const demande = { jeu: 'ventes', mesures: ['ca_eur'], filtres: { mois: '2026-10' } }
      garde.mockResolvedValue({ ok: false, reponse: new Response(null, { status: 401 }) })
      expect((await catalogue(new Request(application + '/api/v1/catalogue'))).status).toBe(401)
      expect((await indicateurs(demandeJson(demande))).status).toBe(401)
      const actualiseExclu = (await contexteDepuisCompte(exclu.userId))!
      garde.mockResolvedValue({ ok: true, contexte: actualiseExclu })
      expect((await (await catalogue(new Request(application + '/api/v1/catalogue'))).json()).jeux).not.toContainEqual(expect.objectContaining({ cle: 'ventes' }))
      expect((await indicateurs(demandeJson(demande))).status).toBe(404)
      expect(await delivrerJeton(actualiseExclu, tableau, origine)).toBeNull()

      const lecteur = (await contexteDepuisCompte(membre.userId))!
      garde.mockResolvedValue({ ok: true, contexte: lecteur })
      const resultat = await (await indicateurs(demandeJson(demande))).json()
      expect(resultat.lignes).toEqual([{ ca_eur: 1280 }])
      expect(resultat.provenance).not.toHaveProperty('sql')
      expect((await indicateurs(demandeJson({ ...demande, sql: 'SELECT 1' }))).status).toBe(400)
      expect((await autorisation(demandeJson({ tableau, origine }, autre))).status).toBe(403)

      const premiere = await creerCleApi(lecteur.userId, 'Recette API', 2)
      const api = (secret: string) => new Request(application + '/api/v1/catalogue', { headers: { Authorization: `Bearer ${secret}` } })
      expect((await catalogue(api(premiere.secret))).status).toBe(200)
      const nouvelle = await tournerCleApi(premiere.id)
      expect((await catalogue(api(premiere.secret))).status).toBe(401)
      expect((await catalogue(api(nouvelle.secret))).status).toBe(200)
      expect(await revoquerCleApi(nouvelle.id)).toBe(true)
      expect((await catalogue(api(nouvelle.secret))).status).toBe(401)
      const expiree = await creerCleApi(lecteur.userId, 'Clé expirée')
      await prisma.$executeRaw`UPDATE warehouse.cles_api SET expire_a = clock_timestamp() WHERE id = ${expiree.id}::uuid`
      expect((await catalogue(api(expiree.secret))).status).toBe(401)
      const active = await creerCleApi(lecteur.userId, 'Autre clé de recette')

      const reponse = await autorisation(demandeJson({ tableau, origine }))
      expect(reponse.status).toBe(200)
      const { jeton } = await reponse.json()
      expect((await embarquer(demandeCadre(jeton, autre))).status).toBe(403)
      const cadre = await embarquer(demandeCadre(jeton))
      expect(cadre.status).toBe(200)
      expect(cadre.headers.get('content-security-policy')).toContain(`frame-ancestors ${origine}`)
      const html = await cadre.text()
      expect(html).toContain('Ventes &lt;pilote&gt;')
      expect(html).toContain('1280')
      expect((await embarquer(demandeCadre(jeton))).status).toBe(403)

      const unique = (await delivrerJeton(lecteur, tableau, origine))!
      expect((await Promise.all([consommerJeton(unique, origine), consommerJeton(unique, origine)])).filter(Boolean)).toHaveLength(1)
      const revoque = (await delivrerJeton(lecteur, tableau, origine))!
      await prisma.user.update({ where: { id: membre.userId }, data: { status: 'inactive' } })
      expect(await consommerJeton(revoque, origine)).toBeNull()
      expect((await catalogue(api(active.secret))).status).toBe(401)
    } finally {
      vi.unstubAllEnvs()
      if (groupe) {
        await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = 'ventes'`
        await prisma.$executeRaw`DELETE FROM warehouse.groupes_acces WHERE id = ${groupe}::uuid`
      }
      await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ${acteur}`
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    }
  }, 30_000)
})
