# Synchronisation incrémentale PostgreSQL

Ouvrez la page **Qualité et suivi** d’un import PostgreSQL administré, puis configurez la lecture incrémentale. Sélectionnez une ou plusieurs colonnes dont la combinaison identifie durablement chaque ligne. Sélectionnez un horodatage PostgreSQL distinct, déjà inclus dans l’import et mis à jour à chaque insertion ou modification. Les horodatages sans fuseau sont interprétés en UTC.

La première lecture copie la table. Les lectures suivantes reprennent au dernier horodatage observé, en incluant les lignes à cet horodatage. Le chevauchement remonte davantage dans le temps pour relire des modifications arrivées en retard. Les clés déterminent quelles lignes sont remplacées. Côté source, un index sur l’horodatage et une contrainte d’unicité sur la clé sont adaptés à ce mode.

Les suppressions sont détectées à la prochaine réconciliation complète. Lancez une réconciliation depuis l’interface pour appliquer les suppressions immédiatement. Elle détecte également les clés vides ou dupliquées. Si la lecture échoue ou qu’un contrôle qualité bloque le résultat, la dernière publication valide et le point de reprise restent disponibles.

Le plafond est de 100 000 lignes et 20 Mio par jeu en mode incrémental. La source transmet les changements en lecture partielle. L’entrepôt recompose ensuite le jeu complet et applique les transformations et contrôles avant publication. Un chevauchement nul convient à une source dont les horodatages reflètent l’ordre des modifications. Adaptez le chevauchement à la latence réelle de votre source.

```powershell
npm run test:postgres -- -t 'Import incrémental PostgreSQL'
```
