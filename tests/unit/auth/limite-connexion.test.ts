import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleEmail, cleIp, extraireIp, FENETRE_MINUTES, reinitialiser, reserverTentative, sautsProxyDeConfiance,
  SEUIL_EMAIL, SEUIL_IP, type EtatTentative, type MagasinTentatives,
} from '@/lib/auth/limite-connexion'

vi.mock('@/lib/db/client', () => ({ prisma: {} }))

const DUREE = FENETRE_MINUTES * 60_000
type Ligne = { echecs: number, debut: number, bloque: number | null }

function fauxMagasin() {
  const lignes = new Map<string, Ligne>()
  const magasin: MagasinTentatives & { purges: number } = {
    purges: 0,
    async enregistrer(cle, seuil): Promise<EtatTentative> {
      const now = Date.now()
      const l = lignes.get(cle)
      let nouvelle: Ligne
      if (l?.bloque != null && l.bloque > now) nouvelle = l
      else if (!l || l.debut + DUREE <= now) nouvelle = { echecs: 1, debut: now, bloque: null }
      else nouvelle = { echecs: l.echecs + 1, debut: l.debut, bloque: l.echecs + 1 > seuil ? now + DUREE : null }
      lignes.set(cle, nouvelle)
      return { echecs: nouvelle.echecs, bloqueJusqua: nouvelle.bloque === null ? null : new Date(nouvelle.bloque) }
    },
    async liberer(cle) {
      const l = lignes.get(cle)
      if (l && (l.bloque ?? 0) <= Date.now()) l.echecs = Math.max(0, l.echecs - 1)
    },
    async supprimer(cle) { lignes.delete(cle) },
    async purger() {
      magasin.purges++
      const now = Date.now()
      for (const [cle, l] of lignes) if (l.debut + DUREE <= now && (l.bloque ?? 0) <= now) lignes.delete(cle)
    },
  }
  return { lignes, magasin }
}

const essais = async (cible: { email?: string, ip?: string }, m: MagasinTentatives, n: number) => {
  const resultats: boolean[] = []
  for (let i = 0; i < n; i++) resultats.push(await reserverTentative(cible, m))
  return resultats
}

