CREATE SCHEMA "warehouse";
REVOKE ALL ON SCHEMA "warehouse" FROM PUBLIC;

CREATE TABLE "warehouse"."snapshots" (
  "jeu" text PRIMARY KEY,
  "empreinte" text NOT NULL,
  "contenu" jsonb NOT NULL CHECK (jsonb_typeof("contenu") = 'array'),
  "hash" text NOT NULL,
  "lignes" integer NOT NULL CHECK ("lignes" >= 0),
  "publie_a" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "warehouse"."synchronisations" (
  "jeu" text PRIMARY KEY,
  "empreinte" text NOT NULL,
  "verifie_a" timestamptz NOT NULL,
  "statut" text NOT NULL CHECK ("statut" IN ('publie', 'identique', 'echec'))
);
