import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import * as serveur from 'next-intl/server'
import { messageErreurLib, trouverMotifErreurLib } from '@/app/(dashboard)/sources/erreurs-lib'

const RACINE = resolve(__dirname, '../../..')
const lire = (fichier: string) => readFileSync(resolve(RACINE, fichier), 'utf8')

// Messages de lib avec des valeurs réalistes (apostrophe ’ comme dans lib), et la clé attendue.
const EXEMPLES: [string, string][] = [
  ['champCatalogue', 'Vérifiez le champ « Libellé de l’indicateur ».'],
  ['definitionInvalide', 'Définition métier invalide.'],
  ['jeuIndisponible', 'Ce jeu est indisponible.'],
  ['definitionChangee', 'La définition a changé depuis son ouverture. Rechargez le jeu.'],
  ['colonneIndisponible', 'La colonne « montant_ttc » est indisponible.'],
  ['uniciteCles', 'Chaque clé, dimension et mesure doit être unique.'],
  ['calendrierColonneDate', 'Sélectionnez une colonne de type date pour le calendrier.'],
  ['cleCalendrier', 'La clé « mois » est utilisée par le calendrier. Retirez la dimension ou renommez l’indicateur.'],
  ['rapportDenominateur', 'Un rapport exige une colonne au dénominateur.'],
  ['indicateurNumerique', 'L’indicateur « Taux d’occupation » exige des colonnes numériques.'],
  ['filtreNumerique', 'Le filtre sur « quantité » exige une valeur numérique.'],
  ['filtreDate', 'Le filtre sur « date_visite » exige une date valide (AAAA-MM-JJ).'],
  ['reessayerEnregistrement', 'Réessayez l’enregistrement.'],
  ['jeuCombineIntrouvable', 'Ce jeu combiné est introuvable.'],
  ['jeuCombineUtilise', 'Ce jeu combiné est utilisé par « Ventes par pays ». Supprimez d’abord ces jeux combinés.'],
  ['jeuCombineUtilise', 'Ce jeu combiné est utilisé par « Ventes », « Stocks ». Supprimez d’abord ces jeux combinés.'],
  ['jeuCombineUtiliseAutres', 'Ce jeu combiné est utilisé par « A », « B », « C », « D », « E » et 3 autre(s). Supprimez d’abord ces jeux combinés.'],
  ['jeuCombineModifie', 'Ce jeu a été modifié depuis son ouverture. Rouvrez-le pour reprendre vos changements.'],
  ['jeuxSourceFixes', 'Les deux jeux source sont fixés lors de la création de la combinaison.'],
  ['colonneUtiliseeParJeu', 'La colonne « pays_id » est utilisée par « Ventes par pays ». Conservez-la pour enregistrer.'],
  ['colonneUtiliseeCatalogue', 'La colonne « pays_id » est utilisée par le catalogue métier. Mettez le catalogue à jour avant de la remplacer.'],
  ['colonneUtiliseeDroits', 'La colonne « pays_id » est utilisée par les droits d’accès. Mettez ces droits à jour avant de la remplacer.'],
  ['deuxJeuxDifferents', 'Sélectionnez deux jeux de données différents et disponibles.'],
  ['plusHuitImports', 'Cette combinaison utilise plus de huit imports.'],
  ['colonneIntrouvableJeu', 'Une colonne sélectionnée est introuvable dans son jeu.'],
  ['typesIncompatibles', 'Les colonnes de chaque liaison doivent avoir des types compatibles.'],
  ['liaisonRepetee', 'Une liaison est répétée.'],
  ['colonneDoublon', 'Une colonne a été sélectionnée deux fois.'],
  ['groupeNomExistant', 'Un groupe porte déjà ce nom.'],
  ['groupeIntrouvable', 'Ce groupe est introuvable.'],
  ['membresIndisponibles', 'Rechargez la page. Certains membres sont indisponibles.'],
  ['jeuIntrouvable', 'Ce jeu est introuvable.'],
  ['colonneSelectionIndisponible', 'Une colonne sélectionnée est indisponible.'],
  ['groupeSelectionIndisponible', 'Un groupe sélectionné est indisponible.'],
  ['garderColonneVisible', 'Conservez au moins une colonne visible.'],
  ['espaceNomExistant', 'Un espace porte déjà ce nom.'],
  ['jeuSelectionIndisponible', 'Un jeu sélectionné est indisponible.'],
  ['retirerJeuEspace', 'Retirez d’abord le jeu de son espace actuel.'],
  ['espaceChange', 'L’espace a changé. Rechargez la page.'],
  ['hoteRefuse', 'Hôte non autorisé ou introuvable.'],
  ['incrementalConfiguration', 'Configurez la lecture incrémentale sur un import PostgreSQL administré.'],
  ['incrementalCles', 'Sélectionnez des clés stables et une colonne de modification distincte.'],
  ['incrementalDateType', 'La date de modification doit être un horodatage PostgreSQL.'],
  ['incrementalCleVide', 'Une ligne possède une clé incrémentale vide.'],
  ['volumeMaxSynchro', 'Volume maximal de synchronisation dépassé.'],
  ['incrementalDateAbsente', 'Une date de modification est absente ou invalide.'],
  ['incrementalCleDupliquee', 'Une clé incrémentale apparaît plusieurs fois.'],
  ['lectureIndisponible', 'Connexion PostgreSQL de lecture indisponible.'],
  ['compteLectureDedie', 'Configurez un compte PostgreSQL de lecture dédié.'],
  ['premiereSynchro', 'Ce jeu attend sa première synchronisation.'],
  ['versionInvalide', 'Version de préparation invalide.'],
  ['importIndisponible', 'Cet import est indisponible.'],
  ['preparationChangee', 'La préparation a changé. Rechargez l’import avant de réessayer.'],
  ['valeurNumeriqueTypee', 'Saisissez une valeur numérique du type de la colonne.'],
  ['valeurNumeriqueFinie', 'Saisissez une valeur numérique finie.'],
  ['dateValide', 'Saisissez une date valide (AAAA-MM-JJ).'],
  ['memeType', 'Les valeurs comparées doivent avoir le même type.'],
  ['filtresInvalides', 'Vérifiez les filtres, les normalisations et les contrôles.'],
  ['valeurFiltre', 'Renseignez la valeur du filtre.'],
  ['normalisationsTexte', 'Les normalisations s’appliquent aux colonnes de texte.'],
  ['controleColonneUnique', 'Sélectionnez chaque colonne une seule fois dans un contrôle.'],
  ['plageType', 'Une plage exige une colonne numérique ou une date.'],
  ['borneRequise', 'Renseignez au moins une borne.'],
  ['bornesInversees', 'La borne minimale dépasse la borne maximale.'],
  ['execVolume', 'Le volume dépasse la limite de cet import.'],
  ['execSchema', 'Une table, une colonne ou un type ne correspond plus à la définition de l’import.'],
  ['execSource', 'La source ne répond pas ou le compte de lecture ne dispose plus des accès nécessaires.'],
  ['execNonNul', 'Une valeur obligatoire est absente.'],
  ['execUnique', 'Une clé se répète dans les données préparées.'],
  ['execPlage', 'Une valeur est hors des bornes autorisées.'],
  ['execIncrementalCle', 'Une clé de synchronisation est vide ou dupliquée.'],
  ['execIncrementalDate', 'Un horodatage de modification est absent ou invalide.'],
  ['execConfiguration', 'La définition de préparation est incompatible avec les colonnes de cet import.'],
  ['sourceIntrouvable', 'Source introuvable.'],
  ['sourceFichierIntrouvable', 'Source fichier introuvable.'],
  ['fichierIntrouvable', 'Fichier introuvable.'],
  ['colonneInaccessible', 'Une colonne sélectionnée n’est plus accessible.'],
  ['nomJeuUtilise', 'Ce nom de jeu est déjà utilisé. Réessayez.'],
  ['importIntrouvable', 'Import introuvable.'],
  ['champsFormulaire', 'Vérifiez les champs du formulaire.'],
  ['secretRequis', 'Ressaisissez le mot de passe ou le jeton : il n’est jamais réutilisé quand la destination de la connexion change.'],
  ['echecTest', 'La connexion avec ces paramètres a échoué. Rien n’a été modifié.'],
  ['sourceUtilisee', 'Cette source est utilisée par « Clients CSV ». Supprimez d’abord ces imports.'],
  ['sourceUtiliseeAutres', 'Cette source est utilisée par « I1 », « I2 », « I3 », « I4 », « I5 » et 2 autre(s). Supprimez d’abord ces imports.'],
  ['importUtilise', 'Cet import est utilisé par « Ventes par pays », « Stocks ». Supprimez d’abord ces jeux combinés.'],
  ['importUtiliseAutres', 'Cet import est utilisé par « A », « B », « C », « D », « E » et 12 autre(s). Supprimez d’abord ces jeux combinés.'],
]

