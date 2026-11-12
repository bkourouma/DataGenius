ALTER TABLE warehouse.sources
  ADD COLUMN type text NOT NULL DEFAULT 'postgresql' CHECK (type IN ('postgresql', 'mysql', 'rest', 'fichier'));

CREATE TABLE warehouse.source_fichiers (
  source_id text PRIMARY KEY REFERENCES warehouse.sources(id) ON DELETE CASCADE,
  nom text NOT NULL,
  contenu bytea NOT NULL CHECK (octet_length(contenu) BETWEEN 1 AND 5242880)
);
