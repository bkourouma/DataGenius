import { randomBytes } from 'crypto';
import { join, resolve, sep } from 'path';
import { existsSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';

import { PREFIXE_URL_DOCUMENTS } from './lien-document';

export { PREFIXE_URL_DOCUMENTS };

export interface FileUploadResult {
  url: string;
  filename: string;
  size: number;
  type: string;
  uploadedAt: string;
}

/**
 * Extensions acceptees et type MIME servi pour chacune.
 *
 * C'est une liste BLANCHE, et le type vient de l'extension, jamais du client :
 * l'ancienne liste noire laissait passer .html, .htm et .svg, et le type MIME
 * declare par le navigateur suffisait (un x.svg annonce « image/png » etait
 * ecrit dans public/ et servi tel quel).
 */
export const EXTENSIONS_AUTORISEES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** Premiers octets attendus pour chaque famille de format binaire. */
const SIGNATURE_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SIGNATURE_JPEG = [0xff, 0xd8, 0xff];
const SIGNATURE_ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx, xlsx, pptx
const SIGNATURE_OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc, xls, ppt

const SIGNATURES: Readonly<Record<string, number[]>> = {
  pdf: SIGNATURE_PDF,
  png: SIGNATURE_PNG,
  jpg: SIGNATURE_JPEG,
  jpeg: SIGNATURE_JPEG,
  docx: SIGNATURE_ZIP,
  xlsx: SIGNATURE_ZIP,
  pptx: SIGNATURE_ZIP,
  doc: SIGNATURE_OLE,
  xls: SIGNATURE_OLE,
  ppt: SIGNATURE_OLE,
};

/** Seuls caracteres admis dans un nom de fichier stocke. */
const NOM_STOCKE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/** Fichier refuse a la validation : les routes le traduisent en 400. */
export class FichierRefuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FichierRefuseError';
  }
}

function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.');
  return point >= 0 ? nom.slice(point + 1).toLowerCase() : '';
}

function commencePar(octets: Uint8Array, signature: number[]): boolean {
  if (octets.length < signature.length) return false;
  return signature.every((octet, i) => octets[i] === octet);
}

/**
 * Chemin de `nom` dans `dossier`, ou null s'il en sortirait. Double garde : le
 * nom est deja restreint a NOM_STOCKE, mais on verifie le chemin resolu.
 */
function cheminDans(dossier: string, nom: string): string | null {
  if (!NOM_STOCKE.test(nom) || nom.includes('..')) return null;
  const base = resolve(dossier);
  const chemin = resolve(base, nom);
  return chemin.startsWith(base + sep) ? chemin : null;
}

export class FileUploadService {
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * Dossier ou sont ecrits les nouveaux documents.
   *
   * Hors de public/ : avec `output: 'standalone'`, un fichier ajoute a public/
   * apres le build n'est pas servi, et il disparait au deploiement suivant
   * (nouvelle release, nouveau dossier). En production, UPLOAD_DIR designe un
   * dossier partage entre releases (C:\medicpro\shared\uploads) ; sans elle, on
   * ecrit sous ./storage/uploads, ignore par git et jamais servi directement.
   * Lu a chaque appel pour que les tests puissent le rediriger.
   */
  static repertoireDepot(): string {
    const configure = process.env.UPLOAD_DIR?.trim();
    const racine = configure ? resolve(configure) : join(process.cwd(), 'storage', 'uploads');
    return join(racine, 'documents');
  }

  /**
   * Ancien emplacement, sous public/. Les fichiers deja references en base y
   * sont encore lus, pour que les liens existants continuent de marcher.
   */
  static repertoireHistorique(): string {
    return join(process.cwd(), 'public', 'uploads', 'documents');
  }

