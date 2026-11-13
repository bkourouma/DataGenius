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

Dans [Data Genius](http://localhost:3120), ouvrez **Source** pour ajouter des bases et suivre leurs imports. Configurez une clé IA dans `.env` et sélectionnez le fournisseur dans **Paramètres** pour activer le chat. Le rôle `Member` accède à ses conversations et aux jeux autorisés. Le rôle `TenantAdmin` gère les paramètres, les synchronisations et les droits d’accès aux jeux.

### Gérer les droits des jeux

Dans **Source → Groupes et droits d’accès aux données**, créez des groupes, attribuez-y les membres puis définissez les droits de chaque jeu. Une règle peut réserver le jeu aux groupes sélectionnés, masquer des colonnes et limiter les lignes par égalité sur une colonne. Un jeu sans règle est accessible à tous les membres de l’installation. Le rôle `TenantAdmin` dispose du périmètre complet. Les modifications de droits sont journalisées.

Un jeu combiné hérite des restrictions d’accès de ses entrées. Si une entrée est filtrée ou comporte des colonnes masquées pour un lecteur, la combinaison est écartée de son catalogue. La révision des droits invalide le cache des jeux. Quand des règles sont en vigueur, les conversations et les artefacts antérieurs à la dernière révision sont retirés du périmètre des membres, car leur texte peut inclure des résultats du périmètre précédent. Les partages et les envois de rapports vérifient le périmètre des destinataires.

Dans **Gérer les espaces de données**, regroupez des jeux par équipe ou activité et choisissez les groupes qui peuvent consulter l’espace. L’accès à un jeu cumule les règles de son espace et ses propres restrictions. Les membres retrouvent leurs jeux dans **Espaces**. Pour une connexion au fournisseur d’identité de l’entreprise, suivez la [configuration OpenID Connect](docs/connexion-entreprise.md).

## Configurer les sources et l’entrepôt

- `DATABASE_URL` pointe vers la base appartenant à Data Genius. Les migrations y créent les tables applicatives et le schéma `warehouse`, qui stocke les copies publiées et l’état des synchronisations.
- `DATAGENIUS_WAREHOUSE_READ_URL` pointe vers la même base avec un compte dédié. Après migration, accordez-lui `CONNECT` sur la base, `USAGE` sur le schéma `warehouse` et `SELECT` sur `warehouse.snapshots`. Ce compte sert aux calculs et au SQL contrôlé.
1. Dans **Source**, choisissez PostgreSQL, MySQL, API REST ou fichier CSV/Excel. Data Genius teste la connexion et chiffre les identifiants dans sa propre base. [Configuration des connecteurs](docs/connecteurs.md)
2. Ouvrez la source, recherchez une table puis choisissez les colonnes à importer. La liste reflète les droits de lecture du compte PostgreSQL.
3. Donnez un nom au jeu et indiquez la fréquence en minutes. Le jeu apparaît immédiatement dans **Source**, où vous pouvez modifier la fréquence ou lancer la synchronisation manuellement.

### Combiner des jeux dans l’interface

Dans **Source → Combiner des jeux**, sélectionnez deux jeux, les paires de colonnes qui doivent correspondre et les colonnes à conserver. Vous pouvez garder uniquement les lignes correspondantes ou toutes les lignes du premier jeu. Utilisez **Prévisualiser la jointure** pour vérifier un échantillon de 20 lignes au maximum. Si vous conservez toutes les lignes du premier jeu, l’aperçu signale celles sans correspondance. Enregistrez ensuite le résultat sous un nom. Il est utilisable dans le chat et peut être repris dans une autre combinaison.

Pour reprendre un jeu enregistré dans l’interface, ouvrez **Source → Jeux combinés → Modifier**. Ajustez les lignes à conserver, les paires de liaison ou les colonnes du résultat, puis lancez un aperçu avant d’enregistrer. Data Genius vous signale les colonnes à conserver lorsqu’un autre jeu combiné les utilise.

Le diagnostic de l’aperçu couvre les jeux complets. Il indique les lignes rapprochées de chaque côté, les clés nulles et dupliquées, les lignes multipliées et l’effet sur les sommes des colonnes numériques du résultat.

Une combinaison enregistre la définition du rapprochement dans Data Genius. Ses résultats sont calculés sur les dernières copies publiées des imports. Chaque correspondance produit une ligne, y compris lorsque plusieurs lignes partagent la même clé.

Les nouveaux imports sont lus directement dans la base de Data Genius par l’application et le worker. `DATAGENIUS_CATALOGUE` reste facultatif pour les catalogues historiques, la démonstration et les combinaisons SQL historiques. Le [catalogue de démonstration](config/demo-postgresql.json) combine deux bases fictives.

Dans **Source → Catalogue métier**, vous pouvez associer une colonne de type date à un jeu et choisir le mois de début de son exercice. Sans réglage, l’exercice suit l’année civile (janvier à décembre) ; avec un mois de début réglé, les filtres par exercice le suivent (début en avril : exercice 2026 = avril 2026 à mars 2027). Les regroupements par trimestre et par année suivent le calendrier civil.

### Publier les définitions métier

Depuis un import administré ou un jeu combiné, ouvrez **Catalogue métier**. Renseignez la granularité, les clés, les descriptions et les synonymes. Définissez les dimensions et les indicateurs avec leurs filtres, unités et devises. Chaque publication apparaît dans l’historique. Le moteur sémantique et le chat utilisent la dernière définition publiée.

Les calculs numériques conservent les décimales dans PostgreSQL. Les valeurs qui dépassent la précision des nombres de tableur sont transportées sous forme de chaînes décimales et exportées en texte dans les cellules Excel pour préserver leurs chiffres.

## Exploiter la synchronisation

Pour le déploiement avec Docker, la supervision, les sauvegardes et les variables d’environnement, suivez le [guide d’exploitation](docs/exploitation.md).

En production, lancez `node .next/standalone/server.js` (ou l’image Docker) : `npm start` affiche un avertissement avec `output: standalone`.

```powershell
npm run warehouse:sync
npm run warehouse:sync -- --force
npm run warehouse:worker
```

La première commande traite les jeux échus. `--force` déclenche une vérification immédiate. Faites tourner `warehouse:worker` comme processus de service pour vérifier les échéances toutes les 15 secondes. Vous pouvez aussi lancer `warehouse:sync` depuis un planificateur existant.

Chaque vérification relit les colonnes sélectionnées. Data Genius compare le contenu et publie atomiquement une copie si des lignes ont été ajoutées, modifiées ou supprimées. En cas d’échec, la dernière copie publiée reste disponible et la page **Source** indique l’erreur. Les analyses précisent la date de publication des copies utilisées. Les combinaisons utilisent la dernière copie de chacun de leurs jeux et peuvent donc réunir des données publiées à des moments différents.

Les imports complets sont limités à 50 000 lignes et environ 20 Mio par jeu.

Les imports PostgreSQL peuvent activer la [synchronisation incrémentale](docs/synchronisation-incrementale.md). Le plafond est de 100 000 lignes et 20 Mio par jeu. La réconciliation complète périodique ou manuelle détecte les suppressions.

Pour les rapports programmés, configurez le SMTP de Data Genius et l’appel de `POST /api/taches/medic-assist` avec le jeton `JETON_TACHES_PLANIFIEES` dans l’en-tête `Authorization: Bearer …`.

Ouvrez **Qualité et suivi** depuis un import pour configurer ses filtres, normalisations et contrôles, consulter les exécutions et relancer une synchronisation. Les analyses indiquent les échecs et les échéances de vérification dépassées. [Préparation des imports](docs/preparation-imports.md)

## Tableaux de bord

Dans **Tableaux**, créez des tuiles à partir d’un indicateur publié ou d’un artefact accessible. Les tuiles d’indicateurs peuvent recevoir un filtre commun, une dimension de détail et un objectif. Le propriétaire choisit les lecteurs et retrouve dans **Tableaux** les notifications de franchissement de seuil. L’évaluation des alertes utilise la même tâche serveur que les rapports programmés.

Dans **Tendances**, sélectionnez un indicateur mensuel et une période. Data Genius signale les écarts atypiques et, lorsque l’historique le permet, affiche une prévision et son erreur de validation chronologique. [Méthode et conditions d’utilisation](docs/tendances.md)

## Intégrer Data Genius à une application

L’API `/api/v1` consulte les jeux et calcule les indicateurs autorisés. L’intégration embarquée affiche un tableau avec le contexte de filtres de l’application hôte et le périmètre du lecteur. [API et démonstration du tableau embarqué](docs/integration.md)

## Reproduire la recette PostgreSQL

Avec Node.js et les binaires serveur PostgreSQL (`initdb`, `pg_ctl`, `psql`), la commande suivante crée une instance temporaire, charge les sources fictives, applique les migrations et supprime l’instance à la fin. Renseignez `PG_BIN` si les binaires ne sont pas dans le `PATH`.

```powershell
npm run test:postgres
```

### Préparer une instance de recette existante

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
