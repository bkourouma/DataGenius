/** Rendu SVG côté serveur : nettoyage et rendu ECharts réel (SSR, sans DOM). */
import { describe, expect, it } from 'vitest';

import type { ContexteGraphique } from '@/lib/medic-assist/artefacts/types-rendu';
import type { JeuClient } from '@/lib/medic-assist/artefacts/types-rendu';
import { construireOptionGraphique } from '@/lib/medic-assist/artefacts/graphique-option';
import { nettoyerSvg, rendreGraphiqueSvg } from '@/lib/medic-assist/artefacts/exports/svg-serveur';

import { preparerEnvironnementServeur } from './_export-serveur';
import { PROVENANCE } from './_export-fixtures';

preparerEnvironnementServeur();

describe('nettoyerSvg', () => {
  it('retire style, script, foreignObject et image, garde le dessin', () => {
    const brut =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<style>path:hover{opacity:.5}@keyframes a{}</style>' +
      '<script>alert(1)</script>' +
      '<foreignObject><div>html</div></foreignObject>' +
      '<image href="file:///etc/passwd" width="1" height="1"/>' +
      '<image href="x.png"></image>' +
      '<path d="M0 0L10 10" fill="#0f4ca9"/>' +
      '<text x="1" y="2">Côte d’Ivoire</text>' +
      '</svg>';
    const propre = nettoyerSvg(brut);
    expect(propre).not.toMatch(/<style|<script|<foreignObject|<image/i);
    expect(propre).not.toContain('alert(1)');
    expect(propre).toContain('<path d="M0 0L10 10" fill="#0f4ca9"/>');
    expect(propre).toContain('<text x="1" y="2">Côte d’Ivoire</text>');
    expect(propre.startsWith('<svg')).toBe(true);
  });

  it('retire les caractères interdits en XML 1.0, garde tabulation et sauts de ligne', () => {
    const propre = nettoyerSvg('<svg><text>a\u0000b\u0008c\u000bd\u001fe\tf\ng\rh￾i</text></svg>');
    expect(propre).toBe('<svg><text>abcde\tf\ng\rhi</text></svg>');
  });

  it('ne touche pas à un SVG déjà propre', () => {
    const svg = '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="transparent"/></svg>';
    expect(nettoyerSvg(svg)).toBe(svg);
  });
});

const jeu: JeuClient = {
  jeuDeDonneesId: 'ventes',
  colonnes: [
    { cle: 'pays', libelle: 'Pays', type: 'texte' },
    { cle: 'ca', libelle: 'CA', type: 'montant' },
  ],
  lignes: [
    { pays: 'Mali', ca: 100 },
    { pays: 'Togo', ca: 250 },
    { pays: 'Bénin', ca: 75 },
  ],
  nbLignes: 3,
  tronque: false,
  provenance: PROVENANCE,
};

const contexte: ContexteGraphique = {
  locale: 'fr',
  theme: 'clair',
  rtl: false,
  traduire: cle => cle,
  statique: true,
};

describe('rendreGraphiqueSvg (echarts)', () => {
  it('rend un graphique en barres en SVG statique', async () => {
    const { option } = construireOptionGraphique(
      { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
      jeu,
      contexte
    );
    const svg = await rendreGraphiqueSvg(option, { largeur: 640, hauteur: 360 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('Togo');
    expect(svg).not.toMatch(/<style|<image|<foreignObject/i);
  }, 120_000);

  it('rend les formes sans équivalent PowerPoint (treemap, entonnoir, jauge)', async () => {
    for (const forme of ['treemap', 'entonnoir', 'jauge'] as const) {
      const { option } = construireOptionGraphique(
        { forme, x: 'pays', y: [{ cle: 'ca' }] },
        jeu,
        contexte
      );
      const svg = await rendreGraphiqueSvg(option, { largeur: 640, hauteur: 360 });
      expect(svg).toContain('<svg');
    }
  }, 30_000);
});
