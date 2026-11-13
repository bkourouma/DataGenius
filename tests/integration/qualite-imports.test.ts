import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import { calculerSql } from '@/lib/medic-assist/donnees/sql/calcul'
import { deconnecterPostgres } from '@/lib/warehouse/postgres'
import { chargerQualite, enregistrerQualite } from '@/lib/warehouse/qualite-admin'
import { ajouterSource, creerImport } from '@/lib/warehouse/sources-admin'
import { synchroniserEntrepot } from '@/lib/warehouse/synchronisation'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Préparation et qualité des imports', () => {
  let source: string | undefined
  let cle: string | undefined

  afterAll(async () => {
    try {
      if (cle) {
        await prisma.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${cle}`
      }
      if (source) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${source}`
    } finally {
      await Promise.all([prisma.$disconnect(), deconnecterPostgres()])
    }
  })

  it('transforme les lignes, rejette un contrôle bloquant et conserve la dernière publication', async () => {
    const url = new URL(process.env.DATAGENIUS_SOURCE_DISTRIBUTION ?? '')
    if (url.pathname !== '/dg_source' || new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser les bases fictives de la recette.')
    }
    source = await ajouterSource({ titre: 'Source qualité', hote: url.hostname, port: url.port || '5432', base: 'dg_source',
      utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable' })
    const jeu = await creerImport({ sourceId: source, titre: 'Factures à contrôler', schema: 'finance', table: 'factures',
      colonnes: ['facture_id', 'devise', 'montant', 'equipe'], description: '', frequenceMinutes: 60 })
    cle = jeu
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'publie' }])

    const definition = {
      filtres: [{ colonne: 'devise', operateur: 'egal', valeur: 'XOF' }],
      normalisations: [{ colonne: 'equipe', operation: 'majuscules' }],
      controles: [{ type: 'unique', colonnes: ['facture_id'] }, { type: 'non_nul', colonnes: ['equipe'] },
        { type: 'plage', colonnes: ['montant'], min: '0', max: '200' }],
    }
    await enregistrerQualite(jeu, 0, definition)
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'publie' }])
    const requeteCopie = () => prisma.$queryRaw<{ lignes: number; contenu: { equipe: string }[]; publie_a: Date }[]>`
      SELECT lignes, contenu, publie_a FROM warehouse.snapshots WHERE jeu = ${jeu}
    `
    const publication = (await requeteCopie())[0]
    expect(publication.lignes).toBe(3)
    expect(publication.contenu.map(ligne => ligne.equipe).sort()).toEqual(['NORD', 'NORD', 'SUD'])

    await expect(enregistrerQualite(jeu, 0, definition)).rejects.toThrow('Rechargez')
    await enregistrerQualite(jeu, 1, { ...definition, controles: [{ type: 'unique', colonnes: ['equipe'] }] })
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'echec' }])
    expect((await requeteCopie())[0]).toEqual(publication)
    const fiche = await chargerQualite(jeu)
    expect(fiche?.version).toBe(2)
    expect(fiche?.historique.map(({ statut, code, lignesLues, lignesValides }) => ({ statut, code, lignesLues, lignesValides })))
      .toEqual([
        { statut: 'echec', code: 'unique', lignesLues: 4, lignesValides: null },
        { statut: 'publie', code: null, lignesLues: 4, lignesValides: 3 },
        { statut: 'publie', code: null, lignesLues: 4, lignesValides: 4 },
      ])
    expect(fiche?.publication).toEqual(publication.publie_a)
    expect(fiche?.derniereReussite).not.toBeNull()
    const contexte: ContexteExecution = {
      userId: 'recette-fraicheur', roleName: 'TenantAdmin', scope: { roleName: 'TenantAdmin', voitTout: true },
      habilitations: null, locale: 'fr', maintenant: new Date('2026-11-12T12:00:00Z'),
    }
    const calcul = await calculerSql({ objectif: 'Vérifier la provenance de la dernière publication',
      sql: 'SELECT COUNT(*) AS total FROM mv_' + jeu }, contexte)
    expect(calcul.lignes).toEqual([{ total: 3 }])
    expect(calcul.provenance.regles.some(regle => regle.includes('dernière synchronisation en échec'))).toBe(true)

    await enregistrerQualite(jeu, 2, definition)
    expect(await synchroniserEntrepot({ jeu })).toEqual([{ jeu, statut: 'identique' }])
    await prisma.$executeRaw`UPDATE warehouse.snapshots SET fraiche_jusqua = now() - interval '1 minute' WHERE jeu = ${jeu}`
    const enRetard = await calculerSql({ objectif: 'Vérifier le retard du jeu', sql: 'SELECT COUNT(*) AS total FROM mv_' + jeu }, contexte)
    expect(enRetard.provenance.regles.some(regle => regle.includes('vérification en retard'))).toBe(true)
  })
})
