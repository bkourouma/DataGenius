/**
 * Mise en conformite Excel 2007 d'un classeur produit par ExcelJS.
 *
 * ExcelJS ecrit les proprietes de police dans son propre ordre (`color` et
 * `scheme` avant `sz`, `name` en dernier). La norme autorise n'importe quel
 * ordre et Excel recent s'en accommode, mais Excel 2007 exige une sequence
 * fixe (MS-OE376, element `font`) et refuse le fichier sinon. On reordonne
 * donc les enfants de chaque `<font>` de `xl/styles.xml`, sans rien changer
 * d'autre au classeur.
 */

import JSZip from 'jszip';

const ORDRE_POLICE = [
  'b',
  'i',
  'strike',
  'condense',
  'extend',
  'outline',
  'shadow',
  'u',
  'vertAlign',
  'sz',
  'color',
  'name',
  'family',
  'charset',
  'scheme',
];

/** Reordonne les enfants d'un `<font>` ; le laisse tel quel s'il est inattendu. */
function reordonnerPolice(enfants: string): string {
  const balises = enfants.match(/<\w+\b[^>]*\/>/g) ?? [];
  // Un enfant non auto-fermant (ou du texte) : on ne sait pas le deplacer sans risque.
  if (balises.join('') !== enfants) return enfants;

  const rang = (balise: string) => {
    const nom = /^<(\w+)/.exec(balise)?.[1] ?? '';
    const index = ORDRE_POLICE.indexOf(nom);
    return index === -1 ? ORDRE_POLICE.length : index;
  };
  return [...balises].sort((a, b) => rang(a) - rang(b)).join('');
}

/** Reordonne les polices de styles.xml ; faux si rien n'est a changer. */
async function corrigerPolices(archive: JSZip): Promise<boolean> {
  const styles = archive.file('xl/styles.xml');
  if (!styles) return false;

  const xml = await styles.async('string');
  const corrige = xml.replace(
    /<font(\s[^>]*)?>([\s\S]*?)<\/font>/g,
    (_, attributs: string | undefined, enfants: string) =>
      `<font${attributs ?? ''}>${reordonnerPolice(enfants)}</font>`
  );
  if (corrige === xml) return false;

  archive.file('xl/styles.xml', corrige);
  return true;
}

export async function compatibiliserExcel2007(contenu: Buffer): Promise<Buffer> {
  const archive = await JSZip.loadAsync(contenu);
  if (!(await corrigerPolices(archive))) return contenu;
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Meme correctif dans le navigateur, ou Buffer n'existe pas. */
export async function compatibiliserExcel2007Octets(contenu: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const archive = await JSZip.loadAsync(contenu);
  if (!(await corrigerPolices(archive))) return contenu instanceof Uint8Array ? contenu : new Uint8Array(contenu);
  return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
