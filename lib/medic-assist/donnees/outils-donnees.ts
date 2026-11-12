/**
 * Outils de données de Medic Assist branchés sur le moteur (lot 2) : `catalogue_donnees`,
 * `interroger_donnees`, `requete_sql`, lecture et export d'un jeu, enregistrement d'un jeu.
 *
 * Les signatures sont celles des souches de `outils.ts` ; le chef de lot assemble
 * `outils-impl.ts` avec les autres fonctions (recherche d'entités, résumé mensuel, briefing).
 *
 * Ces fonctions lèvent `ErreurDonnees` (message écrit pour le modèle) ; `versErreurOutil`
 * (erreurs-outils.ts) la traduit en code d'erreur d'outil. Le périmètre vient de
 * `contexte.scope`, jamais de l'entrée.
 */

import {
  LIMITES,
  type ChampCatalogue,
  type ContexteExecution,
  type DescriptionJeu,
  type EntreeCatalogueDonnees,
  type EntreeInterrogerDonnees,
  type EntreeRequeteSql,
  type FiltreCatalogue,
  type Granularite,
  type JeuPagineDto,
  type ResultatJeu,
  type TypeFiltreCatalogue,
} from '@/lib/medic-assist/contrats'
import { libelleDe, REGLES } from './catalogue/communs'
import { catalogueDonnees as catalogueDuMoteur, type DetailJeuCatalogue } from './catalogue/index'
import { registreAutorise } from './catalogue/autorisation'
import { calculerSemantique } from './moteur/calculer'
import { ErreurDonnees } from './types'
import { aplatirRequete } from './requete-interne'
import { calculerSql } from './sql/calcul'
import { enregistrerJeu } from './jeux-de-donnees/enregistrer'
import {
  lignesCompletesPourExport as lignesCompletes,
  lireJeu as lireJeuStocke,
} from './jeux-de-donnees/lire'
import {
  RequetePieceJointeSchema,
  type DonneesJeuAEnregistrer,
  type JeuCompletPourExport,
  type OptionsLireJeu,
  type OptionsViaArtefact,
} from './jeux-de-donnees/types'

export type { DonneesJeuAEnregistrer, JeuCompletPourExport, OptionsLireJeu, OptionsViaArtefact }

// ---------------------------------------------------------------------------
// catalogue_donnees
// ---------------------------------------------------------------------------

/** Clés des filtres fixes de `FiltresRequete` : tout autre filtre va dans `filtres.autres`. */
const TYPES_FILTRE: Record<DetailJeuCatalogue['filtres'][number]['type'], TypeFiltreCatalogue> = {
  ids: 'ids',
  texte: 'texte',
  liste: 'statuts',
  nombre: 'nombre',
  booleen: 'booleen',
  // Une date se saisit en texte AAAA-MM-JJ : le contrat n'a pas de type « date » de filtre.
  date: 'texte',
  periode: 'periode',
}

function versChamp(c: {
  cle: string
  libelle: string
  definition: string
  type: ChampCatalogue['type']
  unite?: string
}): ChampCatalogue {
  return {
    cle: c.cle,
    libelle: c.libelle,
    type: c.type,
    ...(c.unite ? { unite: c.unite } : {}),
    definition: c.definition,
  }
}

function versFiltre(f: DetailJeuCatalogue['filtres'][number]): FiltreCatalogue {
  return {
    cle: f.cle,
    libelle: f.libelle,
    type: TYPES_FILTRE[f.type] ?? 'texte',
    autre: f.type !== 'periode',
    ...(f.valeursPossibles
      ? { valeurs: f.valeursPossibles.map(v => ({ valeur: v, libelle: v })) }
      : {}),
    description: f.definition,
  }
}

/** Mappe le détail d'un jeu du catalogue vers le contrat `DescriptionJeu`. */
export function versDescriptionJeu(
  detail: DetailJeuCatalogue,
  contexte: Pick<ContexteExecution, 'locale'>
): DescriptionJeu {
  const periodeParDefaut = detail.temps
    ? detail.temps.defaut === 'dernier_mois_clos'
      ? libelleDe(REGLES.dernierMoisClos, contexte.locale)
      : PERIODE_TOUTES[contexte.locale] || PERIODE_TOUTES.fr
    : undefined
  return {
    cle: detail.cle,
    libelle: detail.libelle,
    description: detail.description,
    grain: detail.granularite,
    dimensions: detail.dimensions.map(versChamp),
    mesures: detail.mesures.map(versChamp),
    filtres: detail.filtres.map(versFiltre),
    granularites: (detail.temps?.granularites ?? []) as Granularite[],
    ...(periodeParDefaut ? { periodeParDefaut } : {}),
    regles: detail.regles,
    vueSql: detail.vueSql.nom,
  }
}

