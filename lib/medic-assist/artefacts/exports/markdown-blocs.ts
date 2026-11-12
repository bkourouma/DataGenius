/**
 * Markdown GFM restreint vers une structure neutre, consommée par les exports PDF et PPTX.
 *
 * Module pur, sans dépendance (pas de react-markdown) : un petit analyseur ligne à ligne.
 * Couvert : titres ATX (`#`…`######`) et Setext (`===`, `---`), paragraphes (sauts de ligne
 * doux joints par une espace, saut dur sur deux espaces ou `\` en fin de ligne), citations
 * (`>` : rendues comme des paragraphes), listes à puces et numérotées imbriquées, tableaux
 * GFM, blocs de code clôturés (texte brut), gras, italique, code en ligne, liens.
 *
 * Sécurité et sobriété :
 * - le HTML est ignoré : commentaires, `<script>` et `<style>` disparaissent avec leur
 *   contenu, les autres balises sont retirées (leur texte reste) ;
 * - les images (`![alt](src)`) sont retirées ;
 * - un lien n'est conservé que s'il est INTERNE (`/chemin`, `#ancre`) ; un lien externe
 *   (`http:`, `https:`, `mailto:`, `//hôte`, `javascript:`…) est neutralisé : son texte
 *   reste, la cible disparaît ;
 * - les lignes horizontales (`---`, `***`) sont ignorées.
 */

export interface Segment {
  texte: string;
  gras?: boolean;
  italique?: boolean;
  /** Code en ligne ou bloc de code (rendu tel quel). */
  code?: boolean;
  /** Cible d'un lien INTERNE (commence par `/` ou `#`). */
  lien?: string;
}

export interface ElementListe {
  segments: Segment[];
  /** Listes imbriquées sous cet élément. */
  sousListes: BlocListe[];
}

export interface BlocListe {
  type: 'liste';
  ordonnee: boolean;
  /** Premier numéro d'une liste numérotée (1 sinon). */
  debut: number;
  elements: ElementListe[];
}

export type AlignementColonne = 'start' | 'center' | 'end' | null;

export type BlocMarkdown =
  | { type: 'titre'; niveau: 1 | 2 | 3 | 4 | 5 | 6; segments: Segment[] }
  | { type: 'paragraphe'; segments: Segment[] }
  | BlocListe
  | {
      type: 'tableau';
      entetes: Segment[][];
      alignements: AlignementColonne[];
      /** Chaque ligne a exactement autant de cellules que d'en-têtes. */
      lignes: Segment[][][];
    };

export interface SectionMarkdown {
  /** Titre de la section (niveau 1 ou 2) ; absent pour le texte qui précède le premier titre. */
  titre?: Segment[];
  niveau?: number;
  blocs: BlocMarkdown[];
}

// ---------------------------------------------------------------------------
// Liens
// ---------------------------------------------------------------------------

