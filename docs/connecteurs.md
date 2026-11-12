# Connecteurs de Data Genius

Depuis **Sources**, ajoutez une base PostgreSQL ou MySQL, une API REST ou un fichier CSV/Excel. Ouvrez la source et sélectionnez la table, la feuille ou la collection. Choisissez les colonnes à publier et la fréquence de synchronisation. Les jeux publiés utilisent le même entrepôt, les mêmes règles de qualité et les mêmes droits quelle que soit leur origine.

## Bases MySQL

Utilisez un compte disposant de `SELECT` sur les tables ou colonnes à importer. Data Genius utilise une transaction en lecture seule. Le compte et le mot de passe sont chiffrés dans la base applicative. TLS est activé par défaut et vérifie le certificat et l’identité du serveur. Renseignez le port du serveur, généralement 3306.

## API REST

Le connecteur envoie des requêtes GET. Saisissez l’URL, un jeton Bearer éventuel et le chemin du tableau dans la réponse JSON, par exemple `reponse.articles`. Pour un tableau à la racine, laissez le chemin vide. Une API qui accepte un numéro de page peut indiquer le nom du paramètre, par exemple `page`. Le premier numéro est 1. La première page vide marque la fin. Sans paramètre, seule la réponse de l’URL fournie est importée.

L’inventaire des colonnes est établi sur la première page. Un champ absent d’une ligne est importé comme valeur nulle. Pour une réponse non vide, la disparition d’une colonne sélectionnée sur toutes les pages invalide l’import. Les champs imbriqués restent consultables sous forme de texte JSON.

Le connecteur accepte par défaut les endpoints HTTPS IPv4 publics sur le port 443. Pour une API privée de confiance, configurez côté serveur `DATAGENIUS_REST_ORIGINES_PRIVEES` avec les origines exactes, séparées par des virgules. Par exemple `https://intranet.example:8443,http://127.0.0.1:4567`. Appliquez la même configuration à l’application et au worker. Les redirections sont refusées. Le lecteur impose 15 secondes, 100 pages, 2 Mio par page et 20 Mio cumulés.

## Fichiers

Les fichiers `.csv` et `.xlsx` peuvent faire jusqu’à 5 Mio. Les feuilles importables contiennent jusqu’à 5 000 lignes de données. Le fichier est conservé dans la base de Data Genius. Pour mettre à jour le contenu, remplacez-le depuis sa fiche puis déclenchez ou attendez la prochaine synchronisation. Conservez les en-têtes et les noms des feuilles utilisés par les imports. La source CSV expose toujours la collection `fichier.donnees`.

## Recette

`npm run test:postgres` teste les imports CSV, Excel et REST avec une API locale et un entrepôt PostgreSQL temporaire. `npm run test:mysql` ajoute un serveur MySQL 8.4 temporaire dans Docker, sur un port aléatoire de l’interface de bouclage. Ce scénario vérifie la découverte et la synchronisation avec un compte `SELECT`, ainsi que la conservation des identifiants entiers au-delà de la précision de JavaScript.
