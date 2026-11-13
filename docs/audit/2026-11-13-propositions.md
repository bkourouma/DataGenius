# Data Genius : propositions d'amélioration (13 novembre 2026)

État de départ : `master` @ 4d909e9. Le typecheck passe et les 1 280 tests unitaires sont verts (71 fichiers). Ce document vient de cinq audits du code en lecture seule (fonctionnel, sécurité, synchronisation, assistant IA et exports, exploitation). Les constats prioritaires ont été revérifiés dans le code. Rien n'a été testé en charge ni dans le navigateur.

## Ce qui est déjà solide

- **Cloisonnement des données.** Les masques de colonnes et les filtres de lignes sont injectés côté serveur. Le SQL généré par l'IA passe par une liste blanche d'AST, en lecture seule, avec délai maximal. Toutes les routes et server actions vérifient la garde, et aucun accès direct à la ressource d'un autre (IDOR) n'a été trouvé.
- **Connecteur REST.** Il est protégé contre les appels vers le réseau interne (SSRF et rebinding DNS). Les secrets des sources sont chiffrés en AES-256-GCM.
- **Synchronisation.** Un verrou par jeu évite les doubles traitements. La publication est atomique, et l'ancienne copie reste servie en cas d'échec.
- **Assistant IA.** Les erreurs fournisseur sont classées, avec reprise et backoff. La réponse partielle est conservée en cas d'interruption. Les sorties d'outils et l'historique sont plafonnés.
- **Langues.** Les 6 langues ont exactement les mêmes clés.

---

## Robustesse : à corriger en priorité

