import type {
  ColumnDef,
  ExpandedState,
  OnChangeFn,
  Row,
  RowData,
  SortingFn,
  SortingState,
  Table,
} from "@tanstack/react-table"

import type { FormatColonne } from "@/lib/client/export-utils"

/** Hauteur de ligne : l'utilisateur choisit entre voir beaucoup ou voir confortablement. */
export type GridDensity = "compact" | "normal" | "comfortable"

/**
 * Informations de presentation attachees a une colonne.
 *
 * TanStack Table transporte cet objet tel quel dans `column.columnDef.meta` ;
 * on l'utilise pour l'alignement, l'export et le menu des colonnes.
 */
export interface DataGridColumnMeta<TData> {
  /** Libelle lisible : menu des colonnes, en-tete d'export, vue mobile. */
  label?: string
  align?: "start" | "center" | "end"
  /** Colonne collee au bord pendant le defilement horizontal. */
  sticky?: "start" | "end"
  /**
   * Distance au bord, en pixels, d'une colonne collee. Indispensable des qu'on
   * en colle deux : la seconde doit commencer la ou la premiere s'arrete, sinon
   * elles se superposent.
   */
  stickyOffset?: number
  /** Masquee sous 768 px (la vue carte n'affiche que l'essentiel). */
  hideOnMobile?: boolean
  /**
   * Importance de la colonne sur petit ecran (< 768 px). Une colonne `'basse'`
   * est masquee PAR DEFAUT sur telephone, mais l'utilisateur peut la reafficher
   * depuis le menu « Colonnes » (son choix l'emporte et est memorise). C'est la
   * difference avec `hideOnMobile`, qui masque en CSS sans retour possible.
   * Sans effet sur grand ecran.
   */
  priorite?: "haute" | "basse"
  /**
   * Colonne qui sert de titre a la carte en vue `affichageMobile="cartes"`.
   * Par defaut : la premiere colonne visible qui n'est pas une colonne systeme.
   */
  carteTitre?: boolean
  /** Exclue du menu des colonnes et de l'export (cases a cocher, actions). */
  system?: boolean
  /** Valeur brute a exporter quand la cellule affiche un composant. */
  exportValue?: (row: TData) => unknown
  /**
   * Format Excel de la colonne exportee (texte, entier, montant, pourcentage,
   * date...). Sans cette indication, le format est deduit du libelle et des
   * valeurs de la colonne.
   */
  exportFormat?: FormatColonne
  /**
   * Colonne de taux de realisation : l'export Excel la colore selon les seuils
   * de la charte (rouge, orange, vert). A poser explicitement pour les langues
   * dont le libelle n'est pas reconnu (arabe, hindi, chinois). Jamais sur une
   * evolution ou une part.
   */
  exportSeuils?: boolean
  /** Classes appliquees aux cellules du corps. */
  cellClassName?: string
  /**
   * Colonne qui identifie une ligne (pays, grossiste, produit, date...). La
   * decocher dans le menu « Colonnes » cumule les lignes sur les dimensions
   * restantes, comme on retire un champ d'un pivot (voir `regroupement.ts`).
   */
  dimension?: boolean
  /**
   * Valeur de la colonne sur une ligne regroupee :
   * - `"somme"` : addition (quantites, montants, budgets) ;
   * - `"recalcul"` : l'`accessorFn` de la colonne est relu sur la ligne fusionnee,
   *   pour une valeur derivee de champs deja cumules (taux, ecart) ;
   * - une fonction : calculee a partir des lignes fusionnees.
   * Une colonne sans `dimension` ni `agregat` (prix unitaire, statut...) est
   * masquee tant que dure le regroupement : sa valeur n'y aurait pas de sens.
   */
  agregat?: DataGridAgregat<TData>
}

/** Calcul d'une mesure sur les lignes fusionnees par le regroupement. */
export type DataGridAgregat<TData> = "somme" | "recalcul" | ((lignes: TData[]) => unknown)

