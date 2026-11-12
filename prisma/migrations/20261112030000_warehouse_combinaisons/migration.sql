CREATE TABLE "warehouse"."combinaisons" (
  "position" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "cle" text NOT NULL UNIQUE,
  "definition" jsonb NOT NULL CHECK (jsonb_typeof("definition") = 'object')
);
