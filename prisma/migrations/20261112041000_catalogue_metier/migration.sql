CREATE TABLE warehouse.catalogue_metier (
  jeu text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  publie_par text NOT NULL,
  publie_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (jeu, version)
);
