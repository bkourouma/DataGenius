import { getLocale, getTranslations } from 'next-intl/server'

/**
 * Traduction des messages d'erreur français levés par lib/warehouse/** (sans code).
 * lib ne peut pas être modifié : on reconnaît le message français (motifs ancrés) et on le
 * rend dans la langue courante à partir du groupe de messages `sources.erreursLib`.
 * En français, le texte rendu est exactement le message de lib.
 */

export type MotifErreurLib = { cle: string; params?: Record<string, string> }

type Entree = { cle: string; motif: RegExp | string; params?: string[] }

const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Gabarit français avec {parametres} -> entrée à regex ancrée. Les valeurs sont capturées au plus court. */
function g(cle: string, gabarit: string): Entree {
  const params: string[] = []
  const source = gabarit
    .split(/(\{[a-z]+\})/i)
    .map(morceau => {
      const m = /^\{([a-z]+)\}$/i.exec(morceau)
      if (!m) return echapper(morceau)
      params.push(m[1])
      return '(.+?)'
    })
    .join('')
  return params.length ? { cle, motif: new RegExp('^' + source + '$', 's'), params } : { cle, motif: gabarit }
}

/**
 * Message construit avec listeTitres (lib/warehouse/jeux-admin.ts) : « a », « b » (5 titres au
 * plus) puis éventuellement ` et N autre(s)`. La liste est transmise telle quelle ({liste}) ;
 * le complément « et N autre(s) » est converti en paramètre {autres} (clé suffixée Autres).
 */
function listee(cle: string, avant: string, apres: string): Entree[] {
  const debut = '^' + echapper(avant)
  const fin = echapper(apres) + '$'
  return [
    { cle: cle + 'Autres', motif: new RegExp(debut + '(.+?) et (\\d+) autre\\(s\\)' + fin, 's'), params: ['liste', 'autres'] },
    { cle, motif: new RegExp(debut + '(.+?)' + fin, 's'), params: ['liste'] },
  ]
}

