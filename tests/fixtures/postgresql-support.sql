\set ON_ERROR_STOP on
CREATE SCHEMA support;
REVOKE CONNECT, TEMPORARY ON DATABASE dg_support FROM PUBLIC;
GRANT CONNECT ON DATABASE dg_support TO dg_support_reader;
CREATE TABLE support.centres (
  "Nom du centre" text PRIMARY KEY,
  segment text NOT NULL,
  information_privee text NOT NULL
);
INSERT INTO support.centres VALUES
  ('Lagune', 'Littoral', 'exclue'),
  ('Plateau', 'Intérieur', 'exclue');
GRANT USAGE ON SCHEMA support TO dg_support_reader;
GRANT SELECT ("Nom du centre", segment) ON support.centres TO dg_support_reader;

CREATE SCHEMA facturation;
CREATE TABLE facturation.reglements (
  reglement_id text PRIMARY KEY,
  facture_id text NOT NULL,
  recu_le date NOT NULL,
  montant numeric(20, 2) NOT NULL
);
INSERT INTO facturation.reglements VALUES
  ('R-001', 'F-001', '2026-10-02', 30.00),
  ('R-002', 'F-001', '2026-10-03', 20.00),
  ('R-003', 'F-002', '2026-10-05', 200.00);
GRANT USAGE ON SCHEMA facturation TO dg_support_reader;
GRANT SELECT ON facturation.reglements TO dg_support_reader;

CREATE TABLE support.tickets (
  ticket_id text PRIMARY KEY,
  equipe text NOT NULL,
  canal text NOT NULL,
  ouvert_le date NOT NULL,
  statut text NOT NULL,
  resolution_minutes integer,
  satisfait boolean
);
INSERT INTO support.tickets VALUES
  ('T-001', 'Nord', 'mail', '2026-10-01', 'resolu', 30, true),
  ('T-002', 'Nord', 'chat', '2026-10-01', 'resolu', 90, false),
  ('T-003', 'Sud', 'mail', '2026-10-02', 'resolu', 120, true),
  ('T-004', 'Sud', 'chat', '2026-10-03', 'ouvert', NULL, NULL);
GRANT SELECT ON support.tickets TO dg_support_reader;
