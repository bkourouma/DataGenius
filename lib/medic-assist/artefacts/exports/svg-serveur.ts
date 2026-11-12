/**
 * Rendu d'une option ECharts en SVG côté serveur (exports PDF et PPTX), sans DOM.
 *
 * ECharts 6 en rendu serveur : `init(null, null, { renderer: 'svg', ssr: true, width,
 * height })`, `setOption`, `renderToSVGString()`, `dispose()`. Le paquet est chargé à la
 * demande (import dynamique d'`echarts`, point d'entrée ESM `index.js` : tous les graphiques et
 * composants, y compris `LegacyGridContainLabel` dont dépend `grid.containLabel`). Sans
 * canvas, zrender mesure le texte avec une table de largeurs approximative (police sans
 * empattement) : les étiquettes peuvent être un peu mieux ou moins bien placées qu'à l'écran.
 *
 * Limites de svg-to-pdfkit (embarqué dans pdfmake 0.3.13, `src/3rd-party/svg-to-pdfkit`),
 * relevées dans ses sources :
 * - polices : seule la famille déclarée à pdfmake est utilisée (le `fontCallback` de pdfmake
 *   ne reconnaît que les noms de `fonts` et retombe sur Roboto) ; 600 et plus = gras ;
 *   `font-variant-numeric` est ignoré ;
 * - `clip-path` et `mask` : pris en charge (groupes et masques doux PDF), comme les
 *   dégradés et les motifs (`<pattern>`, utilisés par les décors `aria.decal`) ;
 * - `<style>` : seuls des sélecteurs simples (balise, `.classe`, `#id`) sont lus ; les
 *   pseudo-classes (`:hover`) et animations CSS qu'ECharts écrit en rendu serveur sont
 *   inutiles en statique : `nettoyerSvg` retire le bloc ;
 * - non pris en charge : `filter` (ombres), `foreignObject`, `paint-order` ;
 * - `<image>` : ouverte par pdfkit depuis un chemin local, refusée par la politique d'accès
 *   de pdfmake : `nettoyerSvg` retire toute image (ECharts n'en produit pas ici) ;
 * - le XML doit être valide (xmldoc) : les caractères de contrôle interdits en XML 1.0
 *   sont retirés.
 */

import type { OptionGraphique } from '../types-rendu';

type ModuleEcharts = typeof import('echarts');

export interface TailleSvg {
  largeur: number;
  hauteur: number;
}

let chargement: Promise<ModuleEcharts> | null = null;

/** Charge echarts une fois par processus (une erreur de chargement n'est pas mémorisée). */
async function chargerEcharts(): Promise<ModuleEcharts> {
  if (!chargement) {
    chargement = import('echarts')
      .then(mod => {
        const m = mod as ModuleEcharts & { default?: ModuleEcharts };
        return typeof m.init === 'function' ? m : (m.default as ModuleEcharts);
      })
      .catch(erreur => {
        chargement = null;
        throw erreur;
      });
  }
  return chargement;
}

// Caractères interdits en XML 1.0 (hors tabulation, saut de ligne, retour chariot).
// eslint-disable-next-line no-control-regex
const RE_CONTROLE_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/**
 * Prépare un SVG d'ECharts pour un rendu statique (PDF, image de diapositive) : retire les
 * blocs `<style>` (survol, animations), les `<image>`, les `<foreignObject>`, les scripts et
 * les caractères de contrôle interdits en XML.
 */
export function nettoyerSvg(svg: string): string {
  return svg
    .replace(RE_CONTROLE_XML, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<style\b[^>]*\/>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<image\b[^>]*>[\s\S]*?<\/image\s*>/gi, '')
    .replace(/<image\b[^>]*\/?>/gi, '');
}

/**
 * Rend l'option ECharts en chaîne SVG (`<svg width=… height=… viewBox=…>`), nettoyée.
 * L'animation est forcée à `false` (rendu immédiat). Lève l'erreur d'ECharts telle quelle :
 * l'appelant décide du repli (tableau des données).
 */
export async function rendreGraphiqueSvg(
  option: OptionGraphique,
  taille: TailleSvg
): Promise<string> {
  const echarts = await chargerEcharts();
  const largeur = Math.max(1, Math.round(taille.largeur));
  const hauteur = Math.max(1, Math.round(taille.hauteur));
  const graphique = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: largeur,
    height: hauteur,
  });
  try {
    graphique.setOption({ ...option, animation: false } as Parameters<
      typeof graphique.setOption
    >[0]);
    return nettoyerSvg(graphique.renderToSVGString());
  } finally {
    graphique.dispose();
  }
}