/** Un choix de filtre : une valeur de colonne, ou un groupe de valeurs. */
export interface DataGridFacetOption {
  value: string
  label: string
  /**
   * Valeurs de colonne couvertes par ce choix, quand il en regroupe plusieurs.
   * Sert aux colonnes dont le statut decrit un cycle de vie plutot qu'un
   * interrupteur : « en catalogue » couvre alors plusieurs etapes. Sans cette
   * liste, le choix filtre sur `value` seule.
   */
  matches?: string[]
}

/** Filtre a choix unique propose dans la barre d'outils. */
export interface DataGridFacet {
  /** `id` de la colonne filtree. */
  columnId: string
  label: string
  options: DataGridFacetOption[]
  /**
   * Valeur appliquee a l'ouverture de la grille. Sert a ne montrer que les
   * lignes actives par defaut : le filtre reste visible et se retire d'un clic,
   * les autres lignes ne sont donc jamais cachees pour de bon.
   */
  defaultValue?: string
}

export interface DataGridEmptyState {
  title?: string
  description?: string
  action?: React.ReactNode
}

/** Rendu des lignes sur petit ecran. */
export type DataGridAffichageMobile = "tableau" | "cartes"

export interface DataGridProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]

  /**
   * Identifiant de persistance des preferences (colonnes visibles, densite,
   * largeurs, taille de page). Deux grilles differentes doivent avoir des cles
   * differentes, sinon elles se marchent dessus.
   */
  storageKey?: string

  getRowId?: (row: TData, index: number) => string
  loading?: boolean
  /** Message d'erreur de chargement affiche a la place des lignes. */
  error?: string | null

  /** Recherche libre sur toutes les colonnes. `false` retire le champ. */
  enableSearch?: boolean
  searchPlaceholder?: string
  facets?: DataGridFacet[]

  enableSelection?: boolean
  /** Barre d'actions groupees, affichee des qu'une ligne est cochee. */
  renderBulkActions?: (rows: Row<TData>[], table: Table<TData>) => React.ReactNode

  enableColumnVisibility?: boolean
  enableDensity?: boolean
  /**
   * Tri par colonne. A mettre a `false` quand les lignes arrivent du serveur
   * par paquets : trier n'ordonnerait alors que les paquets recus, ce qui laisse
   * croire a un classement d'ensemble.
   */
  enableSorting?: boolean
  /**
   * Tri applique a l'ouverture de la grille, par exemple
   * `[{ id: 'nom', desc: false }]` pour ranger les lignes par libelle. C'est
   * aussi le tri auquel on revient quand l'utilisateur retire son tri (3e clic
   * sur l'en-tete, « Effacer le tri » en vue cartes) : la grille ne retombe
   * donc jamais sur l'ordre brut des donnees. Sans cette propriete, l'ordre
   * initial reste celui des donnees recues. Sans effet si `enableSorting` est `false`.
   */
  triInitial?: SortingState
  enableResizing?: boolean
  enableFullscreen?: boolean

  enableExport?: boolean
  /** Nom du fichier exporte, sans extension. */
  exportFileName?: string
  /**
   * Titre de la feuille Excel exportee. Sans lui, il est deduit de
   * `exportFileName` (« synthese-ventes-pays » devient « Synthese ventes pays »).
   */
  exportTitle?: string
  /** Sous-titre(s) de la feuille Excel (periode, perimetre, filtres...). */
  exportSubtitle?: string | string[]

  /**
   * Nombre de lignes sous le tableau (defaut `true`). La grille n'a pas de
   * pages : toutes les lignes defilent sous un en-tete colle.
   */
  afficherCompteur?: boolean
  /**
   * Nombre total de lignes cote serveur, pour une page qui les charge par
   * paquets : le compteur annonce alors « X sur Y lignes ».
   */
  totalLignes?: number
  /** Le serveur a encore des lignes a envoyer (chargement par paquets). */
  aUneSuite?: boolean
  /** Un paquet de lignes est en cours de chargement : indicateur au bas de la liste. */
  chargementSuite?: boolean
  /**
   * Appelee une fois par paquet quand l'utilisateur arrive au bas des lignes
   * chargees et que `aUneSuite` est vrai : la page ajoute alors le paquet suivant
   * a `data`, sans repasser par `loading` (sinon la liste remonterait en haut).
   */
  chargerSuite?: () => void

  /** Boutons propres a la page (creer, importer...), a droite de la barre d'outils. */
  toolbarActions?: React.ReactNode
  /** Identifiant d'un topic du guide : affiche un bouton « ? » dans la barre d'outils. */
  helpTopic?: string
  onRowClick?: (row: TData) => void
  /**
   * Classes ajoutees a une ligne selon son contenu (ligne modifiee, en alerte,
   * en retard...). Le fond choisi doit rester translucide, sinon il masquerait
   * le surlignage au survol et la couleur de selection.
   */
  getRowClassName?: (row: TData) => string | undefined
  emptyState?: DataGridEmptyState
  /** Ligne de totaux ou resume, collee sous le tableau. */
  renderFooter?: (table: Table<TData>) => React.ReactNode
  /**
   * Detail deplie sous une ligne. Quand cette fonction est fournie, la grille
   * ajoute d'elle-meme une colonne de chevrons pour ouvrir et refermer chaque
   * ligne. Utile pour un decoupage — la ventilation mensuelle d'un budget, les
   * erreurs d'une ligne d'import — qui n'a pas sa place dans une colonne.
   */
  renderExpandedRow?: (row: TData) => React.ReactNode
  /**
   * Lignes filles d'une ligne, pour une grille arborescente (pays, puis
   * grossistes, puis produits). La page dessine le chevron dans sa propre
   * colonne (`row.getCanExpand()`, `row.getToggleExpandedHandler()`,
   * `row.depth`). Le tri s'applique a chaque niveau sans melanger les branches,
   * et la recherche garde une ligne mere des qu'une de ses filles correspond.
   * L'export integre ne sort que les lignes du premier niveau.
   */
  getSubRows?: (row: TData, index: number) => TData[] | undefined
  /**
   * Lignes depliees, quand la page les pilote (« tout deplier »). Sans ces deux
   * proprietes, la grille garde cet etat pour elle.
   */
  expanded?: ExpandedState
  onExpandedChange?: OnChangeFn<ExpandedState>
  /**
   * Rendu sur petit ecran (< 768 px) : `'tableau'` (defaut) garde le tableau,
   * `'cartes'` empile une carte par ligne. Sans effet sur grand ecran.
   */
  affichageMobile?: DataGridAffichageMobile
  /**
   * Champs additionnes sur une ligne regroupee en plus des colonnes `"somme"` :
   * ceux qu'une colonne `"recalcul"`, une cellule ou un pied de colonne lit dans
   * `row.original` sans qu'une colonne `"somme"` les porte.
   */
  champsCumules?: string[]
  /**
   * Regroupement fait par le serveur, pour une grille qui ne recoit qu'une page :
   * la grille ne fusionne rien elle-meme (elle cumulerait la seule page) mais
   * annonce les dimensions affichees par `onRegroupementChange`, et la page
   * recharge des lignes deja cumulees.
   */
  regroupementServeur?: boolean
  /** Dimensions encore affichees quand l'utilisateur en decoche, `null` sans regroupement. */
  onRegroupementChange?: (dimensions: string[] | null) => void
  className?: string
  /** Hauteur maximale de la zone defilante ; au-dela l'en-tete reste colle. */
  maxHeight?: string
}

/**
 * TanStack Table laisse `ColumnMeta` vide : on la complete ici pour que les
 * pages ecrivent `meta: { label, align, ... }` avec l'aide du typage.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> extends DataGridColumnMeta<TData> {}

  /**
   * Tri par defaut des colonnes de la grille (voir `trierCellules`) : ignore
   * accents et casse pour le texte, compare nombres et dates par leur valeur,
   * range les valeurs vides en dernier. Une colonne qui declare son propre
   * `sortingFn` la remplace.
   */
  interface SortingFns {
    libelle: SortingFn<unknown>
  }
}
