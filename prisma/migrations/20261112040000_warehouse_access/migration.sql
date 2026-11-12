CREATE TABLE warehouse.groupes_acces (
  id uuid PRIMARY KEY,
  nom text NOT NULL UNIQUE
);

CREATE TABLE warehouse.membres_groupes (
  groupe_id uuid NOT NULL REFERENCES warehouse.groupes_acces(id) ON DELETE CASCADE,
  utilisateur_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (groupe_id, utilisateur_id)
);
CREATE INDEX membres_groupes_utilisateur ON warehouse.membres_groupes(utilisateur_id);

CREATE TABLE warehouse.regles_acces (
  jeu text PRIMARY KEY,
  definition jsonb NOT NULL
);

CREATE TABLE warehouse.revision_acces (
  id smallint PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0,
  depuis timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO warehouse.revision_acces(id) VALUES (1);

CREATE TABLE warehouse.audit_acces (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acteur_id text NOT NULL,
  action text NOT NULL,
  objet text NOT NULL,
  fait_a timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION warehouse.reviser_acces_compte() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM warehouse.regles_acces) THEN
    UPDATE warehouse.revision_acces SET revision = revision + 1, depuis = clock_timestamp() WHERE id = 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER comptes_role_revise_acces
AFTER UPDATE OF "roleName", status, "deletedAt" ON public.users
FOR EACH ROW
WHEN (OLD."roleName" IS DISTINCT FROM NEW."roleName" OR OLD.status IS DISTINCT FROM NEW.status OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt")
EXECUTE FUNCTION warehouse.reviser_acces_compte();
