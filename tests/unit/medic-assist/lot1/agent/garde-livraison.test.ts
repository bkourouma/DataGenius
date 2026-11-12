/**
 * Garde-fou de livraison (anomalie B1) : décision pure et construction de la spécification.
 */
import { describe, it, expect } from 'vitest'

import {
  collecterMorceau,
  construireSpecTableau,
  contientTableauMarkdown,
  creerEtatLivraison,
  evaluerLivraison,
} from '@/lib/medic-assist/agent/garde-livraison'
import { EntreeCreerArtefactSchema, type ResultatJeu } from '@/lib/medic-assist/contrats'

const PAYS = ['Bénin', 'Côte d’Ivoire', 'Sénégal', 'Mali', 'Togo', 'Niger', 'Gabon']

function jeu(lignes: number, id = 'jeu-1', extra: Partial<ResultatJeu> = {}): ResultatJeu {
  return {
    jeuDeDonneesId: id,
    colonnes: [
      { cle: 'pays', libelle: 'Pays', type: 'texte' },
      { cle: 'ca_eur', libelle: 'CA', type: 'montant', unite: 'EUR' },
    ],
    apercu: Array.from({ length: Math.min(lignes, 30) }, (_, i) => ({
      pays: PAYS[i] ?? `Pays ${i}`,
      ca_eur: 1000 + i,
    })),
    nbLignes: lignes,
    tronque: false,
    totaux: { ca_eur: 9999 },
    provenance: {
      source: 'semantique',
      jeu: 'ventes',
      libelleSource: 'Ventes (sorties locales)',
      periode: { debut: '2026-10', fin: '2026-10', libelle: 'octobre 2026' },
      perimetre: { pays: 'tous', libelle: 'Tous les pays' },
      filtres: [],
      regles: [],
      calculeA: '2026-11-02T10:00:00.000Z',
    },
    ...extra,
  } as ResultatJeu
}

type Etat = ReturnType<typeof creerEtatLivraison>

/** Joue un appel d'outil complet dans l'état. */
function appel(etat: Etat, nom: string, sortie: unknown) {
  const id = `${nom}-${etat.outils.size}`
  collecterMorceau(etat, { type: 'tool-input-available', toolCallId: id, toolName: nom, input: {} })
  collecterMorceau(etat, { type: 'tool-output-available', toolCallId: id, output: sortie })
}

const ERREUR = { erreur: { code: 'requete_invalide', message: 'non' } }

function decision(etat: Etat, texte: string) {
  return evaluerLivraison({ jeux: etat.jeux, artefactLivre: etat.artefactLivre, texte })
}

describe('garde de livraison : evaluerLivraison', () => {
  it('6 lignes sans artefact : tableau à créer, même si le texte cite les pays', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(6))
    const texte = 'Bénin, Côte d’Ivoire, Sénégal, Mali, Togo, Niger : voir le détail.'
    expect(decision(etat, texte)?.jeuDeDonneesId).toBe('jeu-1')
  })

  it('6 lignes avec artefact livré : rien', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(6))
    appel(etat, 'creer_artefact', { artefactId: 'a1', version: 1, type: 'tableau', titre: 'T' })
    expect(decision(etat, 'Voir le tableau.')).toBeNull()
  })

  it('modifier_artefact abouti compte aussi comme livraison', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(8))
    appel(etat, 'modifier_artefact', { artefactId: 'a1', version: 2, type: 'tableau', titre: 'T' })
    expect(decision(etat, '')).toBeNull()
  })

  it('un creer_artefact en erreur ne compte pas comme livraison', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(6))
    appel(etat, 'creer_artefact', ERREUR)
    expect(decision(etat, 'Voir le tableau.')).not.toBeNull()
  })

  it('1 ligne (ou 0) : rien', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(1))
    expect(decision(etat, 'Le CA est de 1 000 EUR.')).toBeNull()
    appel(etat, 'interroger_donnees', jeu(0, 'vide'))
    expect(decision(etat, '')).toBeNull()
  })

  it('3 lignes avec un tableau markdown dans le texte : rien', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(3))
    const texte = 'Total : 3 000 EUR\n\n| Pays | CA |\n| :--- | ---: |\n| A | 1 |\n| B | 2 |'
    expect(decision(etat, texte)).toBeNull()
  })

  it('3 lignes dont tous les libellés sont cités (casse et accents ignorés) : rien', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(3))
    expect(decision(etat, 'benin : 1 000 ; COTE D’IVOIRE : 1 001 ; senegal : 1 002')).toBeNull()
  })

  it('3 lignes avec un libellé manquant dans le texte : tableau à créer', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(3))
    expect(decision(etat, 'Bénin et Sénégal sont en tête.')).not.toBeNull()
  })

  it('3 lignes, seulement le total et « voir le tableau ci-dessus » : tableau à créer', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(3))
    const texte = 'Le CA total est de 9 999 EUR. Détails dans le tableau ci-dessus.'
    expect(decision(etat, texte)).not.toBeNull()
  })

  it('sans colonne texte/période : un tableau markdown est exigé', () => {
    const etat = creerEtatLivraison()
    const sansTexte = jeu(3, 'num', {
      colonnes: [{ cle: 'ca_eur', libelle: 'CA', type: 'montant' }],
      apercu: [{ ca_eur: 1 }, { ca_eur: 2 }, { ca_eur: 3 }],
    })
    appel(etat, 'interroger_donnees', sansTexte)
    expect(decision(etat, '1, 2 et 3')).not.toBeNull()
    expect(decision(etat, '| CA |\n|---|\n| 1 |')).toBeNull()
  })

  it('plusieurs jeux : le dernier à 2 lignes ou plus l’emporte', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(6, 'premier'))
    appel(etat, 'interroger_donnees', jeu(4, 'second'))
    appel(etat, 'requete_sql', jeu(1, 'dernier-1-ligne'))
    expect(decision(etat, 'Total seulement.')?.jeuDeDonneesId).toBe('second')
  })

  it('jeu en erreur d’outil ignoré', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'interroger_donnees', jeu(6, 'bon'))
    appel(etat, 'interroger_donnees', ERREUR)
    expect(etat.jeux).toHaveLength(1)
    expect(decision(etat, '')?.jeuDeDonneesId).toBe('bon')
  })

  it('sortie de lire_piece_jointe enveloppée dans { resultat }', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'lire_piece_jointe', { nom: 'a.xlsx', resultat: jeu(7, 'pj') })
    expect(decision(etat, '')?.jeuDeDonneesId).toBe('pj')
  })

  it('outils sans rapport (entités) ignorés', () => {
    const etat = creerEtatLivraison()
    appel(etat, 'rechercher_entites', jeu(9, 'x'))
    expect(etat.jeux).toHaveLength(0)
  })
})

