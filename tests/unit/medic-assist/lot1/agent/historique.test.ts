import { convertToModelMessages, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  estimerCaracteres,
  reduireHistorique,
  TEXTE_DEBUT_OMIS,
  type MessageUi,
} from '@/lib/medic-assist/agent/historique'

// Marqueur de test : ZZMA1HIST

const utilisateur = (id: string, texte: string): MessageUi => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: texte }],
})

const apercu = Array.from({ length: 30 }, (_, i) => ({ produit: `ZZMA1HIST P${i}`, ca: i * 100 }))

const resultatJeu = {
  jeuDeDonneesId: 'jeu-1',
  colonnes: [
    { cle: 'produit', libelle: 'Produit', type: 'texte' },
    { cle: 'ca', libelle: 'CA', type: 'montant', unite: 'EUR' },
  ],
  apercu,
  nbLignes: 120,
  tronque: true,
  totaux: { ca: 43500 },
  provenance: {
    source: 'semantique',
    jeu: 'ventes',
    libelleSource: 'Ventes locales',
    periode: { debut: '2026-04', fin: '2026-09', libelle: 'avril à septembre 2026' },
    perimetre: { pays: 'tous', libelle: 'Tous les pays' },
    filtres: [],
    regles: ['CA = quantité × PGHT de la ligne', 'inactifs exclus'],
    calculeA: '2026-11-02T10:00:00Z',
  },
}

function echange(n: number, extra: MessageUi['parts'] = []): MessageUi[] {
  return [
    utilisateur(`u${n}`, `question ${n}`),
    {
      id: `a${n}`,
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        {
          type: 'tool-interroger_donnees',
          toolCallId: `t${n}`,
          state: 'output-available',
          input: { jeu: 'ventes' },
          output: resultatJeu,
        },
        ...extra,
        { type: 'text', text: `réponse ${n}` },
      ],
    },
  ]
}

const partieOutil = (m: MessageUi) =>
  m.parts.find((p) => p.type.startsWith('tool-')) as Record<string, unknown>

