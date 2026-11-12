/**
 * Nom des fichiers exportés : « Titre AAAA-MM-JJ.ext », lisible, sans id.
 *
 * - caractères interdits sous Windows (`\ / : * ? " < > |`), contrôles et marques de
 *   direction Unicode retirés (ces dernières permettent de maquiller une extension) ;
 * - espaces normalisés, accents et écritures non latines CONSERVÉS ;
 * - titre limité à 100 caractères (points de code, pas d'unités UTF-16) ;
 * - noms réservés de Windows (CON, NUL, COM1…) suivis d'un tiret bas ;
 * - date au fuseau du serveur.
 */

import type { FormatExport } from './types';

export const LONGUEUR_MAX_TITRE = 100;

const RESERVES_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// eslint-disable-next-line no-control-regex
const INTERDITS = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function dateIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Titre nettoyé pour servir de nom de fichier ; `repli` si rien ne reste. */
export function titrePourFichier(titre: string, repli: string): string {
  const propre = String(titre ?? '')
    .replace(INTERDITS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let coupe = Array.from(propre).slice(0, LONGUEUR_MAX_TITRE).join('');
  // Pas de point ni d'espace en fin de nom (Windows les supprime).
  coupe = coupe.replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  if (!coupe)
    coupe =
      Array.from(repli.replace(INTERDITS, ' ').trim()).slice(0, LONGUEUR_MAX_TITRE).join('') ||
      'Export';
  if (RESERVES_WINDOWS.test(coupe)) coupe = `${coupe}_`;
  return coupe;
}

/**
 * Nom de fichier d'un export. `repli` (déjà traduit, clé `exports.fichierSansTitre`) sert
 * quand le titre est vide ou ne contient que des caractères interdits.
 */
export function nomFichierExport(
  titre: string,
  format: FormatExport,
  date: Date,
  repli = 'Export'
): string {
  return `${titrePourFichier(titre, repli)} ${dateIso(date)}.${format}`;
}

/**
 * Version ASCII pour `filename="…"` de Content-Disposition : accents retirés, le reste
 * remplacé par un tiret bas, guillemets et antislash exclus. L'ASCII ne porte jamais d'id.
 */
export function nomFichierAscii(nom: string): string {
  const ascii = nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\%;]/g, '_')
    .replace(/_{2,}/g, '_');
  // Si l'ASCII ne garde que l'extension et la date, le nom reste valable.
  return ascii.trim() || 'export';
}

/** Valeur complète de l'en-tête Content-Disposition (RFC 6266 et RFC 5987). */
export function enteteContentDisposition(nom: string): string {
  const encode = encodeURIComponent(nom).replace(
    /['()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${nomFichierAscii(nom)}"; filename*=UTF-8''${encode}`;
}
