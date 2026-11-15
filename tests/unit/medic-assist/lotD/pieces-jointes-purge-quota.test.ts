/**
 * Lot D : purge des pieces jointes et quota par utilisateur. Depot en memoire, dossier
 * temporaire (UPLOAD_DIR) ; aucune base.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ prisma: {}, default: {} }))

import type { ContexteExecution } from '@/lib/medic-assist/contrats'
import type {
  DepotPiecesJointes,
  LignePieceJointe,
} from '@/lib/medic-assist/pieces-jointes/depot-prisma'
import { purgerPiecesJointes } from '@/lib/medic-assist/pieces-jointes/purge'
import {
  enregistrerPieceJointe,
  QUOTA_FICHIERS,
  QUOTA_OCTETS,
} from '@/lib/medic-assist/pieces-jointes/service'
import { dossierPiecesJointes } from '@/lib/medic-assist/pieces-jointes/stockage'

const H = 3_600_000
const MAINTENANT = new Date('2026-11-13T12:00:00Z')

function depotMemoire(lignes: LignePieceJointe[] = []) {
  const base = [...lignes]
  const depot: DepotPiecesJointes = {
    async creer(d) {
      const { resume, ...reste } = d
      const l: LignePieceJointe = { ...reste, id: `id${base.length}`, resume, createdAt: new Date() }
      base.push(l)
      return l
    },
    async lireDuProprietaire(id, userId) {
      return base.find(l => l.id === id && l.userId === userId) ?? null
    },
    async supprimerDuProprietaire() {
      return 0
    },
    async conversationDuProprietaire() {
      return true
    },
    async usageDeLUtilisateur(userId) {
      const m = base.filter(l => l.userId === userId)
      return { nombre: m.length, octets: m.reduce((s, l) => s + l.taille, 0) }
    },
    async listerNonRattacheesAvant(date, limite) {
      return base
        .filter(l => l.conversationId === null && l.createdAt < date)
        .slice(0, limite)
        .map(l => ({ id: l.id, chemin: l.chemin }))
    },
    async cheminsExistants(noms) {
      return new Set(base.filter(l => noms.includes(l.chemin)).map(l => l.chemin))
    },
    async supprimerNonRattacheesParIds(ids) {
      const supprimees: string[] = []
      for (const id of ids) {
        const i = base.findIndex(l => l.id === id && l.conversationId === null)
        if (i >= 0) {
          base.splice(i, 1)
          supprimees.push(id)
        }
      }
      return supprimees
    },
  }
  return { depot, base }
}

function ligne(
  id: string,
  chemin: string,
  ageH: number,
  conversationId: string | null,
  taille = 10
): LignePieceJointe {
  return {
    id,
    userId: 'u1',
    conversationId,
    nomFichier: 'x.csv',
    typeMime: 'text/csv',
    taille,
    chemin,
    resume: null,
    createdAt: new Date(MAINTENANT.getTime() - ageH * H),
  }
}

function poserFichier(nom: string, ageH: number): string {
  const chemin = join(dossierPiecesJointes(), nom)
  writeFileSync(chemin, 'a,b\n1,2\n')
  const t = new Date(MAINTENANT.getTime() - ageH * H)
  utimesSync(chemin, t, t)
  return chemin
}

let racine: string
let ancienEnv: string | undefined

beforeEach(() => {
  ancienEnv = process.env.UPLOAD_DIR
  racine = mkdtempSync(join(tmpdir(), 'dg-pj-'))
  process.env.UPLOAD_DIR = racine
  mkdirSync(dossierPiecesJointes(), { recursive: true })
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ancienEnv === undefined) delete process.env.UPLOAD_DIR
  else process.env.UPLOAD_DIR = ancienEnv
  rmSync(racine, { recursive: true, force: true })
})

describe('purgerPiecesJointes', () => {
  it('supprime ligne et fichier d une piece non rattachee de 25 h', async () => {
    const c = poserFichier('1_aaaaaaaa_a.csv', 25)
    const { depot, base } = depotMemoire([ligne('a', '1_aaaaaaaa_a.csv', 25, null)])
    const r = await purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    expect(r).toEqual({ lignesSupprimees: 1, fichiersSupprimes: 1 })
    expect(base).toHaveLength(0)
    expect(existsSync(c)).toBe(false)
  })

  it('une piece rattachee entre la lecture et la suppression garde sa ligne et son fichier', async () => {
    const rattachee = poserFichier('9_iiiiiiii_i.csv', 30)
    const libre = poserFichier('9_jjjjjjjj_j.csv', 30)
    const { depot, base } = depotMemoire([
      ligne('i', '9_iiiiiiii_i.csv', 30, null),
      ligne('j', '9_jjjjjjjj_j.csv', 30, null),
    ])
    const lire = depot.listerNonRattacheesAvant
    // La conversation s'attache a la piece « i » juste apres la lecture du lot.
    depot.listerNonRattacheesAvant = async (date, limite) => {
      const lot = await lire(date, limite)
      const i = base.find(l => l.id === 'i')
      if (i) i.conversationId = 'conv1'
      return lot
    }
    const r = await purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    expect(r).toEqual({ lignesSupprimees: 1, fichiersSupprimes: 1 })
    expect(base.map(l => l.id)).toEqual(['i'])
    expect(existsSync(rattachee)).toBe(true)
    expect(existsSync(libre)).toBe(false)
  })

  it('conserve une non rattachee de 2 h et une rattachee de 30 h', async () => {
    const c1 = poserFichier('2_bbbbbbbb_b.csv', 2)
    const c2 = poserFichier('3_cccccccc_c.csv', 30)
    const { depot, base } = depotMemoire([
      ligne('b', '2_bbbbbbbb_b.csv', 2, null),
      ligne('c', '3_cccccccc_c.csv', 30, 'conv1'),
    ])
    const r = await purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    expect(r).toEqual({ lignesSupprimees: 0, fichiersSupprimes: 0 })
    expect(base).toHaveLength(2)
    expect(existsSync(c1) && existsSync(c2)).toBe(true)
  })

  it('supprime un fichier orphelin de plus d 1 h, garde un orphelin recent', async () => {
    const vieux = poserFichier('4_dddddddd_d.csv', 2)
    const recent = poserFichier('5_eeeeeeee_e.csv', 0.5)
    const { depot } = depotMemoire()
    const r = await purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    expect(r).toEqual({ lignesSupprimees: 0, fichiersSupprimes: 1 })
    expect(existsSync(vieux)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it('ne touche pas un fichier avec ligne, un nom hors format ni un sous-dossier', async () => {
    const lie = poserFichier('6_ffffffff_f.csv', 48)
    const hors = join(dossierPiecesJointes(), '.cache cache')
    writeFileSync(hors, 'x')
    const t = new Date(MAINTENANT.getTime() - 48 * H)
    utimesSync(hors, t, t)
    mkdirSync(join(dossierPiecesJointes(), 'sous'))
    const { depot } = depotMemoire([ligne('f', '6_ffffffff_f.csv', 48, 'conv1')])
    const r = await purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    expect(r.fichiersSupprimes).toBe(0)
    expect(existsSync(lie)).toBe(true)
    expect(existsSync(hors)).toBe(true)
  })

  it('une erreur de suppression n arrete pas la purge et ne journalise ni nom ni chemin', async () => {
    poserFichier('7_gggggggg_g.csv', 30)
    poserFichier('8_hhhhhhhh_h.csv', 30)
    const { depot } = depotMemoire()
    let appels = 0
    const supprimerFichier = vi.fn(async (chemin: string) => {
      appels++
      if (appels === 1) throw Object.assign(new Error('boom ' + chemin), { code: 'EPERM' })
    })
    const r = await purgerPiecesJointes({
      maintenant: MAINTENANT,
      deps: { depot, supprimerFichier },
    })
    expect(supprimerFichier).toHaveBeenCalledTimes(2)
    expect(r.fichiersSupprimes).toBe(1)
    const journal = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(journal).toContain('EPERM')
    expect(journal).not.toContain('gggggggg')
    expect(journal).not.toContain('.csv')
  })

  it('dossier absent : rien a faire, sans erreur', async () => {
    rmSync(dossierPiecesJointes(), { recursive: true, force: true })
    const { depot } = depotMemoire()
    await expect(
      purgerPiecesJointes({ maintenant: MAINTENANT, deps: { depot } })
    ).resolves.toEqual({ lignesSupprimees: 0, fichiersSupprimes: 0 })
  })
})

describe('quota par utilisateur', () => {
  const ctx = (userId: string) => ({ userId }) as unknown as ContexteExecution
  const fichier = { nom: 'petit.csv', octets: Buffer.from('a,b\n1,2\n') }

  it('constantes', () => {
    expect(QUOTA_OCTETS).toBe(200 * 1024 * 1024)
    expect(QUOTA_FICHIERS).toBe(100)
  })

  it('accepte le 100e fichier, refuse le 101e sans ecrire sur disque', async () => {
    const existantes = Array.from({ length: 99 }, (_, i) => ligne(`l${i}`, `${i}_x.csv`, 1, 'c'))
    const { depot } = depotMemoire(existantes)
    await expect(enregistrerPieceJointe(ctx('u1'), fichier, {}, { depot })).resolves.toBeTruthy()
    const avant = readdirSync(dossierPiecesJointes()).length
    await expect(enregistrerPieceJointe(ctx('u1'), fichier, {}, { depot })).rejects.toMatchObject({
      code: 'quota_pieces_jointes',
      statut: 413,
    })
    expect(readdirSync(dossierPiecesJointes()).length).toBe(avant)
  })

  it('refuse au-dela de 200 Mo cumules, accepte pile a la limite', async () => {
    const taille = fichier.octets.byteLength
    const pile = depotMemoire([ligne('a', 'a.csv', 1, 'c', QUOTA_OCTETS - taille)])
    await expect(
      enregistrerPieceJointe(ctx('u1'), fichier, {}, { depot: pile.depot })
    ).resolves.toBeTruthy()
    const trop = depotMemoire([ligne('a', 'a.csv', 1, 'c', QUOTA_OCTETS - taille + 1)])
    await expect(
      enregistrerPieceJointe(ctx('u1'), fichier, {}, { depot: trop.depot })
    ).rejects.toMatchObject({ code: 'quota_pieces_jointes' })
  })

  it('un autre utilisateur n est pas affecte', async () => {
    const { depot } = depotMemoire(
      Array.from({ length: 100 }, (_, i) => ligne(`l${i}`, `${i}_x.csv`, 1, 'c'))
    )
    await expect(enregistrerPieceJointe(ctx('u1'), fichier, {}, { depot })).rejects.toMatchObject({
      code: 'quota_pieces_jointes',
    })
    await expect(enregistrerPieceJointe(ctx('u2'), fichier, {}, { depot })).resolves.toBeTruthy()
  })
})