describe('limitation des tentatives', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.DATAGENIUS_PROXY_DE_CONFIANCE })

  it('autorise 5 tentatives par e-mail puis bloque la suivante', async () => {
    const { magasin: m } = fauxMagasin()
    expect(await essais({ email: 'A@x.fr' }, m, SEUIL_EMAIL + 2)).toEqual([true, true, true, true, true, false, false])
    expect(await reserverTentative({ email: 'autre@x.fr' }, m)).toBe(true)
  })

  it('bloque une IP après 30 tentatives, même avec des e-mails différents', async () => {
    const { magasin: m } = fauxMagasin()
    for (let i = 0; i < SEUIL_IP; i++) expect(await reserverTentative({ email: `u${i}@x.fr`, ip: '10.0.0.1' }, m)).toBe(true)
    expect(await reserverTentative({ email: 'neuf@x.fr', ip: '10.0.0.1' }, m)).toBe(false)
    expect(await reserverTentative({ email: 'neuf@x.fr', ip: '10.0.0.2' }, m)).toBe(true)
  })

  it('débloque 15 minutes après le blocage', async () => {
    const { magasin: m } = fauxMagasin()
    await essais({ email: 'a@x.fr' }, m, SEUIL_EMAIL + 1)
    vi.advanceTimersByTime(DUREE - 1000)
    expect(await reserverTentative({ email: 'a@x.fr' }, m)).toBe(false)
    vi.advanceTimersByTime(DUREE)
    expect(await reserverTentative({ email: 'a@x.fr' }, m)).toBe(true)
  })

  it('redémarre à un échec quand la fenêtre est expirée', async () => {
    const { magasin: m, lignes } = fauxMagasin()
    await essais({ email: 'a@x.fr' }, m, 4)
    vi.advanceTimersByTime(DUREE + 1)
    await reserverTentative({ email: 'a@x.fr' }, m)
    expect(lignes.get(cleEmail('a@x.fr'))?.echecs).toBe(1)
  })

  it('réinitialise le compteur e-mail sur succès et rend la tentative IP', async () => {
    const { magasin: m, lignes } = fauxMagasin()
    await essais({ email: 'a@x.fr', ip: '10.0.0.1' }, m, 4)
    await reinitialiser({ email: 'a@x.fr', ip: '10.0.0.1' }, m)
    expect(lignes.has(cleEmail('a@x.fr'))).toBe(false)
    expect(lignes.get(cleIp('10.0.0.1'))?.echecs).toBe(3)
  })

  it('20 requêtes simultanées pour un même e-mail : au plus 5 autorisées', async () => {
    const { magasin: m } = fauxMagasin()
    const resultats = await Promise.all(Array.from({ length: 20 }, () => reserverTentative({ email: 'a@x.fr' }, m)))
    expect(resultats.filter(Boolean)).toHaveLength(SEUIL_EMAIL)
  })

  it('purge au plus une fois toutes les 10 minutes les lignes expirées sans blocage actif', async () => {
    const { magasin: m, lignes } = fauxMagasin()
    await reserverTentative({ email: 'vieux@x.fr' }, m)
    expect(m.purges).toBe(1)
    await reserverTentative({ email: 'b@x.fr' }, m)
    expect(m.purges).toBe(1)
    vi.advanceTimersByTime(DUREE + 1)
    await reserverTentative({ email: 'c@x.fr' }, m)
    expect(m.purges).toBe(2)
    expect(lignes.has(cleEmail('vieux@x.fr'))).toBe(false)
    expect(lignes.has(cleEmail('c@x.fr'))).toBe(true)
  })

  it('une purge en échec n’empêche pas la réservation', async () => {
    const { magasin: m } = fauxMagasin()
    m.purger = () => Promise.reject(new Error('base'))
    expect(await reserverTentative({ email: 'a@x.fr' }, m)).toBe(true)
  })

  it('ne stocke et ne journalise aucun e-mail en clair', async () => {
    const { magasin: m, lignes } = fauxMagasin()
    await essais({ email: 'secret@x.fr', ip: '10.0.0.9' }, m, SEUIL_EMAIL + 1)
    expect([...lignes.keys()].join()).not.toContain('secret')
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret')
  })

  it('laisse passer (échec ouvert) si le stockage est indisponible', async () => {
    const { magasin } = fauxMagasin()
    const m: MagasinTentatives = {
      ...magasin,
      enregistrer: () => Promise.reject(new Error('base')),
      supprimer: () => Promise.reject(new Error('base')),
    }
    expect(await reserverTentative({ email: 'a@x.fr' }, m)).toBe(true)
    await expect(reinitialiser({ email: 'a@x.fr' }, m)).resolves.toBeUndefined()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain('limiteur_indisponible')
  })

  it('sans proxy de confiance, les en-têtes d’IP sont ignorés', () => {
    const forge = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' }
    expect(extraireIp(forge, 0)).toBeUndefined()
    expect(sautsProxyDeConfiance()).toBe(0)
    process.env.DATAGENIUS_PROXY_DE_CONFIANCE = 'abc'
    expect(sautsProxyDeConfiance()).toBe(0)
    process.env.DATAGENIUS_PROXY_DE_CONFIANCE = '2'
    expect(sautsProxyDeConfiance()).toBe(2)
  })

  it('prend le N-ième élément de x-forwarded-for en partant de la droite', () => {
    const xff = { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 5.6.7.8' }
    expect(extraireIp(xff, 1)).toBe('5.6.7.8')
    expect(extraireIp(xff, 2)).toBe('1.2.3.4')
    expect(extraireIp(xff, 4)).toBeUndefined()
    expect(extraireIp(new Headers({ 'x-forwarded-for': '9.9.9.9' }), 1)).toBe('9.9.9.9')
    expect(extraireIp({ 'x-forwarded-for': '<script>' }, 1)).toBeUndefined()
    expect(extraireIp({ 'x-forwarded-for': '1'.repeat(80) }, 1)).toBeUndefined()
  })

  it('x-real-ip n’est lu qu’avec un proxy de confiance et sans x-forwarded-for', () => {
    expect(extraireIp({ 'x-real-ip': '::1' }, 1)).toBe('::1')
    expect(extraireIp({ 'x-real-ip': '::1' }, 0)).toBeUndefined()
    expect(extraireIp({}, 1)).toBeUndefined()
    expect(extraireIp(undefined, 1)).toBeUndefined()
  })
})
