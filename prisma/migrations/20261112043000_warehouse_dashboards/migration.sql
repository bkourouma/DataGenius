CREATE TABLE warehouse.tableaux (
  id uuid PRIMARY KEY,
  proprietaire_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  definition jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  modifie_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  alertes_verifie_a timestamptz
);
CREATE INDEX tableaux_proprietaire ON warehouse.tableaux(proprietaire_id, modifie_a DESC);

CREATE TABLE warehouse.lecteurs_tableaux (
  tableau_id uuid NOT NULL REFERENCES warehouse.tableaux(id) ON DELETE CASCADE,
  utilisateur_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (tableau_id, utilisateur_id)
);
CREATE INDEX lecteurs_tableaux_utilisateur ON warehouse.lecteurs_tableaux(utilisateur_id);

CREATE TABLE warehouse.etat_alertes_tableaux (
  tableau_id uuid NOT NULL REFERENCES warehouse.tableaux(id) ON DELETE CASCADE,
  tuile_id uuid NOT NULL,
  etat boolean NOT NULL,
  verifie_a timestamptz NOT NULL,
  PRIMARY KEY (tableau_id, tuile_id)
);
