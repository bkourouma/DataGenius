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
