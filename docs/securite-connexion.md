# Sécurité de la connexion

Ce document décrit la limitation des tentatives de connexion et le hachage des mots de passe
(`lib/auth/limite-connexion.ts`, `lib/auth/password.ts`, `lib/auth/config.ts`).

## Limitation des tentatives

Chaque tentative de connexion par e-mail et mot de passe est comptée **avant** tout calcul de hachage,
par un incrément atomique en base (table `auth_tentatives`). La tentative compte comme un échec
provisoire ; un succès efface le compteur de l'e-mail.

| Clé | Seuil | Fenêtre | Blocage |
| --- | --- | --- | --- |
| E-mail normalisé (minuscules, haché SHA-256) | 5 tentatives | 15 minutes | 15 minutes |
| Adresse IP (hachée SHA-256) | 30 échecs | 15 minutes | 15 minutes |

- La 6e tentative sur un même e-mail dans la fenêtre est refusée sans calcul de hachage. L'erreur
  `trop_de_tentatives` est levée ; next-auth redirige vers `/login?error=trop_de_tentatives`.
- Pendant un blocage, le compteur n'avance plus et le blocage n'est pas prolongé.
- Sur l'IP, un succès rend la tentative réservée : seuls les échecs comptent, ce qui évite de bloquer un
  bureau entier derrière une même adresse.
- Aucun e-mail ni mot de passe n'est stocké ou journalisé : les clés sont des empreintes SHA-256 et les
  journaux n'écrivent que les 12 premiers caractères de l'empreinte.
- Les lignes expirées sans blocage actif sont purgées par le processus, au plus une fois toutes les
  10 minutes.

### Adresse IP et proxy de confiance : `DATAGENIUS_PROXY_DE_CONFIANCE`

Les en-têtes `x-forwarded-for` et `x-real-ip` sont fournis par le client tant qu'aucun proxy ne les
réécrit : on ne leur fait confiance que si l'on sait combien de proxys de l'infrastructure les complètent.

- **Absente ou `0` (défaut)** : les en-têtes d'IP sont ignorés. Seule la limite par e-mail s'applique.
- **`N` ≥ 1** : nombre de sauts de proxy de confiance devant l'application (répartiteur de charge,
  proxy inverse, CDN...). L'IP retenue est le N-ième élément de `x-forwarded-for` en partant de la
  **droite** (les éléments de gauche sont forgeables). `x-real-ip` n'est lu que dans ce mode, en
  l'absence de `x-forwarded-for`. Si la chaîne contient moins de N éléments, l'IP est ignorée.
  Valeur maximale prise en compte : 10.

Exemple : un seul proxy inverse qui ajoute l'adresse du client à `x-forwarded-for` : `N=1`.

## Verrouillage volontaire d'un compte

La limite par e-mail est un compromis : toute personne qui connaît l'adresse d'un utilisateur peut
envoyer 6 tentatives en 15 minutes et empêcher ce compte de se connecter pendant 15 minutes (déni de
service ciblé). Il n'y a pas de déblocage manuel : le blocage expire seul. En cas d'abus répété,
supprimer la ligne correspondante de `auth_tentatives` (la clé est l'empreinte SHA-256 de
`email:<adresse en minuscules>`) ou filtrer l'attaquant en amont (pare-feu, proxy inverse).

## Si la table manque ou si la base est indisponible

Le limiteur **échoue ouvert** : si la base ou la table `auth_tentatives` est inaccessible, la connexion
reste possible (un échec fermé bloquerait tous les comptes pour une panne qui n'est pas une attaque),
mais **aucune limite n'est appliquée**.

- La migration `20261113010000_auth_tentatives` doit être appliquée (`prisma migrate deploy`) à chaque
  déploiement, avant de démarrer la nouvelle version.
- Surveiller l'événement `limiteur_indisponible` dans les journaux
  (`[datagenius] auth { evenement: 'limiteur_indisponible' }`) : sa présence signifie que la limitation
  est désactivée. L'événement `purge_impossible` signale un échec de la purge, sans effet sur la connexion.
- L'événement `connexion_bloquee` indique un refus pour dépassement de seuil.

## Hachage des mots de passe

- Format : `scrypt$<N>$<r>$<p>$<sel>$<hash>`, avec N=2^17, r=8, p=1, sel de 16 octets, hash de 64 octets.
- Les anciens hachages `sel.hash` (N=16384) restent acceptés. À la première connexion réussie, le hachage
  est recalculé au format actuel (`doitRehacher`).
- Un hachage stocké dont les paramètres dépassent le coût actuel (N > 2^17, r > 8, p > 1) est refusé sans
  calcul, pour qu'une valeur corrompue en base ne puisse pas saturer le serveur.
- Pour un compte inexistant, un hachage factice de même coût est calculé : le temps de réponse ne révèle
  pas l'existence du compte.
- Le calcul est asynchrone (`crypto.scrypt`) et ne bloque pas la boucle d'événements.
