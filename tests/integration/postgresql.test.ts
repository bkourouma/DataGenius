import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db/client'
import { executerChat } from '@/lib/medic-assist/agent/executer'
import { construireExport } from '@/lib/medic-assist/artefacts/exports'
import { lireArtefact, modifierArtefact } from '@/lib/medic-assist/artefacts/stockage'
import { chargerCombinaison, creerCombinaison, listerCombinaisons, modifierCombinaison, previsualiserCombinaison } from '@/lib/warehouse/combinaisons-admin'
import { interrogerDonnees, lireJeu } from '@/lib/medic-assist/donnees/outils'
import { ajouterSource, creerImport, listerColonnes, listerTables, modifierFrequence } from '@/lib/warehouse/sources-admin'
import { calculerSemantique } from '@/lib/medic-assist/donnees/moteur/calculer'
import { calculerSql } from '@/lib/medic-assist/donnees/sql/calcul'
import { transactionLecture, deconnecterPostgres } from '@/lib/warehouse/postgres'
import { etatEntrepot, synchroniserEntrepot } from '@/lib/warehouse/synchronisation'
import type { ContexteExecution } from '@/lib/medic-assist/contrats'

const { creerModele } = vi.hoisted(() => ({ creerModele: vi.fn() }))
vi.mock('@/lib/medic-assist/config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/medic-assist/config')>(),
  creerModele,
}))

const url = process.env.DATAGENIUS_SOURCE_DISTRIBUTION
const testActif = process.env.DATAGENIUS_TEST_POSTGRES === '1'
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
}

function tour(elements: Record<string, unknown>[], raison = 'tool-calls') {
  return {
    stream: convertArrayToReadableStream([
      { type: 'stream-start', warnings: [] },
      ...elements,
      { type: 'finish', finishReason: { unified: raison, raw: raison }, usage },
    ] as never[]),
  }
}

function appel(toolName: string, input: unknown) {
  return { type: 'tool-call', toolCallId: randomUUID(), toolName, input: JSON.stringify(input) }
}

