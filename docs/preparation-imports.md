# Préparation et suivi des imports

Depuis **Sources**, ouvrez **Qualité et suivi** sur un import administré. Les normalisations sont exécutées dans l’ordre du formulaire, puis les filtres sont combinés avec un ET. Les contrôles portent sur les lignes préparées.

- Les normalisations de texte retirent les espaces aux extrémités, changent la casse ou remplacent une valeur vide par `NULL`.
- Les filtres d’égalité et d’inégalité utilisent le type de la colonne et écartent les lignes dont la valeur est nulle. Le filtre **Non nul** vérifie explicitement la présence d’une valeur.
- Les contrôles vérifient la présence d’une valeur, l’unicité d’une clé simple ou composée et des bornes inclusives sur un nombre ou une date. Ajoutez un contrôle **Non nul** si une plage doit aussi exclure les valeurs absentes.

L’enregistrement rend la nouvelle préparation éligible à la prochaine vérification du worker. **Relancer la synchronisation** lance une tentative depuis l’interface. Si un contrôle échoue ou si la source devient inaccessible, la dernière publication valide reste disponible. La date de publication suit les modifications du contenu et la date de dernière vérification réussie suit aussi les vérifications qui concluent à un contenu identique.

L’historique affiche les 30 dernières tentatives et les jeux combinés qui utilisent l’import. Le calcul sémantique et le SQL contrôlé ajoutent à la provenance un avertissement si la dernière synchronisation a échoué ou si la vérification est en retard. Les anciennes publications renseignent l’échéance à la prochaine synchronisation.

```powershell
npm run test:postgres -- -t 'Préparation et qualité'
```
