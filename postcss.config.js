/**
 * Chaine PostCSS.
 *
 * postcss-rtlcss s'execute apres Tailwind : il relit les regles generees et
 * ajoute, pour chacune qui contient une propriete orientee (padding-left,
 * margin-right, left, text-align...), une variante prefixee `[dir="rtl"]` avec
 * les cotes inverses. Les quatre langues de gauche a droite gardent exactement
 * les memes regles qu'avant (prefixees `[dir="ltr"]`), l'arabe recoit les
 * variantes miroir. Voir docs/I18N.md.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    'postcss-rtlcss': {
      mode: 'combined',
      ltrPrefix: '[dir="ltr"]',
      rtlPrefix: '[dir="rtl"]',
      bothPrefix: '[dir]',
      // Ne prefixe que les regles reellement orientees : une regle sans cote
      // (couleur, taille...) reste unique et s'applique aux deux sens.
      safeBothPrefix: false,
      // Les URL d'images et les animations ne sont pas inversees : aucune
      // ressource du projet n'est orientee.
      processUrls: false,
      processKeyFrames: false,
      useCalc: false,
    },
    autoprefixer: {},
  },
}
