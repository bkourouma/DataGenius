-- Etat des alertes par destinataire : chaque utilisateur notifie a son propre etat.
ALTER TABLE warehouse.etat_alertes_tableaux ADD COLUMN utilisateur_id text;

UPDATE warehouse.etat_alertes_tableaux AS e
SET utilisateur_id = t.proprietaire_id
FROM warehouse.tableaux AS t
WHERE t.id = e.tableau_id;

-- Une ligne sans tableau ne peut pas exister (cle etrangere) : aucune ligne ne reste sans utilisateur.
ALTER TABLE warehouse.etat_alertes_tableaux ALTER COLUMN utilisateur_id SET NOT NULL;
ALTER TABLE warehouse.etat_alertes_tableaux
  ADD CONSTRAINT etat_alertes_tableaux_utilisateur_fkey
  FOREIGN KEY (utilisateur_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE warehouse.etat_alertes_tableaux DROP CONSTRAINT etat_alertes_tableaux_pkey;
ALTER TABLE warehouse.etat_alertes_tableaux ADD PRIMARY KEY (tableau_id, tuile_id, utilisateur_id);
