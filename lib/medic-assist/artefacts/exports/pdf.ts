/**
 * Export PDF (pdfmake 0.3) d'un artefact préparé, aux couleurs des exports Excel.
 *
 * Mise en page :
 * - A4, en-tête de page « MedicPro » + titre court, pied « Exporté le … · personne » et
 *   « Page x sur y » (date = `prep.exporteLe`, jamais l'heure du serveur) ;
 * - page 1 : titre, sous-titre, lignes de contexte ; sommaire dès 3 blocs ;
 * - un bloc après l'autre : texte (markdown restreint), tableau (en-tête répété à chaque page,
 *   lignes insécables, nombres à droite, bandes alternées, totaux en gras), graphique (SVG
 *   rendu par ECharts côté serveur, à la largeur utile), indicateurs (cartes : libellé,
 *   valeur, variation, objectif et statut écrit à côté de la pastille de couleur) ;
 * - tableau large : page paysage et police réduite au-delà de 7 colonnes, découpe en parties
 *   (dimensions répétées) au-delà de 16 : jamais de débordement ; au-delà de 5 000 lignes, le
 *   PDF tronque et le dit (l'Excel contient tout) ;
 * - dernière page « Sources et calcul » : une provenance par jeu, champs nommés un à un (le
 *   SQL n'est jamais lu).
 *
 * Langue : le texte de chrome vient de `prep.traduire` ; formats de nombre et de date en
 * `localePdf(prep.locale)` (anglais pour zh, ar, hi : voir polices.ts). Tout texte passe
 * par `assainirTexte`. Le PDF est toujours de gauche à droite (l'arabe y est en anglais).
 *
 * pdfmake est un singleton : polices et politiques d'accès (aucune URL, accès local limité
 * aux polices) sont posées avant chaque document.
 */

