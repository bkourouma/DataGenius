# API et tableaux intégrés

## Lire le catalogue et les indicateurs

L’API v1 accepte la session Data Genius et une clé de lecture pour les intégrations de serveur à serveur. Les droits appliqués sont ceux du compte à chaque appel. Appelez `GET /api/v1/catalogue` pour découvrir les jeux, les dimensions, les mesures et les filtres visibles. Les réponses sont privées et exclues des caches HTTP. Le quota est de 60 appels d’intégration par minute et par compte, par processus web. Le statut `429` invite le client à ralentir ses requêtes.

Depuis le serveur Data Genius, émettez la clé d’un compte actif dont les groupes donnent uniquement le périmètre attendu. La commande affiche le secret une fois. Placez-le dans le gestionnaire de secrets de l’intégration, puis transmettez-le par l’en-tête `Authorization: Bearer <secret>` sur HTTPS. Les clés sont réservées aux routes de lecture catalogue et indicateurs. La base conserve leur empreinte. La durée par défaut est de 30 jours et le maximum est de 90 jours.

```powershell
npx tsx --env-file-if-exists=.env scripts/api-cle.ts creer lecteur@example.test "Portail BI" 30
npx tsx --env-file-if-exists=.env scripts/api-cle.ts tourner <identifiant-de-la-clé> 30
npx tsx --env-file-if-exists=.env scripts/api-cle.ts revoquer <identifiant-de-la-clé>
```

La rotation crée le nouveau secret et révoque l’ancien dans la même transaction. Les journaux du proxy ou du client doivent exclure l’en-tête `Authorization` et la sortie de la commande d’émission.

Envoyez un objet JSON à `POST /api/v1/indicateurs`. Les valeurs de filtres sont textuelles et leurs clés proviennent du catalogue du jeu.

```json
{
  "jeu": "ventes",
  "mesures": ["ca_eur"],
  "dimensions": ["agence"],
  "filtres": { "mois": "2026-10" },
  "limite": 100
}
```

La réponse contient les colonnes, lignes, totaux éventuels, provenance et le drapeau `tronque`. La limite par requête est de 500 lignes. Les valeurs trop précises pour un nombre JavaScript peuvent être retournées sous forme de chaînes décimales. Un jeu inaccessible renvoie `404`, une session absente `401` et une requête invalide `400`. Le calcul accepte les clés du moteur sémantique.

## Intégrer un tableau dans une application

1. Ajoutez l’origine HTTPS exacte du portail à `DATAGENIUS_EMBED_ORIGINS`. Utilisez des virgules pour séparer les origines. HTTP est prévu pour `localhost`, `127.0.0.1` ou `[::1]` en développement.
2. Donnez au compte Data Genius du lecteur l’accès au tableau et à ses jeux. Le lecteur s’identifie dans une fenêtre Data Genius et autorise l’affichage pour l’origine annoncée.
3. Depuis le portail, créez un nonce aléatoire, puis ouvrez `/integration/autoriser?tableau=<uuid>&origine=<origine-portail>&nonce=<nonce>` sur l’origine Data Genius dans une fenêtre qui conserve l’accès à `window.opener`.
4. Acceptez le message `{ type: 'datagenius:autorisation', nonce, jeton }` seulement si `event.origin` correspond à Data Genius, `event.source` est la fenêtre ouverte et le nonce correspond à la demande. Soumettez `jeton` par formulaire `POST` de type `application/x-www-form-urlencoded` vers `/api/v1/integration/tableau`, en ciblant un iframe nommé. Les champs facultatifs `filtre` et `valeur` appliquent une dimension commune du tableau. Les tuiles incompatibles avec ce filtre sont écartées.

Le jeton est valable 90 secondes et peut être consommé une seule fois par l’origine du portail. Le serveur relit les droits du lecteur au moment de l’affichage. Chaque nouvel affichage demande une autorisation. Les données du tableau sont rendues en HTML dans le cadre et les artefacts s’affichent sous forme de références de titre et de version. L’en-tête CSP du cadre autorise seulement l’origine exacte du portail à l’encadrer. La requête passe le jeton dans son corps. Ce parcours fonctionne avec les cookies tiers bloqués.

Le portail doit conserver l’en-tête `Origin` lors de la soumission du formulaire. Utilisez par exemple `Referrer-Policy: strict-origin-when-cross-origin`. La valeur `no-referrer` peut amener le navigateur à envoyer `Origin: null`, qui est rejeté. Le portail doit aussi autoriser l’origine Data Genius dans `frame-src` et `form-action` s’il définit sa propre CSP.

### Lancer le portail de démonstration

Dans le terminal de Data Genius, autorisez le portail et lancez l’application.

```powershell
$env:DATAGENIUS_EMBED_ORIGINS = 'http://127.0.0.1:3130'
npm run dev
```

Dans un autre terminal, lancez le serveur hôte.

```powershell
node scripts/demo-integration.mjs
```

Ouvrez [le portail local](http://127.0.0.1:3130) et indiquez l’identifiant d’un tableau accessible à votre compte. C’est la valeur qui suit `/tableaux/` dans son adresse Data Genius. Vous pouvez aussi saisir la clé et la valeur d’un filtre commun. Cliquez sur **Afficher le tableau**, puis autorisez l’affichage dans la fenêtre Data Genius. Le tableau apparaît dans le portail.

Le portail vise `http://localhost:3120` par défaut. Si l’application est lancée sur une autre origine, définissez `NEXTAUTH_URL` dans le terminal du portail avant de le démarrer.