describe('reduireHistorique', () => {
  it('renvoie un tableau vide pour une entrée vide', () => {
    expect(reduireHistorique([])).toEqual({ messages: [], compacte: false })
  })

  it('garde intacts les N derniers échanges et compacte les plus anciens', () => {
    const messages = [1, 2, 3, 4].flatMap((n) => echange(n))
    const { messages: sortie, compacte } = reduireHistorique(messages, { derniersEchanges: 2 })

    expect(compacte).toBe(true)
    expect(sortie).toHaveLength(8)
    // Les deux derniers échanges (3 et 4) gardent l'aperçu des lignes.
    for (const index of [5, 7]) {
      const sortieOutil = partieOutil(sortie[index]!).output as Record<string, unknown>
      expect(sortieOutil.apercu).toHaveLength(30)
    }
    // Les deux plus anciens sont compactés.
    for (const index of [1, 3]) {
      const sortieOutil = partieOutil(sortie[index]!).output as Record<string, unknown>
      expect(sortieOutil.apercu).toBeUndefined()
      expect(sortieOutil.apercuOmis).toBe(true)
    }
  })

  it('la compaction garde le jeu, les colonnes, le nombre de lignes et la provenance', () => {
    const { messages: sortie } = reduireHistorique(echange(1).concat(echange(2)), {
      derniersEchanges: 1,
    })
    const compact = partieOutil(sortie[1]!).output as Record<string, unknown>
    expect(compact.jeuDeDonneesId).toBe('jeu-1')
    expect(compact.nbLignes).toBe(120)
    expect(compact.tronque).toBe(true)
    expect(compact.totaux).toEqual({ ca: 43500 })
    expect(compact.colonnes).toEqual([
      { cle: 'produit', libelle: 'Produit', type: 'texte' },
      { cle: 'ca', libelle: 'CA', type: 'montant' },
    ])
    expect(compact.provenance).toContain('Ventes locales')
    expect(compact.provenance).toContain('avril à septembre 2026')
    expect(compact.provenance).toContain('Tous les pays')
    expect(JSON.stringify(compact)).not.toContain('ZZMA1HIST P')
  })

  it("garde l'identifiant, le titre et le type d'un artefact ancien", () => {
    const artefact: MessageUi = {
      id: 'a-art',
      role: 'assistant',
      parts: [
        {
          type: 'tool-creer_artefact',
          toolCallId: 'tc',
          state: 'output-available',
          input: {
            spec: {
              type: 'tableau',
              titre: 'Top ventes',
              jeuDeDonneesId: 'jeu-1',
              colonnes: apercu,
            },
          },
          output: { artefactId: 'art-1', version: 2, type: 'tableau', titre: 'Top ventes' },
        },
      ],
    }
    const messages = [utilisateur('u0', 'fais un tableau'), artefact, ...echange(1)]
    const { messages: sortie } = reduireHistorique(messages, { derniersEchanges: 1 })
    const partie = partieOutil(sortie[1]!)
    expect(partie.output).toEqual({
      artefactId: 'art-1',
      version: 2,
      type: 'tableau',
      titre: 'Top ventes',
    })
    expect(partie.input).toEqual({
      spec: { type: 'tableau', titre: 'Top ventes', jeuDeDonneesId: 'jeu-1' },
    })
  })

  it('retire data-* et le raisonnement des anciens échanges seulement, garde le step-start qui sépare deux étapes', () => {
    const avecExtras = (n: number) =>
      echange(n, [
        { type: 'reasoning', text: `raison ${n}` },
        { type: 'data-ui-chip', data: { x: 1 } },
        { type: 'step-start' },
      ])
    const { messages: sortie } = reduireHistorique([...avecExtras(1), ...avecExtras(2)], {
      derniersEchanges: 1,
    })
    const types = (m: MessageUi) => m.parts.map((p) => p.type)
    // Le step-start de tête est retiré ; celui qui sépare l'outil du texte final est gardé.
    expect(types(sortie[1]!)).toEqual(['tool-interroger_donnees', 'step-start', 'text'])
    expect(types(sortie[3]!)).toEqual(['tool-interroger_donnees', 'reasoning', 'step-start', 'text'])
  })

  it('retire les step-start qui ne séparent rien (tête, queue, consécutifs, message vide)', () => {
    const messages: MessageUi[] = [
      utilisateur('u1', 'a'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'un' },
          { type: 'step-start' },
          { type: 'step-start' },
          { type: 'tool-x', toolCallId: 'i', state: 'input-available', input: {} },
          { type: 'step-start' },
        ],
      },
      { id: 'a2', role: 'assistant', parts: [{ type: 'step-start' }] },
    ]
    const { messages: sortie } = reduireHistorique(messages)
    expect(sortie.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(sortie[1]!.parts.map((p) => p.type)).toEqual(['text'])
  })

  it("retire les parties d'outil incomplètes et les messages vides qui en résultent", () => {
    const messages: MessageUi[] = [
      utilisateur('u1', 'bonjour'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'tool-requete_sql', toolCallId: 'x1', state: 'input-streaming', input: {} },
          { type: 'tool-requete_sql', toolCallId: 'x2', state: 'input-available', input: {} },
        ],
      },
      utilisateur('u2', 'toujours là ?'),
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          { type: 'tool-requete_sql', toolCallId: 'x3', state: 'input-available', input: {} },
          {
            type: 'tool-requete_sql',
            toolCallId: 'x4',
            state: 'output-error',
            input: {},
            errorText: 'oups',
          },
          { type: 'text', text: 'ok' },
        ],
      },
    ]
    const { messages: sortie } = reduireHistorique(messages)
    expect(sortie.map((m) => m.id)).toEqual(['u1', 'u2', 'a2'])
    expect(sortie[2]!.parts.map((p) => p.type)).toEqual(['tool-requete_sql', 'text'])
    expect((sortie[2]!.parts[0] as Record<string, unknown>).state).toBe('output-error')
  })

  it('gère les outils dynamiques sans sortie', () => {
    const messages: MessageUi[] = [
      utilisateur('u1', 'a'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'x',
            toolCallId: 'd1',
            state: 'input-available',
            input: {},
          },
          { type: 'text', text: 'fin' },
        ],
      },
    ]
    expect(reduireHistorique(messages).messages[1]!.parts.map((p) => p.type)).toEqual(['text'])
  })

  it("ne mute jamais l'entrée", () => {
    const messages = [1, 2, 3].flatMap((n) => echange(n, [{ type: 'reasoning', text: 'r' }]))
    const copie = JSON.parse(JSON.stringify(messages))
    reduireHistorique(messages, { derniersEchanges: 1, budgetCaracteres: 500 })
    expect(messages).toEqual(copie)
  })

  it('supprime les plus anciens échanges quand le budget est dépassé', () => {
    const gros = (n: number): MessageUi[] => [
      utilisateur(`u${n}`, 'q'.repeat(1_000)),
      { id: `a${n}`, role: 'assistant', parts: [{ type: 'text', text: 'r'.repeat(1_000) }] },
    ]
    const messages = [1, 2, 3, 4, 5].flatMap(gros)
    const { messages: sortie, compacte } = reduireHistorique(messages, {
      derniersEchanges: 2,
      budgetCaracteres: 4_500,
    })
    expect(compacte).toBe(true)
    expect(sortie.map((m) => m.id)).toEqual(['u4', 'a4', 'u5', 'a5'])
    expect(estimerCaracteres(sortie)).toBeLessThanOrEqual(4_500)
    expect(sortie[0]!.role).toBe('user')
  })

  it('garde toujours le dernier message utilisateur, même au-dessus du budget', () => {
    const messages = [
      utilisateur('u1', 'a'.repeat(500)),
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'b' }] } as MessageUi,
      utilisateur('u2', 'c'.repeat(5_000)),
    ]
    const { messages: sortie } = reduireHistorique(messages, { budgetCaracteres: 100 })
    expect(sortie.map((m) => m.id)).toEqual(['u2'])
  })

  it('compacte le dernier échange en dernier recours', () => {
    const { messages: sortie, compacte } = reduireHistorique(echange(1), {
      budgetCaracteres: 1_000,
    })
    expect(compacte).toBe(true)
    const sortieOutil = partieOutil(sortie[1]!).output as Record<string, unknown>
    expect(sortieOutil.apercu).toBeUndefined()
    expect(sortieOutil.jeuDeDonneesId).toBe('jeu-1')
  })

  it("garde une alternance valide : commence par l'utilisateur, ajoute un rappel si besoin", () => {
    const messages: MessageUi[] = [
      { id: 'a0', role: 'assistant', parts: [{ type: 'text', text: 'Bienvenue' }] },
      utilisateur('u1', 'salut'),
    ]
    const { messages: sortie } = reduireHistorique(messages)
    expect(sortie[0]!.role).toBe('user')
    expect(sortie[0]!.parts).toEqual([{ type: 'text', text: TEXTE_DEBUT_OMIS }])
    expect(sortie.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])

    // Aucun rappel quand la conversation commence déjà par l'utilisateur.
    const normal = reduireHistorique(echange(1)).messages
    expect(normal[0]!.id).toBe('u1')
  })

  it('remplace les gros fichiers anciens par une mention', () => {
    const messages: MessageUi[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'file',
            filename: 'ventes.xlsx',
            url: `data:application/x;base64,${'A'.repeat(5_000)}`,
          },
          { type: 'text', text: 'analyse' },
        ],
      },
      ...echange(2),
    ]
    const { messages: sortie, compacte } = reduireHistorique(messages, { derniersEchanges: 1 })
    expect(compacte).toBe(true)
    expect(sortie[0]!.parts[0]).toEqual({
      type: 'text',
      text: '[Fichier ancien omis : ventes.xlsx]',
    })
  })

  it('tronque une sortie volumineuse non reconnue dans un ancien échange', () => {
    const messages: MessageUi[] = [
      utilisateur('u1', 'résume'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-resume_mensuel',
            toolCallId: 'r1',
            state: 'output-available',
            input: {},
            output: { periode: '2026-09', alertes: 'x'.repeat(5_000) },
          },
        ],
      },
      ...echange(2),
    ]
    const { messages: sortie } = reduireHistorique(messages, { derniersEchanges: 1 })
    const compact = partieOutil(sortie[1]!).output as Record<string, unknown>
    expect(compact.periode).toBe('2026-09')
    expect(compact.alertes).toBeUndefined()
    expect(compact.sortieTronquee).toBe(true)
  })
})

