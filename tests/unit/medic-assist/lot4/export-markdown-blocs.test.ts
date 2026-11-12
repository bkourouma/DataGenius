import { describe, expect, it } from 'vitest';

import {
  analyserMarkdown,
  decouperEnSections,
  estLienInterne,
  segmentsEnLigne,
  texteDeSegments,
  type BlocListe,
  type BlocMarkdown,
} from '@/lib/medic-assist/artefacts/exports/markdown-blocs';

function seul<T extends BlocMarkdown['type']>(
  blocs: BlocMarkdown[],
  type: T
): Extract<BlocMarkdown, { type: T }> {
  expect(blocs).toHaveLength(1);
  expect(blocs[0].type).toBe(type);
  return blocs[0] as Extract<BlocMarkdown, { type: T }>;
}

describe('analyserMarkdown : titres et paragraphes', () => {
  it('reconnaît les titres ATX de niveau 1 à 6 et retire les # de fin', () => {
    const blocs = analyserMarkdown(
      '# Un\n## Deux ##\n### Trois\n#### Quatre\n##### Cinq\n###### Six'
    );
    expect(
      blocs.map(b => (b.type === 'titre' ? [b.niveau, texteDeSegments(b.segments)] : null))
    ).toEqual([
      [1, 'Un'],
      [2, 'Deux'],
      [3, 'Trois'],
      [4, 'Quatre'],
      [5, 'Cinq'],
      [6, 'Six'],
    ]);
  });

  it('ne prend pas un mot-dièse pour un titre', () => {
    const p = seul(analyserMarkdown('#hashtag reste du texte'), 'paragraphe');
    expect(texteDeSegments(p.segments)).toBe('#hashtag reste du texte');
  });

  it('reconnaît les titres Setext', () => {
    const blocs = analyserMarkdown('Synthèse\n=====\n\nDétail\n---');
    expect(blocs).toEqual([
      { type: 'titre', niveau: 1, segments: [{ texte: 'Synthèse' }] },
      { type: 'titre', niveau: 2, segments: [{ texte: 'Détail' }] },
    ]);
  });

  it('joint les sauts doux par une espace et garde les sauts durs', () => {
    const p = seul(analyserMarkdown('Première ligne\nsuite  \nligne dure\\\nfin'), 'paragraphe');
    expect(texteDeSegments(p.segments)).toBe('Première ligne suite\nligne dure\nfin');
  });

  it('sépare les paragraphes sur une ligne vide et ignore les lignes horizontales', () => {
    const blocs = analyserMarkdown('Un\n\n---\n\n***\nDeux');
    expect(blocs.map(b => b.type)).toEqual(['paragraphe', 'paragraphe']);
  });

  it('rend une citation comme un paragraphe', () => {
    const p = seul(analyserMarkdown('> Le CA progresse\n> nettement.'), 'paragraphe');
    expect(texteDeSegments(p.segments)).toBe('Le CA progresse nettement.');
  });

  it('rend un bloc de code clôturé en texte brut, sans interpréter le markdown', () => {
    const p = seul(analyserMarkdown('```\n**pas gras**\n<b>x</b>\n```'), 'paragraphe');
    expect(p.segments).toEqual([{ texte: '**pas gras**\nx', code: true }]);
  });
});

describe('analyserMarkdown : listes', () => {
  it('lit une liste à puces simple (-, *, +)', () => {
    const l = seul(analyserMarkdown('- un\n* deux\n+ trois'), 'liste');
    expect(l.ordonnee).toBe(false);
    expect(l.elements.map(e => texteDeSegments(e.segments))).toEqual(['un', 'deux', 'trois']);
  });

  it('garde le premier numéro d’une liste numérotée', () => {
    const l = seul(analyserMarkdown('3. trois\n4. quatre'), 'liste');
    expect(l.ordonnee).toBe(true);
    expect(l.debut).toBe(3);
    expect(l.elements).toHaveLength(2);
  });

  it('imbrique les listes sur trois niveaux et remonte correctement', () => {
    const md = [
      '1. Pays',
      '   - Mali',
      '     - Bamako',
      '   - Togo',
      '2. Produits',
      '- puce après',
    ].join('\n');
    const blocs = analyserMarkdown(md);
    expect(blocs.map(b => b.type)).toEqual(['liste', 'liste']);
    const l = blocs[0] as BlocListe;
    expect(l.ordonnee).toBe(true);
    expect(l.elements.map(e => texteDeSegments(e.segments))).toEqual(['Pays', 'Produits']);
    const sous = l.elements[0].sousListes[0];
    expect(sous.ordonnee).toBe(false);
    expect(sous.elements.map(e => texteDeSegments(e.segments))).toEqual(['Mali', 'Togo']);
    expect(texteDeSegments(sous.elements[0].sousListes[0].elements[0].segments)).toBe('Bamako');
    expect(l.elements[1].sousListes).toEqual([]);
    expect((blocs[1] as BlocListe).ordonnee).toBe(false);
  });

  it('rattache les lignes de suite à l’élément courant', () => {
    const l = seul(analyserMarkdown('- début\n  suite indentée\n- autre'), 'liste');
    expect(l.elements.map(e => texteDeSegments(e.segments))).toEqual([
      'début suite indentée',
      'autre',
    ]);
  });

  it('ferme la liste sur un paragraphe non indenté après une ligne vide', () => {
    const blocs = analyserMarkdown('- un\n\nParagraphe');
    expect(blocs.map(b => b.type)).toEqual(['liste', 'paragraphe']);
  });

  it('analyse le markdown en ligne des éléments', () => {
    const l = seul(analyserMarkdown('- **gras** et *italique*'), 'liste');
    expect(l.elements[0].segments).toEqual([
      { texte: 'gras', gras: true },
      { texte: ' et ' },
      { texte: 'italique', italique: true },
    ]);
  });
});

