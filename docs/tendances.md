# Tendances mensuelles

Publiez un indicateur sur un jeu muni d’un calendrier dans **Catalogue métier**. Dans **Tendances**, choisissez cet indicateur et une période de 36 mois au maximum, jusqu’au dernier mois complet, c’est-à-dire le mois qui précède le mois en cours : la fenêtre ne dépend que de la date du jour, jamais d’une règle de saisie. Les droits du lecteur s’appliquent au catalogue et au calcul. La provenance indique les sources, la définition métier et les avertissements de fraîcheur disponibles.

Chaque mois apparaît dans le résultat, même si sa valeur est absente. Les mois absents et les valeurs dont la magnitude dépasse la précision des calculs de tendance interrompent la série. Les valeurs exactes restent lisibles dans le tableau.

- **Écarts atypiques**. Une observation est comparée aux six mois consécutifs précédents. Le signal se déclenche si `0,6745 × écart absolu à la médiane / MAD > 3,5`, où MAD désigne la médiane des écarts absolus. Quand la MAD vaut zéro, tout écart à la médiane est signalé.
- **Prévisions**. Avec six observations consécutives en fin de période, la médiane des trois dernières observations est projetée de un à six mois. La méthode convient à un repère de niveau et suppose que les conditions récentes se prolongent.
- **Validation**. L’erreur absolue moyenne est calculée à partir de trois prévisions historiques à un mois au minimum, en utilisant uniquement les valeurs antérieures à chaque mois évalué. Avec au moins douze erreurs, la bande représente le 90e centile de leurs valeurs absolues autour de l’estimation. Cette bande décrit les erreurs historiques à un mois.