describe('estimerCaracteres', () => {
  it('compte le texte et la taille sérialisée des autres parties', () => {
    const n = estimerCaracteres([utilisateur('u', 'abcde')])
    expect(n).toBe(5)
    expect(estimerCaracteres(echange(1))).toBeGreaterThan(estimerCaracteres(echange(1).slice(0, 1)))
  })
})

describe('ordre des messages après convertToModelMessages (vrai SDK)', () => {
  const outil = (id: string, nom: string, sortie: unknown): MessageUi['parts'][number] => ({
    type: `tool-${nom}`,
    toolCallId: id,
    state: 'output-available',
    input: { id },
    output: sortie,
  })

  async function convertir(messages: MessageUi[]) {
    const nettoyes = reduireHistorique(messages).messages
    return convertToModelMessages(nettoyes as unknown as UIMessage[])
  }

  const resume = (modeles: Awaited<ReturnType<typeof convertir>>) =>
    modeles.map((m) => ({
      role: m.role,
      contenu:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => `${c.type}${'text' in c ? `:${c.text}` : ''}`),
    }))

  it('texte, outil, texte : le résultat précède le texte final', async () => {
    const modeles = await convertir([
      utilisateur('u1', 'total ?'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'Je regarde.' },
          outil('t1', 'interroger_donnees', { total: 42 }),
          { type: 'step-start' },
          { type: 'text', text: 'Le total est 42.' },
        ],
      },
    ])
    const lu = resume(modeles)
    expect(lu).toEqual([
      { role: 'user', contenu: ['text:total ?'] },
      { role: 'assistant', contenu: ['text:Je regarde.', 'tool-call'] },
      { role: 'tool', contenu: ['tool-result'] },
      { role: 'assistant', contenu: ['text:Le total est 42.'] },
    ])
  })

  it('deux outils dans deux étapes : chaque résultat suit son appel', async () => {
    const modeles = await convertir([
      utilisateur('u1', 'compare'),
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          outil('t1', 'interroger_donnees', { n: 1 }),
          { type: 'step-start' },
          { type: 'text', text: 'Je creuse.' },
          outil('t2', 'interroger_donnees', { n: 2 }),
          { type: 'step-start' },
          { type: 'text', text: 'Fini.' },
        ],
      },
    ])
    expect(resume(modeles)).toEqual([
      { role: 'user', contenu: ['text:compare'] },
      { role: 'assistant', contenu: ['tool-call'] },
      { role: 'tool', contenu: ['tool-result'] },
      { role: 'assistant', contenu: ['text:Je creuse.', 'tool-call'] },
      { role: 'tool', contenu: ['tool-result'] },
      { role: 'assistant', contenu: ['text:Fini.'] },
    ])
  })
})