  /**
   * Controles qui ne demandent pas de lire le contenu : taille, nom, extension.
   * Le type MIME annonce par le client est ignore.
   */
  static validateFile(file: File): { valid: boolean; error?: string } {
    if (file.size > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds ${this.MAX_FILE_SIZE / (1024 * 1024)}MB limit`,
      };
    }

    if (file.size === 0) {
      return { valid: false, error: 'Empty file' };
    }

    const filename = file.name;
    if (
      !filename ||
      filename.length > 255 ||
      filename.includes('..') ||
      filename.includes('/') ||
      filename.includes('\\') ||
      // Caracteres de controle, NUL compris.
      /[\x00-\x1f\x7f]/.test(filename)
    ) {
      return { valid: false, error: 'Invalid filename' };
    }

    if (!EXTENSIONS_AUTORISEES[extensionDe(filename)]) {
      return {
        valid: false,
        error: 'Invalid file type. Allowed types: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, CSV, TXT, PNG, JPG',
      };
    }

    return { valid: true };
  }

  /**
   * Verifie que le contenu correspond a l'extension : signature des premiers
   * octets pour les formats binaires, absence d'octet NUL pour le texte.
   */
  static validateContent(filename: string, octets: Uint8Array): { valid: boolean; error?: string } {
    const extension = extensionDe(filename);
    if (!EXTENSIONS_AUTORISEES[extension]) {
      return { valid: false, error: 'Invalid file type' };
    }

    const signature = SIGNATURES[extension];
    if (signature) {
      return commencePar(octets, signature)
        ? { valid: true }
        : { valid: false, error: 'File content does not match its extension' };
    }

    // csv, txt : du texte, donc pas d'octet NUL au debut du fichier.
    const debut = octets.subarray(0, 8192);
    return debut.includes(0)
      ? { valid: false, error: 'File content does not match its extension' }
      : { valid: true };
  }

  /**
   * Nom stocke : horodatage, alea (deux depots dans la meme milliseconde ne
   * s'ecrasent pas), nom d'origine reduit a [A-Za-z0-9._-], extension en
   * minuscules.
   */
  static generateUniqueFilename(originalName: string): string {
    const extension = extensionDe(originalName);
    const sansExtension = extension ? originalName.slice(0, -(extension.length + 1)) : originalName;
    const base =
      sansExtension
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '')
        .slice(0, 100) || 'document';
    const alea = randomBytes(4).toString('hex');
    return `${Date.now()}_${alea}_${base}${extension ? `.${extension}` : ''}`;
  }

  /**
   * Valide, puis ecrit le fichier dans le dossier de depot et rend son adresse.
   * Leve FichierRefuseError si le fichier est refuse.
   */
  static async saveFile(file: File): Promise<FileUploadResult> {
    const controle = this.validateFile(file);
    if (!controle.valid) {
      throw new FichierRefuseError(controle.error ?? 'Invalid file');
    }

    const contenu = Buffer.from(await file.arrayBuffer());
    const controleContenu = this.validateContent(file.name, contenu);
    if (!controleContenu.valid) {
      throw new FichierRefuseError(controleContenu.error ?? 'Invalid file');
    }

    const dossier = this.repertoireDepot();
    await mkdir(dossier, { recursive: true });

    const filename = this.generateUniqueFilename(file.name);
    const chemin = cheminDans(dossier, filename);
    if (!chemin) {
      throw new FichierRefuseError('Invalid filename');
    }
    await writeFile(chemin, contenu);

    return {
      url: this.getFileUrl(filename),
      filename,
      size: file.size,
      type: this.contentTypeFor(filename),
      uploadedAt: new Date().toISOString(),
    };
  }

  /**
   * Lit un document stocke : d'abord le dossier de depot, puis l'ancien
   * emplacement sous public/. Rend null si le nom est invalide ou introuvable.
   */
  static async readFile(filename: string): Promise<Buffer | null> {
    for (const dossier of [this.repertoireDepot(), this.repertoireHistorique()]) {
      const chemin = cheminDans(dossier, filename);
      if (chemin && existsSync(chemin)) {
        return readFile(chemin);
      }
    }
    return null;
  }

  static async deleteFile(filename: string): Promise<void> {
    for (const dossier of [this.repertoireDepot(), this.repertoireHistorique()]) {
      try {
        const chemin = cheminDans(dossier, filename);
        if (chemin && existsSync(chemin)) {
          await unlink(chemin);
        }
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }
  }

  /** Type MIME servi pour un nom stocke, d'apres son extension uniquement. */
  static contentTypeFor(filename: string): string {
    return EXTENSIONS_AUTORISEES[extensionDe(filename)] ?? 'application/octet-stream';
  }

  /** Vrai si `filename` peut designer un document stocke. */
  static isStoredFilename(filename: string): boolean {
    return NOM_STOCKE.test(filename) && !filename.includes('..');
  }

  /** Nom stocke a partir d'une adresse /uploads/documents/<nom>, sinon null. */
  static filenameFromUrl(url: string | null | undefined): string | null {
    if (!url || !url.startsWith(PREFIXE_URL_DOCUMENTS)) return null;
    const nom = url.slice(PREFIXE_URL_DOCUMENTS.length);
    return this.isStoredFilename(nom) ? nom : null;
  }

  /**
   * Adresse enregistree en base. Elle ne change pas de forme : les nouveaux
   * fichiers comme les anciens sont servis par app/api/uploads/documents/[nom]
   * (reecriture dans next.config.js), avec controle de session et de pays,
   * sauf les anciens fichiers encore presents dans le public/ du build, que
   * Next sert avant la reecriture. Pour un lien, voir lienDocument().
   */
  static getFileUrl(filename: string): string {
    return `${PREFIXE_URL_DOCUMENTS}${filename}`;
  }
}
