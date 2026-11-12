/**
 * Constantes partagées de Medic Assist : limites, noms figés (outils, jeux,
 * notifications, paramètres) et modèles par défaut.
 *
 * Ce fichier n'importe rien : tous les autres contrats s'appuient sur lui, et il
 * reste chargeable côté client comme côté serveur.
 */

/**
 * Titre de repli d'une conversation sans titre : valeur TECHNIQUE, jamais un texte
 * d'interface. Le client la reconnaît et affiche à la place `medicAssist.conversation.sansTitre`.
 */
export const TITRE_PAR_DEFAUT_CONVERSATION = 'Nouvelle conversation'

/** Un mégaoctet, en octets. */
const MO = 1024 * 1024

/**
 * Garde-fous de l'architecture (§3), et quelques bornes choisies au lot 0 pour
 * fermer les schémas (signalées « choix lot 0 »). Un lot qui a besoin d'une autre
 * valeur la demande dans son rapport : on ne la redéfinit pas localement.
 */
export const LIMITES = {
  /** Corps d'une requête POST /api/medic-assist/chat. */
  tailleMaxRequeteChatOctets: 20 * MO,
  /** Une pièce jointe téléversée. */
  tailleMaxPieceJointeOctets: 10 * MO,
  /** Liste blanche des extensions de pièces jointes (minuscules, sans point). */
  extensionsPiecesJointes: ['xlsx', 'csv', 'pdf', 'txt'] as const,
  /** Pièces jointes rattachées à un même message (choix lot 0). */
  piecesJointesMaxParMessage: 5,
  /** Un enregistrement audio envoyé à POST /api/medic-assist/transcription (choix lot 0). */
  tailleMaxAudioOctets: 10 * MO,
  /** Étapes d'outils au plus par réponse, en mode standard (stopWhen). */
  etapesMaxStandard: 12,
  /** Étapes d'outils au plus par réponse, en analyse approfondie (stopWhen). */
  etapesMaxProfond: 30,
  /** Délai d'une requête SQL (SET LOCAL statement_timeout). */
  delaiSqlMs: 15_000,
  /** Lignes gardées en cache dans un jeu de données. */
  lignesMaxStockees: 10_000,
  /** Lignes au plus dans un export (recalcul complet). */
  lignesMaxExport: 100_000,
  /** Lignes d'aperçu renvoyées au modèle dans un ResultatJeu. */
  lignesApercu: 30,
  /** Questions de relance proposées après une réponse. */
  relancesMax: 3,
  /** Durée du cache du briefing d'accueil, par utilisateur. */
  dureeCacheBriefingMs: 15 * 60 * 1000,
  /** Horizon des visas qui expirent, dans le briefing. */
  joursExpirationVisasBriefing: 90,
  /** Délai du proxy IIS ARR : un flux de chat ne peut pas durer plus longtemps. */
  dureeMaxFluxSecondes: 300,
  /** Texte d'un message utilisateur, en caractères (choix lot 0). */
  longueurMaxMessageUtilisateur: 20_000,
  /** Titre d'une conversation, d'un artefact ou d'une carte (§4 : titre ≤ 120). */
  longueurMaxTitre: 120,
  /** Sous-titre d'un artefact (choix lot 0). */
  longueurMaxSousTitre: 200,
  /** Libellé court : colonne, série, carte d'indicateur, lien (choix lot 0). */
  longueurMaxLibelle: 80,
  /** Un bloc de texte markdown d'un document (choix lot 0). */
  longueurMaxMarkdown: 20_000,
  /** Message libre d'une action (e-mail, notification) (choix lot 0). */
  longueurMaxMessageAction: 2_000,
  /** Requête SQL écrite par le modèle, en caractères (choix lot 0). */
  longueurMaxSql: 20_000,
  /** Colonnes d'un tableau (choix lot 0). */
  colonnesMaxTableau: 50,
  /** Séries (mesures en ordonnée) d'un graphique (choix lot 0). */
  seriesMaxGraphique: 12,
  /** Cartes d'un artefact « indicateurs » (choix lot 0). */
  cartesMaxIndicateurs: 12,
  /** Blocs d'un artefact « document » (choix lot 0). */
  blocsMaxDocument: 40,
  /** Destinataires d'une action (e-mail, notification, rapport programmé) (choix lot 0). */
  destinatairesMax: 20,
  /** Identifiants dans un filtre de requête sémantique (choix lot 0). */
  idsMaxParFiltre: 200,
  /** Résultats renvoyés par rechercher_entites (choix lot 0). */
  resultatsMaxRecherche: 20,
  /** Taille de page par défaut de GET /api/medic-assist/jeux/[id]. */
  taillePageJeuDefaut: 100,
  /** Taille de page au plus de GET /api/medic-assist/jeux/[id] (choix lot 0). */
  taillePageJeuMax: 500,
  /** Taille de page des listes (conversations, analyses, avis) (choix lot 0). */
  taillePageListeDefaut: 50,
  taillePageListeMax: 200,
} as const

