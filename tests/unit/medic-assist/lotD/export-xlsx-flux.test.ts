/**
 * Export xlsx en flux : le classeur écrit en flux (au-delà du seuil de lignes) doit être
 * identique à celui du chemin non streamé pour le même jeu de données : valeurs, styles,
 * formats, largeurs, hauteurs, gel de volet, filtre, mise en page, pied de page.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  planifierXlsxFlux,
  SEUIL_XLSX_FLUX,
  construireXlsx,
} from '@/lib/medic-assist/artefacts/exports/xlsx';
import type { BlocExport, ExportPrepare } from '@/lib/medic-assist/artefacts/exports/types';
import type { ColonneModele, ModeleTableau } from '@/lib/medic-assist/artefacts/types-rendu';

import { blocTableau, creerPrep, lireClasseur } from '../lot4/_export-fixtures';

const COLONNES: ColonneModele[] = [
  { id: 'pays', libelle: 'Pays', format: 'texte', type: 'dimension', alignement: 'start' },
  { id: 'periode', libelle: 'Période', format: 'periode', type: 'dimension', alignement: 'start' },
  { id: 'jour', libelle: 'Jour', format: 'date', type: 'dimension', alignement: 'start' },
  { id: 'ca', libelle: 'CA', format: 'montant', type: 'valeur', alignement: 'end' },
  { id: 'qte', libelle: 'Quantité', format: 'entier', type: 'valeur', alignement: 'end' },
  { id: 'taux', libelle: 'Réalisation', format: 'pourcentage', type: 'valeur', alignement: 'end' },
  { id: 'note', libelle: 'Commentaire', format: 'texte', type: 'dimension', alignement: 'start' },
  { id: 'an', libelle: '2026', format: 'entier', type: 'valeur', alignement: 'end' },
];

const PAYS = ['Côte d’Ivoire', 'Sénégal', 'Mali', 'Guinée équatoriale', 'Togo'];

/** Jeu déterministe qui mélange nombres, négatifs, dates, vides, textes longs et exacts. */
function modele(nb: number, avecTotaux = true): ModeleTableau {
  const lignes: Record<string, unknown>[] = [];
  for (let i = 0; i < nb; i += 1) {
    lignes.push({
      pays: PAYS[i % PAYS.length],
      periode: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      jour: i % 7 === 3 ? null : `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
      ca: i % 11 === 0 ? null : (i % 5 === 0 ? -1 : 1) * (i * 37.123 + 0.5),
      qte: i % 13 === 0 ? 'n/d' : i * 3 - 10,
      taux: (i * 7) % 130,
      note: i % 9 === 0 ? null : i % 17 === 5 ? 'Texte long avec plusieurs mots à couper\nsur deux lignes' : `ligne ${i}`,
      an: i % 4 === 0 ? 123456789 : i,
    });
  }
  return {
    colonnes: COLONNES,
    lignes,
    totaux: avecTotaux ? { ca: 9999999.5, qte: 42, an: 1 } : null,
    estPivot: false,
    nbLignesSource: nb,
    nbLignesFiltrees: nb,
  };
}

async function lireFlux(flux: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(flux as unknown as BodyInit).arrayBuffer());
}

const sansUndefined = (valeur: unknown) => JSON.parse(JSON.stringify(valeur ?? null));

/** Compare deux classeurs relus : tout ce qui se voit dans Excel. */
function comparer(a: ExcelJS.Workbook, b: ExcelJS.Workbook): void {
  expect(b.worksheets.map(f => f.name)).toEqual(a.worksheets.map(f => f.name));
  for (const fa of a.worksheets) {
    const fb = b.getWorksheet(fa.name)!;
    expect(fb.rowCount, `${fa.name} : lignes`).toBe(fa.rowCount);
    expect(fb.columnCount, `${fa.name} : colonnes`).toBe(fa.columnCount);
    for (let c = 1; c <= fa.columnCount; c += 1) {
      expect(fb.getColumn(c).width, `${fa.name} : largeur ${c}`).toBe(fa.getColumn(c).width);
    }
    expect(sansUndefined(fb.views), `${fa.name} : volet`).toEqual(sansUndefined(fa.views));
    expect(sansUndefined(fb.autoFilter), `${fa.name} : filtre`).toEqual(
      sansUndefined(fa.autoFilter)
    );
    expect(sansUndefined(fb.pageSetup), `${fa.name} : mise en page`).toEqual(
      sansUndefined(fa.pageSetup)
    );
    expect(fb.headerFooter.oddHeader).toBe(fa.headerFooter.oddHeader);
    expect(fb.headerFooter.oddFooter).toBe(fa.headerFooter.oddFooter);
    expect(sansUndefined(fb.model.merges), `${fa.name} : fusions`).toEqual(
      sansUndefined(fa.model.merges)
    );
    // Cellule par cellule : on compare dans une seule assertion pour garder un message lisible.
    const ecarts: string[] = [];
    fa.eachRow({ includeEmpty: true }, (la, r) => {
      const lb = fb.getRow(r);
      if ((lb.height ?? null) !== (la.height ?? null)) ecarts.push(`hauteur ${fa.name}!${r}`);
      for (let c = 1; c <= fa.columnCount; c += 1) {
        const ca = la.getCell(c);
        const cb = lb.getCell(c);
        const va = JSON.stringify(ca.value ?? null);
        const vb = JSON.stringify(cb.value ?? null);
        if (va !== vb) ecarts.push(`valeur ${fa.name}!${r}:${c} ${va} <> ${vb}`);
        const sa = JSON.stringify({ ...ca.style, numFmt: ca.numFmt });
        const sb = JSON.stringify({ ...cb.style, numFmt: cb.numFmt });
        if (sa !== sb) ecarts.push(`style ${fa.name}!${r}:${c} ${sa} <> ${sb}`);
      }
    });
    expect(ecarts.slice(0, 5), `${fa.name} : écarts (${ecarts.length})`).toEqual([]);
  }
}

async function comparerDeuxChemins(prep: ExportPrepare, seuil: number): Promise<void> {
  const plan = planifierXlsxFlux(prep, seuil);
  expect(plan, 'le flux doit être planifié').not.toBeNull();
  const flux = await lireFlux(plan!.creerFlux());
  expect(flux.subarray(0, 2).toString('latin1')).toBe('PK');
  const classique = await lireClasseur(await construireXlsx(prep));
  const enFlux = await lireClasseur(flux);
  expect(enFlux.creator, 'créateur').toBeTruthy();
  expect(enFlux.creator).toBe(classique.creator);
  comparer(classique, enFlux);
}

describe('xlsx en flux : identique au chemin non streamé', () => {
  it('a un seuil par défaut de 20 000 lignes', () => {
    expect(SEUIL_XLSX_FLUX).toBe(20_000);
  });

  it('ne planifie rien sous le seuil (chemin non streamé conservé)', async () => {
    const prep = await creerPrep([blocTableau(modele(10, false))]);
    expect(planifierXlsxFlux(prep)).toBeNull();
    expect(planifierXlsxFlux(prep, 10)).toBeNull();
    expect(planifierXlsxFlux(prep, 9)).not.toBeNull();
  });

  it('mêmes valeurs, styles, largeurs, volet et filtre avec totaux (seuil abaissé)', async () => {
    await comparerDeuxChemins(await creerPrep([blocTableau(modele(300))]), 5);
  });

  it('idem sans ligne de total', async () => {
    await comparerDeuxChemins(await creerPrep([blocTableau(modele(250, false))]), 5);
  });

  it('idem pour un tableau d’une colonne et en arabe (volet inversé)', async () => {
    const m = modele(80);
    m.colonnes = m.colonnes.slice(0, 1);
    await comparerDeuxChemins(await creerPrep([blocTableau(m)], { locale: 'ar' }), 5);
  });

  it('idem avec deux tableaux (un petit recopié, un gros en flux) et la provenance', async () => {
    const petit = modele(3);
    const prep = await creerPrep([
      blocTableau(petit, 'Petit'),
      blocTableau(modele(120), 'Gros'),
    ]);
    await comparerDeuxChemins(prep, 50);
  });

  it('bascule en flux au vrai seuil (20 001 lignes) et le fichier se relit en entier', async () => {
    // Deux colonnes seulement : ExcelJS est lent sur ce volume (l'équivalence détaillée est testée plus haut).
    const m = modele(SEUIL_XLSX_FLUX + 1, false);
    m.colonnes = [m.colonnes[0], m.colonnes[4]];
    const prep = await creerPrep([blocTableau(m)]);
    expect(planifierXlsxFlux(prep, SEUIL_XLSX_FLUX + 1)).toBeNull();
    const plan = planifierXlsxFlux(prep);
    expect(plan).not.toBeNull();
    const classeur = await lireClasseur(await lireFlux(plan!.creerFlux()));
    const f = classeur.getWorksheet('CA par pays')!;
    // Titre, 3 lignes de contexte, « Exporté le », ligne vide, en-tête, puis les données.
    expect(f.getRow(7).getCell(1).value).toBe('Pays');
    expect(f.rowCount).toBe(7 + SEUIL_XLSX_FLUX + 1);
    expect(f.getRow(8).getCell(1).value).toBe('Côte d’Ivoire');
    expect(f.getRow(7 + SEUIL_XLSX_FLUX + 1).getCell(2).value).toBe(SEUIL_XLSX_FLUX * 3 - 10);
  }, 180_000);

  it('renvoie null (chemin non streamé) quand une feuille colorée par seuils dépasse le seuil', async () => {
    const indicateur = {
      type: 'indicateurs',
      titre: 'KPI',
      indicateurs: Array.from({ length: 4 }, (_, i) => ({
        id: `k${i}`,
        libelle: `Indicateur ${i}`,
        valeur: { brute: i * 10, affichee: String(i * 10) },
        objectif: { brute: 100, affichee: '100' },
      })),
    } as unknown as BlocExport;
    const prep = await creerPrep([indicateur]);
    // Seuil 0 : la feuille d'indicateurs (avec taux) serait « grosse » ; le helper la colore par valeur.
    expect(planifierXlsxFlux(prep, 0)).toBeNull();
  });

  it('ne laisse rien en suspens quand le lecteur annule le flux', async () => {
    const prep = await creerPrep([blocTableau(modele(5000))]);
    const flux = planifierXlsxFlux(prep, 5)!.creerFlux();
    const lecteur = flux.getReader();
    await lecteur.read();
    await lecteur.cancel();
    // Laisse la boucle d'écriture constater l'annulation : aucune exception non gérée.
    await new Promise(r => setTimeout(r, 50));
  });
});