import type {
  Content,
  ContentTable,
  ContentText,
  CustomTableLayout,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import { toIntlTag, type Locale } from '@/i18n/config';

import { creerFormateur, estFormatNumerique } from '../formats';
import { construireOptionGraphique } from '../graphique-option';
import type {
  ContexteGraphique,
  IndicateurResolu,
  ModeleTableau,
  Traducteur,
} from '../types-rendu';
import { analyserMarkdown, type BlocMarkdown, type Segment } from './markdown-blocs';
import {
  assainirTexte,
  CHARTE,
  couleurEntete,
  decouperColonnes,
  FAMILLE_POLICE_PDF,
  fichiersPolicePdf,
  largeursProportionnelles,
  localePdf,
  politiqueAccesLocal,
  politiqueAccesUrl,
  type FichiersPolice,
} from './polices';
import { rendreGraphiqueSvg } from './svg-serveur';
import { creerTraducteurServeur } from './traducteur-serveur';
import type { BlocExport, ExportPrepare } from './types';

/** Au-delà, le tableau du PDF est tronqué (l'Excel contient toutes les lignes). */
export const LIGNES_MAX_PDF = 5000;
/** Au-delà de ce nombre de colonnes, le tableau passe en paysage. */
export const COLONNES_MAX_PORTRAIT = 7;
/** Au-delà, le tableau est découpé en parties (colonnes de dimension répétées). */
export const COLONNES_MAX_PAGE = 16;
/** Nombre de blocs à partir duquel le sommaire est ajouté. */
export const BLOCS_MIN_SOMMAIRE = 3;

const A4 = { largeur: 595.28, hauteur: 841.89 };
const MARGES: [number, number, number, number] = [36, 54, 36, 46];
const LARGEUR_PORTRAIT = A4.largeur - MARGES[0] - MARGES[2];
const LARGEUR_PAYSAGE = A4.hauteur - MARGES[0] - MARGES[2];
const RETRAIT_CELLULE = 4;
/** Petit tableau : titre et lignes gardés ensemble (déplacés d'un bloc sur la page suivante). */
const LIGNES_TABLEAU_INSECABLE = 20;
const LONGUEUR_TITRE_COURT = 70;

const hex = (c: string) => `#${c}`;

type Orientation = 'portrait' | 'landscape';

interface Contexte {
  prep: ExportPrepare;
  locale: Locale;
  /** Traduction assainie pour le PDF. */
  t: Traducteur;
}

interface Morceau {
  orientation: Orientation;
  contenu: Content[];
}

// ---------------------------------------------------------------------------
// pdfmake (chargé à la demande, serveur seulement)
// ---------------------------------------------------------------------------

interface PdfMakeServeur {
  setFonts(fonts: Record<string, FichiersPolice>): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  createPdf(doc: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}

async function chargerPdfMake(): Promise<PdfMakeServeur> {
  // Chargé à la demande : pdfmake reste hors du paquet client (serverComponentsExternalPackages).
  const mod = (await import('pdfmake')) as unknown as PdfMakeServeur & { default?: PdfMakeServeur };
  // CommonJS : `module.exports` est une INSTANCE (méthodes sur le prototype), d'où `default`.
  const instance = mod.default && typeof mod.default.createPdf === 'function' ? mod.default : mod;
  if (typeof instance.createPdf !== 'function') throw new Error('pdfmake : createPdf introuvable');
  return instance;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function formaterDateHeure(date: Date, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(toIntlTag(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function tronquer(texte: string, max: number): string {
  const car = Array.from(texte);
  return car.length <= max ? texte : `${car.slice(0, max - 1).join('')}…`;
}

function variationFormatee(points: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(toIntlTag(locale), {
      style: 'percent',
      signDisplay: 'exceptZero',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(points / 100);
  } catch {
    return `${points.toFixed(1)} %`;
  }
}

function inlines(segments: Segment[]): Content[] {
  return segments.map(s => {
    const n: ContentText = { text: assainirTexte(s.texte) };
    if (s.gras) n.bold = true;
    if (s.italique) n.italics = true;
    if (s.code) n.color = hex(CHARTE.grisTexte);
    return n;
  });
}

// ---------------------------------------------------------------------------
// Tableaux
// ---------------------------------------------------------------------------

function tailleTableau(nbColonnes: number): number {
  if (nbColonnes <= COLONNES_MAX_PORTRAIT) return 8.5;
  if (nbColonnes <= 10) return 8;
  if (nbColonnes <= 13) return 7;
  return 6.5;
}

function alignementColonne(colonne: ModeleTableau['colonnes'][number]) {
  if (colonne.format === 'date') return 'center' as const;
  if (colonne.alignement === 'end' || estFormatNumerique(colonne.format)) return 'right' as const;
  return 'left' as const;
}

function dispositionTableau(ligneTotal: number | null, nbEntetes: number): CustomTableLayout {
  return {
    hLineWidth: i => (ligneTotal !== null && i === ligneTotal ? 1 : 0.5),
    vLineWidth: () => 0.5,
    hLineColor: i =>
      hex(ligneTotal !== null && i === ligneTotal ? CHARTE.bleuNuit : CHARTE.grisBordure),
    vLineColor: () => hex(CHARTE.grisBordure),
    paddingLeft: () => RETRAIT_CELLULE,
    paddingRight: () => RETRAIT_CELLULE,
    paddingTop: () => 2.5,
    paddingBottom: () => 2.5,
    fillColor: i => {
      if (i < nbEntetes) return null;
      if (ligneTotal !== null && i === ligneTotal) return hex(CHARTE.fondTotal);
      return (i - nbEntetes) % 2 === 1 ? hex(CHARTE.bande) : null;
    },
  };
}

interface TableauRendu {
  orientation: Orientation;
  contenus: Content[];
}

/** Tableau(x) d'un modèle : une ou plusieurs parties si trop large, lignes plafonnées. */
function tableauxDuModele(ctx: Contexte, modele: ModeleTableau): TableauRendu {
  const { t, locale } = ctx;
  const colonnes = modele.colonnes;
  if (colonnes.length === 0) return { orientation: 'portrait', contenus: [] };

  const formateurs = colonnes.map(c => creerFormateur(c.format, locale, { unite: c.unite }));
  const tronque = modele.lignes.length > LIGNES_MAX_PDF;
  const lignes = tronque ? modele.lignes.slice(0, LIGNES_MAX_PDF) : modele.lignes;
  const libelleTotal = t('exports.total');
  let indexLibelleTotal = colonnes.findIndex(c => c.type === 'dimension');
  if (indexLibelleTotal < 0) indexLibelleTotal = 0;

  const parties = decouperColonnes(colonnes, COLONNES_MAX_PAGE);
  const nbMax = Math.max(...parties.map(p => p.indices.length));
  const orientation: Orientation = nbMax > COLONNES_MAX_PORTRAIT ? 'landscape' : 'portrait';
  const largeurUtile = orientation === 'landscape' ? LARGEUR_PAYSAGE : LARGEUR_PORTRAIT;

  // Textes formatés une seule fois.
  const corps: string[][] = lignes.map(ligne =>
    colonnes.map((c, k) => assainirTexte(formateurs[k](ligne[c.id])))
  );
  const totaux: string[] | null = modele.totaux
    ? colonnes.map((c, k) =>
        k === indexLibelleTotal
          ? libelleTotal
          : assainirTexte(formateurs[k]((modele.totaux as Record<string, unknown>)[c.id]))
      )
    : null;
  const entetes = colonnes.map(c => assainirTexte(c.libelle));

  const contenus: Content[] = [];
  if (tronque) {
    contenus.push({
      text: t('exportsPdf.troncature', { n: LIGNES_MAX_PDF, total: modele.lignes.length }),
      style: 'note',
    });
  }

  parties.forEach(partie => {
    const idx = partie.indices;
    const taille = tailleTableau(idx.length);
    const echantillon = corps.slice(0, 300);
    const longueurs = idx.map(k => {
      const motLong = entetes[k].split(/\s+/).reduce((m, mot) => Math.max(m, mot.length), 0);
      let l = Math.max(motLong, Math.min(entetes[k].length, 18));
      for (const ligne of echantillon) l = Math.max(l, ligne[k].length);
      if (totaux) l = Math.max(l, totaux[k].length);
      return l;
    });
    const disponible = largeurUtile - idx.length * (2 * RETRAIT_CELLULE + 0.5) - 1;
    const largeurs = largeursProportionnelles(longueurs, disponible, { min: 4, max: 36 });

    const ligneEntete: TableCell[] = idx.map(k => ({
      text: entetes[k],
      bold: true,
      color: hex(CHARTE.blanc),
      fillColor: hex(couleurEntete(colonnes[k].format)),
      alignment: 'center',
      fontSize: taille,
    }));
    const alignements = idx.map(k => alignementColonne(colonnes[k]));
    const body: TableCell[][] = [ligneEntete];
    for (const ligne of corps) {
      body.push(
        idx.map((k, j) => ({ text: ligne[k], alignment: alignements[j], fontSize: taille }))
      );
    }
    let ligneTotal: number | null = null;
    if (totaux) {
      ligneTotal = body.length;
      body.push(
        idx.map((k, j) => ({
          text: totaux[k],
          bold: true,
          alignment: k === indexLibelleTotal ? 'left' : alignements[j],
          fontSize: taille,
        }))
      );
    }

    if (parties.length > 1) {
      contenus.push({
        text: t('exportsPdf.partieColonnes', {
          debut: partie.premiere,
          fin: partie.derniere,
          total: partie.total,
        }),
        style: 'note',
      });
    }
    const table: ContentTable = {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        keepWithHeaderRows: 1,
        widths: largeurs,
        body,
      },
      layout: dispositionTableau(ligneTotal, 1),
      margin: [0, 2, 0, 10],
    };
    contenus.push(table);
  });
  return { orientation, contenus };
}

// ---------------------------------------------------------------------------
// Blocs
// ---------------------------------------------------------------------------

function titreBloc(texte: string, sousTitre: string | undefined): Content[] {
  const sortie: Content[] = [];
  if (texte.trim() !== '') {
    sortie.push({ text: assainirTexte(texte), style: 'titreBloc', tocItem: true });
  }
  if (sousTitre && sousTitre.trim() !== '') {
    sortie.push({ text: assainirTexte(sousTitre), style: 'sousTitreBloc' });
  }
  return sortie;
}

function contenuMarkdown(ctx: Contexte, blocs: BlocMarkdown[]): Content[] {
  const sortie: Content[] = [];
  const liste = (b: Extract<BlocMarkdown, { type: 'liste' }>): Content => {
    const elements: Content[] = b.elements.map(e => {
      const texte: Content = { text: inlines(e.segments) };
      return e.sousListes.length > 0 ? { stack: [texte, ...e.sousListes.map(liste)] } : texte;
    });
    return b.ordonnee
      ? ({ ol: elements, start: b.debut, margin: [0, 0, 0, 4] } as Content)
      : ({ ul: elements, margin: [0, 0, 0, 4] } as Content);
  };

  blocs.forEach((b, i) => {
    switch (b.type) {
      case 'titre': {
        const style = b.niveau === 1 ? 'h1' : b.niveau === 2 ? 'h2' : 'h3';
        const titre: Content = {
          text: inlines(b.segments),
          style,
          ...(b.niveau <= 2
            ? { tocItem: true, tocMargin: [b.niveau === 2 ? 12 : 0, 0, 0, 0] }
            : {}),
        } as Content;
        // Le titre reste avec le bloc qui le suit s'il est court (pas de titre orphelin).
        const suivant = blocs[i + 1];
        const court =
          suivant &&
          (suivant.type === 'paragraphe' ||
            (suivant.type === 'liste' && suivant.elements.length <= 8));
        if (court) {
          sortie.push({ stack: [titre, ...contenuMarkdown(ctx, [suivant])], unbreakable: true });
          blocs[i + 1] = { type: 'paragraphe', segments: [] };
        } else {
          sortie.push(titre);
        }
        break;
      }
      case 'paragraphe':
        if (b.segments.length > 0) sortie.push({ text: inlines(b.segments), style: 'corps' });
        break;
      case 'liste':
        sortie.push(liste(b));
        break;
      case 'tableau': {
        const n = b.entetes.length;
        const largeurs = Array.from({ length: n }, () => '*' as const);
        const align = (k: number): 'left' | 'right' | 'center' =>
          b.alignements[k] === 'end' ? 'right' : b.alignements[k] === 'center' ? 'center' : 'left';
        const body: TableCell[][] = [
          b.entetes.map((e, k) => ({
            text: inlines(e),
            bold: true,
            color: hex(CHARTE.blanc),
            fillColor: hex(CHARTE.bleuNuit),
            alignment: align(k),
          })),
          ...b.lignes.map(l =>
            l.map((cellule, k) => ({ text: inlines(cellule), alignment: align(k) }))
          ),
        ];
        sortie.push({
          table: { headerRows: 1, dontBreakRows: true, widths: largeurs, body },
          layout: dispositionTableau(null, 1),
          fontSize: 8.5,
          margin: [0, 2, 0, 8],
        });
        break;
      }
    }
  });
  return sortie;
}

const CLE_STATUT = { atteint: 'atteint', en_cours: 'enCours', a_risque: 'aRisque' } as const;
const COULEUR_STATUT = {
  atteint: CHARTE.etat.atteint,
  en_cours: CHARTE.etat.enCours,
  a_risque: CHARTE.etat.aRisque,
} as const;

function carteIndicateur(ctx: Contexte, ind: IndicateurResolu): Content {
  const { t, locale } = ctx;
  const pile: Content[] = [
    { text: assainirTexte(ind.libelle), style: 'carteLibelle' },
    {
      text:
        ind.valeur === null
          ? t('exportsPdf.indicateurs.nonDisponible')
          : assainirTexte(ind.valeurFormatee),
      style: 'carteValeur',
    },
  ];
  if (ind.comparaison) {
    const c = ind.comparaison;
    pile.push({
      text: t('exportsPdf.libelleValeur', {
        libelle: assainirTexte(c.libelle),
        valeur:
          c.valeur === null
            ? t('exportsPdf.indicateurs.nonDisponible')
            : assainirTexte(c.valeurFormatee),
      }),
      style: 'carteDetail',
    });
    if (c.variationPct !== null) {
      const valeur = assainirTexte(variationFormatee(c.variationPct, locale));
      pile.push({
        text: c.sens
          ? t('exportsPdf.indicateurs.variationSens', {
              valeur,
              sens: t(`exportsPdf.indicateurs.sens.${c.sens}`),
            })
          : t('exportsPdf.indicateurs.variation', { valeur }),
        style: 'carteDetail',
      });
    }
  }
  if (ind.objectif) {
    const o = ind.objectif;
    pile.push({
      text: t('exportsPdf.libelleValeur', {
        libelle: assainirTexte(o.libelle ?? '') || t('exports.indicateurs.objectif'),
        valeur:
          o.valeur === null
            ? t('exportsPdf.indicateurs.nonDisponible')
            : assainirTexte(o.valeurFormatee),
      }),
      style: 'carteDetail',
    });
    if (o.taux !== null) {
      pile.push({
        text: t('exportsPdf.indicateurs.realisation', {
          valeur: assainirTexte(creerFormateur('pourcentage', locale)(o.taux)),
        }),
        style: 'carteDetail',
      });
    }
    if (o.statut) {
      const couleur = hex(COULEUR_STATUT[o.statut]);
      pile.push({
        columns: [
          {
            width: 11,
            canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 2, color: couleur }],
          },
          {
            width: '*',
            text: t(`exports.indicateurs.statuts.${CLE_STATUT[o.statut]}`),
            bold: true,
            color: couleur,
            fontSize: 8.5,
          },
        ],
        margin: [0, 3, 0, 0],
      } as Content);
    }
  }
  return {
    table: { widths: ['*'], body: [[{ stack: pile }]] },
    layout: {
      hLineWidth: () => 0.75,
      vLineWidth: () => 0.75,
      hLineColor: () => hex(CHARTE.grisBordure),
      vLineColor: () => hex(CHARTE.grisBordure),
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
  };
}

function grilleIndicateurs(ctx: Contexte, indicateurs: IndicateurResolu[]): Content[] {
  const parLigne = 3;
  const rangees: Content[] = [];
  for (let i = 0; i < indicateurs.length; i += parLigne) {
    const tranche = indicateurs.slice(i, i + parLigne);
    const colonnes: Content[] = tranche.map(
      ind => ({ width: '*', stack: [carteIndicateur(ctx, ind)] }) as Content
    );
    while (colonnes.length < parLigne) colonnes.push({ width: '*', text: '' } as Content);
    rangees.push({
      columns: colonnes,
      columnGap: 10,
      margin: [0, 0, 0, 10],
      unbreakable: true,
    } as Content);
  }
  return rangees;
}

/** Texte des SVG : caractères hors police remplacés (le XML échappé reste intact). */
function svgPourPdf(svg: string): string {
  return svg.replace(/>([^<]+)</g, (_, texte: string) => `>${assainirTexte(texte)}<`);
}

async function contenuGraphique(
  ctx: Contexte,
  bloc: Extract<BlocExport, { type: 'graphique' }>
): Promise<Morceau[]> {
  const { t } = ctx;
  const entete = titreBloc(bloc.titre, bloc.sousTitre);
  const contexteGraphique: ContexteGraphique = {
    locale: ctx.locale,
    theme: 'clair',
    rtl: false,
    traduire: ctx.t,
    compact: false,
    statique: true,
  };
  try {
    const resultat = construireOptionGraphique(bloc.spec, bloc.jeu, contexteGraphique);
    if (resultat.vide) {
      return [
        {
          orientation: 'portrait',
          contenu: [
            {
              stack: [...entete, { text: t('graphique.aucuneDonnee'), style: 'note' }],
              unbreakable: true,
            },
          ],
        },
      ];
    }
    const notes: Content[] = [];
    for (const a of resultat.avertissements) {
      if (a.code === 'limite_appliquee' && a.valeurs) {
        notes.push({
          text: t('exportsPdf.limiteAppliquee', {
            n: a.valeurs.n ?? '',
            total: a.valeurs.total ?? '',
          }),
          style: 'note',
        });
      }
    }
    // Rendu à 1,25 fois la largeur utile : les textes de 12 px font environ 9,6 pt.
    const svg = await rendreGraphiqueSvg(resultat.option, {
      largeur: LARGEUR_PORTRAIT * 1.25,
      hauteur: LARGEUR_PORTRAIT * 1.25 * 0.55,
    });
    return [
      {
        orientation: 'portrait',
        contenu: [
          {
            stack: [
              ...entete,
              ...notes,
              { svg: svgPourPdf(svg), width: LARGEUR_PORTRAIT, margin: [0, 4, 0, 12] },
            ],
            unbreakable: true,
          },
        ],
      },
    ];
  } catch {
    // Graphique impossible à dessiner : ses données en tableau, avec une note.
    const tableaux = tableauxDuModele(ctx, bloc.modele);
    return [
      {
        orientation: tableaux.orientation,
        contenu: [
          ...entete,
          { text: t('exportsPdf.graphiqueIndisponible'), style: 'note' },
          ...tableaux.contenus,
        ],
      },
    ];
  }
}

async function morceauxDuBloc(ctx: Contexte, bloc: BlocExport): Promise<Morceau[]> {
  switch (bloc.type) {
    case 'texte':
      return [
        { orientation: 'portrait', contenu: contenuMarkdown(ctx, analyserMarkdown(bloc.markdown)) },
      ];
    case 'tableau': {
      const entete = titreBloc(bloc.titre, bloc.sousTitre);
      const tableaux = tableauxDuModele(ctx, bloc.modele);
      const petit =
        bloc.modele.lignes.length <= LIGNES_TABLEAU_INSECABLE && tableaux.contenus.length <= 2;
      return [
        {
          orientation: tableaux.orientation,
          contenu: petit
            ? [{ stack: [...entete, ...tableaux.contenus], unbreakable: true }]
            : [...entete, ...tableaux.contenus],
        },
      ];
    }
    case 'graphique':
      return contenuGraphique(ctx, bloc);
    case 'indicateurs':
      return [
        {
          orientation: 'portrait',
          contenu: [
            ...titreBloc(bloc.titre, bloc.sousTitre),
            ...grilleIndicateurs(ctx, bloc.indicateurs),
          ],
        },
      ];
  }
}

function pageSources(ctx: Contexte): Content[] {
  const { t, prep, locale } = ctx;
  const aucun = t('exports.provenance.aucun');
  const contenu: Content[] = [
    { text: t('exportsPdf.sourcesEtCalcul'), style: 'titreBloc', tocItem: true },
  ];
  if (prep.exportePar) {
    contenu.push({
      text: t('exports.provenance.exportePar', { nom: assainirTexte(prep.exportePar) }),
      style: 'note',
    });
  }
  // Champs nommés un à un : `Provenance.sql` n'est jamais lu.
  for (const p of prep.provenances) {
    const calcule = new Date(p.calculeA);
    const lignes: [string, string][] = [
      [t('exports.provenance.periode'), p.periode?.libelle || aucun],
      [t('exports.provenance.perimetre'), p.perimetre?.libelle || aucun],
      [
        t('exports.provenance.filtres'),
        p.filtres.length > 0
          ? p.filtres
              .map(f => t('exportsPdf.libelleValeur', { libelle: f.libelle, valeur: f.valeur }))
              .join('\n')
          : aucun,
      ],
      [t('exports.provenance.regles'), p.regles.length > 0 ? p.regles.join('\n') : aucun],
      [
        t('exports.provenance.calculeLe'),
        Number.isNaN(calcule.getTime()) ? aucun : formaterDateHeure(calcule, locale),
      ],
      [
        t('exports.provenance.lienEcran'),
        p.lienEcran ? `${p.lienEcran.libelle} (${p.lienEcran.href})` : aucun,
      ],
    ];
    contenu.push({
      stack: [
        { text: assainirTexte(p.libelleSource), style: 'titreSource' },
        {
          table: {
            widths: [120, '*'],
            body: lignes.map(([libelle, valeur]) => [
              { text: assainirTexte(libelle), bold: true, color: hex(CHARTE.grisTexte) },
              { text: assainirTexte(valeur) },
            ]),
          },
          layout: dispositionTableau(null, 0),
          fontSize: 8.5,
          margin: [0, 2, 0, 12],
        },
      ],
      unbreakable: true,
    });
  }
  return contenu;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

function styles(): TDocumentDefinitions['styles'] {
  return {
    titre: { fontSize: 20, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 0, 0, 4] },
    sousTitre: { fontSize: 11, italics: true, color: hex(CHARTE.grisTexte), margin: [0, 0, 0, 4] },
    contexte: { fontSize: 9, color: hex(CHARTE.grisTexte) },
    titreBloc: { fontSize: 14, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 10, 0, 3] },
    sousTitreBloc: {
      fontSize: 9.5,
      italics: true,
      color: hex(CHARTE.grisTexte),
      margin: [0, 0, 0, 4],
    },
    h1: { fontSize: 13, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 8, 0, 3] },
    h2: { fontSize: 11.5, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 6, 0, 3] },
    h3: { fontSize: 10, bold: true, color: hex(CHARTE.encre), margin: [0, 5, 0, 2] },
    corps: { margin: [0, 0, 0, 6] },
    note: { fontSize: 8, italics: true, color: hex(CHARTE.grisTexte), margin: [0, 0, 0, 4] },
    carteLibelle: { fontSize: 8.5, bold: true, color: hex(CHARTE.grisTexte) },
    carteValeur: { fontSize: 17, bold: true, color: hex(CHARTE.encre), margin: [0, 2, 0, 3] },
    carteDetail: { fontSize: 8, color: hex(CHARTE.grisTexte) },
    titreSource: { fontSize: 10.5, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 6, 0, 2] },
    sommaire: { fontSize: 14, bold: true, color: hex(CHARTE.bleuNuit), margin: [0, 12, 0, 6] },
  };
}

/** Regroupe les morceaux consécutifs de même orientation (une section pdfmake chacun). */
function sections(morceaux: Morceau[]): Content[] {
  const groupes: Morceau[] = [];
  for (const m of morceaux) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.orientation === m.orientation) dernier.contenu.push(...m.contenu);
    else groupes.push({ orientation: m.orientation, contenu: [...m.contenu] });
  }
  return groupes.map(g => ({ section: g.contenu, pageOrientation: g.orientation }) as Content);
}