describe('analyserMarkdown : tableaux GFM', () => {
  it('lit en-têtes, alignements et lignes', () => {
    const md =
      '| Pays | CA | Taux |\n|:-----|---:|:---:|\n| Mali | 1 250 € | 85 % |\n| **Togo** | 980 € | 62 % |';
    const t = seul(analyserMarkdown(md), 'tableau');
    expect(t.entetes.map(texteDeSegments)).toEqual(['Pays', 'CA', 'Taux']);
    expect(t.alignements).toEqual(['start', 'end', 'center']);
    expect(t.lignes.map(l => l.map(texteDeSegments))).toEqual([
      ['Mali', '1 250 €', '85 %'],
      ['Togo', '980 €', '62 %'],
    ]);
    expect(t.lignes[1][0]).toEqual([{ texte: 'Togo', gras: true }]);
  });

  it('accepte un tableau sans barres extérieures, complète les cellules manquantes', () => {
    const t = seul(analyserMarkdown('a | b\n--- | ---\n1\n2 | 3 | 4'), 'tableau');
    expect(t.alignements).toEqual([null, null]);
    expect(t.lignes.map(l => l.map(texteDeSegments))).toEqual([
      ['1', ''],
      ['2', '3'],
    ]);
  });

  it('garde une barre échappée dans une cellule', () => {
    const t = seul(analyserMarkdown('| Règle |\n|---|\n| a \\| b |'), 'tableau');
    expect(texteDeSegments(t.lignes[0][0])).toBe('a | b');
  });

  it('n’en fait pas un tableau si le séparateur ne correspond pas', () => {
    const blocs = analyserMarkdown('a | b | c\n--- | ---');
    expect(blocs.every(b => b.type !== 'tableau')).toBe(true);
  });

  it('termine le tableau sur une ligne vide', () => {
    const blocs = analyserMarkdown('| a |\n|---|\n| 1 |\n\nAprès');
    expect(blocs.map(b => b.type)).toEqual(['tableau', 'paragraphe']);
  });
});

describe('segmentsEnLigne : emphase et code', () => {
  it('gras, italique, gras italique', () => {
    expect(segmentsEnLigne('**g** _i_ ***gi*** __g2__')).toEqual([
      { texte: 'g', gras: true },
      { texte: ' ' },
      { texte: 'i', italique: true },
      { texte: ' ' },
      { texte: 'gi', gras: true, italique: true },
      { texte: ' ' },
      { texte: 'g2', gras: true },
    ]);
  });

  it('italique imbriqué dans du gras', () => {
    expect(segmentsEnLigne('**CA *net* annuel**')).toEqual([
      { texte: 'CA ', gras: true },
      { texte: 'net', gras: true, italique: true },
      { texte: ' annuel', gras: true },
    ]);
  });

  it('ne prend pas les tirets bas d’un identifiant pour de l’italique', () => {
    expect(segmentsEnLigne('colonne prix_unitaire_ht')).toEqual([
      { texte: 'colonne prix_unitaire_ht' },
    ]);
  });

  it('laisse un astérisque isolé ou non fermé tel quel', () => {
    expect(texteDeSegments(segmentsEnLigne('5 * 3 et *ouvert'))).toBe('5 * 3 et *ouvert');
  });

  it('code en ligne sans interprétation', () => {
    expect(segmentsEnLigne('voir `**brut**`')).toEqual([
      { texte: 'voir ' },
      { texte: '**brut**', code: true },
    ]);
  });

  it('caractères échappés', () => {
    expect(segmentsEnLigne('\\*pas italique\\* et \\[pas lien\\]')).toEqual([
      { texte: '*pas italique* et [pas lien]' },
    ]);
  });

  it('le barré garde son texte', () => {
    expect(segmentsEnLigne('~~ancien~~ nouveau')).toEqual([{ texte: 'ancien nouveau' }]);
  });
});

