CREATE TABLE warehouse.espaces (
  id uuid PRIMARY KEY,
  nom text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE warehouse.espaces_groupes (
  espace_id uuid NOT NULL REFERENCES warehouse.espaces(id) ON DELETE CASCADE,
  groupe_id uuid NOT NULL REFERENCES warehouse.groupes_acces(id) ON DELETE CASCADE,
  PRIMARY KEY (espace_id, groupe_id)
);

CREATE TABLE warehouse.espaces_jeux (
  jeu text PRIMARY KEY,
  espace_id uuid NOT NULL REFERENCES warehouse.espaces(id) ON DELETE CASCADE
);
CREATE INDEX espaces_jeux_espace ON warehouse.espaces_jeux (espace_id);

CREATE OR REPLACE FUNCTION warehouse.reviser_acces_compte() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM warehouse.regles_acces UNION ALL SELECT 1 FROM warehouse.espaces_jeux) THEN
    UPDATE warehouse.revision_acces SET revision = revision + 1, depuis = clock_timestamp() WHERE id = 1;
  END IF;
  RETURN NEW;
END;
$$;
