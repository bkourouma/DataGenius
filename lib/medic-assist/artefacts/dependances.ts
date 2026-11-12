/**
 * Dependances par defaut des artefacts : lecture d'un artefact (stockage du lot 4) et de ses
 * jeux de donnees (lot 2). C'est le SEUL fichier du lot 4 qui appelle `lireJeu` et
 * `lignesCompletesPourExport` : tant que le lot 2 n'a pas livre, ces souches levent
 * « non implemente : lot 2 » et l'erreur remonte (elle n'est pas masquee).
 */

import { LIMITES, type ContexteExecution } from '@/lib/medic-assist/contrats';
import { lignesCompletesPourExport, lireJeu } from '@/lib/medic-assist/donnees/outils';

import type { DonneesJeuReponse } from './reponse';
import { ErreurArtefact, lireArtefact } from './stockage-impl';
import type { ArtefactEnregistre, DependancesArtefacts, JeuComplet, ViaArtefact } from './ports';

/** Garde-fou : 20 pages de 500 lignes couvrent déjà LIMITES.lignesMaxStockees. */
const PAGES_MAX = 40;

async function chargerArtefact(
  artefactId: string,
  contexte: ContexteExecution,
  version?: number
): Promise<ArtefactEnregistre | null> {
  try {
    const dto = await lireArtefact(
      contexte,
      artefactId,
      version === undefined ? undefined : { version }
    );
    const sousTitre = (dto.spec as { sousTitre?: string }).sousTitre;
    const creeLe = dto.versions.find(v => v.version === dto.version)?.creeA ?? dto.creeA;
    return {
      id: dto.id,
      racineId: dto.id,
      version: dto.version,
      type: dto.type,
      titre: dto.titre,
      ...(sousTitre ? { sousTitre } : {}),
      spec: dto.spec,
      conversationId: dto.conversationId ?? null,
      userId: dto.proprietaire.id,
      creeLe: new Date(creeLe),
    };
  } catch (erreur) {
    // Inexistant ou non accessible : même réponse, on ne révèle pas l'existence.
    if (
      erreur instanceof ErreurArtefact &&
      (erreur.code === 'introuvable' || erreur.code === 'interdit')
    ) {
      return null;
    }
    throw erreur;
  }
}

/** Erreur « jeu inconnu ou hors périmètre » du lot 2 (code porté par l'erreur). */
function jeuInaccessible(erreur: unknown): boolean {
  const code = (erreur as { code?: unknown } | null)?.code;
  return code === 'introuvable' || code === 'acces_refuse' || code === 'jeu_inconnu';
}

async function chargerJeuComplet(
  jeuId: string,
  contexte: ContexteExecution,
  viaArtefact?: ViaArtefact
): Promise<JeuComplet | null> {
  try {
    const jeu = viaArtefact
      ? await lignesCompletesPourExport(jeuId, contexte, {
          viaArtefact: { proprietaireId: viaArtefact.proprietaireId },
        })
      : await lignesCompletesPourExport(jeuId, contexte);
    const totaux = (jeu as { totaux?: Record<string, number> }).totaux;
    return {
      jeuDeDonneesId: jeuId,
      colonnes: jeu.colonnes,
      lignes: jeu.lignes,
      nbLignes: jeu.lignes.length,
      tronque: jeu.lignes.length >= LIMITES.lignesMaxExport,
      ...(totaux ? { totaux } : {}),
      provenance: jeu.provenance,
    };
  } catch (erreur) {
    if (jeuInaccessible(erreur)) return null;
    throw erreur;
  }
}

/**
 * Pagine `lireJeu` (pages de taillePageJeuMax) jusqu'à `total`, plafonné à
 * LIMITES.lignesMaxStockees. `recalculer` n'est demandé qu'à la première page : le recalcul
 * dans le périmètre du lecteur (non propriétaire) se fait une seule fois.
 */
async function chargerLignesPourAffichage(
  jeuId: string,
  contexte: ContexteExecution,
  options: { recalculer: boolean; viaArtefact?: ViaArtefact }
): Promise<DonneesJeuReponse | null> {
  const lignes: DonneesJeuReponse['lignes'] = [];
  let totaux: Record<string, number> | undefined;
  for (let page = 1; page <= PAGES_MAX; page++) {
    const lue = await lireJeu(jeuId, contexte, {
      recalculer: options.recalculer && page === 1,
      page,
      taille: LIMITES.taillePageJeuMax,
      ...(options.viaArtefact
        ? { viaArtefact: { proprietaireId: options.viaArtefact.proprietaireId } }
        : {}),
    });
    lignes.push(...lue.lignes);
    totaux ??= lue.totaux;
    const cible = Math.min(lue.total, LIMITES.lignesMaxStockees);
    if (lue.lignes.length === 0 || lignes.length >= cible) break;
  }
  return { lignes: lignes.slice(0, LIMITES.lignesMaxStockees), ...(totaux ? { totaux } : {}) };
}

export const dependancesParDefaut: DependancesArtefacts = {
  chargerArtefact,
  chargerJeuComplet,
  chargerLignesPourAffichage,
};
