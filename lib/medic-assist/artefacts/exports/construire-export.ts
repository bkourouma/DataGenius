/**
 * Orchestrateur d'export : fonction serveur « pure » (sans requête HTTP), appelée par la
 * route d'export et, plus tard, par les e-mails et les rapports programmés (lot 5).
 *
 * Étapes : charger l'artefact (null : introuvable, sans distinguer le refus d'accès) ;
 * charger les jeux COMPLETS référencés, y compris ceux des artefacts cités par un document
 * (un niveau) ; refuser plus de 100 000 lignes ; préparer ; générer le format demandé.
 * Toute défaillance imprévue devient `ErreurExport('echec')` sans détail interne (la cause
 * technique reste dans `error.cause` pour la journalisation).
 */

import { artefactsReferences, jeuxReferences, type ContexteExecution } from '@/lib/medic-assist/contrats';
import { CODE_LIMITE_DEBIT_DONNEES } from '@/lib/medic-assist/donnees/limite-debit';
import { ErreurDonnees } from '@/lib/medic-assist/donnees/types';
import { dependancesParDefaut } from '../dependances';
import {
  ErreurExport,
  type ArtefactEnregistre,
  type DependancesArtefacts,
  type JeuComplet,
} from '../ports';
import { nomFichierExport } from './nom-fichier';
import { localePdf } from './polices';
import { jeuxDeLExport, preparerExport } from './preparer-export';
import { creerTraducteurServeur } from './traducteur-serveur';
import { FORMATS_EXPORT, TYPES_MIME, type FormatExport, type ResultatExport } from './types';

/** Plafond de lignes par jeu de données exporté (miroir de LIMITES.lignesMaxExport du lot 0). */
export const LIGNES_MAX_EXPORT = 100_000;

export interface OptionsExport {
  /** Version à exporter ; absente : la dernière. */
  version?: number;
  /** Nom affiché de la personne qui exporte (jamais son id) ; absent : non mentionné. */
  exportePar?: string;
  /** Dépendances (lecture de l'artefact et des jeux) ; par défaut, celles de la production. */
  deps?: DependancesArtefacts;
}

export function estFormatExport(valeur: unknown): valeur is FormatExport {
  return typeof valeur === 'string' && (FORMATS_EXPORT as readonly string[]).includes(valeur);
}

/**
 * Construit l'export d'un artefact dans le format demandé, pour le lecteur de `contexte`.
 * Lève `ErreurExport` : introuvable, format_non_supporte, jeu_indisponible, trop_de_lignes, echec.
 */
export async function construireExport(
  contexte: ContexteExecution,
  artefactId: string,
  format: FormatExport,
  options: OptionsExport = {}
): Promise<ResultatExport> {
  try {
    return await executer(contexte, artefactId, format, options);
  } catch (erreur) {
    if (erreur instanceof ErreurExport) throw erreur;
    if (erreur instanceof ErreurDonnees && erreur.code === CODE_LIMITE_DEBIT_DONNEES) {
      // Trop de rejeux : on garde le délai pour que la route réponde 429 + Retry-After.
      const limitee = new ErreurExport('limite_debit', undefined, erreur.reessayerDansMs);
      (limitee as { cause?: unknown }).cause = erreur;
      throw limitee;
    }
    const enrobee = new ErreurExport('echec');
    (enrobee as { cause?: unknown }).cause = erreur;
    throw enrobee;
  }
}

/**
 * Jeu -> propriétaire de l'artefact qui le référence, pour les seuls jeux d'un artefact qui
 * n'est pas celui du lecteur. Si le lecteur possède l'un des artefacts qui le référencent, le
 * jeu suit le chemin normal (absent de la table).
 */
function proprietairesDesJeux(
  artefacts: ArtefactEnregistre[],
  contexte: ContexteExecution
): Map<string, string> {
  const table = new Map<string, string>();
  const propres = new Set<string>();
  for (const a of artefacts) {
    for (const id of jeuxReferences(a.spec)) {
      if (a.userId === contexte.userId) propres.add(id);
      else if (!table.has(id)) table.set(id, a.userId);
    }
  }
  for (const id of propres) table.delete(id);
  return table;
}

async function executer(
  contexte: ContexteExecution,
  artefactId: string,
  format: FormatExport,
  options: OptionsExport
): Promise<ResultatExport> {
  if (!estFormatExport(format)) throw new ErreurExport('format_non_supporte');
  const deps = options.deps ?? dependancesParDefaut;
  const artefact = await deps.chargerArtefact(artefactId, contexte, options.version);
  if (!artefact) throw new ErreurExport('introuvable');

  // Un document est une mise en page : le csv (une seule table) n'a pas de sens.
  if (artefact.spec.type === 'document' && format === 'csv') {
    throw new ErreurExport('format_non_supporte');
  }

  const artefactsLies: Record<string, ArtefactEnregistre> = {};
  for (const id of artefactsReferences(artefact.spec)) {
    const lie = await deps.chargerArtefact(id, contexte);
    // Citation inaccessible : omise (le document reste exportable, sans révéler son existence).
    if (lie) artefactsLies[id] = lie;
  }

  // Propriétaire de l'artefact (principal ou cité) qui référence chaque jeu : un lecteur qui
  // n'est pas ce propriétaire lit le jeu « via l'artefact » (le lot 2 le rejoue dans son
  // périmètre). Valeur issue de l'artefact lu avec contrôle d'accès, jamais d'un client.
  const proprietaires = proprietairesDesJeux([artefact, ...Object.values(artefactsLies)], contexte);

  const jeux: Record<string, JeuComplet> = {};
  for (const id of jeuxDeLExport(artefact, artefactsLies)) {
    const proprietaireId = proprietaires.get(id);
    const jeu = proprietaireId
      ? await deps.chargerJeuComplet(id, contexte, { proprietaireId })
      : await deps.chargerJeuComplet(id, contexte);
    if (!jeu) throw new ErreurExport('jeu_indisponible');
    if (jeu.nbLignes > LIGNES_MAX_EXPORT || jeu.lignes.length > LIGNES_MAX_EXPORT) {
      throw new ErreurExport('trop_de_lignes');
    }
    jeux[id] = jeu;
  }

  // Le PDF n'embarque que Roboto (latin, grec, cyrillique) : pour zh, ar et hi, le texte de
  // chrome ET les formats de nombres et de dates sont en anglais. Les autres formats gardent
  // la langue réelle.
  const localeExport = format === 'pdf' ? localePdf(contexte.locale) : contexte.locale;
  const contexteExport =
    localeExport === contexte.locale ? contexte : { ...contexte, locale: localeExport };
  const { traduire, rtl } = await creerTraducteurServeur(localeExport);
  const exporteLe = contexte.maintenant;
  const prep = preparerExport({
    artefact,
    jeux,
    artefactsLies,
    contexte: contexteExport,
    traduire,
    rtl,
    exporteLe,
    exportePar: options.exportePar,
  });

  let buffer: Buffer;
  switch (format) {
    case 'xlsx':
      buffer = await (await import('./xlsx')).construireXlsx(prep);
      break;
    case 'csv':
      buffer = (await import('./csv')).construireCsv(prep);
      break;
    case 'pdf':
      buffer = await (await import('./pdf')).construirePdf(prep);
      break;
    case 'pptx':
      buffer = await (await import('./pptx')).construirePptx(prep);
      break;
  }

  return {
    buffer,
    nomFichier: nomFichierExport(
      artefact.titre,
      format,
      exporteLe,
      traduire('exports.fichierSansTitre')
    ),
    typeMime: TYPES_MIME[format],
  };
}
