import { describe, expect, it } from 'vitest';

import {
  construireCsv,
  echapperCellule,
  neutraliserFormule,
} from '@/lib/medic-assist/artefacts/exports/csv';
import type { ModeleTableau } from '@/lib/medic-assist/artefacts/types-rendu';

import { blocTableau, COLONNES, creerPrep, modeleSimple } from './_export-fixtures';

const texte = (b: Buffer) => b.toString('utf8');

async function csv(modele: ModeleTableau, locale: 'fr' | 'en' | 'zh' | 'ar' = 'fr') {
  return texte(construireCsv(await creerPrep([blocTableau(modele)], { locale })));
}

describe('construireCsv', () => {
  it('commence par le BOM UTF-8, sépare par « ; » et termine les lignes par CRLF', async () => {
    const buffer = construireCsv(await creerPrep([blocTableau(modeleSimple(false))]));
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const s = texte(buffer);
    expect(s.startsWith('﻿Pays;Période;Jour;CA;Quantité;Réalisation\r\n')).toBe(true);
    expect(s.endsWith('\r\n')).toBe(true);
    expect(s.split('\r\n')).toHaveLength(5); // en-tête + 3 lignes + fin vide
    expect(s.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('n’écrit ni titre ni lignes de contexte', async () => {
    const s = await csv(modeleSimple(false));
    expect(s).not.toContain('Source :');
    expect(s).not.toContain('Exporté le');
    expect(s).not.toContain('Chiffre d’affaires par pays');
  });

  it('met la virgule décimale en fr et es, le point sinon, sans séparateur de milliers', async () => {
    const fr = await csv(modeleSimple(false), 'fr');
    expect(fr).toContain('Côte d’Ivoire;2026-04;2026-04-15;1250,5;120;85,5');
    const en = await csv(modeleSimple(false), 'en');
    expect(en).toContain('Côte d’Ivoire;2026-04;2026-04-15;1250.5;120;85.5');
    const ar = await csv(modeleSimple(false), 'ar');
    expect(ar).toContain('1250.5');
  });

  it('ne préfixe pas les nombres négatifs', async () => {
    const s = await csv(modeleSimple(false), 'en');
    expect(s).toContain('Mali;2026-06;2026-06-30;-40.25;-3;101.2');
    expect(s).not.toContain("'-40.25");
  });

  it('arrondit les nombres à 15 chiffres significatifs (pas de 78506.51999999999)', async () => {
    const modele = modeleSimple(false);
    modele.lignes = [
      {
        pays: 'A',
        periode: '2026-04',
        jour: '2026-04-15',
        ca: 78506.51999999999,
        qte: 5,
        taux: 0.1 + 0.2,
      },
      {
        pays: 'B',
        periode: '2026-05',
        jour: '2026-05-15',
        ca: -78506.51999999999,
        qte: 1e21,
        taux: 12,
      },
    ];
    const en = await csv(modele, 'en');
    expect(en).toContain('A;2026-04;2026-04-15;78506.52;5;0.3');
    expect(en).toContain('B;2026-05;2026-05-15;-78506.52;1000000000000000000000;12');
    const fr = await csv(modele, 'fr');
    expect(fr).toContain('78506,52');
    expect(fr).not.toContain('51999');
  });

  it('ajoute la ligne de totaux seulement si demandée', async () => {
    const avec = (await csv(modeleSimple(true), 'en')).split('\r\n');
    expect(avec.at(-2)).toBe('Total;;;2190.25;192;');
    const sans = await csv(modeleSimple(false), 'en');
    expect(sans).not.toContain('Total');
  });

  it('met entre guillemets les valeurs avec ;, guillemet ou retour à la ligne', async () => {
    const modele = modeleSimple(false);
    modele.lignes = [
      { pays: 'A;B', periode: 'dit "oui"', jour: null, ca: 1, qte: 2, taux: 3 },
      { pays: 'ligne1\nligne2', periode: ' espace', jour: null, ca: null, qte: null, taux: null },
    ];
    const s = await csv(modele, 'en');
    expect(s).toContain('"A;B";"dit ""oui""";;1;2;3');
    expect(s).toContain('"ligne1\nligne2";" espace";;;;');
  });

  it('neutralise l’injection de formule dans les cellules texte et les en-têtes', async () => {
    const modele = modeleSimple(false);
    modele.colonnes = COLONNES.map((c, i) => (i === 1 ? { ...c, libelle: '=SOMME(A1)' } : c));
    modele.lignes = [
      { pays: '=HYPERLINK("http://x")', periode: '+1', jour: '@cmd', ca: 5, qte: 1, taux: 1 },
      { pays: '-2+3', periode: '\tx', jour: '\rx', ca: -5, qte: 1, taux: 1 },
    ];
    const s = await csv(modele, 'en');
    expect(s).toContain("'=SOMME(A1)");
    expect(s).toContain(`"'=HYPERLINK(""http://x"")";'+1;'@cmd;5;1;1`);
    expect(s).toContain("'-2+3;'\tx;\"'\rx\";-5;1;1");
    for (const ligne of s.split('\r\n').slice(1)) {
      for (const cellule of ligne.split(';')) {
        expect(cellule.replace(/^"/, '')).not.toMatch(/^[=+@]/);
      }
    }
  });

  it('exporte les graphiques par leurs données et les indicateurs une ligne par carte', async () => {
    const prepGraph = await creerPrep(
      [
        {
          type: 'graphique',
          titre: 'G',
          spec: { forme: 'barres', x: 'pays', y: [{ cle: 'ca' }] },
          jeu: {} as never,
          modele: modeleSimple(false),
        },
      ],
      { locale: 'en' }
    );
    expect(texte(construireCsv(prepGraph))).toContain('Sénégal;2026-05;2026-05-02;980;75;62');

    const prepInd = await creerPrep(
      [
        {
          type: 'indicateurs',
          titre: 'I',
          indicateurs: [
            {
              libelle: 'CA',
              valeur: 10.5,
              format: 'montant',
              valeurFormatee: '',
              objectif: { valeur: 20, valeurFormatee: '', taux: 52.5, statut: 'a_risque' },
            },
            { libelle: 'Marge', valeur: null, format: 'montant', valeurFormatee: '' },
          ],
        },
      ],
      { locale: 'fr' }
    );
    const lignes = texte(construireCsv(prepInd)).split('\r\n');
    expect(lignes[0]).toBe(
      "﻿Indicateur;Valeur;Comparaison;Valeur de comparaison;Variation (%);Objectif;Valeur de l'objectif;Taux de réalisation (%);Statut"
    );
    expect(lignes[1]).toBe('CA;10,5;;;;;20;52,5;À risque');
    expect(lignes[2]).toBe('Marge;;;;;;;;');
  });

  it('conserve le chinois et l’arabe en UTF-8', async () => {
    const modele = modeleSimple(false);
    modele.lignes = [{ pays: '科特迪瓦', periode: 'السنغال', jour: null, ca: 1, qte: 1, taux: 1 }];
    const s = await csv(modele, 'zh');
    expect(s).toContain('科特迪瓦;السنغال');
  });
});

describe('aides csv', () => {
  it('neutraliserFormule et echapperCellule', () => {
    expect(neutraliserFormule('=1')).toBe("'=1");
    expect(neutraliserFormule('abc')).toBe('abc');
    expect(neutraliserFormule('a=1')).toBe('a=1');
    expect(echapperCellule('a"b')).toBe('"a""b"');
    expect(echapperCellule('simple')).toBe('simple');
  });
});
