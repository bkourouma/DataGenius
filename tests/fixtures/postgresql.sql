\set ON_ERROR_STOP on

CREATE SCHEMA metier;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE dg_source FROM PUBLIC;
GRANT CONNECT ON DATABASE dg_source TO dg_reader;

CREATE TABLE metier.activite (
  agence text NOT NULL,
  produit text NOT NULL,
  mois text NOT NULL,
  quantite integer NOT NULL,
  ca numeric(12, 2) NOT NULL,
  stock integer NOT NULL,
  objectif numeric(12, 2) NOT NULL
);
INSERT INTO metier.activite VALUES
  ('Lagune', 'Aster', '2026-09', 25, 500.00, 40, 600.00),
  ('Lagune', 'Boreal', '2026-09', 10, 300.00, 20, 350.00),
  ('Plateau', 'Aster', '2026-09', 12, 240.00, 35, 300.00),
  ('Plateau', 'Boreal', '2026-09', 8, 240.00, 15, 250.00),
  ('Lagune', 'Aster', '2026-10', 40, 800.00, 32, 750.00),
  ('Lagune', 'Boreal', '2026-10', 16, 480.00, 18, 450.00),
  ('Plateau', 'Aster', '2026-10', 15, 300.00, 24, 350.00),
  ('Plateau', 'Boreal', '2026-10', 10, 300.00, 19, 320.00);

GRANT USAGE ON SCHEMA metier TO dg_reader;
GRANT SELECT (agence, produit, mois, quantite, ca, stock, objectif) ON metier.activite TO dg_reader;
ALTER ROLE dg_reader IN DATABASE dg_source SET default_transaction_read_only = on;

CREATE SCHEMA finance;
CREATE TABLE finance.factures (
  facture_id text PRIMARY KEY,
  equipe text NOT NULL,
  emise_le date NOT NULL,
  devise text NOT NULL,
  montant numeric(20, 2) NOT NULL
);
INSERT INTO finance.factures VALUES
  ('F-001', 'Nord', '2026-10-01', 'XOF', 100.00),
  ('F-002', 'Nord', '2026-10-01', 'XOF', 200.00),
  ('F-003', 'Sud', '2026-10-03', 'XOF', 80.00),
  ('F-004', 'Sud', '2026-10-03', 'EUR', 70.01);
GRANT USAGE ON SCHEMA finance TO dg_reader;
GRANT SELECT ON finance.factures TO dg_reader;

CREATE TABLE finance.ecritures (libelle text PRIMARY KEY, montant numeric(24, 2) NOT NULL);
INSERT INTO finance.ecritures VALUES ('Crédit', 9007199254740993.25), ('Débit', -0.10);
GRANT SELECT ON finance.ecritures TO dg_reader;
