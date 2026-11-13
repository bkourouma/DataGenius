-- Backoff après échec : le worker ne retente plus un jeu en échec toutes les 15 s.
ALTER TABLE warehouse.synchronisations ADD COLUMN echecs_consecutifs integer NOT NULL DEFAULT 0
  CHECK (echecs_consecutifs >= 0);
ALTER TABLE warehouse.synchronisations ADD COLUMN prochain_essai_a timestamptz;

-- Bail d'exclusivité par jeu : la source est lue hors transaction interne, donc sans verrou
-- de transaction. Le bail expire seul si le processus s'arrête sans le libérer.
CREATE TABLE warehouse.verrous_synchronisation (
  jeu text PRIMARY KEY,
  proprietaire text NOT NULL,
  expire_a timestamptz NOT NULL
);
