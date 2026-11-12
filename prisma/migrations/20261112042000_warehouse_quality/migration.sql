CREATE TABLE warehouse.qualite_imports (
  jeu text PRIMARY KEY REFERENCES warehouse.imports(cle) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL
);

ALTER TABLE warehouse.synchronisations ADD COLUMN qualite_version integer NOT NULL DEFAULT 0;
ALTER TABLE warehouse.synchronisations ADD COLUMN reussi_a timestamptz;
UPDATE warehouse.synchronisations SET reussi_a = verifie_a WHERE statut IN ('publie', 'identique');
UPDATE warehouse.synchronisations t SET reussi_a = s.publie_a
FROM warehouse.snapshots s WHERE t.jeu = s.jeu AND t.empreinte = s.empreinte AND t.reussi_a IS NULL;

ALTER TABLE warehouse.snapshots ADD COLUMN verifie_a timestamptz;
ALTER TABLE warehouse.snapshots ADD COLUMN verification_ok boolean;
ALTER TABLE warehouse.snapshots ADD COLUMN fraiche_jusqua timestamptz;
UPDATE warehouse.snapshots s SET verifie_a = t.verifie_a, verification_ok = t.statut <> 'echec'
FROM warehouse.synchronisations t WHERE t.jeu = s.jeu AND t.empreinte = s.empreinte;

CREATE TABLE warehouse.executions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jeu text NOT NULL,
  empreinte text NOT NULL,
  qualite_version integer NOT NULL,
  verifie_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  duree_ms integer NOT NULL CHECK (duree_ms >= 0),
  statut text NOT NULL CHECK (statut IN ('publie', 'identique', 'echec')),
  lignes_lues integer,
  lignes_valides integer,
  code text
);
CREATE INDEX executions_jeu_recente ON warehouse.executions (jeu, verifie_a DESC, id DESC);
