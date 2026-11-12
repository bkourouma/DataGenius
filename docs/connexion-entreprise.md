# Connexion entreprise avec OpenID Connect

Configurez `DATAGENIUS_OIDC_ISSUER`, `DATAGENIUS_OIDC_CLIENT_ID` et `DATAGENIUS_OIDC_CLIENT_SECRET` sur le serveur Data Genius. L’émetteur doit être l’identifiant exact publié par le fournisseur. Enregistrez l’URL de retour `https://<hôte-data-genius>/api/auth/callback/entreprise` dans le fournisseur d’identité. Configurez `NEXTAUTH_URL` avec l’URL publique de Data Genius.

La connexion entreprise associe le sujet OpenID Connect `sub` au compte Data Genius déjà créé. L’association utilise l’émetteur et le sujet. L’adresse e-mail du fournisseur n’accorde aucun accès. Les groupes et les droits sont ceux du compte Data Genius.

```powershell
$env:DATAGENIUS_OIDC_EMAIL = 'utilisateur@example.test'
$env:DATAGENIUS_OIDC_SUBJECT = 'sujet-fourni-par-le-fournisseur'
npx tsx --env-file-if-exists=.env scripts/liaison-oidc.ts
```

Pour retirer une association, conservez `DATAGENIUS_OIDC_EMAIL` et exécutez la commande suivante. Data Genius revalide le compte et son association à chaque consultation d’une session entreprise.

```powershell
npx tsx --env-file-if-exists=.env scripts/liaison-oidc.ts --retirer
```

La connexion par mot de passe reste disponible pour les comptes locaux. La configuration OpenID Connect peut servir à la connexion normale ou à l’autorisation d’un tableau de bord embarqué.