| # | Gravité | Constat | Preuve | Correctif | Effort |
|---|---|---|---|---|---|
| R1 | Haute | Aucune limite de tentatives à la connexion. `scryptSync` bloque le serveur, donc quelques dizaines de requêtes par seconde gèlent l'application. | `lib/auth/config.ts:18-23`, `lib/auth/password.ts:5,11` | Limiteur par IP et par e-mail en base, `scrypt` asynchrone, paramètres stockés dans le hash, faux hachage si le compte n'existe pas | M |
| R2 | Haute | Aucun plafond de coût ni de débit sur le chat IA et la transcription. Un onglet en boucle ou un script peut faire exploser la facture du fournisseur. | `app/api/medic-assist/chat/route.ts`, `lib/medic-assist/agent/executer.ts` | Plafond de coût par jour et par utilisateur (agrégat sur `assistantUsage.coutUsd`), 1 à 2 flux simultanés, réponse 429 | M |
| R3 | Haute | Une erreur sur un jeu interrompt la synchronisation de tous les suivants. L'erreur est avalée sans cause et le jeu est retenté toutes les 15 s, sans backoff. | `lib/warehouse/synchronisation.ts:183-186`, `scripts/warehouse-sync.ts:436` | `try/catch` par jeu, échec enregistré hors transaction, backoff exponentiel, journal `{jeu, code, durée}` | S |
| R4 | Haute | Un rapport programmé en échec (SMTP indisponible, crash) est perdu jusqu'à l'échéance suivante, parfois une semaine ou un mois. | `lib/medic-assist/suivi/rapports-programmes.ts:321` (réservation avant envoi) | Reprise jusqu'à 3 essais, délais SMTP explicites, alerte à l'administrateur | M |
| R5 | Haute | Un export XLSX jusqu'à 100 000 lignes × 50 colonnes est construit entièrement en mémoire dans la requête. Quelques exports en parallèle peuvent faire tomber le serveur. | `lib/medic-assist/artefacts/exports/xlsx.ts:332`, `construire-export.ts:29` | Écriture en flux (`WorkbookWriter`) ou plafond XLSX avec bascule en CSV, 1 à 2 exports simultanés au maximum | M |
| R6 | Haute | Aucun en-tête de sécurité global : l'application peut être chargée dans l'iframe d'un autre site (clickjacking sur « Confirmer »), et il n'y a pas de CSP ni de HSTS. | `next.config.js:5-9` | `headers()` global : `frame-ancestors 'none'`, HSTS, `nosniff`, CSP (exception pour l'intégration) | S |
| R7 | Haute | Aucune validation de la configuration au démarrage, pas d'endpoint de santé ni de pages d'erreur. Sans `SMTP_HOST`, les e-mails sont abandonnés sans signal. | absence de `app/error.tsx`, `global-error.tsx`, `not-found.tsx`, `/api/health` ; `lib/mail/transport.ts:45` | `lib/env.ts` (zod) appelé au démarrage de l'application et du worker, `/api/health`, pages d'erreur traduites | M |
| R8 | Moyenne | La lecture d'une source se fait dans une transaction interne de 30 s. Les sources lentes saturent le pool Prisma partagé avec l'interface et le chat. | `synchronisation.ts:60,95-103,177` | Lire hors transaction, puis transaction courte de publication | M |
| R9 | Moyenne | La synchronisation manuelle ne dit rien si le worker est déjà sur le jeu, et elle n'a pas de `try/catch`. | `app/(dashboard)/sources/actions.ts:110-116` | Retourner et afficher « déjà en cours » ou l'erreur | S |
| R10 | Moyenne | Pas de verrou par conversation : un double clic ou deux onglets produisent deux tours, payés deux fois. La fin de tour n'est pas transactionnelle. | `executer.ts:421-431`, `persistance.ts:285-349` | Identifiant de message fourni par le client et contrainte unique, réponse 409, `$transaction` | S-M |
| R11 | Moyenne | Croissance sans limite : `warehouse.executions` n'a pas de purge, et les pièces jointes non rattachées ou des comptes supprimés restent sur le disque. | aucun `DELETE` sur `executions` ; `pieces-jointes/service.ts:96-111` | Purge à 90 jours dans le worker, balayage des pièces orphelines, quota par utilisateur | S |
| R12 | Moyenne | Le texte libre d'un e-mail proposé par l'IA n'apparaît pas dans le résumé de confirmation. Une injection dans un fichier importé peut faire envoyer un message piégé. | `lib/medic-assist/suivi/actions.ts:236-244` | Afficher le message complet dans la carte ou y interdire les URL | S |
| R13 | Moyenne | Les corps de requête sont lus en entier avant le contrôle de taille, contournable en envoi fragmenté (chunked). | `pieces-jointes/route.ts:36-46`, `chat/route.ts:37-42` | Lecture en flux avec plafond (réutiliser `lib/integration/http.ts`) | S |
| R14 | Moyenne | Pas de modèle de secours : une panne prolongée du fournisseur IA coupe l'assistant pour tout le monde. | `agent/reprise.ts` | `modeleSecours` configurable après épuisement des reprises | M |
| R15 | Moyenne | Pas de déploiement outillé : ni Dockerfile, ni supervision du worker, ni procédure de sauvegarde. La perte de `DATAGENIUS_SOURCE_KEY` rend toutes les connexions irrécupérables. | racine du dépôt, README | Dockerfile `standalone`, compose (application, worker, PostgreSQL) avec healthchecks, runbook de sauvegarde et de restauration | M |
| R16 | Moyenne | Pas d'ESLint ni d'audit des dépendances en CI. Les routes du chat et les server actions n'ont aucun test, et il n'y a pas de test navigateur. | `.github/workflows/verification.yml`, `tests/` | ESLint et `npm audit` en CI, test « chaque route appelle une garde », test Playwright minimal | M |

Points mineurs :
- Les hôtes PostgreSQL et MySQL ne sont pas filtrés : un administrateur peut sonder le réseau interne.
- Les journaux sont des `console.*` sans identifiant de requête.
- `react-dropzone` et `date-fns` ne servent à rien, et `recharts` double `echarts`.
- Expéditeur par défaut « MedicPro » (`lib/mail/transport.ts:80`).
- Next 14 et next-auth v4 sont en fin de cycle : une montée de version est à planifier.

---

## Fonctionnalités : propositions

### P1 : indispensables avant de confier l'outil à des clients
1. **Gestion des utilisateurs dans l'interface (M).** Aujourd'hui, un compte ne se crée que par `npm run user:create`. Il manque l'invitation, la désactivation, le changement de rôle et le « mot de passe oublié ».
2. **Supprimer et modifier les sources, les jeux et les tableaux (M).** Les actions serveur ne savent qu'ajouter, changer la fréquence et enregistrer (`sources/actions.ts`, `tableaux/actions.ts`). Il faut aussi prévenir des dépendances (jeux combinés, catalogue, tableaux).
3. **Retirer les restes de Medic Assist visibles par l'utilisateur (S-M) :**
   - Les tendances tronquent la série selon un « jour limite de saisie » d'agences (`lib/warehouse/tendances.ts:2,19`).
   - Les messages parlent de « ventes », d'« agences » et de « Patient ».
   - L'export s'appelle « Medic Assist » par défaut, et les adresses commencent par `/medic-assist`.
   - Le code mort à supprimer est dans `lib/reports` et `lib/services/revue-mensuelle`.
4. **Premier démarrage guidé (M).** Le parcours irait de la connexion d'une source à l'import, puis à la publication du catalogue et à la première question, avec un état d'avancement. Un Member sans données ne voit aujourd'hui aucune explication.

### P2 : forte valeur
5. **Écrans réellement traduits et sélecteur de langue (L).** Seul le chat est traduit. Les écrans Sources, Tableaux, Tendances, Droits et Connexion sont en français en dur, et `User.locale` n'est modifiable nulle part.
6. **Alertes de tableaux utiles (M).** Aujourd'hui elles n'existent qu'en base, pour le seul propriétaire, sur la première ligne. Propositions : envoi par e-mail ou webhook, lecteurs destinataires, cloche de notifications dans l'en-tête.
7. **Journal d'audit consultable (M).** Il couvrirait les sources, les exports, les partages et les connexions, pas seulement les droits.
8. **Historique et restauration des tableaux (M).**
9. **État du worker dans l'interface (S).** L'écran indiquerait si le worker tourne, la dernière exécution et une alerte en cas d'arrêt.
10. **Glossaire des indicateurs pour les Members (M).** Il donnerait la définition, la formule et les synonymes. Une recherche globale et des commentaires sur les analyses compléteraient l'ensemble.

### P3 : selon la demande
11. **Connecteurs supplémentaires** : SQL Server, Google Sheets, BigQuery. Le contrat de connecteur est prêt.
12. **Enregistrement des tendances** comme tuile de tableau, avec une granularité hebdomadaire ou trimestrielle et une fenêtre au choix.
13. **Analyses sans IA** : un constructeur de requêtes guidé.

---

## Découpage proposé en lots

| Lot | Contenu | Dépend de |
|---|---|---|
| 0. Fondations | R7 (configuration, santé, pages d'erreur, journal structuré), ESLint en CI | – |
| A. Sécurité d'accès | R1, R6, R12, R13 | 0 |
| B. Garde-fous IA | R2, R10, R14, limite de débit sur la transcription | 0 |
| C. Fiabilité de la synchronisation | R3, R8, R9, purge de `executions` | 0 |
| D. Rapports et exports | R4, R5, purge des pièces jointes | 0 |
| E. Déploiement | R15, nettoyage des dépendances et des fichiers parasites | 0 |
| F. Fonctionnel P1 | 1 à 4 | A |
