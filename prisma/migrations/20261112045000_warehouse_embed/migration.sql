CREATE TABLE warehouse.jetons_integration (
  empreinte text PRIMARY KEY,
  utilisateur_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tableau_id uuid NOT NULL REFERENCES warehouse.tableaux(id) ON DELETE CASCADE,
  origine text NOT NULL,
  expire_a timestamptz NOT NULL
);
CREATE INDEX jetons_integration_expiration ON warehouse.jetons_integration(expire_a);