/**
 * Les onze outils de l'agent. Noms figés (§4) : ils sont persistés dans les
 * messages (parties `tool-<nom>`), ne jamais les renommer.
 */
export const NOMS_OUTILS = [
  'catalogue_donnees',
  'rechercher_entites',
  'interroger_donnees',
  'requete_sql',
  'resume_mensuel',
  'lire_piece_jointe',
  'creer_artefact',
  'modifier_artefact',
  'proposer_action',
  'proposer_relances',
  'preparer_alerte',
] as const
export type NomOutil = (typeof NOMS_OUTILS)[number]

/** Jeux métier du catalogue sémantique (§5). */
export const CLES_JEUX = [
  'ventes',
  'budget',
  'stocks',
  'rentabilite',
  'prix',
  'produits',
  'pays',
  'grossistes',
  'agences',
  'molecules',
  'procedures_amm',
  'visas',
  'mep',
  'info_pays',
  'ventes_concurrents',
  'taches',
] as const
export type CleJeu = string

/** Types d'entités que rechercher_entites sait retrouver (§4). */
export const TYPES_ENTITES = [
  'produit',
  'pays',
  'grossiste',
  'agence',
  'molecule',
  'laboratoire',
  'classe_therapeutique',
  'utilisateur',
] as const
export type TypeEntite = (typeof TYPES_ENTITES)[number]

/** Types d'artefacts (discriminant de ArtefactSpec). */
export const TYPES_ARTEFACT = ['tableau', 'graphique', 'indicateurs', 'document'] as const
export type TypeArtefact = (typeof TYPES_ARTEFACT)[number]

/** Types d'actions que l'assistant peut proposer (jamais exécuter seul). */
export const TYPES_ACTION = [
  'creer_tache',
  'envoyer_email',
  'notifier',
  'programmer_rapport',
] as const
export type TypeAction = (typeof TYPES_ACTION)[number]

/** Cycle de vie d'une action proposée. */
export const STATUTS_ACTION = ['proposee', 'executee', 'annulee', 'echec'] as const
export type StatutAction = (typeof STATUTS_ACTION)[number]

/** Formats d'export d'un artefact (GET /api/medic-assist/artefacts/[id]/export). */
export const FORMATS_EXPORT = ['xlsx', 'csv', 'pdf', 'pptx'] as const
export type FormatExport = (typeof FORMATS_EXPORT)[number]

/** Formats joints à un e-mail ou à un rapport programmé. */
export const FORMATS_ENVOI = ['xlsx', 'pdf', 'csv'] as const
export type FormatEnvoi = (typeof FORMATS_ENVOI)[number]

/** Nouveaux types du modèle Notification (channel 'in_app'), lus par la cloche. */
export const TYPES_NOTIFICATION = {
  partage: 'MEDIC_ASSIST_PARTAGE',
  rapport: 'MEDIC_ASSIST_RAPPORT',
  message: 'MEDIC_ASSIST_MESSAGE',
  tache: 'MEDIC_ASSIST_TACHE',
} as const
export type TypeNotificationMedicAssist =
  (typeof TYPES_NOTIFICATION)[keyof typeof TYPES_NOTIFICATION]

/** Clés de ParametreApplication (§2). */
export const CLES_PARAMETRES = {
  fournisseur: 'medic_assist.fournisseur',
  modeleStandard: 'medic_assist.modele.standard',
  modeleProfond: 'medic_assist.modele.profond',
  modeleRapide: 'medic_assist.modele.rapide',
  transcription: 'medic_assist.transcription',
} as const
export type CleParametreMedicAssist = (typeof CLES_PARAMETRES)[keyof typeof CLES_PARAMETRES]

