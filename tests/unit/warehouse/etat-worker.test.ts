import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.fn()
const executeRaw = vi.fn()
vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}))
const avertissement = vi.fn()
vi.mock('@/lib/journal', () => ({
  journal: { info: vi.fn(), avertissement: (...args: unknown[]) => avertissement(...args), erreur: vi.fn() },
}))

import {
  avecBattementPeriodique, DELAI_ARRET_MS, enregistrerBattement, evaluerEtatWorker, hoteCourt, lireEtatWorker,
  lireExecutionsEnEchec, nettoyerInstancesMuettes, nettoyerInstancesMuettesSiEchu,
} from '@/lib/warehouse/etat-worker'

beforeEach(() => {
  queryRaw.mockReset()
  executeRaw.mockReset()
  avertissement.mockReset()
})

describe('evaluerEtatWorker', () => {
  const intervalleMs = 15_000
  it('marche quand le silence reste sous deux intervalles', () => {
    expect(evaluerEtatWorker({ silenceMs: 0, intervalleMs })).toBe('marche')
    expect(evaluerEtatWorker({ silenceMs: 29_999, intervalleMs })).toBe('marche')
  })
  it('borne exacte de 30 s : encore en marche, puis en retard', () => {
    expect(evaluerEtatWorker({ silenceMs: 30_000, intervalleMs })).toBe('marche')
    expect(evaluerEtatWorker({ silenceMs: 30_001, intervalleMs })).toBe('en_retard')
  })
  it('borne exacte de 5 min : encore en retard, puis arrêté', () => {
    expect(DELAI_ARRET_MS).toBe(300_000)
    expect(evaluerEtatWorker({ silenceMs: 300_000, intervalleMs })).toBe('en_retard')
    expect(evaluerEtatWorker({ silenceMs: 300_001, intervalleMs })).toBe('arrete')
  })
  it('arrêté prime sur en retard même avec un grand intervalle', () => {
    expect(evaluerEtatWorker({ silenceMs: 600_000, intervalleMs: 10 * 60_000 })).toBe('arrete')
  })
})

describe('hoteCourt', () => {
  it('garde le premier label d’un nom de domaine complet', () => {
    expect(hoteCourt('serveur1.exemple.test')).toBe('serveur1')
    expect(hoteCourt('machine')).toBe('machine')
  })
  it('refuse une adresse IPv4 ou IPv6', () => {
    expect(hoteCourt('192.168.1.20')).toBe('inconnu')
    expect(hoteCourt('::1')).toBe('inconnu')
    expect(hoteCourt('2001:db8::7334')).toBe('inconnu')
    expect(hoteCourt('fe80::1%eth0')).toBe('inconnu')
  })
  it('renvoie inconnu pour une valeur vide', () => {
    expect(hoteCourt('')).toBe('inconnu')
    expect(hoteCourt('   ')).toBe('inconnu')
    expect(hoteCourt('.exemple.test')).toBe('inconnu')
  })
  it('tronque à 63 caractères', () => {
    const resultat = hoteCourt('a'.repeat(200) + '.exemple.test')
    expect(resultat).toHaveLength(63)
    expect(resultat).toBe('a'.repeat(63))
  })
})