describe('garde de livraison : tableau markdown', () => {
  it('reconnaît en-tête + séparatrice avec alignements et espaces', () => {
    expect(contientTableauMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true)
    expect(contientTableauMarkdown('a | b\n:-: | --:\n1 | 2')).toBe(true)
  })

  it('refuse un simple texte ou une liste', () => {
    expect(contientTableauMarkdown('Total | 3\nvoir ci-dessus')).toBe(false)
    expect(contientTableauMarkdown('- a\n- b')).toBe(false)
  })
})

describe('garde de livraison : construireSpecTableau', () => {
  it('titre = source · période, sous-titre = périmètre, totaux si présents', () => {
    const r = construireSpecTableau(jeu(6))!
    expect(r).toEqual({
      spec: {
        type: 'tableau',
        titre: 'Ventes (sorties locales) · octobre 2026',
        sousTitre: 'Tous les pays',
        jeuDeDonneesId: 'jeu-1',
        totaux: true,
      },
    })
    expect(EntreeCreerArtefactSchema.safeParse(r).success).toBe(true)
  })

  it('sans période, sans totaux, périmètre vide : titre seul', () => {
    const j = jeu(6)
    delete j.totaux
    delete j.provenance.periode
    j.provenance.perimetre = { pays: 'tous', libelle: '' }
    expect(construireSpecTableau(j)).toEqual({
      spec: { type: 'tableau', titre: 'Ventes (sorties locales)', jeuDeDonneesId: 'jeu-1' },
    })
  })

  it('totaux vides : pas de totaux', () => {
    const r = construireSpecTableau(jeu(6, 'j', { totaux: {} }))!
    expect(r.spec).not.toHaveProperty('totaux')
  })

  it('titre tronqué à 120 caractères et aplati sur une ligne', () => {
    const j = jeu(6)
    j.provenance.libelleSource = 'Ventes\n  très   longues '.repeat(10).slice(0, 200)
    const r = construireSpecTableau(j)!
    expect(r.spec.titre.length).toBeLessThanOrEqual(120)
    expect(r.spec.titre).not.toMatch(/[\r\n]|\s{2}/)
    expect(EntreeCreerArtefactSchema.safeParse(r).success).toBe(true)
  })

  it('sous-titre refusé par le schéma : retiré, le tableau reste créé', () => {
    const j = jeu(6)
    j.provenance.perimetre = { pays: 'tous', libelle: '<b>Tous</b>' }
    const r = construireSpecTableau(j)
    expect(r?.spec).toBeDefined()
    expect(r!.spec).not.toHaveProperty('sousTitre')
  })

  it('titre refusé par le schéma : rien n’est créé', () => {
    const j = jeu(6)
    j.provenance.libelleSource = '<script>x</script>'
    expect(construireSpecTableau(j)).toBeNull()
  })
})
