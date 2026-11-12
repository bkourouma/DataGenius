/**
 * SQL controle (`requete_sql`) : requetes LEGITIMES, parfois complexes, qui doivent PASSER
 * l'analyse, et ce que l'analyse rend (vues referencees, SQL re-emis, alias de colonnes).
 */

import { describe, expect, it } from 'vitest';

import { analyserSql } from '@/lib/medic-assist/donnees/sql/analyseur';

const VUES = [
  'mv_ventes',
  'mv_budget',
  'mv_stocks',
  'mv_produits',
  'mv_pays',
  'mv_grossistes',
  'mv_agences',
];

function accepte(sql: string) {
  const r = analyserSql(sql, VUES);
  if (!r.ok) throw new Error(`Refus inattendu : ${r.message}\nSQL : ${sql}`);
  return r;
}

describe('requete_sql : requetes legitimes acceptees', () => {
  const cas: [string, string, string[]][] = [
    [
      'agregat simple avec tri et limite',
      'SELECT pays, SUM(ca_eur) AS ca_eur FROM mv_ventes WHERE annee = 2026 GROUP BY pays ORDER BY ca_eur DESC LIMIT 10',
      ['mv_ventes'],
    ],
    [
      'CTE multiples et jointure de deux vues',
      `WITH ventes AS (
         SELECT pays_id, pays, SUM(ca_eur) AS ca_eur FROM mv_ventes WHERE exercice = 2025 GROUP BY pays_id, pays
       ), budget AS (
         SELECT pays_id, SUM(budget_eur) AS budget_eur FROM mv_budget WHERE annee = 2025 GROUP BY pays_id
       )
       SELECT v.pays, v.ca_eur, b.budget_eur,
              ROUND((v.ca_eur / NULLIF(b.budget_eur, 0) * 100)::numeric, 1) AS taux_pct
       FROM ventes v LEFT JOIN budget b ON b.pays_id = v.pays_id
       ORDER BY taux_pct DESC NULLS LAST`,
      ['mv_budget', 'mv_ventes'],
    ],
    [
      'fonctions de fenetre rank et lag',
      `SELECT pays, periode, ca_eur,
              RANK() OVER (PARTITION BY periode ORDER BY ca_eur DESC) AS rang,
              LAG(ca_eur, 1) OVER (PARTITION BY pays ORDER BY periode) AS ca_mois_precedent,
              SUM(ca_eur) OVER (PARTITION BY pays ORDER BY periode ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumul_eur
       FROM (SELECT pays, periode, SUM(ca_eur) AS ca_eur FROM mv_ventes GROUP BY pays, periode) t`,
      ['mv_ventes'],
    ],
    [
      'CASE, COALESCE, NULLIF',
      `SELECT produit,
              CASE WHEN SUM(quantite) >= 1000 THEN 'fort' WHEN SUM(quantite) >= 100 THEN 'moyen' ELSE 'faible' END AS niveau,
              COALESCE(SUM(ca_eur), 0) AS ca_eur,
              SUM(ca_eur) / NULLIF(SUM(quantite), 0) AS prix_moyen_eur
       FROM mv_ventes GROUP BY produit`,
      ['mv_ventes'],
    ],
    [
      'dates : date_trunc, to_char, age, extract, interval, make_date',
      `SELECT to_char(date_trunc('month', date_vente), 'YYYY-MM') AS mois,
              EXTRACT(YEAR FROM date_vente)::int AS annee_vente,
              age(make_date(2026, 3, 31), date_vente) AS anciennete,
              COUNT(*) AS nb
       FROM mv_ventes
       WHERE date_vente >= CURRENT_DATE - INTERVAL '12 months' AND date_vente < DATE '2027-04-01'
       GROUP BY 1, 2, 3`,
      ['mv_ventes'],
    ],
    [
      'FILTER (WHERE ...) et string_agg ordonne',
      `SELECT pays,
              SUM(ca_eur) FILTER (WHERE exercice = 2025) AS ca_2025_eur,
              SUM(ca_eur) FILTER (WHERE exercice = 2024) AS ca_2024_eur,
              STRING_AGG(DISTINCT produit, ', ') AS produits,
              COUNT(DISTINCT grossiste_id) AS nb_grossistes
       FROM mv_ventes GROUP BY pays`,
      ['mv_ventes'],
    ],
    [
      'UNION ALL entre vues autorisees',
      `SELECT 'vente' AS source, pays, SUM(ca_eur) AS montant_eur FROM mv_ventes GROUP BY pays
       UNION ALL
       SELECT 'budget' AS source, pays, SUM(budget_eur) AS montant_eur FROM mv_budget GROUP BY pays
       ORDER BY pays, source`,
      ['mv_budget', 'mv_ventes'],
    ],
    [
      'sous-requete correlee scalaire et EXISTS',
      `SELECT p.produit,
              (SELECT MAX(s.quantite) FROM mv_stocks s WHERE s.produit_id = p.produit_id) AS stock_max
       FROM mv_produits p
       WHERE EXISTS (SELECT 1 FROM mv_ventes v WHERE v.produit_id = p.produit_id AND v.annee = 2026)
         AND p.produit_id NOT IN (SELECT produit_id FROM mv_budget WHERE annee = 2026)
         AND NOT EXISTS (SELECT 1 FROM mv_stocks s2 WHERE s2.produit_id = p.produit_id AND s2.quantite < 0)`,
      ['mv_budget', 'mv_produits', 'mv_stocks', 'mv_ventes'],
    ],
    [
      'casts ::numeric, ::text, ::date et CAST(... AS ...)',
      `SELECT SUM(ca_eur)::numeric(14, 2) AS ca_eur, CAST(annee AS text) AS annee_txt,
              '2026-01-01'::date AS debut, AVG(quantite)::float8 AS moyenne
       FROM mv_ventes GROUP BY annee`,
      ['mv_ventes'],
    ],
    [
      'LATERAL vers une vue autorisee',
      `SELECT p.pays, t.ca_eur FROM mv_pays p
       CROSS JOIN LATERAL (SELECT SUM(v.ca_eur) AS ca_eur FROM mv_ventes v WHERE v.pays_id = p.pays_id) t`,
      ['mv_pays', 'mv_ventes'],
    ],
    [
      'jointure entre parentheses de vues autorisees',
      'SELECT * FROM (mv_ventes v JOIN mv_pays p ON p.pays_id = v.pays_id) LIMIT 5',
      ['mv_pays', 'mv_ventes'],
    ],
    [
      'generate_series borne pour un calendrier',
      `SELECT to_char(m, 'YYYY-MM') AS periode FROM generate_series(DATE '2025-04-01', DATE '2026-03-01', INTERVAL '1 month') AS m`,
      [],
    ],
    [
      'texte : lower, upper, trim, split_part, lpad, concat, LIKE/ILIKE',
      `SELECT upper(pays) AS pays_maj, lower(trim(produit)) AS produit_min, split_part(periode, '-', 1) AS an,
              lpad(CAST(mois AS text), 2, '0') AS mois_2, concat(pays, ' / ', produit) AS libelle
       FROM mv_ventes WHERE produit ILIKE '%amox%' AND pays NOT LIKE 'Z%'`,
      ['mv_ventes'],
    ],
    [
      'percentile, stddev, greatest/least, round, BETWEEN, IN',
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ca_eur) AS mediane_eur, stddev(ca_eur) AS ecart_type,
              greatest(MAX(ca_eur), 0) AS max_eur, least(MIN(ca_eur), 0) AS min_eur, round(AVG(ca_eur)::numeric, 2) AS moy_eur
       FROM mv_ventes WHERE mois BETWEEN 1 AND 6 AND annee IN (2025, 2026)`,
      ['mv_ventes'],
    ],
    [
      'point-virgule final tolere et casse melangee',
      'Select Pays, Sum(Ca_Eur) As Total_Eur From MV_VENTES Group By Pays;',
      ['mv_ventes'],
    ],
    [
      'chaines contenant -- /* ; et apostrophe doublee',
      "SELECT COUNT(*) AS nb FROM mv_pays WHERE pays IN ('Côte d''Ivoire', 'a--b', 'x/*y*/', 'p;q')",
      ['mv_pays'],
    ],
    [
      'ntile, row_number, dense_rank, first_value',
      `SELECT pays, NTILE(4) OVER (ORDER BY ca_eur) AS quartile, ROW_NUMBER() OVER (ORDER BY ca_eur DESC) AS rang,
              DENSE_RANK() OVER (ORDER BY ca_eur DESC) AS rang_dense, first_value(pays) OVER w AS premier
       FROM (SELECT pays, SUM(ca_eur) AS ca_eur FROM mv_ventes GROUP BY pays) t WINDOW w AS (ORDER BY ca_eur DESC)`,
      ['mv_ventes'],
    ],
    [
      'DISTINCT ON, OFFSET, IS NULL, NOT',
      `SELECT DISTINCT ON (pays) pays, periode, ca_eur FROM mv_ventes
       WHERE grossiste_id IS NOT NULL AND NOT (ca_eur = 0) ORDER BY pays, periode DESC LIMIT 50 OFFSET 10`,
      ['mv_ventes'],
    ],
  ];

  for (const [titre, sql, vues] of cas) {
    it(titre, () => {
      const r = accepte(sql);
      expect(r.vues).toEqual(vues);
      expect(r.sqlNormalise.length).toBeGreaterThan(0);
      // Le texte re-emis est lui-meme accepte et stable.
      const r2 = accepte(r.sqlNormalise);
      expect(r2.vues).toEqual(vues);
    });
  }
});

describe('requete_sql : re-emission et nommage', () => {
  it('re-emet le SQL depuis l arbre : noms entre guillemets, casse normalisee', () => {
    const r = accepte('SELECT Pays FROM MV_Ventes v WHERE V.annee = 2026');
    expect(r.sqlNormalise).toContain('"mv_ventes"');
    expect(r.sqlNormalise).not.toMatch(/MV_Ventes/);
  });

  it('nomme les expressions sans alias et dedoublonne', () => {
    const r = accepte('SELECT SUM(ca_eur), SUM(quantite), COUNT(*) FROM mv_ventes');
    expect(r.sqlNormalise).toContain('as "sum"');
    expect(r.sqlNormalise).toContain('as "sum_2"');
    expect(r.sqlNormalise).toContain('as "count"');
  });

  it('refuse deux colonnes explicites de meme nom', () => {
    const r = analyserSql(
      'SELECT v.pays_id, p.pays_id FROM mv_ventes v JOIN mv_pays p ON p.pays_id = v.pays_id',
      VUES
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/double : pays_id/);
  });

  it('ne rend que les vues effectivement referencees', () => {
    const r = accepte('WITH x AS (SELECT pays FROM mv_pays) SELECT * FROM x');
    expect(r.vues).toEqual(['mv_pays']);
  });

  it('une CTE peut lire une CTE precedente', () => {
    accepte(
      'WITH a AS (SELECT pays_id FROM mv_pays), b AS (SELECT pays_id FROM a) SELECT * FROM b'
    );
  });
});