/** Fournisseurs de modèles de langage pris en charge. */
export const FOURNISSEURS = ['anthropic', 'openai', 'google', 'deepseek'] as const
export type Fournisseur = (typeof FOURNISSEURS)[number]

/**
 * Variable d'environnement qui porte la clé de chaque fournisseur. Un fournisseur
 * est « disponible » quand sa variable est définie et non vide. Seul le NOM de la
 * variable figure ici : la valeur ne sort jamais du serveur.
 */
export const VARIABLES_CLES_FOURNISSEURS: Record<Fournisseur, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

/**
 * Modes d'appel d'un modèle :
 * - standard : la conversation courante ;
 * - profond : l'interrupteur « Analyse approfondie » (plus d'étapes, modèle plus fort) ;
 * - rapide : les tâches annexes (titre de conversation, relances) ;
 * - transcription : la dictée envoyée au serveur (n'est pas un modèle de langage).
 */
export const MODES = ['standard', 'profond', 'rapide', 'transcription'] as const
export type Mode = (typeof MODES)[number]

/** Modes servis par un modèle de langage (ceux qui ont une clé medic_assist.modele.*). */
export const MODES_LANGAGE = ['standard', 'profond', 'rapide'] as const
export type ModeLangage = (typeof MODES_LANGAGE)[number]

/** Clé de paramètre du modèle de chaque mode de langage. */
export const CLE_PARAMETRE_PAR_MODE: Record<ModeLangage, CleParametreMedicAssist> = {
  standard: CLES_PARAMETRES.modeleStandard,
  profond: CLES_PARAMETRES.modeleProfond,
  rapide: CLES_PARAMETRES.modeleRapide,
}

/** Fournisseur par défaut quand rien n'est configuré. */
export const FOURNISSEUR_PAR_DEFAUT: Fournisseur = 'anthropic'

/** Modèles Claude par défaut (§2), identifiants de l'API Anthropic. */
export const MODELES_CLAUDE_PAR_DEFAUT: Record<ModeLangage, string> = {
  standard: 'claude-sonnet-5-5',
  profond: 'claude-opus-5-5',
  rapide: 'claude-haiku-5-5',
}

/**
 * Modèles par défaut des autres fournisseurs : À CONFIRMER PAR LE LOT 1 dans la
 * documentation de chaque fournisseur (identifiants qui existent vraiment au moment
 * du déploiement). Tant qu'un mode vaut null, l'administrateur doit choisir le
 * modèle avant d'activer ce fournisseur : aucune valeur non vérifiée n'est posée ici.
 */
export const MODELES_PAR_DEFAUT_AUTRES: Record<
  Exclude<Fournisseur, 'anthropic'>,
  Record<ModeLangage, string | null>
> = {
  openai: { standard: null, profond: null, rapide: null },
  google: { standard: null, profond: null, rapide: null },
  deepseek: { standard: null, profond: null, rapide: null },
}

/**
 * Fournisseurs possibles pour la transcription serveur de la dictée : ceux dont le
 * paquet @ai-sdk/* installé expose `.transcription(modelId)` (vérifié au lot 0 :
 * @ai-sdk/openai 4.0.106, @ai-sdk/google 4.0.109 ; ni @ai-sdk/anthropic ni
 * @ai-sdk/deepseek). Le modèle reste au choix de l'administrateur (lot 6).
 */
export const FOURNISSEURS_TRANSCRIPTION = ['openai', 'google'] as const
export type FournisseurTranscription = (typeof FOURNISSEURS_TRANSCRIPTION)[number]

/** Intervalles d'un rapport programmé. */
export const FREQUENCES_RAPPORT = ['quotidien', 'hebdomadaire', 'mensuel'] as const
export type FrequenceRapport = (typeof FREQUENCES_RAPPORT)[number]

/** Valeur d'un avis sur une réponse (pouce haut / pouce bas). */
export const VALEURS_AVIS = ['positif', 'negatif'] as const
export type ValeurAvis = (typeof VALEURS_AVIS)[number]