describe('messageErreurLib (fr)', () => {
  it.each(EXEMPLES)('%s : le texte rendu est exactement le message de lib', async (cle, message) => {
    expect(trouverMotifErreurLib(message)?.cle).toBe(cle)
    expect(await messageErreurLib(message)).toBe(message)
  })

  it('extrait les paramètres', () => {
    expect(trouverMotifErreurLib('La colonne « a » est utilisée par « B ». Conservez-la pour enregistrer.'))
      .toEqual({ cle: 'colonneUtiliseeParJeu', params: { colonne: 'a', titre: 'B' } })
    expect(trouverMotifErreurLib('Cet import est utilisé par « A », « B » et 4 autre(s). Supprimez d’abord ces jeux combinés.'))
      .toEqual({ cle: 'importUtiliseAutres', params: { liste: '« A », « B »', autres: '4' } })
  })

  it('chaque clé du groupe de messages fr (hors generique) est couverte par un exemple', () => {
    const groupe = JSON.parse(lire('messages/fr/sources.json')).erreursLib as Record<string, string>
    const attendues = Object.keys(groupe).filter(c => c !== 'generique').sort()
    expect([...new Set(EXEMPLES.map(([c]) => c))].sort()).toEqual(attendues)
  })

  it('rend tel quel un message inconnu en français', async () => {
    expect(await messageErreurLib('Message imprévu de lib.')).toBe('Message imprévu de lib.')
    expect(trouverMotifErreurLib('Message imprévu de lib.')).toBeNull()
  })

  it('ne reconnaît pas un message qui contient seulement un motif', () => {
    expect(trouverMotifErreurLib('Préfixe. Source introuvable.')).toBeNull()
    expect(trouverMotifErreurLib('Source introuvable. Suffixe')).toBeNull()
  })

  it('repli générique hors français', async () => {
    const espion = vi.spyOn(serveur, 'getLocale').mockResolvedValue('en' as never)
    try {
      const generique = (await import('@/messages/fr/sources.json')).default.erreursLib.generique
      expect(await messageErreurLib('Message imprévu de lib.')).toBe(generique)
      // Un message connu reste traduit par son motif, pas par le repli.
      expect(await messageErreurLib('Source introuvable.')).toBe('Source introuvable.')
    } finally {
      espion.mockRestore()
    }
  })
})

