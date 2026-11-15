-- Compléments de définition et synonymes des indicateurs du catalogue publié (modifiables par un TenantAdmin).
CREATE TABLE warehouse.glossaire (
  jeu text NOT NULL,
  indicateur text NOT NULL,
  definition text NOT NULL DEFAULT '' CHECK (char_length(definition) <= 600),
  synonymes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(synonymes) <= 10),
  modifie_par text NOT NULL,
  modifie_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (jeu, indicateur)
);

-- Commentaires en texte brut sur une analyse (artefact_id = racineId de l'AssistantArtefact).
CREATE TABLE warehouse.commentaires_analyses (
  id text PRIMARY KEY,
  artefact_id text NOT NULL,
  auteur_id text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  texte text NOT NULL CHECK (char_length(btrim(texte)) BETWEEN 1 AND 2000),
  cree_a timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX commentaires_analyses_artefact ON warehouse.commentaires_analyses (artefact_id, cree_a);
CREATE INDEX commentaires_analyses_auteur ON warehouse.commentaires_analyses (auteur_id, cree_a);