/**
 * Lignes de contexte (source, période, périmètre) refaites dans la langue du PDF, comme
 * `preparer-export` les écrit : utilisé quand la langue de l'interface n'est pas rendue.
 */
function lignesContexteDe(
  provenances: ExportPrepare['provenances'],
  traduire: Traducteur
): string[] {
  const unique = (valeurs: (string | undefined)[]) => [
    ...new Set(valeurs.filter((v): v is string => typeof v === 'string' && v.trim() !== '')),
  ];
  const lignes: string[] = [];
  const sources = unique(provenances.map(p => p.libelleSource));
  const periodes = unique(provenances.map(p => p.periode?.libelle));
  const perimetres = unique(provenances.map(p => p.perimetre?.libelle));
  if (sources.length > 0) {
    lignes.push(traduire('exports.lignesContexte.source', { valeur: sources.join(', ') }));
  }
  if (periodes.length > 0) {
    lignes.push(traduire('exports.lignesContexte.periode', { valeur: periodes.join(', ') }));
  }
  if (perimetres.length > 0) {
    lignes.push(traduire('exports.lignesContexte.perimetre', { valeur: perimetres.join(', ') }));
  }
  return lignes;
}

/** Définition pdfmake du document (exportée pour les tests ; aucune bibliothèque requise). */
export async function definitionPdf(prep: ExportPrepare): Promise<TDocumentDefinitions> {
  const locale = localePdf(prep.locale);
  // zh, ar, hi : la police n'a pas ces écritures, le texte de chrome passe en anglais (le
  // traducteur serveur retombe sur le français tant que l'anglais n'est pas livré).
  const repli = locale !== prep.locale;
  const traduire = repli ? (await creerTraducteurServeur(locale)).traduire : prep.traduire;
  const t: Traducteur = (cle, valeurs) => assainirTexte(traduire(cle, valeurs));
  const ctx: Contexte = { prep, locale, t };
  const lignesContexte = repli ? lignesContexteDe(prep.provenances, traduire) : prep.lignesContexte;

  const titre = assainirTexte(prep.titre);
  const exporteLe = t('exports.exporteLe', { date: formaterDateHeure(prep.exporteLe, locale) });
  const piedGauche = prep.exportePar
    ? `${exporteLe} · ${assainirTexte(prep.exportePar)}`
    : exporteLe;
  const marque = t('exportsPdf.marque');

  const debut: Content[] = [{ text: titre, style: 'titre' }];
  if (prep.sousTitre && prep.sousTitre.trim() !== '') {
    debut.push({ text: assainirTexte(prep.sousTitre), style: 'sousTitre' });
  }
  for (const ligne of lignesContexte) debut.push({ text: assainirTexte(ligne), style: 'contexte' });
  debut.push({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 4,
        x2: LARGEUR_PORTRAIT,
        y2: 4,
        lineWidth: 1,
        lineColor: hex(CHARTE.bleuNuit),
      },
    ],
    margin: [0, 2, 0, 8],
  });
  if (prep.blocs.length >= BLOCS_MIN_SOMMAIRE) {
    debut.push({
      toc: { title: { text: t('exportsPdf.sommaire'), style: 'sommaire' } },
      margin: [0, 0, 0, 6],
    });
  }

  const morceaux: Morceau[] = [{ orientation: 'portrait', contenu: debut }];
  for (const bloc of prep.blocs) morceaux.push(...(await morceauxDuBloc(ctx, bloc)));
  // Sources et calcul : toujours sur une page à part (section propre).
  const corps = sections(morceaux);
  corps.push({ section: pageSources(ctx), pageOrientation: 'portrait' } as Content);

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: MARGES,
    compress: true,
    displayTitle: true,
    language: locale,
    info: {
      title: titre,
      author: 'Data Genius',
      subject: prep.sousTitre ? assainirTexte(prep.sousTitre) : undefined,
      creator: 'MedicPro',
      producer: 'MedicPro',
      creationDate: prep.exporteLe,
      modDate: prep.exporteLe,
    },
    defaultStyle: {
      font: FAMILLE_POLICE_PDF,
      fontSize: 9.5,
      color: hex(CHARTE.encre),
      lineHeight: 1.15,
    },
    styles: styles(),
    header: (_page, _total, taille) => ({
      margin: [MARGES[0], 20, MARGES[2], 0],
      stack: [
        {
          columns: [
            { text: marque, bold: true, color: hex(CHARTE.bleuNuit), fontSize: 9, width: 'auto' },
            {
              text: tronquer(titre, LONGUEUR_TITRE_COURT),
              alignment: 'right',
              color: hex(CHARTE.grisTexte),
              fontSize: 8,
              width: '*',
            },
          ],
          columnGap: 12,
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 4,
              x2: taille.width - MARGES[0] - MARGES[2],
              y2: 4,
              lineWidth: 0.5,
              lineColor: hex(CHARTE.grisBordure),
            },
          ],
        },
      ],
    }),
    footer: (page, total) => ({
      margin: [MARGES[0], 16, MARGES[2], 0],
      columns: [
        { text: piedGauche, fontSize: 7.5, color: hex(CHARTE.grisTexte), width: '*' },
        {
          text: t('exports.page', { page, total }),
          fontSize: 7.5,
          color: hex(CHARTE.grisTexte),
          alignment: 'right',
          width: 'auto',
        },
      ],
      columnGap: 12,
    }),
    content: corps,
  };
}

let polices: FichiersPolice | null = null;

/** Construit le PDF. Le Buffer commence par `%PDF`. */
export async function construirePdf(prep: ExportPrepare): Promise<Buffer> {
  const pdfmake = await chargerPdfMake();
  polices = polices ?? fichiersPolicePdf();
  // Objet neuf à chaque document : pdfmake réécrit ses descripteurs de police.
  pdfmake.setFonts({ [FAMILLE_POLICE_PDF]: { ...polices } });
  pdfmake.setUrlAccessPolicy(politiqueAccesUrl);
  pdfmake.setLocalAccessPolicy(politiqueAccesLocal(polices));
  const definition = await definitionPdf(prep);
  const buffer = await pdfmake.createPdf(definition).getBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as Uint8Array);
}

