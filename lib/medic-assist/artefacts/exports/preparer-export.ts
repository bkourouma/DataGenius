/**
 * Préparation d'un export : transforme un artefact enregistré et ses jeux de données
 * COMPLETS en `ExportPrepare`, le seul objet que lisent les générateurs (xlsx, csv, pdf,
 * pptx). Module pur et synchrone : aucun accès base, aucun fichier.
 *
 * - tableau : `construireModeleTableau` (filtres, tri, colonnes, pivot, totaux) ;
 * - graphique : ses données COMPLÈTES, mises en tableau, avec la spécification du graphique ;
 * - indicateurs : `resoudreIndicateurs` ;
 * - document : l'ordre de lecture des blocs ; un bloc `artefact` insère les blocs de
 *   l'artefact cité (un seul niveau : un document cité ne développe pas ses propres citations).
 */

import type { Agregat, ContenuTableau, ContexteExecution } from '@/lib/medic-assist/contrats';
import { jeuxReferences } from '@/lib/medic-assist/contrats';
import { resoudreIndicateurs } from '../indicateurs';
import { construireModeleTableau } from '../modele-tableau';
import type { ArtefactEnregistre, JeuComplet } from '../ports';
import type { JeuClient, Traducteur } from '../types-rendu';
import { ErreurExport } from '../ports';
import type { BlocExport, ExportPrepare } from './types';

export interface EntreePreparation {
  artefact: ArtefactEnregistre;
  /** Tous les jeux nécessaires, par `jeuDeDonneesId` (l'artefact et les artefacts cités). */
  jeux: Record<string, JeuComplet>;
  /** Artefacts cités par les blocs `artefact`, par id. */
  artefactsLies?: Record<string, ArtefactEnregistre>;
  contexte: ContexteExecution;
  traduire: Traducteur;
  rtl: boolean;
  exporteLe: Date;
  /** Nom affiché de la personne qui exporte. */
  exportePar?: string;
}

function jeuDe(jeux: Record<string, JeuComplet>, id: string): JeuClient {
  const jeu = jeux[id];
  if (!jeu) throw new ErreurExport('jeu_indisponible');
  return jeu;
}

function sansDoublon(valeurs: (string | undefined)[]): string[] {
  const vues: string[] = [];
  for (const v of valeurs) if (v && v.trim() !== '' && !vues.includes(v)) vues.push(v);
  return vues;
}

/** Blocs d'un artefact seul (hors citations). */
function blocsDe(
  artefact: ArtefactEnregistre,
  entree: EntreePreparation,
  citations: boolean
): BlocExport[] {
  const { jeux, traduire, contexte } = entree;
  const locale = contexte.locale;
  const libelleAgregat = (a: Agregat) => traduire(`exports.agregats.${a}`);
  const tableau = (jeu: JeuClient, spec: ContenuTableau) =>
    construireModeleTableau(jeu, spec, { locale, libelleAgregat });
  const spec = artefact.spec;

  switch (spec.type) {
    case 'tableau': {
      const jeu = jeuDe(jeux, spec.jeuDeDonneesId);
      return [
        {
          type: 'tableau',
          titre: spec.titre,
          sousTitre: spec.sousTitre,
          modele: tableau(jeu, spec),
        },
      ];
    }
    case 'graphique': {
      const jeu = jeuDe(jeux, spec.jeuDeDonneesId);
      return [
        {
          type: 'graphique',
          titre: spec.titre,
          sousTitre: spec.sousTitre,
          spec: spec.graphique,
          jeu,
          modele: tableau(jeu, { titre: spec.titre, jeuDeDonneesId: spec.jeuDeDonneesId }),
        },
      ];
    }
    case 'indicateurs':
      return [
        {
          type: 'indicateurs',
          titre: spec.titre,
          sousTitre: spec.sousTitre,
          indicateurs: resoudreIndicateurs(spec.cartes, jeux as Record<string, JeuClient>, locale),
        },
      ];
    case 'document': {
      const blocs: BlocExport[] = [];
      for (const bloc of spec.blocs) {
        if (bloc.type === 'texte') {
          blocs.push({ type: 'texte', markdown: bloc.markdown });
        } else if (bloc.type === 'tableau') {
          const jeu = jeuDe(jeux, bloc.spec.jeuDeDonneesId);
          blocs.push({
            type: 'tableau',
            titre: bloc.spec.titre,
            sousTitre: bloc.spec.sousTitre,
            modele: tableau(jeu, bloc.spec),
          });
        } else if (bloc.type === 'graphique') {
          const jeu = jeuDe(jeux, bloc.spec.jeuDeDonneesId);
          blocs.push({
            type: 'graphique',
            titre: bloc.spec.titre,
            sousTitre: bloc.spec.sousTitre,
            spec: bloc.spec.graphique,
            jeu,
            modele: tableau(jeu, {
              titre: bloc.spec.titre,
              jeuDeDonneesId: bloc.spec.jeuDeDonneesId,
            }),
          });
        } else if (citations) {
          const lie = entree.artefactsLies?.[bloc.artefactId];
          // Citation devenue inaccessible : omise, jamais d'erreur qui révélerait son existence.
          if (lie) blocs.push(...blocsDe(lie, entree, false));
        }
      }
      return blocs;
    }
  }
}

/** Ids des jeux d'un artefact et de ses artefacts cités, sans doublon, dans l'ordre de lecture. */
export function jeuxDeLExport(
  artefact: ArtefactEnregistre,
  artefactsLies: Record<string, ArtefactEnregistre> = {}
): string[] {
  const ids = [...jeuxReferences(artefact.spec)];
  for (const lie of Object.values(artefactsLies)) {
    for (const id of jeuxReferences(lie.spec)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Prépare l'export : blocs, provenances, bandeau de contexte. */
export function preparerExport(entree: EntreePreparation): ExportPrepare {
  const { artefact, jeux, traduire } = entree;
  const blocs = blocsDe(artefact, entree, true);

  const provenances = jeuxDeLExport(artefact, entree.artefactsLies)
    .map(id => jeux[id]?.provenance)
    .filter((p): p is NonNullable<typeof p> => !!p);

  const lignesContexte: string[] = [];
  const sources = sansDoublon(provenances.map(p => p.libelleSource));
  const periodes = sansDoublon(provenances.map(p => p.periode?.libelle));
  const perimetres = sansDoublon(provenances.map(p => p.perimetre?.libelle));
  if (sources.length > 0) {
    lignesContexte.push(traduire('exports.lignesContexte.source', { valeur: sources.join(', ') }));
  }
  if (periodes.length > 0) {
    lignesContexte.push(
      traduire('exports.lignesContexte.periode', { valeur: periodes.join(', ') })
    );
  }
  if (perimetres.length > 0) {
    lignesContexte.push(
      traduire('exports.lignesContexte.perimetre', { valeur: perimetres.join(', ') })
    );
  }

  return {
    titre: artefact.titre,
    sousTitre: artefact.sousTitre,
    locale: entree.contexte.locale,
    rtl: entree.rtl,
    traduire,
    blocs,
    provenances,
    lignesContexte,
    exporteLe: entree.exporteLe,
    exportePar: entree.exportePar,
  };
}