describe('HTML et images ignorés', () => {
  it('retire les balises en gardant leur texte', () => {
    expect(segmentsEnLigne('<b>gras html</b> et <span class="x">texte</span>')).toEqual([
      { texte: 'gras html et texte' },
    ]);
  });

  it('supprime script, style et commentaires avec leur contenu', () => {
    const blocs = analyserMarkdown(
      'Avant <script>alert("x")</script>après\n\n<style>p{}</style>\n<!-- secret\nsur deux lignes -->\nFin'
    );
    const texte = blocs
      .map(b => (b.type === 'paragraphe' ? texteDeSegments(b.segments) : ''))
      .join('|');
    expect(texte).toBe('Avant après|Fin');
    expect(texte).not.toContain('alert');
    expect(texte).not.toContain('secret');
  });

  it('une ligne HTML seule sans texte ne produit rien', () => {
    expect(analyserMarkdown('<div></div>\n<br/>')).toEqual([]);
  });

  it('retire les images', () => {
    expect(segmentsEnLigne('Voici ![logo](https://x.test/a.png) la suite')).toEqual([
      { texte: 'Voici la suite' },
    ]);
  });
});

describe('liens', () => {
  it('conserve un lien interne avec sa cible', () => {
    expect(segmentsEnLigne('Voir [le rapport](/rapports/ventes?pays=CI) ici')).toEqual([
      { texte: 'Voir ' },
      { texte: 'le rapport', lien: '/rapports/ventes?pays=CI' },
      { texte: ' ici' },
    ]);
    expect(segmentsEnLigne('[haut](#sommaire)')).toEqual([{ texte: 'haut', lien: '#sommaire' }]);
  });

  it('neutralise les liens externes (le texte reste, sans cible)', () => {
    for (const cible of [
      'https://exemple.test',
      'http://exemple.test/x',
      'mailto:a@b.test',
      '//hote.test/chemin',
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'rapports/relatif',
    ]) {
      expect(segmentsEnLigne(`[clic](${cible})`)).toEqual([{ texte: 'clic' }]);
    }
  });

  it('garde le style du texte d’un lien', () => {
    expect(segmentsEnLigne('[**gras**](/a)')).toEqual([{ texte: 'gras', gras: true, lien: '/a' }]);
  });

  it('accepte une cible entre chevrons et un titre', () => {
    expect(segmentsEnLigne('[a](</b c> "titre")')).toEqual([{ texte: 'a' }]);
    expect(segmentsEnLigne('[a](/b "titre")')).toEqual([{ texte: 'a', lien: '/b' }]);
  });

  it('un lien automatique externe devient du texte', () => {
    expect(segmentsEnLigne('<https://exemple.test>')).toEqual([{ texte: 'https://exemple.test' }]);
  });

  it('estLienInterne', () => {
    expect(estLienInterne('/a')).toBe(true);
    expect(estLienInterne('#x')).toBe(true);
    expect(estLienInterne('#')).toBe(false);
    expect(estLienInterne('//a')).toBe(false);
    expect(estLienInterne('/\\a')).toBe(false);
    expect(estLienInterne('/a b')).toBe(false);
    expect(estLienInterne('https://a')).toBe(false);
  });
});

describe('decouperEnSections', () => {
  it('coupe aux titres de niveau 1 et 2, garde les titres plus profonds dans la section', () => {
    const sections = decouperEnSections(
      analyserMarkdown('Intro\n\n# Ventes\nTexte\n### Détail\n- a\n## Stocks\nFin')
    );
    expect(sections.map(s => (s.titre ? texteDeSegments(s.titre) : null))).toEqual([
      null,
      'Ventes',
      'Stocks',
    ]);
    expect(sections[1].blocs.map(b => b.type)).toEqual(['paragraphe', 'titre', 'liste']);
    expect(sections[1].niveau).toBe(1);
    expect(sections[2].niveau).toBe(2);
  });

  it('renvoie une liste vide pour un texte vide', () => {
    expect(decouperEnSections(analyserMarkdown(''))).toEqual([]);
  });
});

describe('robustesse', () => {
  it('ne lève jamais d’exception sur une entrée bizarre', () => {
    const bizarres = [
      '',
      '   ',
      '[',
      '[a](',
      '**',
      '``',
      '|',
      '|---|',
      '- ',
      '1.',
      '<',
      '<!--',
      '```\nsans fin',
      '* * *',
      '\u0000\u0001',
      'a'.repeat(5000),
      null as unknown as string,
    ];
    for (const md of bizarres) expect(() => analyserMarkdown(md)).not.toThrow();
  });

  it('gère les fins de ligne Windows', () => {
    const blocs = analyserMarkdown('# Titre\r\n\r\nTexte\r\n');
    expect(blocs.map(b => b.type)).toEqual(['titre', 'paragraphe']);
  });
});