const PERIODE_TOUTES: Record<string, string> = {
  fr: 'Toutes les périodes',
  en: 'All periods',
  es: 'Todos los períodos',
  zh: '所有期间',
  ar: 'جميع الفترات',
  hi: 'सभी अवधियाँ',
}

/** Outil `catalogue_donnees` : jeu inconnu -> `ErreurDonnees('jeu_inconnu')`. */
export async function catalogueDonnees(
  contexte: ContexteExecution,
  entree: EntreeCatalogueDonnees
): Promise<DescriptionJeu> {
  const resultat = catalogueDuMoteur({ jeu: entree.jeu }, contexte, await registreAutorise(contexte))
  if (!('jeu' in resultat)) throw new ErreurDonnees('Indiquez une clé du catalogue.', 'jeu_inconnu')
  const { jeu } = resultat
  return versDescriptionJeu(jeu, contexte)
}

// ---------------------------------------------------------------------------
// interroger_donnees, requete_sql
// ---------------------------------------------------------------------------

/**
 * Outil `interroger_donnees`. La requête CONTRAT est aplatie pour le moteur, mais c'est elle
 * qui est stockée, pour être rejouée ensuite par la même voie.
 */
export async function interrogerDonnees(
  contexte: ContexteExecution,
  entree: EntreeInterrogerDonnees
): Promise<ResultatJeu> {
  const calcule = await calculerSemantique(aplatirRequete(entree), contexte, {
    limiteLignes: LIMITES.lignesMaxStockees,
  })
  return enregistrerJeu(contexte, {
    source: 'semantique',
    requete: entree,
    colonnes: calcule.colonnes,
    lignes: calcule.lignes,
    tronque: calcule.tronque,
    totaux: calcule.totaux ?? null,
    provenance: calcule.provenance,
    empreinteSource: calcule.empreinteSource,
    colonnesNonAdditives: calcule.colonnesNonAdditives,
  })
}

/** Outil `requete_sql`. Le `ResultatJeu` du modèle n'a jamais `provenance.sql`. */
export async function requeteSql(
  contexte: ContexteExecution,
  entree: EntreeRequeteSql
): Promise<ResultatJeu> {
  const calcule = await calculerSql({ sql: entree.sql, objectif: entree.objectif }, contexte, {
    limiteLignes: LIMITES.lignesMaxStockees,
  })
  return enregistrerJeu(contexte, {
    source: 'sql',
    requete: { type: 'sql', sql: entree.sql, objectif: entree.objectif },
    colonnes: calcule.colonnes,
    lignes: calcule.lignes,
    tronque: calcule.tronque,
    provenance: calcule.provenance,
    empreinteSource: calcule.empreinteSource,
    colonnesNonAdditives: calcule.colonnesNonAdditives,
  })
}

// ---------------------------------------------------------------------------
// Jeux stockés
// ---------------------------------------------------------------------------

/** Lit un jeu par id, paginé (propriétaire, partage, épingle ou conversation partagée). */
export function lireJeu(
  id: string,
  contexte: ContexteExecution,
  options?: OptionsLireJeu
): Promise<JeuPagineDto> {
  return lireJeuStocke(id, contexte, options)
}

/** Rejoue un jeu pour un export, dans le périmètre du lecteur. */
export function lignesCompletesPourExport(
  id: string,
  contexte: ContexteExecution,
  options?: OptionsViaArtefact
): Promise<JeuCompletPourExport> {
  return lignesCompletes(id, contexte, options)
}

/** Range des lignes déjà calculées (pièce jointe surtout) ; jamais rejouable pour `piece_jointe`. */
export async function enregistrerJeuDeDonnees(
  contexte: ContexteExecution,
  donnees: DonneesJeuAEnregistrer
): Promise<ResultatJeu> {
  let requete = donnees.requete
  if (donnees.source === 'piece_jointe') {
    const verifiee = RequetePieceJointeSchema.safeParse(requete)
    if (!verifiee.success) {
      throw new ErreurDonnees(
        'Référence de pièce jointe invalide : pieceJointeId et feuille sont obligatoires (plage facultative).',
        'requete_invalide'
      )
    }
    requete = verifiee.data
  }
  return enregistrerJeu(contexte, {
    source: donnees.source,
    requete,
    colonnes: donnees.colonnes,
    lignes: donnees.lignes,
    provenance: donnees.provenance,
  })
}
