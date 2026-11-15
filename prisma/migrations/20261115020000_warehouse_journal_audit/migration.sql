-- Journal d'audit : ajout seul (la purge de conservation utilise DELETE). Aucun GRANT : le rôle
-- dg_warehouse_reader ne peut pas le lire. Pas de clé étrangère sur acteur_id : un compte peut disparaître.
CREATE TABLE warehouse.journal_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fait_a timestamptz NOT NULL DEFAULT clock_timestamp(),
  acteur_id text,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  cible_type text,
  cible_id text CHECK (char_length(cible_id) <= 128),
  cible_libelle text CHECK (char_length(cible_libelle) <= 200),
  resultat text NOT NULL CHECK (resultat IN ('succes', 'echec', 'refuse')),
  details jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
  ip text CHECK (char_length(ip) <= 45)
);

CREATE INDEX journal_audit_fait_a ON warehouse.journal_audit (fait_a DESC);
CREATE INDEX journal_audit_acteur ON warehouse.journal_audit (acteur_id, fait_a DESC);
CREATE INDEX journal_audit_action ON warehouse.journal_audit (action, fait_a DESC);

CREATE FUNCTION warehouse.refuser_modification_journal_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul : modification refusée';
END;
$$;
CREATE TRIGGER journal_audit_sans_modification
BEFORE UPDATE ON warehouse.journal_audit
FOR EACH ROW
EXECUTE FUNCTION warehouse.refuser_modification_journal_audit();