describe('couverture des messages de lib', () => {
  const FICHIERS = [
    'lib/warehouse/catalogue-metier.ts', 'lib/warehouse/combinaisons-admin.ts', 'lib/warehouse/droits-admin.ts',
    'lib/warehouse/espaces.ts', 'lib/warehouse/hotes-sources.ts', 'lib/warehouse/incremental.ts',
    'lib/warehouse/jointures.ts', 'lib/warehouse/modele-metier.ts', 'lib/warehouse/postgres.ts',
    'lib/warehouse/qualite-admin.ts', 'lib/warehouse/qualite.ts', 'lib/warehouse/sources-admin.ts',
    // ErreurDonnees remontée par previsualiserCombinaison (lireEntrepot).
    'lib/medic-assist/donnees/lecture-seule.ts',
  ]
  // Exclusions : lib/warehouse/{tableaux,tendances,synchronisation}*.ts (jamais affichés par les
  // écrans Sources) ; les `new Error(...)` simples des connecteurs (non attrapés comme erreurs
  // métier : les actions renvoient leur message générique) ; ErreurDonnees du moteur sémantique
  // de medic-assist (requêtes de l'assistant, pas atteignables depuis combiner).

  const constantes = (source: string) => {
    const table: Record<string, string> = {}
    for (const m of source.matchAll(/const (\w+) = '((?:[^'\\]|\\.)*)'/g)) table[m[1]] = m[2]
    return table
  }

  /** Reconstitue le texte d'un argument : littéraux conservés, expressions remplacées par X. */
  function evaluer(arg: string, consts: Record<string, string>) {
    let sortie = ''
    let i = 0
    while (i < arg.length) {
      const c = arg[i]
      if (c === "'") {
        let j = i + 1
        while (arg[j] !== "'") j += arg[j] === '\\' ? 2 : 1
        sortie += arg.slice(i + 1, j).replace(/\\(.)/g, '$1')
        i = j + 1
      } else if (c === '`') {
        let j = i + 1
        while (arg[j] !== '`') j++
        sortie += arg.slice(i + 1, j).replace(/\$\{[^}]*\}/g, 'X')
        i = j + 1
      } else if (/[A-Za-z_]/.test(c)) {
        let j = i
        let profondeur = 0
        while (j < arg.length) {
          if ('([{'.includes(arg[j])) profondeur++
          else if (')]}'.includes(arg[j])) profondeur--
          else if (profondeur === 0 && !/[\w$.?!]/.test(arg[j])) break
          j++
        }
        const expression = arg.slice(i, j)
        sortie += expression.startsWith('listeTitres(') ? '« X »' : consts[expression] ?? 'X'
        i = j
      } else if (c === ',' ) {
        break
      } else {
        i++
      }
    }
    return sortie
  }

  function arguments_(source: string) {
    const messages: { texte: string; ligne: string }[] = []
    const consts = constantes(source)
    for (const m of source.matchAll(/new Erreur(?:Administration|Jointure|Droits|Espace|Qualite|CatalogueMetier|Incrementale|HoteSource|Donnees)\w*\(/g)) {
      let j = m.index! + m[0].length
      let profondeur = 1
      const debut = j
      let guillemet = ''
      for (; j < source.length && profondeur; j++) {
        const c = source[j]
        if (guillemet) {
          if (c === '\\') j++
          else if (c === guillemet) guillemet = ''
        } else if (c === "'" || c === '`') guillemet = c
        else if (c === '(') profondeur++
        else if (c === ')') profondeur--
      }
      let arg = source.slice(debut, j - 1).trim()
      if (/^Erreur(Incrementale)/.test(m[0].slice(4))) arg = arg.replace(/^'[a-z_]+',\s*/, '')
      // Ternaire `cond ? a : b` : chaque branche est un message possible.
      const ternaire = /^[\w.]+ \? ([\s\S]+) : ('[\s\S]*')$/.exec(arg)
      for (const branche of ternaire ? [ternaire[1], ternaire[2]] : [arg]) messages.push({ texte: evaluer(branche, consts), ligne: branche })
    }
    return messages
  }

  it.each(FICHIERS)('%s : chaque message est reconnu', fichier => {
    const messages = arguments_(lire(fichier))
    expect(messages.length).toBeGreaterThan(0)
    const inconnus = messages.filter(({ texte }) => !trouverMotifErreurLib(texte))
    expect(inconnus, JSON.stringify(inconnus)).toEqual([])
  })

  it('messagesExecution (qualite.ts) : chaque message est reconnu', () => {
    const bloc = /messagesExecution[^{]*\{([\s\S]*?)\n\}/.exec(lire('lib/warehouse/qualite.ts'))![1]
    const valeurs = [...bloc.matchAll(/: '((?:[^'\\]|\\.)*)'/g)].map(m => m[1])
    expect(valeurs.length).toBe(9)
    for (const v of valeurs) expect(trouverMotifErreurLib(v), v).not.toBeNull()
  })
})
