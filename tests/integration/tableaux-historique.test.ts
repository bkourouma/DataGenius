import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import { contexteDepuisCompte } from '@/lib/medic-assist/suivi/comptes'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import {
  chargerTableau, chargerVersion, dupliquerTableau, enregistrerTableau, listerTableaux, listerVersions, restaurerVersion, supprimerTableau,
} from '@/lib/warehouse/tableaux'
import type { DefinitionTableau } from '@/lib/warehouse/tableaux-modeles'

const archives = (id: string) => prisma.$queryRaw<{ version: number; definition: DefinitionTableau; auteur_id: string | null }[]>`
  SELECT version, definition, auteur_id FROM warehouse.tableaux_versions WHERE tableau_id = ${id}::uuid ORDER BY version`

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Historique des tableaux', () => {
  afterAll(async () => Promise.all([prisma.$disconnect(), deconnecterPostgres()]))

  it('archive, purge, restaure et protège les versions', async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') throw new Error('Utiliser la base fictive dg_app.')
    const comptes: string[] = []
    async function creerCompte(roleName: string) {
      const compte = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, firstName: 'Histo', lastName: 'Rique', passwordHash: 'fixture', roleName } })
      comptes.push(compte.id)
      const contexte = await contexteDepuisCompte(compte.id)
      if (!contexte) throw new Error('Compte de test inaccessible')
      return contexte
    }
    const tuileId = randomUUID()
    const definition = (titre: string, lecteurs: string[] = []): DefinitionTableau => ({
      titre, lecteurs, tuiles: [{ id: tuileId, type: 'mesure', jeu: 'ventes', mesure: 'ca_eur', dimensions: [] }],
    })
    try {
      await synchroniserEntrepot({ jeu: 'ventes' })
      const proprietaire = await creerCompte('TenantAdmin')
      const lecteur = await creerCompte('Member')
      const id = await enregistrerTableau(proprietaire, definition('V1', [lecteur.userId]))
      expect(await archives(id)).toEqual([])

      // (i) un enregistrement archive la version précédente
      await enregistrerTableau(proprietaire, definition('V2', [lecteur.userId]), { id, version: 1 })
      const [v1] = await archives(id)
      expect(v1).toMatchObject({ version: 1, auteur_id: proprietaire.userId, definition: { titre: 'V1' } })

      // (iii) restauration : nouvelle version, ancienne courante archivée
      expect(await restaurerVersion(proprietaire, id, 1, 2)).toBe(id)
      const apresRestauration = await chargerTableau(id, proprietaire)
      expect(apresRestauration?.version).toBe(3)
      expect(apresRestauration?.definition.titre).toBe('V1')
      expect((await archives(id)).map(a => [a.version, a.definition.titre])).toEqual([[1, 'V1'], [2, 'V2']])
      const liste = await listerVersions(proprietaire, id)
      expect(liste).toMatchObject({ courante: 3 })
      expect(liste?.versions.map(v => [v.version, v.courante])).toEqual([[3, true], [2, false], [1, false]])
      expect(liste?.versions[0]?.auteur).toBe('Histo Rique')
      expect(await chargerVersion(proprietaire, id, 2)).toMatchObject({ version: 2, courante: false, versionCourante: 3, definition: { titre: 'V2' } })
      expect(await chargerVersion(proprietaire, id, 99)).toBeNull()

      // (iv) conflits
      await expect(restaurerVersion(proprietaire, id, 1, 2)).rejects.toThrow('modifié')
      await expect(enregistrerTableau(proprietaire, definition('X'), { id, version: 1 })).rejects.toThrow('modifié')
      await expect(restaurerVersion(proprietaire, id, 3, 3)).rejects.toThrow('déjà la version actuelle')

      // (v) un lecteur ne peut ni lister ni restaurer
      expect(await listerVersions(lecteur, id)).toBeNull()
      expect(await chargerVersion(lecteur, id, 1)).toBeNull()
      await expect(restaurerVersion(lecteur, id, 1, 3)).rejects.toThrow('indisponible')

      // (vi) la duplication ne copie pas l'historique, la suppression l'efface
      const copie = await dupliquerTableau(proprietaire, id)
      expect(await archives(copie)).toEqual([])
      await supprimerTableau(proprietaire, id)
      expect(await archives(id)).toHaveLength(0)

      // (ii) conservation : 50 versions au total (courante + 49 archives)
      const autre = await enregistrerTableau(proprietaire, definition('Purge 0'))
      for (let i = 1; i <= 55; i++) await enregistrerTableau(proprietaire, definition(`Purge ${i}`), { id: autre, version: i })
      const restantes = await archives(autre)
      expect(restantes).toHaveLength(49)
      expect(restantes.map(a => a.version)).toEqual(Array.from({ length: 49 }, (_, i) => i + 7))
      expect((await chargerTableau(autre, proprietaire))?.version).toBe(56)
      const historique = await listerVersions(proprietaire, autre)
      expect(historique?.versions).toHaveLength(50)
      expect(historique?.versions.map(v => v.version)).toEqual(Array.from({ length: 50 }, (_, i) => 56 - i))
      // la plus ancienne version conservée n'a plus de précédente : résumé non disponible
      expect(historique?.versions.at(-1)?.resume).toBeNull()
      expect(historique?.versions.at(-2)?.resume).not.toBeNull()
      expect((await chargerVersion(proprietaire, autre, 7))?.resume).toBeNull()
      expect((await chargerVersion(proprietaire, autre, 8))?.resume).not.toBeNull()
      expect((await listerVersions(proprietaire, id))).toBeNull()

      // (vii) la restauration conserve les lecteurs courants
      const L = await creerCompte('Member')
      const M = await creerCompte('Member')
      const acces = await enregistrerTableau(proprietaire, definition('A1', [L.userId]))
      await enregistrerTableau(proprietaire, definition('A2'), { id: acces, version: 1 })
      expect(await chargerTableau(acces, L)).toBeNull()
      expect(await restaurerVersion(proprietaire, acces, 1, 2)).toBe(acces)
      expect((await chargerTableau(acces, proprietaire))).toMatchObject({ version: 3, definition: { titre: 'A1', lecteurs: [] } })
      expect(await chargerTableau(acces, L)).toBeNull()
      expect(await listerTableaux(L)).toEqual([])
      expect((await listerVersions(proprietaire, acces))?.versions[0]?.resume).toMatchObject({ lecteursModifies: false })

      // un ancien lecteur supprimé du système n'empêche pas la restauration
      const ancien = await enregistrerTableau(proprietaire, definition('B1', [M.userId]))
      await enregistrerTableau(proprietaire, definition('B2'), { id: ancien, version: 1 })
      await prisma.user.delete({ where: { id: M.userId } })
      expect(await restaurerVersion(proprietaire, ancien, 1, 2)).toBe(ancien)
      expect(await chargerTableau(ancien, proprietaire)).toMatchObject({ version: 3, definition: { titre: 'B1', lecteurs: [] } })

      // (viii) concurrence : un seul des deux enregistrements simultanés aboutit
      const concurrent = await enregistrerTableau(proprietaire, definition('C0'))
      const issues = await Promise.allSettled([
        enregistrerTableau(proprietaire, definition('C-a'), { id: concurrent, version: 1 }),
        enregistrerTableau(proprietaire, definition('C-b'), { id: concurrent, version: 1 }),
      ])
      expect(issues.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      const rejets = issues.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(rejets).toHaveLength(1)
      expect(String(rejets[0]?.reason?.message)).toContain('modifié')
      expect((await archives(concurrent)).map(a => a.version)).toEqual([1])
      expect((await chargerTableau(concurrent, proprietaire))?.version).toBe(2)
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: comptes } } })
    }
  }, 60_000)
})
