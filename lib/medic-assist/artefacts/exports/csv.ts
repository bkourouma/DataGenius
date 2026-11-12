/**
 * Export CSV d'un artefact préparé : des données propres, prêtes pour Excel ou un script.
 *
 * - UTF-8 avec BOM (Excel reconnaît ainsi les accents, l'arabe, le chinois) ;
 * - séparateur `;`, fin de ligne CRLF (convention d'Excel en France) ;
 * - une cellule est entre guillemets si elle contient `;`, un guillemet, un retour à la
 *   ligne ou une espace de bord ; les guillemets y sont doublés ;
 * - en-têtes = libellés des colonnes ; AUCUNE ligne de titre ni de contexte ;
 * - ligne de totaux seulement si le tableau en demande une (première cellule = « Total ») ;
 * - nombres bruts, sans séparateur de milliers : VIRGULE décimale pour fr et es (Excel de
 *   ces langues lit alors un nombre), POINT pour en, zh, ar et hi. Les pourcentages
 *   restent en points (85 = 85 %), les montants en euros ;
 * - injection de formule : une cellule TEXTE qui commence par = + - @ tabulation ou retour
 *   chariot reçoit une apostrophe en préfixe. Les nombres (négatifs compris) ne sont
 *   jamais préfixés : ce sont des nombres, pas du texte.
 * - un artefact à plusieurs blocs : seul le premier bloc de données est exporté (le
 *   refus des documents se fait en amont, dans `construireExport`).
 */

import type { FormatColonne } from '@/lib/medic-assist/contrats';
import { estDecimalExact } from '@/lib/medic-assist/contrats/numerique';
import { enNombre, estFormatNumerique } from '../formats';
import type { ModeleTableau } from '../types-rendu';
import { tableauIndicateurs } from './tableau-indicateurs';
import type { ExportPrepare } from './types';

const BOM = '﻿';
const FIN_DE_LIGNE = '\r\n';
const LANGUES_VIRGULE = ['fr', 'es'];

/** Caractères qui font lire une cellule comme une formule dans un tableur. */
const DEBUT_FORMULE = /^[=+\-@\t\r]/;

/** Neutralise l'injection de formule d'une cellule texte. */
export function neutraliserFormule(texte: string): string {
  return DEBUT_FORMULE.test(texte) ? `'${texte}` : texte;
}

/** Entoure de guillemets si nécessaire (guillemets doublés). */
export function echapperCellule(texte: string): string {
  return /[;"\r\n]/.test(texte) || /^\s|\s$/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

function nombreTexte(n: number, virgule: boolean): string {
  // Jamais de notation exponentielle ni de séparateur de milliers. Arrondi à 15 chiffres
  // significatifs : 78506.51999999999 s'écrit 78506.52.
  const arrondi = Number(n.toPrecision(15));
  const brut = Number.isInteger(arrondi)
    ? arrondi.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
    : arrondi.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 15 });
  return virgule ? brut.replace('.', ',') : brut;
}

function cellule(valeur: unknown, format: FormatColonne | undefined, virgule: boolean): string {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  if (typeof valeur === 'number')
    return Number.isFinite(valeur) ? nombreTexte(valeur, virgule) : '';
  if (valeur instanceof Date) {
    return Number.isNaN(valeur.getTime()) ? '' : valeur.toISOString().slice(0, 10);
  }
  if (estFormatNumerique(format)) {
    if (estDecimalExact(valeur)) return virgule ? valeur.replace('.', ',') : valeur;
    const n = enNombre(valeur);
    if (n !== null) return nombreTexte(n, virgule);
  }
  if (typeof valeur === 'boolean') return valeur ? 'true' : 'false';
  return echapperCellule(neutraliserFormule(String(valeur)));
}

function ligne(cellules: string[]): string {
  return cellules.join(';');
}

/** Les en-têtes sont du texte comme les autres : mêmes protections. */
function entete(libelle: string): string {
  return echapperCellule(neutraliserFormule(libelle));
}

function lignesTableau(prep: ExportPrepare, modele: ModeleTableau, virgule: boolean): string[] {
  const sortie = [ligne(modele.colonnes.map(c => entete(c.libelle)))];
  for (const l of modele.lignes) {
    sortie.push(ligne(modele.colonnes.map(c => cellule(l[c.id], c.format, virgule))));
  }
  if (modele.totaux) {
    const totaux = modele.totaux;
    let indexLibelle = modele.colonnes.findIndex(c => c.type === 'dimension');
    if (indexLibelle < 0) indexLibelle = 0;
    sortie.push(
      ligne(
        modele.colonnes.map((c, i) =>
          i === indexLibelle
            ? echapperCellule(prep.traduire('exports.total'))
            : cellule(totaux[c.id], c.format, virgule)
        )
      )
    );
  }
  return sortie;
}

/** Construit le CSV (UTF-8 avec BOM) du premier bloc de données de l'artefact. */
export function construireCsv(prep: ExportPrepare): Buffer {
  const virgule = LANGUES_VIRGULE.includes(prep.locale);
  const bloc = prep.blocs.find(b => b.type !== 'texte');
  let lignes: string[] = [];

  if (bloc?.type === 'tableau' || bloc?.type === 'graphique') {
    lignes = lignesTableau(prep, bloc.modele, virgule);
  } else if (bloc?.type === 'indicateurs') {
    const t = tableauIndicateurs(bloc.indicateurs, prep.traduire);
    const ordre = Object.values(t.entetes);
    lignes = [ligne(ordre.map(entete))];
    for (const l of t.lignes) {
      lignes.push(ligne(ordre.map(libelle => cellule(l[libelle], t.formats[libelle], virgule))));
    }
  }

  return Buffer.from(
    BOM + lignes.join(FIN_DE_LIGNE) + (lignes.length > 0 ? FIN_DE_LIGNE : ''),
    'utf8'
  );
}