describe('enregistrerBattement', () => {
  const meta = { hote: 'serveur1', version: '0.2.0', intervalleMs: 15_000 }

  it('renvoie true après un seul UPSERT', async () => {
    executeRaw.mockResolvedValueOnce(1)
    expect(await enregistrerBattement('i-1', meta)).toBe(true)
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it('ne lève jamais : renvoie false et journalise sans le message brut', async () => {
    executeRaw.mockRejectedValueOnce(
      Object.assign(new Error('postgres://u:secret@10.0.0.5/db'), { code: 'P1001', name: 'PrismaClientInitializationError' }),
    )
    await expect(enregistrerBattement('i-1', meta, { dureeMs: 10, jeux: 1, erreurs: 0 })).resolves.toBe(false)
    expect(avertissement).toHaveBeenCalledTimes(1)
    const [message, champs] = avertissement.mock.calls[0]
    expect(message).toBe('Battement du worker : écriture impossible')
    expect(champs).toMatchObject({ code: 'battement_impossible', codeErreur: 'P1001' })
    const serialise = JSON.stringify(avertissement.mock.calls)
    expect(serialise).not.toContain('secret')
    expect(serialise).not.toContain('10.0.0.5')
  })
})

describe('lireEtatWorker', () => {
  const base = {
    hote: 'serveur1', version: '0.2.0', demarre_a: new Date('2026-11-15T08:00:00Z'),
    dernier_signe_a: new Date('2026-11-15T09:00:00Z'), intervalle_ms: 15_000,
    dernier_tour_a: null, dernier_tour_duree_ms: null, dernier_tour_jeux: null, dernier_tour_erreurs: null,
  }

  it('jamais_vu quand la table est vide', async () => {
    queryRaw.mockResolvedValueOnce([])
    expect(await lireEtatWorker()).toEqual({ statut: 'jamais_vu', silenceMs: null, instance: null })
  })
  it('marche, en_retard et arrete selon le silence calculé par la base', async () => {
    queryRaw.mockResolvedValueOnce([{ ...base, silence_ms: 5000 }])
    expect((await lireEtatWorker()).statut).toBe('marche')
    queryRaw.mockResolvedValueOnce([{ ...base, silence_ms: '60000' }])
    expect((await lireEtatWorker()).statut).toBe('en_retard')
    queryRaw.mockResolvedValueOnce([{ ...base, silence_ms: 720_000 }])
    const etat = await lireEtatWorker()
    expect(etat.statut).toBe('arrete')
    expect(etat.silenceMs).toBe(720_000)
    expect(etat.instance).toMatchObject({ hote: 'serveur1', version: '0.2.0', dernierTour: null })
  })
  it('expose le dernier tour quand il existe', async () => {
    const a = new Date('2026-11-15T09:00:00Z')
    queryRaw.mockResolvedValueOnce([{
      ...base, silence_ms: 1000, dernier_tour_a: a, dernier_tour_duree_ms: 420, dernier_tour_jeux: 3, dernier_tour_erreurs: 1,
    }])
    expect((await lireEtatWorker()).instance?.dernierTour).toEqual({ a, dureeMs: 420, jeux: 3, erreurs: 1 })
  })
  it('laisse les erreurs SQL se propager', async () => {
    queryRaw.mockRejectedValueOnce(new Error('relation absente'))
    await expect(lireEtatWorker()).rejects.toThrow('relation absente')
  })
})

describe('lireExecutionsEnEchec', () => {
  it('ne renvoie que le code technique', async () => {
    const verifie_a = new Date('2026-11-15T09:00:00Z')
    queryRaw.mockResolvedValueOnce([{ jeu: 'ventes', code: 'source', verifie_a, duree_ms: 80 }])
    expect(await lireExecutionsEnEchec()).toEqual([{ jeu: 'ventes', code: 'source', verifieA: verifie_a, dureeMs: 80 }])
  })
})

describe('nettoyage des instances muettes', () => {
  it('ne lève pas sur erreur et renvoie 0', async () => {
    executeRaw.mockRejectedValueOnce(new Error('panne'))
    await expect(nettoyerInstancesMuettes()).resolves.toBe(0)
    expect(avertissement).toHaveBeenCalledTimes(1)
  })
  it('renvoie le nombre de lignes supprimées', async () => {
    executeRaw.mockResolvedValueOnce(2)
    expect(await nettoyerInstancesMuettes()).toBe(2)
  })
  it('garde horaire : au plus un nettoyage par heure', async () => {
    executeRaw.mockResolvedValue(0)
    const t0 = 50_000_000_000
    expect(await nettoyerInstancesMuettesSiEchu(t0)).toBe(0)
    expect(await nettoyerInstancesMuettesSiEchu(t0 + 1000)).toBeNull()
    expect(await nettoyerInstancesMuettesSiEchu(t0 + 3_599_999)).toBeNull()
    expect(executeRaw).toHaveBeenCalledTimes(1)
    expect(await nettoyerInstancesMuettesSiEchu(t0 + 3_600_000)).toBe(0)
    expect(executeRaw).toHaveBeenCalledTimes(2)
  })
})

describe('avecBattementPeriodique', () => {
  afterEach(() => vi.useRealTimers())

  it('émet des battements pendant un traitement long puis arrête le minuteur', async () => {
    vi.useFakeTimers()
    const battre = vi.fn().mockResolvedValue(true)
    const promesse = avecBattementPeriodique(battre, 15_000, async () => {
      await new Promise(resolve => setTimeout(resolve, 50_000))
      return 'fini'
    })
    await vi.advanceTimersByTimeAsync(50_000)
    expect(await promesse).toBe('fini')
    expect(battre).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(battre).toHaveBeenCalledTimes(3)
  })

  it('arrête le minuteur même si le traitement lève', async () => {
    vi.useFakeTimers()
    const battre = vi.fn().mockResolvedValue(true)
    const promesse = avecBattementPeriodique(battre, 15_000, async () => {
      await new Promise(resolve => setTimeout(resolve, 20_000))
      throw new Error('panne')
    })
    const attendu = expect(promesse).rejects.toThrow('panne')
    await vi.advanceTimersByTimeAsync(20_000)
    await attendu
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un battement qui rejette ou lève n’interrompt rien', async () => {
    vi.useFakeTimers()
    const battre = vi.fn()
      .mockRejectedValueOnce(new Error('rejet'))
      .mockImplementationOnce(() => { throw new Error('levée synchrone') })
      .mockResolvedValue(true)
    const promesse = avecBattementPeriodique(battre, 10_000, async () => {
      await new Promise(resolve => setTimeout(resolve, 35_000))
      return 'ok'
    })
    await vi.advanceTimersByTimeAsync(35_000)
    expect(await promesse).toBe('ok')
    expect(battre).toHaveBeenCalledTimes(3)
  })
})