describe.skipIf(!testActif)('Connecteur PostgreSQL · données fictives', () => {
  let support: PrismaClient
  const ctx: ContexteExecution = {
    userId: randomUUID(),
    roleName: 'Member',
    scope: { roleName: 'Member', voitTout: true },
    habilitations: null,
    locale: 'fr',
    maintenant: new Date('2026-11-12T12:00:00Z'),
  }

  beforeAll(async () => {
    if (new URL(url ?? '').pathname !== '/dg_source' ||
        new URL(process.env.DATABASE_URL ?? '').pathname !== '/dg_app') {
      throw new Error('Utiliser les bases fictives dg_app et dg_source.')
    }
    const urlSupport = process.env.DATAGENIUS_TEST_SUPPORT_OWNER_URL
    if (!urlSupport || new URL(urlSupport).pathname !== '/dg_support') throw new Error('Configurer la base fictive dg_support.')
    support = new PrismaClient({ datasourceUrl: urlSupport })
    await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = 'centres'`
    await expect(calculerSemantique({ jeu: 'centres', mesures: [], dimensions: ['centre'] }, ctx))
      .rejects.toThrow('première synchronisation')
    expect(await synchroniserEntrepot({ forcer: true })).toHaveLength(4)
    await prisma.user.create({
      data: { id: ctx.userId, email: ctx.userId + '@example.test', passwordHash: '', firstName: 'Démo' },
    })
  })

  afterAll(async () => {
    if (testActif && new URL(process.env.DATABASE_URL ?? '').pathname === '/dg_app') {
      await prisma.user.deleteMany({ where: { id: ctx.userId } })
      await Promise.all([prisma.$disconnect(), support?.$disconnect(), deconnecterPostgres()])
    }
  })

  it('importe des tables de deux sources et respecte la fréquence et les droits', async () => {
    const etats = await etatEntrepot()
    expect(etats.map(e => [e.cle, e.etat?.lignes])).toEqual([
      ['ventes', 8], ['stocks', 8], ['budget', 8], ['centres', 2],
    ])
    expect((await synchroniserEntrepot()).map(e => e.statut)).toEqual(Array(4).fill('pas_echu'))
    expect((await synchroniserEntrepot({ forcer: true })).map(e => e.statut)).toEqual(Array(4).fill('identique'))
    const [droits] = await transactionLecture(
      'DATAGENIUS_SOURCE_SUPPORT',
      tx => tx.$queryRaw<{ lecture: string; prive: boolean; insertion: boolean }[]>`
        SELECT current_setting('transaction_read_only') AS lecture,
          has_column_privilege('support.centres', 'information_privee', 'SELECT') AS prive,
          has_table_privilege('support.centres', 'INSERT') AS insertion
      `,
    )
    expect(droits).toEqual({ lecture: 'on', prive: false, insertion: false })
    const [interne] = await transactionLecture('DATAGENIUS_WAREHOUSE_READ_URL',
      tx => tx.$queryRaw<{ snapshots: boolean; comptes: boolean }[]>`
        SELECT has_table_privilege('warehouse.snapshots', 'SELECT') AS snapshots,
          has_table_privilege('public.users', 'SELECT') AS comptes
      `)
    expect(interne).toEqual({ snapshots: true, comptes: false })
  })

  it('réunit les sources et répercute ajout, modification et suppression après synchronisation', async () => {
    const calculer = () => calculerSemantique({
      jeu: 'ventes_par_segment', dimensions: ['segment'], mesures: ['ca_eur'], filtres: { mois: '2026-10' },
      tri: [{ cle: 'ca_eur', sens: 'desc' }],
    }, ctx)
    const initial = await calculer()
    expect(initial.lignes).toEqual([{ segment: 'Littoral', ca_eur: 1280 }, { segment: 'Intérieur', ca_eur: 600 }])
    expect(initial.provenance.regles.filter(r => r.includes("copie publiée"))).toHaveLength(2)
    try {
      await support.$executeRaw`UPDATE support.centres SET segment = 'Nord' WHERE "Nom du centre" = 'Lagune'`
      await support.$executeRaw`DELETE FROM support.centres WHERE "Nom du centre" = 'Plateau'`
      await support.$executeRaw`INSERT INTO support.centres VALUES ('Nouveau', 'Sud', 'exclue')`
      expect((await calculer()).lignes).toEqual(initial.lignes)
      await prisma.$executeRaw`UPDATE warehouse.synchronisations SET verifie_a = now() - interval '11 minutes' WHERE jeu = 'centres'`
      expect(await synchroniserEntrepot({ jeu: 'centres' })).toEqual([{ jeu: 'centres', statut: 'publie' }])
      expect((await calculer()).lignes).toEqual([{ segment: 'Nord', ca_eur: 1280 }])
      const centres = await calculerSemantique({ jeu: 'centres', dimensions: ['centre'] }, ctx)
      expect(centres.lignes).toEqual([{ centre: 'Lagune' }, { centre: 'Nouveau' }])
      await support.$executeRaw`REVOKE SELECT ("Nom du centre", segment) ON support.centres FROM dg_support_reader`
      expect(await synchroniserEntrepot({ forcer: true, jeu: 'centres' })).toEqual([{ jeu: 'centres', statut: 'echec', code: 'source' }])
      expect((await calculer()).lignes).toEqual([{ segment: 'Nord', ca_eur: 1280 }])
    } finally {
      await support.$executeRaw`GRANT SELECT ("Nom du centre", segment) ON support.centres TO dg_support_reader`
      await support.$executeRaw`UPDATE support.centres SET segment = 'Littoral' WHERE "Nom du centre" = 'Lagune'`
      await support.$executeRaw`DELETE FROM support.centres WHERE "Nom du centre" = 'Nouveau'`
      await support.$executeRaw`INSERT INTO support.centres VALUES ('Plateau', 'Intérieur', 'exclue') ON CONFLICT DO NOTHING`
      await synchroniserEntrepot({ forcer: true, jeu: 'centres' })
    }
  })

  it('calcule les chiffres attendus par les deux chemins', async () => {
    const ventes = await calculerSemantique({
      jeu: 'ventes', dimensions: ['agence'], mesures: ['ca_eur'], filtres: { mois: '2026-10' },
    }, ctx)
    expect(ventes.lignes).toEqual([{ agence: 'Lagune', ca_eur: 1280 }, { agence: 'Plateau', ca_eur: 600 }])
    expect(ventes.totaux).toEqual({ ca_eur: 1880 })

    const budget = await calculerSemantique({
      jeu: 'budget', mesures: ['objectif_eur'], filtres: { mois: '2026-10' },
    }, ctx)
    expect(budget.lignes).toEqual([{ objectif_eur: 1870 }])

    const stocks = await calculerSemantique({
      jeu: 'stocks', mesures: ['stock_unites'], filtres: { mois: '2026-10' },
    }, ctx)
    expect(stocks.lignes).toEqual([{ stock_unites: 93 }])
    await expect(calculerSemantique({ jeu: 'stocks', mesures: ['stock_unites'] }, ctx))
      .rejects.toMatchObject({ code: 'periode_invalide' })

    const sql = await calculerSql({
      objectif: 'Total octobre', sql: "SELECT SUM(ca) AS total FROM mv_ventes WHERE mois = '2026-10'",
    }, ctx)
    expect(sql.lignes).toEqual([{ total: 1880 }])
  })

  it('exécute un tour de chat, crée et versionne un artefact et exporte les données', async () => {
    let etape = 0
    const modele = new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        etape++
        if (etape === 1) return tour([appel('interroger_donnees', {
          jeu: 'ventes', mesures: ['ca_eur'], dimensions: ['agence'], filtres: { autres: { mois: '2026-10' } },
        })])
        if (etape === 2) {
          const sortie = prompt.flatMap(message => message.role === 'tool' ? message.content : [])
            .find(part => part.type === 'tool-result' && part.toolName === 'interroger_donnees')
          if (!sortie || sortie.output.type !== 'json') throw new Error('Résultat du connecteur absent')
          const resultat = sortie.output.value as { jeuDeDonneesId: string; totaux?: Record<string, number> }
          expect(resultat.totaux?.ca_eur).toBe(1880)
          return tour([appel('creer_artefact', {
            spec: { type: 'tableau', titre: 'Ventes octobre', jeuDeDonneesId: resultat.jeuDeDonneesId },
          })])
        }
        return tour([
          { type: 'text-start', id: 'reponse' },
          { type: 'text-delta', id: 'reponse', delta: 'Le chiffre d’affaires total est de 1 880 EUR.' },
          { type: 'text-end', id: 'reponse' },
        ], 'stop')
      },
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'Ventes octobre' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      }),
    })
    creerModele.mockReturnValue(modele)

    const chat = await executerChat({
      contexte: ctx,
      corps: { message: { id: 'question-1', role: 'user', parts: [
        { type: 'text', text: 'Crée un tableau du chiffre d’affaires par agence en octobre.' },
      ] } },
    })
    expect(chat.type).toBe('flux')
    if (chat.type !== 'flux') throw new Error(JSON.stringify(chat))
    const flux = await chat.reponse.text()
    expect(flux).toContain('1 880 EUR')
    expect(flux).not.toContain('output-error')
    await vi.waitFor(async () => {
      expect(await prisma.assistantMessage.count({ where: { conversationId: chat.conversationId } })).toBe(2)
    })

    const artefact = await prisma.assistantArtefact.findFirstOrThrow({
      where: { conversationId: chat.conversationId },
    })
    const [jeuId] = artefact.jeuxDeDonneesIds as string[]
    await expect(lireJeu(jeuId, { ...ctx, userId: randomUUID() })).rejects.toMatchObject({ code: 'introuvable' })
    const spec = { type: 'tableau' as const, titre: 'Ventes octobre par agence', jeuDeDonneesId: jeuId }
    await expect(modifierArtefact({ ...ctx, conversationId: chat.conversationId }, { artefactId: artefact.racineId, spec }))
      .resolves.toMatchObject({ version: 2 })
    await expect(lireArtefact(ctx, artefact.racineId, { version: 1 })).resolves.toMatchObject({ version: 1 })

    const csv = await construireExport(ctx, artefact.racineId, 'csv')
    expect(csv.buffer.toString('utf8')).toMatch(/Lagune[\s\S]*1280/)
    const [xlsx, pdf, pptx] = await Promise.all(
      (['xlsx', 'pdf', 'pptx'] as const).map(format => construireExport(ctx, artefact.racineId, format)),
    )
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe('PK')
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF')
    expect(pptx.buffer.subarray(0, 2).toString()).toBe('PK')
  }, 30000)
  it('enregistre une connexion et un import administrés, découverts puis synchronisés', async () => {
    const sourceUrl = new URL(process.env.DATAGENIUS_SOURCE_SUPPORT!)
    const existant = await interrogerDonnees(ctx, { jeu: 'ventes', mesures: ['ca_eur'] })
    const sourceId = await ajouterSource({
      titre: 'Support administré', hote: sourceUrl.hostname, port: sourceUrl.port || '5432',
      base: 'dg_support', utilisateur: sourceUrl.username,
      motDePasse: decodeURIComponent(sourceUrl.password), tls: 'disable',
    })
    let cle: string | undefined
    try {
      const [stockage] = await prisma.$queryRaw<{ secret: string }[]>`
        SELECT secret FROM warehouse.sources WHERE id = ${sourceId}
      `
      expect(stockage.secret).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      expect(stockage.secret).not.toContain('dg_support_reader')
      expect((await listerTables(sourceId, 'centres')).tables).toEqual([{ schema: 'support', table: 'centres' }])
      const table = { schema: 'support', table: 'centres' }
      expect((await listerColonnes(sourceId, table)).map(c => c.nom)).toEqual(['Nom du centre', 'segment'])
      const importation = { sourceId, ...table, titre: 'Centres sélectionnés', description: '', frequenceMinutes: 15 }
      await expect(creerImport({ ...importation, colonnes: ['information_privee'] })).rejects.toThrow('accessible')
      cle = await creerImport({ ...importation, colonnes: ['Nom du centre'] })
      await modifierFrequence(cle, 7)
      expect((await etatEntrepot()).find(e => e.cle === cle)).toMatchObject({ frequence: 7, modifiable: true })
      expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
      const resultat = await calculerSql({ sql: 'SELECT * FROM mv_' + cle, objectif: 'Centres' }, ctx)
      expect(resultat.colonnes.map(c => c.cle)).toEqual(['nom_du_centre'])
      expect(resultat.lignes).toHaveLength(2)
      await expect(lireJeu(existant.jeuDeDonneesId, ctx)).resolves.toMatchObject({ total: 1 })
    } finally {
      await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE source_id = ${sourceId}`
      await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${sourceId}`
      if (cle) {
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${cle}`
      }
    }
  })
  it('enregistre et interroge une combinaison entre bases et permet de la réutiliser', async () => {
    const definitions = [
      { variable: 'DATAGENIUS_SOURCE_DISTRIBUTION', titre: 'Distribution UI', schema: 'metier', table: 'activite', colonnes: ['agence', 'mois', 'ca'] },
      { variable: 'DATAGENIUS_SOURCE_SUPPORT', titre: 'Support UI', schema: 'support', table: 'centres', colonnes: ['Nom du centre', 'segment'] },
    ]
    const sources: string[] = []
    const imports: string[] = []
    const combinaisons: string[] = []
    try {
      for (const { variable, titre, ...table } of definitions) {
        const url = new URL(process.env[variable]!)
        const sourceId = await ajouterSource({
          titre, hote: url.hostname, port: url.port || '5432', base: url.pathname.slice(1),
          utilisateur: url.username, motDePasse: decodeURIComponent(url.password), tls: 'disable',
        })
        sources.push(sourceId)
        const cle = await creerImport({ ...table, sourceId, titre, description: '', frequenceMinutes: 10 })
        imports.push(cle)
        expect(await synchroniserEntrepot({ jeu: cle })).toEqual([{ jeu: cle, statut: 'publie' }])
      }
      const [gauche, droite] = imports
      const spec = {
        titre: 'Distribution par segment', description: '', gauche, droite, type: 'interne',
        liens: [{ gauche: 'agence', droite: 'nom_du_centre' }],
        colonnes: [{ cote: 'gauche', nom: 'agence' }, { cote: 'gauche', nom: 'ca' }, { cote: 'droite', nom: 'segment' }],
      }
      await expect(creerCombinaison({ ...spec, liens: [{ gauche: 'ca', droite: 'segment' }] })).rejects.toThrow('compatibles')
      await expect(creerCombinaison({ ...spec, colonnes: [{ cote: 'droite', nom: 'information_privee' }] })).rejects.toThrow('introuvable')
      const { titre, description, ...selection } = spec
      const avant = await listerCombinaisons()
      const apercu = await previsualiserCombinaison(selection, ctx)
      expect(apercu.colonnes.map(c => c.nom)).toEqual(['agence', 'ca', 'segment'])
      expect(apercu.lignes).toHaveLength(8)
      expect(apercu.lignes).toContainEqual({ cellules: ['Lagune', '500.00', 'Littoral'], correspondance: true })
      expect(apercu.tronque).toBe(false)
      expect(apercu.diagnostic).toMatchObject({
        resultat: '8',
        gauche: { lignes: '8', correspondances: '8', clesDupliquees: '2', lignesMultipliees: '0' },
        droite: { lignes: '2', correspondances: '2', clesDupliquees: '0', lignesMultipliees: '2' },
        totaux: [{ cote: 'gauche', colonne: { nom: 'ca' }, avant: '3160.00', apres: '3160.00' }],
      })
      await expect(previsualiserCombinaison({
        ...selection, liens: [...selection.liens, { gauche: 'mois', droite: 'segment' }],
      }, ctx)).resolves.toMatchObject({ lignes: [], tronque: false })
      await expect(previsualiserCombinaison({ ...selection, liens: [{ gauche: 'ca', droite: 'segment' }] }, ctx))
        .rejects.toThrow('compatibles')
      expect(await listerCombinaisons()).toEqual(avant)
      const cle = await creerCombinaison({ ...selection, titre, description })
      combinaisons.push(cle)
      expect((await listerCombinaisons()).find(j => j.cle === cle)).toMatchObject({ disponible: true, gauche: 'Distribution UI', droite: 'Support UI' })
      const analyse = await calculerSql({ objectif: 'Total par segment', sql: 'SELECT segment, SUM(ca) AS total FROM mv_' + cle + ' GROUP BY segment ORDER BY total DESC' }, ctx)
      expect(analyse.lignes).toEqual([{ segment: 'Littoral', total: 2080 }, { segment: 'Intérieur', total: 1080 }])
      expect(analyse.provenance.regles.filter(r => r.includes("copie publiée"))).toHaveLength(2)
      const autre = await creerCombinaison({ ...spec, titre: 'Distribution bis' })
      combinaisons.push(autre)
      const grandApercu = await previsualiserCombinaison({
        gauche: cle, droite: autre, type: 'interne', liens: [{ gauche: 'segment', droite: 'segment' }],
        colonnes: [{ cote: 'gauche', nom: 'segment' }],
      }, ctx)
      expect(grandApercu.lignes).toHaveLength(20)
      expect(grandApercu.tronque).toBe(true)
      expect(grandApercu.diagnostic).toMatchObject({
        resultat: '32', gauche: { lignesMultipliees: '8' }, droite: { lignesMultipliees: '8' },
      })
      const suivante = await creerCombinaison({
        ...spec, titre: 'Combinaison réutilisée', gauche: cle, type: 'gauche',
        colonnes: [{ cote: 'gauche', nom: 'segment' }, { cote: 'droite', nom: 'segment' }],
      })
      combinaisons.push(suivante)
      const initiale = (await chargerCombinaison(cle))!
      expect(initiale.definition.liens).toEqual([{ gauche: 'agence', droite: 'nom_du_centre' }])
      const definitionDroits = JSON.stringify({ groupes: [], masquer: ['ca'], filtre: null })
      await prisma.$executeRaw`INSERT INTO warehouse.regles_acces (jeu, definition) VALUES (${cle}, ${definitionDroits}::jsonb)`
      try {
        await expect(modifierCombinaison(cle, initiale.revision, {
          ...selection, colonnes: selection.colonnes.filter(c => c.nom !== 'ca'),
        })).rejects.toThrow('droits d’accès')
      } finally {
        await prisma.$executeRaw`DELETE FROM warehouse.regles_acces WHERE jeu = ${cle}`
      }
      await expect(modifierCombinaison(cle, initiale.revision, {
        ...selection, colonnes: selection.colonnes.filter(c => c.nom !== 'segment'),
      })).rejects.toThrow('Combinaison réutilisée')
      const modifiee = {
        ...selection,
        liens: [{ gauche: 'agence', droite: 'segment' }],
        colonnes: [...selection.colonnes, { cote: 'gauche', nom: 'mois' }],
      }
      await expect(previsualiserCombinaison(modifiee, ctx)).resolves.toMatchObject({ lignes: [] })
      expect(await chargerCombinaison(cle)).toEqual(initiale)
      await modifierCombinaison(cle, initiale.revision, modifiee)
      const enregistree = (await chargerCombinaison(cle))!
      expect(enregistree.definition).toMatchObject({ cle, liens: modifiee.liens, colonnes: modifiee.colonnes })
      expect(enregistree.revision).not.toBe(initiale.revision)
      await expect(modifierCombinaison(cle, initiale.revision, selection)).rejects.toThrow('modifié depuis')
      const nouveauResultat = await calculerSemantique({
        jeu: cle, dimensions: ['mois', 'segment'], mesures: [],
      }, ctx)
      expect(nouveauResultat.lignes).toEqual([])
      await modifierCombinaison(cle, enregistree.revision, selection)
      const chaine = await calculerSemantique({ jeu: suivante, dimensions: ['segment', 'segment_2'], mesures: [] }, ctx)
      expect(chaine.lignes).toEqual(expect.arrayContaining([
        { segment: 'Littoral', segment_2: 'Littoral' }, { segment: 'Intérieur', segment_2: 'Intérieur' },
      ]))
      try {
        await support.$executeRaw`DELETE FROM support.centres WHERE "Nom du centre" = 'Plateau'`
        await synchroniserEntrepot({ jeu: droite, forcer: true })
        const actualise = await calculerSemantique({ jeu: suivante, dimensions: ['segment', 'segment_2'], mesures: [] }, ctx)
        expect(actualise.lignes).toEqual(expect.arrayContaining([
          { segment: 'Littoral', segment_2: 'Littoral' },
        ]))
        expect(actualise.lignes).toHaveLength(1)
        const avantChangementType = (await chargerCombinaison(cle))!
        const selectionGauche = { ...selection, type: 'gauche' }
        const apercuGauche = await previsualiserCombinaison(selectionGauche, ctx)
        expect(apercuGauche.lignes.filter(l => !l.correspondance)).toHaveLength(4)
        expect(apercuGauche.lignes).toContainEqual({ cellules: ['Plateau', '240.00', null], correspondance: false })
        expect(apercuGauche.diagnostic).toMatchObject({ resultat: '8', gauche: { sansCorrespondance: '4' } })
        expect(await chargerCombinaison(cle)).toEqual(avantChangementType)
        await modifierCombinaison(cle, avantChangementType.revision, selectionGauche)
        const apresChangementType = (await chargerCombinaison(cle))!
        expect(apresChangementType.definition).toEqual({ ...avantChangementType.definition, type: 'gauche' })
        expect(apresChangementType.revision).not.toBe(avantChangementType.revision)
        expect((await calculerSemantique({ jeu: cle, dimensions: ['agence', 'segment'], mesures: [] }, ctx)).lignes)
          .toContainEqual({ agence: 'Plateau', segment: null })
        const apercuInterne = await previsualiserCombinaison(selection, ctx)
        const correspondantes = apercuGauche.lignes.filter(l => l.correspondance)
        expect(apercuInterne.lignes).toHaveLength(correspondantes.length)
        expect(apercuInterne.lignes).toEqual(expect.arrayContaining(correspondantes))
        expect(await chargerCombinaison(cle)).toEqual(apresChangementType)
        await modifierCombinaison(cle, apresChangementType.revision, selection)
        expect((await calculerSemantique({ jeu: cle, dimensions: ['agence', 'segment'], mesures: [] }, ctx)).lignes)
          .not.toContainEqual({ agence: 'Plateau', segment: null })
        const conserve = await creerCombinaison({ ...spec, type: 'gauche' })
        combinaisons.push(conserve)
        const resultat = await calculerSemantique({ jeu: conserve, dimensions: ['agence', 'segment'], mesures: [] }, ctx)
        expect(resultat.lignes).toContainEqual({ agence: 'Plateau', segment: null })
        const apercuClesNulles = await previsualiserCombinaison({
          gauche: conserve, droite, type: 'interne', liens: [{ gauche: 'segment', droite: 'segment' }],
          colonnes: [{ cote: 'gauche', nom: 'segment' }],
        }, ctx)
        expect(apercuClesNulles.diagnostic).toMatchObject({
          resultat: '4', gauche: { lignesCleNulle: '4', sansCorrespondance: '4', clesDupliquees: '1' },
        })
      } finally {
        await support.$executeRaw`INSERT INTO support.centres VALUES ('Plateau', 'Intérieur', 'exclue') ON CONFLICT DO NOTHING`
      }
    } finally {
      for (const cle of combinaisons) await prisma.$executeRaw`DELETE FROM warehouse.combinaisons WHERE cle = ${cle}`
      for (const cle of imports) {
        await prisma.$executeRaw`DELETE FROM warehouse.imports WHERE cle = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.snapshots WHERE jeu = ${cle}`
        await prisma.$executeRaw`DELETE FROM warehouse.synchronisations WHERE jeu = ${cle}`
      }
      for (const id of sources) await prisma.$executeRaw`DELETE FROM warehouse.sources WHERE id = ${id}`
    }
  }, 30000)
})

