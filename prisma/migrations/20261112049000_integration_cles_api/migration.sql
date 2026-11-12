CREATE TABLE warehouse.cles_api (
  id uuid PRIMARY KEY,
  empreinte text UNIQUE NOT NULL,
  utilisateur_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  libelle text NOT NULL,
  cree_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  expire_a timestamptz NOT NULL,
  revoque_a timestamptz
);
CREATE INDEX cles_api_utilisateur ON warehouse.cles_api (utilisateur_id);
