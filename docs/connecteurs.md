# Connecteurs de Data Genius

Depuis **Sources**, ajoutez une base PostgreSQL ou MySQL, une API REST ou un fichier CSV/Excel. Ouvrez la source et sélectionnez la table, la feuille ou la collection. Choisissez les colonnes à publier et la fréquence de synchronisation. Les jeux publiés utilisent le même entrepôt, les mêmes règles de qualité et les mêmes droits quelle que soit leur origine.

## Bases MySQL

Utilisez un compte disposant de `SELECT` sur les tables ou colonnes à importer. Data Genius utilise une transaction en lecture seule. Le compte et le mot de passe sont chiffrés dans la base applicative. TLS est activé par défaut et vérifie le certificat et l’identité du serveur. Renseignez le port du serveur, généralement 3306.

## API REST

Le connecteur envoie des requêtes GET. Saisissez l’URL, un jeton Bearer éventuel et le chemin du tableau dans la réponse JSON, par exemple `reponse.articles`. Pour un tableau à la racine, laissez le chemin vide. Une API qui accepte un numéro de page peut indiquer le nom du paramètre, par exemple `page`. Le premier numéro est 1. La première page vide marque la fin. Sans paramètre, seule la réponse de l’URL fournie est importée.

L’inventaire des colonnes est établi sur la première page. Un champ absent d’une ligne est importé comme valeur nulle. Pour une réponse non vide, la disparition d’une colonne sélectionnée sur toutes les pages invalide l’import. Les champs imbriqués restent consultables sous forme de texte JSON.

Le connecteur accepte par défaut les endpoints HTTPS IPv4 publics sur le port 443. Pour une API privée de confiance, configurez côté serveur `DATAGENIUS_REST_ORIGINES_PRIVEES` avec les origines exactes, séparées par des virgules. Par exemple `https://intranet.example:8443,http://127.0.0.1:4567`. Appliquez la même configuration à l’application et au worker. Les redirections sont refusées. Le lecteur impose 15 secondes, 100 pages, 2 Mio par page et 20 Mio cumulés.

## Filtre des hôtes PostgreSQL et MySQL

Pour empêcher un administrateur de sonder le réseau interne, Data Genius résout le DNS de l’hôte avant chaque connexion (ajout, modification, lecture, synchronisation) et refuse les adresses de boucle locale (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, dont les métadonnées cloud, et `fe80::/10`), privées (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), partagées (`100.64/10`), réservées ou multicast. Une IPv6 qui embarque une IPv4 (`::ffff:a.b.c.d`) est jugée sur l’IPv4. Le message affiché est volontairement unique (« Hôte non autorisé ou introuvable ») ; le détail est journalisé côté serveur.

Pour autoriser une base interne de confiance, configurez côté serveur `DATAGENIUS_SOURCES_HOTES_AUTORISES` : liste séparée par des virgules de noms d’hôtes ou d’adresses IP exacts, par exemple `db.interne.example,10.0.4.12`. Un nom listé est accepté quelle que soit son adresse ; une adresse listée est acceptée même si elle est privée. Appliquez la même valeur à l’application et au worker. Les recettes locales (`npm run test:postgres`, `npm run test:mysql`) positionnent `DATAGENIUS_SOURCES_HOTES_AUTORISES=127.0.0.1`. La vérification précède la connexion sans l’épingler : un enregistrement DNS modifié entre les deux reste un risque résiduel, réduit par la revérification à chaque connexion.

Les lectures MySQL demandent aussi `MAX_EXECUTION_TIME` de 15 secondes côté serveur (MySQL 5.7.8 et plus). MariaDB et les versions plus anciennes ne connaissent pas cette variable : l’erreur 1193 est alors ignorée et seul le délai côté client de 15 secondes s’applique.

## Gestion des sources et des jeux

- **Modifier une connexion** (fiche de la source) : nom, hôte, port, base, utilisateur et TLS. Un mot de passe ou jeton laissé vide est conservé, sauf si l’hôte, le port, l’utilisateur ou la base (PostgreSQL, MySQL), ou l’origine de l’URL (API REST) changent : il faut alors le ressaisir. La connexion est testée avant enregistrement ; en cas d’échec rien n’est modifié.
- **Supprimer une source** : refusé tant que des imports l’utilisent (ils sont listés).
- **Renommer ou supprimer un import** : la suppression est refusée si un jeu combiné en dépend. Sinon elle supprime en une transaction la copie publiée, l’historique de synchronisation, la qualité, l’incrémental, le catalogue métier, la règle de droits et le rattachement aux espaces. Les tuiles de tableaux de bord qui l’utilisaient s’affichent comme indisponibles. Chaque suppression est inscrite dans le journal des droits.
- **Jeux combinés** : suppression refusée si un autre jeu combiné en dépend.

## Fichiers

Les fichiers `.csv` et `.xlsx` peuvent faire jusqu’à 5 Mio. Les feuilles importables contiennent jusqu’à 5 000 lignes de données. Le fichier est conservé dans la base de Data Genius. Pour mettre à jour le contenu, remplacez-le depuis sa fiche puis déclenchez ou attendez la prochaine synchronisation. Conservez les en-têtes et les noms des feuilles utilisés par les imports. La source CSV expose toujours la collection `fichier.donnees`.

## Recette

`npm run test:postgres` teste les imports CSV, Excel et REST avec une API locale et un entrepôt PostgreSQL temporaire. `npm run test:mysql` ajoute un serveur MySQL 8.4 temporaire dans Docker, sur un port aléatoire de l’interface de bouclage. Ce scénario vérifie la découverte et la synchronisation avec un compte `SELECT`, ainsi que la conservation des identifiants entiers au-delà de la précision de JavaScript.
