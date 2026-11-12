# Data Genius

Data Genius permet d’interroger un entrepôt par la conversation et de produire des analyses, des artefacts versionnés et des exports. Le chat et les artefacts réutilisent le code de Medic Assist. Les sources, les définitions métier et les jeux publiés sont configurés dans Data Genius.

## Démarrer

Prérequis : Node.js 22+, npm et PostgreSQL. Copiez `.env.example` vers `.env`, renseignez les connexions et générez un secret de session et une clé de chiffrement des connexions.

```powershell
npm ci
npm run db:generate
npm run db:deploy
$env:DATAGENIUS_USER_EMAIL = 'admin@example.test'
$env:DATAGENIUS_USER_ROLE = 'TenantAdmin'
$env:DATAGENIUS_USER_NAME = 'Démo'
# Définissez DATAGENIUS_USER_PASSWORD dans le terminal (12 caractères minimum).
npm run user:create
npm run dev
```

Pour générer `DATAGENIUS_SOURCE_KEY`, exécutez `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` et conservez la valeur dans l’environnement du serveur web et du worker. La clé permet de lire les connexions déjà enregistrées, conservez-la avec les sauvegardes de configuration.

Dans [Data Genius](http://localhost:3120), ouvrez **Source** pour ajouter des bases et suivre leurs imports. Configurez une clé IA dans `.env` et sélectionnez le fournisseur dans **Paramètres** pour activer le chat. Le rôle `Member` accède aux jeux publiés et à ses conversations. Le rôle `TenantAdmin` gère les paramètres et les synchronisations. Les jeux publiés sont communs aux membres de cette installation.

## Configurer les sources et l’entrepôt

- `DATABASE_URL` pointe vers la base appartenant à Data Genius. Les migrations y créent les tables applicatives et le schéma `warehouse`, qui stocke les copies publiées et l’état des synchronisations.
- `DATAGENIUS_WAREHOUSE_READ_URL` pointe vers la même base avec un compte dédié. Après migration, accordez-lui `CONNECT` sur la base, `USAGE` sur le schéma `warehouse` et `SELECT` sur `warehouse.snapshots`. Ce compte sert aux calculs et au SQL contrôlé.
1. Dans **Source**, sélectionnez **Ajouter une base PostgreSQL**. Renseignez l’hôte, le port, le nom de la base et le compte de lecture. Choisissez le mode TLS adapté à votre serveur. Data Genius teste la connexion et chiffre les identifiants dans sa propre base.
2. Ouvrez la source, recherchez une table puis choisissez les colonnes à importer. La liste reflète les droits de lecture du compte PostgreSQL.
3. Donnez un nom au jeu et indiquez la fréquence en minutes. Le jeu apparaît immédiatement dans **Source**, où vous pouvez modifier la fréquence ou lancer la synchronisation manuellement.

### Combiner des jeux dans l’interface

Dans **Source → Combiner des jeux**, sélectionnez deux jeux, les paires de colonnes qui doivent correspondre et les colonnes à conserver. Vous pouvez garder uniquement les lignes correspondantes ou toutes les lignes du premier jeu. Utilisez **Prévisualiser la jointure** pour vérifier un échantillon de 20 lignes au maximum. Si vous conservez toutes les lignes du premier jeu, l’aperçu signale celles sans correspondance. Enregistrez ensuite le résultat sous un nom. Il est utilisable dans le chat et peut être repris dans une autre combinaison.

Pour reprendre un jeu enregistré dans l’interface, ouvrez **Source → Jeux combinés → Modifier**. Ajustez les lignes à conserver, les paires de liaison ou les colonnes du résultat, puis lancez un aperçu avant d’enregistrer. Data Genius vous signale les colonnes à conserver lorsqu’un autre jeu combiné les utilise.

Une combinaison enregistre la définition du rapprochement dans Data Genius. Ses résultats sont calculés sur les dernières copies publiées des imports. Chaque correspondance produit une ligne, y compris lorsque plusieurs lignes partagent la même clé.

Les nouveaux imports sont lus directement dans la base de Data Genius par l’application et le worker. `DATAGENIUS_CATALOGUE` reste facultatif pour les catalogues historiques, la démonstration et les combinaisons SQL historiques. Le [catalogue de démonstration](config/demo-postgresql.json) combine deux bases fictives.

## Exploiter la synchronisation

```powershell
npm run warehouse:sync
npm run warehouse:sync -- --force
npm run warehouse:worker
```

La première commande traite les jeux échus. `--force` déclenche une vérification immédiate. Faites tourner `warehouse:worker` comme processus de service pour vérifier les échéances toutes les 15 secondes. Vous pouvez aussi lancer `warehouse:sync` depuis un planificateur existant.

Chaque vérification relit les colonnes sélectionnées. Data Genius compare le contenu et publie atomiquement une copie si des lignes ont été ajoutées, modifiées ou supprimées. En cas d’échec, la dernière copie publiée reste disponible et la page **Source** indique l’erreur. Les analyses précisent la date de publication des copies utilisées. Les combinaisons utilisent la dernière copie de chacun de leurs jeux et peuvent donc réunir des données publiées à des moments différents.

Cette version utilise des copies complètes, limitées à 50 000 lignes et environ 20 Mio par jeu. Elle convient à un premier data mart de taille limitée. Le moteur d’import disponible est PostgreSQL. La capture continue des changements et les autres moteurs demandent des connecteurs supplémentaires.

Pour les rapports programmés, configurez le SMTP de Data Genius et l’appel de `POST /api/taches/medic-assist` avec le jeton `JETON_TACHES_PLANIFIEES` dans l’en-tête `Authorization: Bearer …`.

## Reproduire la recette PostgreSQL

Sur une instance PostgreSQL de test, créez les rôles et les bases avec un compte d’administration. Attribuez des mots de passe selon la méthode d’authentification utilisée.

```sql
CREATE ROLE dg_app LOGIN;
CREATE ROLE dg_reader LOGIN;
CREATE ROLE dg_support_reader LOGIN;
CREATE ROLE dg_warehouse_reader LOGIN;
CREATE DATABASE dg_app OWNER dg_app;
CREATE DATABASE dg_source;
CREATE DATABASE dg_support;
```

Chargez les jeux fictifs avec le compte d’administration des sources, puis lancez les migrations avec `DATABASE_URL` pointant vers `dg_app` avec le rôle `dg_app`.

```powershell
psql -d dg_source -f tests/fixtures/postgresql.sql
psql -d dg_support -f tests/fixtures/postgresql-support.sql
npm run db:deploy
```

Sur `dg_app`, accordez au rôle `dg_warehouse_reader` l’accès à l’entrepôt.

```sql
GRANT USAGE ON SCHEMA warehouse TO dg_warehouse_reader;
GRANT SELECT ON warehouse.snapshots TO dg_warehouse_reader;
```

Exportez `DATAGENIUS_WAREHOUSE_READ_URL` avec ce rôle, `DATAGENIUS_SOURCE_DISTRIBUTION` vers `dg_source` avec `dg_reader`, `DATAGENIUS_SOURCE_SUPPORT` vers `dg_support` avec `dg_support_reader`, et `DATAGENIUS_CATALOGUE=config/demo-postgresql.json`. Renseignez aussi `DATAGENIUS_SOURCE_KEY` pour la recette de l’ajout d’une connexion. Le test utilise `DATAGENIUS_TEST_SUPPORT_OWNER_URL` pour modifier les lignes et droits de la base fictive `dg_support`.

```powershell
$env:DATAGENIUS_TEST_POSTGRES = '1'
npm test
```

La recette vérifie l’enregistrement chiffré des connexions, la découverte des tables et colonnes, la sélection, la modification de fréquence, les droits, les échéances, les ajouts, modifications et suppressions, la jointure entre sources, la conservation de la copie précédente après échec, et le parcours chat–artefact–exports. Le test de chat simule le modèle IA.
