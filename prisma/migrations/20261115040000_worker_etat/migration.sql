-- État du worker de synchronisation : une ligne par processus (instance), mise à jour à chaque
-- battement. Toutes les horloges viennent de la base (clock_timestamp()), jamais de l'application.
CREATE TABLE warehouse.worker_etat (
  instance text PRIMARY KEY,
  hote text NOT NULL,
  version text NOT NULL,
  demarre_a timestamptz NOT NULL,
  dernier_signe_a timestamptz NOT NULL,
  intervalle_ms integer NOT NULL,
  dernier_tour_a timestamptz,
  dernier_tour_duree_ms integer,
  dernier_tour_jeux integer,
  dernier_tour_erreurs integer
);
CREATE INDEX worker_etat_dernier_signe ON warehouse.worker_etat (dernier_signe_a DESC);