// Table ORDONNÉE : le premier motif qui correspond l'emporte (les variantes « Autres » passent avant).
const MOTIFS: Entree[] = [
  // catalogue-metier.ts, modele-metier.ts
  g('champCatalogue', 'Vérifiez le champ « {champ} ».'),
  g('definitionInvalide', 'Définition métier invalide.'),
  g('jeuIndisponible', 'Ce jeu est indisponible.'),
  g('definitionChangee', 'La définition a changé depuis son ouverture. Rechargez le jeu.'),
  g('colonneIndisponible', 'La colonne « {colonne} » est indisponible.'),
  g('uniciteCles', 'Chaque clé, dimension et mesure doit être unique.'),
  g('calendrierColonneDate', 'Sélectionnez une colonne de type date pour le calendrier.'),
  g('cleCalendrier', 'La clé « {cle} » est utilisée par le calendrier. Retirez la dimension ou renommez l’indicateur.'),
  g('rapportDenominateur', 'Un rapport exige une colonne au dénominateur.'),
  g('indicateurNumerique', 'L’indicateur « {libelle} » exige des colonnes numériques.'),
  g('filtreNumerique', 'Le filtre sur « {colonne} » exige une valeur numérique.'),
  g('filtreDate', 'Le filtre sur « {colonne} » exige une date valide (AAAA-MM-JJ).'),
  // combinaisons-admin.ts, jointures.ts
  g('reessayerEnregistrement', 'Réessayez l’enregistrement.'),
  g('jeuCombineIntrouvable', 'Ce jeu combiné est introuvable.'),
  ...listee('jeuCombineUtilise', 'Ce jeu combiné est utilisé par ', '. Supprimez d’abord ces jeux combinés.'),
  g('jeuCombineModifie', 'Ce jeu a été modifié depuis son ouverture. Rouvrez-le pour reprendre vos changements.'),
  g('jeuxSourceFixes', 'Les deux jeux source sont fixés lors de la création de la combinaison.'),
  g('colonneUtiliseeParJeu', 'La colonne « {colonne} » est utilisée par « {titre} ». Conservez-la pour enregistrer.'),
  g('colonneUtiliseeCatalogue', 'La colonne « {colonne} » est utilisée par le catalogue métier. Mettez le catalogue à jour avant de la remplacer.'),
  g('colonneUtiliseeDroits', 'La colonne « {colonne} » est utilisée par les droits d’accès. Mettez ces droits à jour avant de la remplacer.'),
  g('deuxJeuxDifferents', 'Sélectionnez deux jeux de données différents et disponibles.'),
  g('plusHuitImports', 'Cette combinaison utilise plus de huit imports.'),
  g('colonneIntrouvableJeu', 'Une colonne sélectionnée est introuvable dans son jeu.'),
  g('typesIncompatibles', 'Les colonnes de chaque liaison doivent avoir des types compatibles.'),
  g('liaisonRepetee', 'Une liaison est répétée.'),
  g('colonneDoublon', 'Une colonne a été sélectionnée deux fois.'),
  // droits-admin.ts, espaces.ts
  g('groupeNomExistant', 'Un groupe porte déjà ce nom.'),
  g('groupeIntrouvable', 'Ce groupe est introuvable.'),
  g('membresIndisponibles', 'Rechargez la page. Certains membres sont indisponibles.'),
  g('jeuIntrouvable', 'Ce jeu est introuvable.'),
  g('colonneSelectionIndisponible', 'Une colonne sélectionnée est indisponible.'),
  g('groupeSelectionIndisponible', 'Un groupe sélectionné est indisponible.'),
  g('garderColonneVisible', 'Conservez au moins une colonne visible.'),
  g('espaceNomExistant', 'Un espace porte déjà ce nom.'),
  g('jeuSelectionIndisponible', 'Un jeu sélectionné est indisponible.'),
  g('retirerJeuEspace', 'Retirez d’abord le jeu de son espace actuel.'),
  g('espaceChange', 'L’espace a changé. Rechargez la page.'),
  // hotes-sources.ts
  g('hoteRefuse', 'Hôte non autorisé ou introuvable.'),
  // incremental.ts
  g('incrementalConfiguration', 'Configurez la lecture incrémentale sur un import PostgreSQL administré.'),
  g('incrementalCles', 'Sélectionnez des clés stables et une colonne de modification distincte.'),
  g('incrementalDateType', 'La date de modification doit être un horodatage PostgreSQL.'),
  g('incrementalCleVide', 'Une ligne possède une clé incrémentale vide.'),
  g('volumeMaxSynchro', 'Volume maximal de synchronisation dépassé.'),
  g('incrementalDateAbsente', 'Une date de modification est absente ou invalide.'),
  g('incrementalCleDupliquee', 'Une clé incrémentale apparaît plusieurs fois.'),
  // postgres.ts, lecture-seule.ts (ErreurDonnees remontées par previsualiserCombinaison)
  g('lectureIndisponible', 'Connexion PostgreSQL de lecture indisponible.'),
  g('compteLectureDedie', 'Configurez un compte PostgreSQL de lecture dédié.'),
  g('premiereSynchro', 'Ce jeu attend sa première synchronisation.'),
  // qualite-admin.ts, qualite.ts
  g('versionInvalide', 'Version de préparation invalide.'),
  g('importIndisponible', 'Cet import est indisponible.'),
  g('preparationChangee', 'La préparation a changé. Rechargez l’import avant de réessayer.'),
  g('valeurNumeriqueTypee', 'Saisissez une valeur numérique du type de la colonne.'),
  g('valeurNumeriqueFinie', 'Saisissez une valeur numérique finie.'),
  g('dateValide', 'Saisissez une date valide (AAAA-MM-JJ).'),
  g('memeType', 'Les valeurs comparées doivent avoir le même type.'),
  g('filtresInvalides', 'Vérifiez les filtres, les normalisations et les contrôles.'),
  g('valeurFiltre', 'Renseignez la valeur du filtre.'),
  g('normalisationsTexte', 'Les normalisations s’appliquent aux colonnes de texte.'),
  g('controleColonneUnique', 'Sélectionnez chaque colonne une seule fois dans un contrôle.'),
  g('plageType', 'Une plage exige une colonne numérique ou une date.'),
  g('borneRequise', 'Renseignez au moins une borne.'),
  g('bornesInversees', 'La borne minimale dépasse la borne maximale.'),
  // qualite.ts : messagesExecution (affichés par la page de qualité)
  g('execVolume', 'Le volume dépasse la limite de cet import.'),
  g('execSchema', 'Une table, une colonne ou un type ne correspond plus à la définition de l’import.'),
  g('execSource', 'La source ne répond pas ou le compte de lecture ne dispose plus des accès nécessaires.'),
  g('execNonNul', 'Une valeur obligatoire est absente.'),
  g('execUnique', 'Une clé se répète dans les données préparées.'),
  g('execPlage', 'Une valeur est hors des bornes autorisées.'),
  g('execIncrementalCle', 'Une clé de synchronisation est vide ou dupliquée.'),
  g('execIncrementalDate', 'Un horodatage de modification est absent ou invalide.'),
  g('execConfiguration', 'La définition de préparation est incompatible avec les colonnes de cet import.'),
  // sources-admin.ts
  g('sourceIntrouvable', 'Source introuvable.'),
  g('sourceFichierIntrouvable', 'Source fichier introuvable.'),
  g('fichierIntrouvable', 'Fichier introuvable.'),
  g('colonneInaccessible', 'Une colonne sélectionnée n’est plus accessible.'),
  g('nomJeuUtilise', 'Ce nom de jeu est déjà utilisé. Réessayez.'),
  g('importIntrouvable', 'Import introuvable.'),
  g('champsFormulaire', 'Vérifiez les champs du formulaire.'),
  g('secretRequis', 'Ressaisissez le mot de passe ou le jeton : il n’est jamais réutilisé quand la destination de la connexion change.'),
  g('echecTest', 'La connexion avec ces paramètres a échoué. Rien n’a été modifié.'),
  ...listee('sourceUtilisee', 'Cette source est utilisée par ', '. Supprimez d’abord ces imports.'),
  ...listee('importUtilise', 'Cet import est utilisé par ', '. Supprimez d’abord ces jeux combinés.'),
]

export function trouverMotifErreurLib(message: string): MotifErreurLib | null {
  for (const { cle, motif, params } of MOTIFS) {
    if (typeof motif === 'string') {
      if (message === motif) return { cle }
      continue
    }
    const m = motif.exec(message)
    if (!m) continue
    return { cle, params: Object.fromEntries((params ?? []).map((nom, i) => [nom, m[i + 1]])) }
  }
  return null
}

/**
 * Message d'erreur de lib rendu dans la langue courante. Message inconnu : brut en français
 * (comportement historique), message générique traduit dans les autres langues.
 */
export async function messageErreurLib(message: string): Promise<string> {
  const [t, locale] = await Promise.all([getTranslations('sources.erreursLib'), getLocale()])
  const motif = trouverMotifErreurLib(message)
  if (motif) return t(motif.cle as never, motif.params as never)
  return locale === 'fr' ? message : t('generique')
}
