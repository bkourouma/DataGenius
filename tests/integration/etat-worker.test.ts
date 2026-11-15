import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db/client'
import {
  enregistrerBattement, hoteCourt, lireEtatWorker, lireExecutionsEnEchec, nettoyerInstancesMuettes,
} from '@/lib/warehouse/etat-worker'

const meta = { hote: 'serveur-recette', version: '0.2.0', intervalleMs: 15_000 }

function garde() {
  if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
    throw new Error('Utiliser uniquement les bases de recette PostgreSQL.')
  }
}

// Une seule instance « récente » à la fois : lireEtatWorker lit la plus récente de la table.
async function viderInstances() {
  await prisma.$executeRaw`DELETE FROM warehouse.worker_etat`
}

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('État du worker', () => {
  afterAll(async () => {
    garde()
    await viderInstances()
    await prisma.$disconnect()
  })

  it('battement de démarrage puis tour avec statistiques : marche', async () => {
    garde()
    await viderInstances()
    const instance = randomUUID()
    expect(await lireEtatWorker()).toEqual({ statut: 'jamais_vu', silenceMs: null, instance: null })

    expect(await enregistrerBattement(instance, meta)).toBe(true)
    let etat = await lireEtatWorker()
    expect(etat.statut).toBe('marche')
    expect(etat.instance).toMatchObject({ hote: 'serveur-recette', version: '0.2.0', dernierTour: null })
    const demarreA = etat.instance!.demarreA

    expect(await enregistrerBattement(instance, meta, { dureeMs: 420, jeux: 3, erreurs: 1 })).toBe(true)
    etat = await lireEtatWorker()
    expect(etat.statut).toBe('marche')
    expect(etat.silenceMs).toBeLessThan(5000)
    expect(etat.instance?.dernierTour).toMatchObject({ dureeMs: 420, jeux: 3, erreurs: 1 })
    // demarre_a est fixé à l'insertion seulement.
    expect(etat.instance!.demarreA).toEqual(demarreA)

    // Un battement sans statistiques conserve le dernier tour.
    expect(await enregistrerBattement(instance, meta)).toBe(true)
    expect((await lireEtatWorker()).instance?.dernierTour).toMatchObject({ dureeMs: 420, jeux: 3, erreurs: 1 })
    expect(Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM warehouse.worker_etat`)[0].n)).toBe(1)
  })

  it('silence de 10 minutes : arrêté, avec un silence cohérent', async () => {
    garde()
    await viderInstances()
    const instance = randomUUID()
    await enregistrerBattement(instance, meta)
    await prisma.$executeRaw`
      UPDATE warehouse.worker_etat SET dernier_signe_a = clock_timestamp() - interval '10 minutes'
      WHERE instance = ${instance}`
    const etat = await lireEtatWorker()
    expect(etat.statut).toBe('arrete')
    expect(etat.silenceMs).toBeGreaterThanOrEqual(600_000)
    expect(etat.silenceMs).toBeLessThan(620_000)
  })

  it('silence d’une minute : en retard', async () => {
    garde()
    await viderInstances()
    const instance = randomUUID()
    await enregistrerBattement(instance, meta)
    await prisma.$executeRaw`
      UPDATE warehouse.worker_etat SET dernier_signe_a = clock_timestamp() - interval '1 minute'
      WHERE instance = ${instance}`
    expect((await lireEtatWorker()).statut).toBe('en_retard')
  })

  it('nettoyage : supprime l’instance muette depuis 8 jours, garde la récente', async () => {
    garde()
    await viderInstances()
    const ancienne = randomUUID()
    const recente = randomUUID()
    await enregistrerBattement(ancienne, meta)
    await enregistrerBattement(recente, meta)
    await prisma.$executeRaw`
      UPDATE warehouse.worker_etat SET dernier_signe_a = clock_timestamp() - interval '8 days'
      WHERE instance = ${ancienne}`
    expect(await nettoyerInstancesMuettes()).toBe(1)
    const restantes = await prisma.$queryRaw<{ instance: string }[]>`SELECT instance FROM warehouse.worker_etat`
    expect(restantes.map(r => r.instance)).toEqual([recente])
  })

  it('exécutions en échec : seulement les échecs, du plus récent au plus ancien, avec le code', async () => {
    garde()
    const jeu = `recette_worker_${randomUUID().slice(0, 8)}`
    // La colonne mode_lecture vient d'une migration ultérieure à la création de la table.
    const colonnes = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'warehouse' AND table_name = 'executions' AND column_name = 'mode_lecture'`
    expect(colonnes).toHaveLength(1)
    try {
      await prisma.$executeRaw`
        INSERT INTO warehouse.executions (jeu, empreinte, qualite_version, verifie_a, duree_ms, statut, code, mode_lecture)
        VALUES
          (${jeu}, 'e1', 1, now() + interval '1 hour', 10, 'echec', 'source', NULL),
          (${jeu}, 'e1', 1, now() + interval '2 hours', 20, 'publie', NULL, 'delta'),
          (${jeu}, 'e1', 1, now() + interval '3 hours', 30, 'echec', 'schema', 'reconciliation')`
      const echecs = (await lireExecutionsEnEchec(50)).filter(e => e.jeu === jeu)
      expect(echecs.map(e => e.code)).toEqual(['schema', 'source'])
      expect(echecs.map(e => e.dureeMs)).toEqual([30, 10])
      expect(Object.keys(echecs[0]).sort()).toEqual(['code', 'dureeMs', 'jeu', 'verifieA'])
      expect(await lireExecutionsEnEchec(1)).toHaveLength(1)
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.executions WHERE jeu = ${jeu}`
    }
  })

  it('la table n’accueille aucun hôte au format IP', async () => {
    garde()
    await viderInstances()
    const instance = randomUUID()
    for (const brut of ['192.168.1.20', '::1', '2001:db8::1', '']) {
      await enregistrerBattement(instance, { ...meta, hote: hoteCourt(brut) })
    }
    const lignes = await prisma.$queryRaw<{ hote: string }[]>`SELECT hote FROM warehouse.worker_etat`
    expect(lignes).toEqual([{ hote: 'inconnu' }])
    expect(lignes[0].hote).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$|:/)
  })
})
