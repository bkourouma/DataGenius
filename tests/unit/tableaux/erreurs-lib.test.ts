import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as serveur from 'next-intl/server'
import { messageErreurTableau, trouverMotifErreurTableau } from '@/app/(dashboard)/tableaux/erreurs-lib'

const RACINE = resolve(__dirname, '../../..')
const lire = (fichier: string) => readFileSync(resolve(RACINE, fichier), 'utf8')

// Messages de lib (apostrophe ’ comme dans lib) et la clé attendue.
const EXEMPLES: [string, string][] = [
  ['formulaireInvalide', 'Vérifiez le titre, les lecteurs et les paramètres des tuiles.'],
  ['artefactIndisponible', 'Un artefact est indisponible.'],
  ['indicateurDimensionIndisponible', 'Un indicateur ou une dimension de détail est indisponible.'],
  ['compteIndisponible', 'Un compte sélectionné est indisponible.'],
  ['tableauIndisponible', 'Tableau indisponible.'],
  ['tableauModifie', 'Ce tableau a été modifié depuis son ouverture. Rechargez-le.'],
  ['indicateurIndisponible', 'Indicateur indisponible.'],
  ['dejaVersionActuelle', 'Cette version est déjà la version actuelle.'],
  ['versionIntrouvable', 'Version introuvable.'],
  ['versionIncompatible', 'Cette version n’est plus compatible avec le tableau actuel : elle ne peut pas être restaurée.'],
  ['destinatairesLecteurs', 'Chaque destinataire d’une alerte doit être lecteur du tableau.'],
  ['webhookAdmin', 'Seul un administrateur peut configurer un webhook d’alerte.'],
]

describe('messageErreurTableau (fr)', () => {
  it.each(EXEMPLES)('%s : le texte rendu est exactement le message de lib', async (cle, message) => {
    expect(trouverMotifErreurTableau(message)?.cle).toBe(cle)
    expect(await messageErreurTableau(message)).toBe(message)
  })

  it('chaque clé du groupe de messages fr (hors generique) est couverte par un exemple', () => {
    const groupe = JSON.parse(lire('messages/fr/tableaux.json')).erreursLib as Record<string, string>
    const attendues = Object.keys(groupe).filter(c => c !== 'generique').sort()
    expect(EXEMPLES.map(([c]) => c).sort()).toEqual(attendues)
  })

  it('rend tel quel un message inconnu en français', async () => {
    expect(await messageErreurTableau('Message imprévu de lib.')).toBe('Message imprévu de lib.')
    expect(trouverMotifErreurTableau('Message imprévu de lib.')).toBeNull()
  })

  it('ne reconnaît pas un message qui contient seulement un motif', () => {
    expect(trouverMotifErreurTableau('Préfixe. Tableau indisponible.')).toBeNull()
    expect(trouverMotifErreurTableau('Tableau indisponible. Suffixe')).toBeNull()
  })

  it('repli générique hors français, message connu traduit par son motif', async () => {
    const espion = vi.spyOn(serveur, 'getLocale').mockResolvedValue('en' as never)
    try {
      const generique = JSON.parse(lire('messages/fr/tableaux.json')).erreursLib.generique
      expect(await messageErreurTableau('Message imprévu de lib.')).toBe(generique)
      // Le mock de next-intl/server renvoie le texte français : un message connu reste celui du motif.
      expect(await messageErreurTableau('Tableau indisponible.')).toBe('Tableau indisponible.')
    } finally {
      espion.mockRestore()
    }
  })
})

describe('couverture des messages de lib', () => {
  it.each(['lib/warehouse/tableaux.ts', 'lib/warehouse/tableaux-alertes.ts'])('%s : chaque message est reconnu', fichier => {
    const messages = [...lire(fichier).matchAll(/new Erreur(?:Tableau|VersionIncompatible|Alerte)\('([^']*)'\)/g)].map(m => m[1])
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.filter(m => !trouverMotifErreurTableau(m))).toEqual([])
  })
})
