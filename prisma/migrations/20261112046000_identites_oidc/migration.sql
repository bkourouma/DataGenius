CREATE TABLE public.identites_oidc (
  emetteur text NOT NULL,
  sujet text NOT NULL,
  utilisateur_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (emetteur, sujet),
  UNIQUE (emetteur, utilisateur_id)
);
