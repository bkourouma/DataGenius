import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { enregistrerAudit } from '@/lib/audit/enregistrer'
import { lireAuditPourExport, listerAudit } from '@/lib/audit/lecture'
import { purgerAudit } from '@/lib/audit/purge'
import { EXPORT_MAX_LIGNES, TAILLE_PAGE_AUDIT } from '@/lib/audit/types'

describe.skipIf(process.env.DATAGENIUS_TEST_POSTGRES !== '1')('Journal d\'audit (PostgreSQL)', () => {
  const sel = `audit${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const acteurs: string[] = []
  const acteur = (nom: string) => {
    const id = `${sel}-${nom}`
    acteurs.push(id)
    return id
  }
  const emailCompte = `${sel}@example.test`
  let compteId = ''

  beforeAll(async () => {
    const compte = await prisma.user.create({ data: {
      email: emailCompte, firstName: `Prenom${sel}`, lastName: 'Fictif', passwordHash: '!',
    } })
    compteId = compte.id
    acteurs.push(compteId)
  })

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM warehouse.journal_audit WHERE acteur_id = ANY(${acteurs}::text[])`
    await prisma.$executeRaw`DELETE FROM warehouse.audit_acces WHERE acteur_id = ANY(${acteurs}::text[])`
    await prisma.user.deleteMany({ where: { id: compteId } })
    await prisma.$disconnect()
  })

  const inserer = (acteurId: string, action: string, faitA: string, cibleId: string | null = null, libelle: string | null = null) =>
    prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, cible_type, cible_id, cible_libelle, resultat, fait_a)
      VALUES (${acteurId}, ${action}, 'source', ${cibleId}, ${libelle}, 'succes', ${faitA}::timestamptz)`

  it('écrit via enregistrerAudit puis relit la ligne avec ses valeurs bornées', async () => {
    const id = acteur('ecriture')
    await enregistrerAudit({
      acteurId: id, action: 'source.creation', cible: { type: 'source', id: 'src-1', libelle: 'x'.repeat(300) },
      details: { nombre: 3, mot_de_passe: 'interdit', note: 'a@b.co' }, ip: '203.0.113.7',
    })
    const page = await listerAudit({ acteur: id }, 1)
    expect(page.total).toBe(1)
    const [ligne] = page.lignes
    expect(ligne).toMatchObject({
      acteurId: id, action: 'source.creation', cibleType: 'source', cibleId: 'src-1', resultat: 'succes', ip: '203.0.113.7',
      details: { nombre: 3, note: '[masqué]' },
    })
    expect(ligne.id.startsWith('j')).toBe(true)
    expect(ligne.cibleLibelle).toHaveLength(200)
    expect(ligne.faitA).toBeInstanceOf(Date)
  })

  it('une écriture avec une action invalide ne lève pas (CHECK de la base) et n\'écrit rien', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const id = acteur('invalide')
    await expect(enregistrerAudit({ acteurId: id, action: 'Action Invalide' as never })).resolves.toBeUndefined()
    expect((await listerAudit({ acteur: id }, 1)).total).toBe(0)
  })

  it('filtre par période (jusqua inclusif sur toute la journée)', async () => {
    const id = acteur('periode')
    await inserer(id, 'source.creation', '2026-03-09T23:59:59Z')
    await inserer(id, 'source.creation', '2026-03-10T15:00:00Z')
    await inserer(id, 'source.creation', '2026-03-11T00:00:01Z')
    const jour = new Date('2026-03-10T00:00:00Z')
    const dansLeJour = await listerAudit({ acteur: id, depuis: jour, jusqua: jour }, 1)
    expect(dansLeJour.lignes.map(l => l.faitA.toISOString())).toEqual(['2026-03-10T15:00:00.000Z'])
    const instant = await listerAudit({ acteur: id, jusqua: new Date('2026-03-10T15:00:00Z') }, 1)
    expect(instant.total).toBe(2)
    expect((await listerAudit({ acteur: id, depuis: new Date('2026-03-10T15:00:01Z') }, 1)).total).toBe(1)
  })

  it('filtre par acteur : identifiant exact, fragment d\'e-mail, prénom ; nom d\'acteur lu en base', async () => {
    await enregistrerAudit({ acteurId: compteId, action: 'journal.export', ip: null })
    const parId = await listerAudit({ acteur: compteId }, 1)
    expect(parId.total).toBe(1)
    expect(parId.lignes[0].acteurNom).toBe(`Prenom${sel} Fictif`)
    expect((await listerAudit({ acteur: sel.toUpperCase() }, 1)).lignes.some(l => l.acteurId === compteId)).toBe(true)
    expect((await listerAudit({ acteur: `Prenom${sel}` }, 1)).lignes.some(l => l.acteurId === compteId)).toBe(true)
    // Les jokers LIKE sont échappés : « % » ne correspond pas à tout.
    expect((await listerAudit({ acteur: `${sel}%zzz` }, 1)).total).toBe(0)
  })

  it('filtre par famille, action et cible (identifiant exact ou fragment de libellé)', async () => {
    const id = acteur('filtres')
    await inserer(id, 'source.creation', '2026-04-01T10:00:00Z', 'cible-A', 'Ventes 2026')
    await inserer(id, 'source.suppression', '2026-04-01T11:00:00Z', 'cible-B', 'Stock_100%')
    await inserer(id, 'partage.creation', '2026-04-01T12:00:00Z', 'cible-C', null)
    expect((await listerAudit({ acteur: id, famille: 'source' }, 1)).total).toBe(2)
    expect((await listerAudit({ acteur: id, famille: 'partage' }, 1)).total).toBe(1)
    const parAction = await listerAudit({ acteur: id, action: 'source.suppression' }, 1)
    expect(parAction.lignes.map(l => l.cibleId)).toEqual(['cible-B'])
    expect((await listerAudit({ acteur: id, cible: 'cible-C' }, 1)).total).toBe(1)
    expect((await listerAudit({ acteur: id, cible: 'ventes' }, 1)).total).toBe(1)
    expect((await listerAudit({ acteur: id, cible: '_100%' }, 1)).total).toBe(1)
    expect((await listerAudit({ acteur: id, cible: '%' }, 1)).total).toBe(1)
    expect((await listerAudit({ acteur: id, cible: 'Ventes_2026' }, 1)).total).toBe(0)
  })

  it('reprend warehouse.audit_acces comme droits.modification', async () => {
    const id = acteur('droits')
    await prisma.$executeRaw`
      INSERT INTO warehouse.audit_acces (acteur_id, action, objet) VALUES (${id}, 'Règle ajoutée', 'jeu_ventes')`
    await prisma.$executeRaw`
      INSERT INTO warehouse.audit_acces (acteur_id, action, objet, fait_a)
      VALUES (${id}, 'Trop ancienne', 'jeu_ancien', now() - interval '400 days')`
    const page = await listerAudit({ acteur: id }, 1)
    expect(page.total).toBe(1)
    expect(page.lignes[0]).toMatchObject({
      action: 'droits.modification', cibleType: 'droits', cibleId: 'jeu_ventes', cibleLibelle: null,
      resultat: 'succes', ip: null, details: { operation: 'Règle ajoutée' },
    })
    expect(page.lignes[0].id.startsWith('a')).toBe(true)
    expect((await listerAudit({ acteur: id, famille: 'droits' }, 1)).total).toBe(1)
    expect((await listerAudit({ acteur: id, action: 'droits.modification' }, 1)).total).toBe(1)
  })

  it('pagination : total, pages, page ramenée à [1, pages], tri récent d\'abord', async () => {
    const id = acteur('pagination')
    const n = TAILLE_PAGE_AUDIT * 2 + 7
    await prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, resultat, fait_a)
      SELECT ${id}, 'source.modification', 'succes', now() - (g || ' minutes')::interval
      FROM generate_series(1, ${n}::int) AS g`
    const p1 = await listerAudit({ acteur: id }, 1)
    expect(p1).toMatchObject({ total: n, pages: 3, page: 1 })
    expect(p1.lignes).toHaveLength(TAILLE_PAGE_AUDIT)
    const p3 = await listerAudit({ acteur: id }, 3)
    expect(p3.lignes).toHaveLength(7)
    expect(p1.lignes[0].faitA.getTime()).toBeGreaterThan(p3.lignes[0].faitA.getTime())
    expect((await listerAudit({ acteur: id }, 99)).page).toBe(3)
    expect((await listerAudit({ acteur: id }, 0)).page).toBe(1)
    const vide = await listerAudit({ acteur: `${sel}-inexistant-xyz` }, 5)
    expect(vide).toMatchObject({ lignes: [], total: 0, page: 1, pages: 1 })
  })

  it('lireAuditPourExport tronque à EXPORT_MAX_LIGNES', async () => {
    const id = acteur('export')
    const n = EXPORT_MAX_LIGNES + 100
    await prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, resultat)
      SELECT ${id}, 'export.artefact', 'succes' FROM generate_series(1, ${n}::int)`
    const complet = await lireAuditPourExport({ acteur: id })
    expect(complet.lignes).toHaveLength(EXPORT_MAX_LIGNES)
    expect(complet.tronque).toBe(true)
    const exact = await lireAuditPourExport({ acteur: id, action: 'source.creation' })
    expect(exact).toEqual({ lignes: [], tronque: false })
  })

  it('purgerAudit supprime une ligne de 400 jours et garde celle de 10 jours', async () => {
    const id = acteur('purge')
    await prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, resultat, fait_a)
      VALUES (${id}, 'source.creation', 'succes', now() - interval '400 days'),
             (${id}, 'source.creation', 'succes', now() - interval '10 days')`
    const supprimees = await purgerAudit()
    expect(supprimees).toBeGreaterThanOrEqual(1)
    const lignes = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM warehouse.journal_audit WHERE acteur_id = ${id}`
    expect(lignes[0].n).toBe(1)
  })

  it('le trigger refuse un UPDATE mais autorise le DELETE', async () => {
    const id = acteur('trigger')
    await inserer(id, 'source.creation', '2026-05-01T10:00:00Z')
    await expect(prisma.$executeRaw`
      UPDATE warehouse.journal_audit SET action = 'source.suppression' WHERE acteur_id = ${id}`).rejects.toThrow()
    const [ligne] = (await listerAudit({ acteur: id }, 1)).lignes
    expect(ligne.action).toBe('source.creation')
    expect(await prisma.$executeRaw`DELETE FROM warehouse.journal_audit WHERE acteur_id = ${id}`).toBe(1)
  })

  it('les contraintes de la table refusent un résultat ou des détails invalides', async () => {
    const id = acteur('contraintes')
    await expect(prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, resultat) VALUES (${id}, 'source.creation', 'inconnu')`).rejects.toThrow()
    await expect(prisma.$executeRaw`
      INSERT INTO warehouse.journal_audit (acteur_id, action, resultat, details)
      VALUES (${id}, 'source.creation', 'succes', '[]'::jsonb)`).rejects.toThrow()
  })
})
