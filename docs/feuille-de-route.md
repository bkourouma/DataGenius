# Mise en œuvre de Data Genius

Chaque lot étend le parcours qui part des sources, publie des jeux contrôlés et fournit les mêmes indicateurs au chat, aux tableaux de bord et aux exports. Les deux pilotes utilisent des données fictives de facturation et de support.

| Lot | Livrable | Recette de sortie |
| --- | --- | --- |
| Catalogue métier | Éditeur administrateur, clés, granularité, mesures, filtres, unités et versions. | Les totaux et les ratios correspondent au calcul de référence. Les versions publiées sont consultables et une édition concurrente est détectée. |
| Droits et audit | Groupes, accès par jeu, restrictions de colonnes et de lignes, historique des changements. | Deux lecteurs obtiennent des périmètres différents pour le même indicateur dans le chat, les exports et les rapports. Les données révoquées sont protégées dans les analyses déjà créées. |
| Fiabilité des jointures | Volumes des deux entrées et de la sortie, correspondances, doublons de clés, effet sur les totaux et conservation de la précision des nombres. | Les règlements partiels multiplient les lignes d’une facture et l’aperçu indique l’effet sur les montants. Les résultats de précision sont vérifiés jusqu’à l’export. |
| Préparation et supervision | Transformations paramétrables, contrôles qualité, historique des exécutions, dépendances et fraîcheur visible. | Une dérive de schéma ou un contrôle bloquant conserve la dernière publication valide. L’administrateur identifie l’origine du retard et peut reprendre l’import. |
| Tableaux de bord et diffusion | Tableaux persistants, filtres partagés, exploration du détail, objectifs et alertes. | Un changement de période filtre les indicateurs compatibles, avec la même définition que dans le chat. Les alertes évitent les notifications en double. |
| Connecteurs et incrémental | Contrat de connecteur, fichiers CSV/Excel, API REST, moteur SQL supplémentaire, synchronisation incrémentale et réconciliation. | Chaque connecteur importe un jeu réel de sa recette. Une interruption permet une reprise idempotente. Les suppressions et évolutions de schéma sont vérifiées. |
| API et intégration | API de consultation des jeux et indicateurs, affichage embarqué, identité et droits de l’utilisateur. | Une application de démonstration ouvre une analyse avec son contexte. Le serveur refuse les ressources qui ne sont pas autorisées à cet utilisateur. |

`npm run test:postgres` lance les migrations et la recette sur un cluster temporaire. La CI lance aussi la vérification TypeScript, les tests unitaires et la compilation de production. Les parcours d’administration et d’analyse sont à vérifier dans le navigateur avec des comptes distincts.