/** Vrai pour un lien interne à l'application : `/chemin` (pas `//hôte`) ou `#ancre`. */
export function estLienInterne(cible: string): boolean {
  const c = cible.trim();
  if (c.startsWith('#')) return c.length > 1;
  if (!c.startsWith('/') || c.startsWith('//') || c.startsWith('/\\')) return false;
  // Aucun caractère de contrôle ni espace dans la cible.
  return !/[\s\u0000-\u001f]/.test(c);
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const RE_COMMENTAIRE = /<!--[\s\S]*?(?:-->|$)/g;
const RE_SCRIPT_STYLE =
  /<(script|style|iframe|object|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const RE_BALISE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;

/** Retire commentaires, blocs dangereux et balises ; le texte des autres balises reste. */
function sansHtml(texte: string): string {
  return texte.replace(RE_COMMENTAIRE, '').replace(RE_SCRIPT_STYLE, '').replace(RE_BALISE, '');
}

// ---------------------------------------------------------------------------
// En ligne
// ---------------------------------------------------------------------------

interface Style {
  gras?: boolean;
  italique?: boolean;
  lien?: string;
}

const PONCTUATION_ECHAPPABLE = '\\`*_{}[]()#+-.!|~<>"\'$&%,:;=?@^';

function estMot(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** Position de la fermeture `delim` à partir de `debut`, en sautant les échappements et le code. */
function chercherFermeture(texte: string, delim: string, debut: number): number {
  let i = debut;
  while (i < texte.length) {
    const c = texte[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      const fin = finCode(texte, i);
      if (fin > i) {
        i = fin;
        continue;
      }
    }
    if (texte.startsWith(delim, i)) {
      // Une fermeture simple ne doit pas être un morceau d'un délimiteur double.
      if (delim.length === 1 && texte[i + 1] === delim) {
        i += 2;
        continue;
      }
      if (delim[0] === '_' && estMot(texte[i + delim.length])) {
        i += delim.length;
        continue;
      }
      if (i > debut && texte[i - 1] !== ' ') return i;
    }
    i++;
  }
  return -1;
}

/** Fin (exclue) d'un code en ligne ouvert en `debut`, ou `debut` si non fermé. */
function finCode(texte: string, debut: number): number {
  let n = 0;
  while (texte[debut + n] === '`') n++;
  const marque = '`'.repeat(n);
  const fin = texte.indexOf(marque, debut + n);
  if (fin < 0) return debut;
  return fin + n;
}

/** Crochet fermant correspondant à `[` en `debut` (crochets imbriqués comptés), ou -1. */
function crochetFermant(texte: string, debut: number): number {
  let profondeur = 0;
  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') profondeur++;
    else if (c === ']') {
      profondeur--;
      if (profondeur === 0) return i;
    }
  }
  return -1;
}

/** Parenthèse fermante de la cible `(…)` ouverte en `debut`, ou -1. */
function parentheseFermante(texte: string, debut: number): number {
  let profondeur = 0;
  for (let i = debut; i < texte.length; i++) {
    const c = texte[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') profondeur++;
    else if (c === ')') {
      profondeur--;
      if (profondeur === 0) return i;
    }
  }
  return -1;
}

/** Cible d'un lien `(url "titre")` : l'url seule, sans les chevrons. */
function cibleLien(brut: string): string {
  let c = brut.trim();
  if (c.startsWith('<')) {
    const fin = c.indexOf('>');
    return fin > 0 ? c.slice(1, fin) : c.slice(1);
  }
  const espace = c.search(/\s/);
  if (espace > 0) c = c.slice(0, espace);
  return c;
}

function analyserEnLigne(texte: string, style: Style, sortie: Segment[]): void {
  let tampon = '';
  const vider = () => {
    if (tampon !== '') {
      ajouter(sortie, { texte: tampon, ...style });
      tampon = '';
    }
  };

  let i = 0;
  while (i < texte.length) {
    const c = texte[i];

    // Échappement : le caractère suivant est littéral.
    if (c === '\\' && i + 1 < texte.length && PONCTUATION_ECHAPPABLE.includes(texte[i + 1])) {
      tampon += texte[i + 1];
      i += 2;
      continue;
    }

    // Code en ligne.
    if (c === '`') {
      const fin = finCode(texte, i);
      if (fin > i) {
        let n = 0;
        while (texte[i + n] === '`') n++;
        vider();
        const contenu = texte.slice(i + n, fin - n).replace(/^ (.*) $/, '$1');
        if (contenu !== '') ajouter(sortie, { texte: contenu, ...style, code: true });
        i = fin;
        continue;
      }
    }

    // Image : retirée.
    if (c === '!' && texte[i + 1] === '[') {
      const ferme = crochetFermant(texte, i + 1);
      if (ferme > 0 && texte[ferme + 1] === '(') {
        const fin = parentheseFermante(texte, ferme + 1);
        if (fin > 0) {
          i = fin + 1;
          continue;
        }
      }
    }

    // Lien.
    if (c === '[') {
      const ferme = crochetFermant(texte, i);
      if (ferme > 0 && texte[ferme + 1] === '(') {
        const fin = parentheseFermante(texte, ferme + 1);
        if (fin > 0) {
          vider();
          const cible = cibleLien(texte.slice(ferme + 2, fin));
          const interne = estLienInterne(cible);
          const sousStyle: Style = { ...style };
          if (interne) sousStyle.lien = cible.trim();
          else delete sousStyle.lien;
          analyserEnLigne(texte.slice(i + 1, ferme), sousStyle, sortie);
          i = fin + 1;
          continue;
        }
      }
    }

    // Lien automatique `<https://…>` : texte seul (lien externe neutralisé).
    if (c === '<') {
      const m = /^<((?:https?|mailto|ftp):[^\s<>]+)>/i.exec(texte.slice(i));
      if (m) {
        tampon += m[1];
        i += m[0].length;
        continue;
      }
    }

    // Gras (et gras italique).
    if ((c === '*' || c === '_') && texte[i + 1] === c) {
      const triple = texte[i + 2] === c;
      const delim = triple ? c.repeat(3) : c.repeat(2);
      const ouvrable =
        texte[i + delim.length] !== undefined &&
        texte[i + delim.length] !== ' ' &&
        !(c === '_' && estMot(texte[i - 1]));
      if (ouvrable) {
        const fin = chercherFermeture(texte, delim, i + delim.length);
        if (fin > 0) {
          vider();
          analyserEnLigne(
            texte.slice(i + delim.length, fin),
            { ...style, gras: true, ...(triple ? { italique: true } : {}) },
            sortie
          );
          i = fin + delim.length;
          continue;
        }
      }
    }

    // Italique.
    if (c === '*' || c === '_') {
      const ouvrable =
        texte[i + 1] !== undefined &&
        texte[i + 1] !== ' ' &&
        texte[i + 1] !== c &&
        !(c === '_' && estMot(texte[i - 1]));
      if (ouvrable) {
        const fin = chercherFermeture(texte, c, i + 1);
        if (fin > 0) {
          vider();
          analyserEnLigne(texte.slice(i + 1, fin), { ...style, italique: true }, sortie);
          i = fin + 1;
          continue;
        }
      }
    }

    // Barré : le texte reste, sans style.
    if (c === '~' && texte[i + 1] === '~') {
      const fin = texte.indexOf('~~', i + 2);
      if (fin > i + 2) {
        vider();
        analyserEnLigne(texte.slice(i + 2, fin), style, sortie);
        i = fin + 2;
        continue;
      }
    }

    tampon += c;
    i++;
  }
  vider();
}

function memeStyle(a: Segment, b: Segment): boolean {
  return (
    !!a.gras === !!b.gras &&
    !!a.italique === !!b.italique &&
    !!a.code === !!b.code &&
    a.lien === b.lien
  );
}

function ajouter(sortie: Segment[], segment: Segment): void {
  const propre: Segment = { texte: segment.texte };
  if (segment.gras) propre.gras = true;
  if (segment.italique) propre.italique = true;
  if (segment.code) propre.code = true;
  if (segment.lien) propre.lien = segment.lien;
  const dernier = sortie[sortie.length - 1];
  if (dernier && memeStyle(dernier, propre)) dernier.texte += propre.texte;
  else sortie.push(propre);
}

/** Segments d'un texte en ligne (gras, italique, code, liens internes). */
export function segmentsEnLigne(texte: string): Segment[] {
  const sortie: Segment[] = [];
  analyserEnLigne(sansHtml(texte), {}, sortie);
  // Espaces multiples réduites, bords nettoyés (les sauts durs `\n` restent).
  for (const s of sortie) if (!s.code) s.texte = s.texte.replace(/[ \t]{2,}/g, ' ');
  if (sortie.length > 0) {
    sortie[0].texte = sortie[0].texte.replace(/^[ \t]+/, '');
    const d = sortie[sortie.length - 1];
    d.texte = d.texte.replace(/[ \t]+$/, '');
  }
  return sortie.filter(s => s.texte !== '');
}

/** Texte brut d'une suite de segments. */
export function texteDeSegments(segments: Segment[]): string {
  return segments.map(s => s.texte).join('');
}

// ---------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------

const RE_TITRE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_SETEXT_1 = /^ {0,3}=+[ \t]*$/;
const RE_SETEXT_2 = /^ {0,3}-+[ \t]*$/;
const RE_REGLE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_CLOTURE = /^ {0,3}(`{3,}|~{3,})/;
const RE_ELEMENT = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const RE_CITATION = /^ {0,3}>[ \t]?(.*)$/;
const RE_SEPARATEUR_TABLEAU = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Vrai si la ligne ouvre un autre bloc (titre, liste, citation, code, ligne horizontale). */
function debutDeBloc(ligne: string): boolean {
  return (
    RE_TITRE_ATX.test(ligne) ||
    RE_ELEMENT.test(ligne) ||
    RE_CITATION.test(ligne) ||
    RE_CLOTURE.test(ligne) ||
    RE_REGLE.test(ligne)
  );
}

function largeurIndentation(espaces: string): number {
  let n = 0;
  for (const c of espaces) n += c === '\t' ? 4 - (n % 4) : 1;
  return n;
}

/** Cellules d'une ligne de tableau GFM (`\|` reste un caractère). */
function cellulesTableau(ligne: string): string[] {
  let l = ligne.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
  const cellules: string[] = [];
  let courante = '';
  let dansCode = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '\\' && l[i + 1] === '|') {
      courante += '|';
      i++;
      continue;
    }
    if (c === '`') dansCode = !dansCode;
    if (c === '|' && !dansCode) {
      cellules.push(courante.trim());
      courante = '';
      continue;
    }
    courante += c;
  }
  cellules.push(courante.trim());
  return cellules;
}

function alignementDe(cellule: string): AlignementColonne {
  const c = cellule.trim();
  const g = c.startsWith(':');
  const d = c.endsWith(':');
  if (g && d) return 'center';
  if (d) return 'end';
  if (g) return 'start';
  return null;
}

interface ElementEnCours {
  brut: string[];
  sousListes: ListeEnCours[];
}

interface ListeEnCours {
  ordonnee: boolean;
  debut: number;
  /** Colonne du marqueur. */
  indentation: number;
  elements: ElementEnCours[];
}

function finaliserListe(liste: ListeEnCours): BlocListe {
  return {
    type: 'liste',
    ordonnee: liste.ordonnee,
    debut: liste.debut,
    elements: liste.elements.map(e => ({
      segments: segmentsEnLigne(joindreLignes(e.brut)),
      sousListes: e.sousListes.map(finaliserListe),
    })),
  };
}

/** Joint des lignes de paragraphe : saut doux = espace, saut dur (2 espaces ou `\`) = `\n`. */
function joindreLignes(lignes: string[]): string {
  let sortie = '';
  lignes.forEach((brute, i) => {
    const dur = / {2,}$/.test(brute) || /\\$/.test(brute);
    const ligne = brute.replace(/\\$/, '').trim();
    sortie += ligne;
    if (i < lignes.length - 1) sortie += dur ? '\n' : ' ';
  });
  return sortie;
}

/** Analyse un markdown restreint en blocs neutres. Jamais d'exception. */
export function analyserMarkdown(markdown: string): BlocMarkdown[] {
  const source = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(RE_COMMENTAIRE, '')
    .replace(RE_SCRIPT_STYLE, '');
  const lignes = source.split('\n');
  const blocs: BlocMarkdown[] = [];

  let paragraphe: string[] = [];
  let racine: ListeEnCours | null = null;
  let pile: ListeEnCours[] = [];
  let blancDansListe = false;

  const fermerParagraphe = () => {
    if (paragraphe.length === 0) return;
    const segments = segmentsEnLigne(joindreLignes(paragraphe));
    if (segments.length > 0) blocs.push({ type: 'paragraphe', segments });
    paragraphe = [];
  };
  const fermerListe = () => {
    if (racine) blocs.push(finaliserListe(racine));
    racine = null;
    pile = [];
    blancDansListe = false;
  };
  const fermerTout = () => {
    fermerParagraphe();
    fermerListe();
  };

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];

    // Bloc de code clôturé : texte brut, une ligne par saut dur.
    const cloture = RE_CLOTURE.exec(ligne);
    if (cloture) {
      fermerTout();
      const marque = cloture[1];
      const contenu: string[] = [];
      i++;
      while (i < lignes.length && !lignes[i].trimStart().startsWith(marque)) {
        contenu.push(lignes[i]);
        i++;
      }
      const texte = sansHtml(contenu.join('\n')).replace(/\s+$/, '');
      if (texte !== '') blocs.push({ type: 'paragraphe', segments: [{ texte, code: true }] });
      continue;
    }

    // Ligne vide.
    if (ligne.trim() === '') {
      fermerParagraphe();
      if (racine) blancDansListe = true;
      continue;
    }

    // Élément de liste.
    const element = RE_ELEMENT.exec(ligne);
    if (element && !RE_REGLE.test(ligne)) {
      fermerParagraphe();
      blancDansListe = false;
      const indentation = largeurIndentation(element[1]);
      const marqueur = element[2];
      const ordonnee = /\d/.test(marqueur);
      const debut = ordonnee ? Number.parseInt(marqueur, 10) : 1;
      const nouvel: ElementEnCours = { brut: [element[3] ?? ''], sousListes: [] };

      if (!racine) {
        racine = { ordonnee, debut, indentation, elements: [nouvel] };
        pile = [racine];
        continue;
      }
      let sommet = pile[pile.length - 1];
      if (indentation >= sommet.indentation + 2 && sommet.elements.length > 0) {
        // Plus indenté : liste imbriquée sous le dernier élément.
        const enfant: ListeEnCours = { ordonnee, debut, indentation, elements: [nouvel] };
        sommet.elements[sommet.elements.length - 1].sousListes.push(enfant);
        pile.push(enfant);
        continue;
      }
      while (pile.length > 1 && indentation < sommet.indentation - 1) {
        pile.pop();
        sommet = pile[pile.length - 1];
      }
      if (sommet.ordonnee === ordonnee) {
        sommet.elements.push(nouvel);
      } else if (pile.length === 1) {
        // Autre type au premier niveau : nouvelle liste.
        fermerListe();
        racine = { ordonnee, debut, indentation, elements: [nouvel] };
        pile = [racine];
      } else {
        pile.pop();
        const parent = pile[pile.length - 1];
        const soeur: ListeEnCours = { ordonnee, debut, indentation, elements: [nouvel] };
        parent.elements[parent.elements.length - 1].sousListes.push(soeur);
        pile.push(soeur);
      }
      continue;
    }

    // Suite d'un élément de liste (ligne indentée, ou paresseuse sans ligne vide avant).
    if (racine) {
      const indentee = largeurIndentation(/^[ \t]*/.exec(ligne)?.[0] ?? '') >= 2;
      if (indentee || !blancDansListe) {
        const sommet = pile[pile.length - 1];
        const dernier = sommet.elements[sommet.elements.length - 1];
        if (dernier && !RE_TITRE_ATX.test(ligne)) {
          dernier.brut.push(ligne);
          blancDansListe = false;
          continue;
        }
      }
      fermerListe();
    }

    // Titre ATX.
    const titre = RE_TITRE_ATX.exec(ligne);
    if (titre) {
      fermerTout();
      const segments = segmentsEnLigne(titre[2] ?? '');
      if (segments.length > 0) {
        blocs.push({
          type: 'titre',
          niveau: titre[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          segments,
        });
      }
      continue;
    }

    // Titre Setext (la ligne précédente est un paragraphe).
    if (paragraphe.length > 0 && (RE_SETEXT_1.test(ligne) || RE_SETEXT_2.test(ligne))) {
      const segments = segmentsEnLigne(joindreLignes(paragraphe));
      paragraphe = [];
      if (segments.length > 0) {
        blocs.push({ type: 'titre', niveau: RE_SETEXT_1.test(ligne) ? 1 : 2, segments });
      }
      continue;
    }

    // Ligne horizontale : ignorée.
    if (RE_REGLE.test(ligne)) {
      fermerTout();
      continue;
    }

    // Tableau GFM : en-tête, séparateur, lignes.
    if (ligne.includes('|') && i + 1 < lignes.length && RE_SEPARATEUR_TABLEAU.test(lignes[i + 1])) {
      const entetesBruts = cellulesTableau(ligne);
      const separateur = cellulesTableau(lignes[i + 1]);
      if (separateur.length === entetesBruts.length) {
        fermerTout();
        const n = entetesBruts.length;
        const corps: Segment[][][] = [];
        i += 2;
        // GFM : le tableau s'arrête à la première ligne vide ou au début d'un autre bloc.
        while (i < lignes.length && lignes[i].trim() !== '' && !debutDeBloc(lignes[i])) {
          const cellules = cellulesTableau(lignes[i]);
          corps.push(Array.from({ length: n }, (_, k) => segmentsEnLigne(cellules[k] ?? '')));
          i++;
        }
        i--;
        blocs.push({
          type: 'tableau',
          entetes: entetesBruts.map(e => segmentsEnLigne(e)),
          alignements: separateur.map(alignementDe),
          lignes: corps,
        });
        continue;
      }
    }

    // Citation : son texte rejoint le paragraphe.
    const citation = RE_CITATION.exec(ligne);
    if (citation) {
      if (citation[1].trim() === '') {
        fermerParagraphe();
        continue;
      }
      paragraphe.push(citation[1]);
      continue;
    }

    paragraphe.push(ligne);
  }
  fermerTout();
  return blocs;
}

/**
 * Découpe en sections aux titres de niveau 1 et 2 (une diapositive par section). Les titres
 * plus profonds restent dans la section courante.
 */
export function decouperEnSections(blocs: BlocMarkdown[]): SectionMarkdown[] {
  const sections: SectionMarkdown[] = [];
  let courante: SectionMarkdown | null = null;
  for (const bloc of blocs) {
    if (bloc.type === 'titre' && bloc.niveau <= 2) {
      courante = { titre: bloc.segments, niveau: bloc.niveau, blocs: [] };
      sections.push(courante);
      continue;
    }
    if (!courante) {
      courante = { blocs: [] };
      sections.push(courante);
    }
    courante.blocs.push(bloc);
  }
  return sections;
}
