CREATE TABLE "warehouse"."sources" (
  "id" text PRIMARY KEY,
  "titre" text NOT NULL,
  "hote" text NOT NULL,
  "base" text NOT NULL,
  "secret" text NOT NULL,
  "cree_a" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "warehouse"."imports" (
  "cle" text PRIMARY KEY,
  "source_id" text NOT NULL REFERENCES "warehouse"."sources"("id"),
  "definition" jsonb NOT NULL CHECK (jsonb_typeof("definition") = 'object'),
  "frequence_minutes" integer NOT NULL CHECK ("frequence_minutes" BETWEEN 1 AND 10080)
);

CREATE INDEX "warehouse_imports_source_idx" ON "warehouse"."imports"("source_id");
