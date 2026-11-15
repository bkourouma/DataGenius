-- Rapports programmés : reprise après échec (jusqu'à 3 essais) et bail de réservation.
-- La dernière erreur reste portée par la colonne existante "dernierErreur".
ALTER TABLE "assistant_rapports_programmes"
  ADD COLUMN "essais" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "enCoursJusqua" TIMESTAMP(3);
