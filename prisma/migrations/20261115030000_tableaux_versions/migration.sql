CREATE TABLE warehouse.tableaux_versions (
  tableau_id uuid NOT NULL REFERENCES warehouse.tableaux(id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  auteur_id text REFERENCES public.users(id) ON DELETE SET NULL,
  cree_a timestamptz NOT NULL,
  PRIMARY KEY (tableau_id, version)
);

CREATE INDEX tableaux_versions_auteur ON warehouse.tableaux_versions(auteur_id);
