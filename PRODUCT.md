# Data Genius : contexte produit

## Ce que c'est
Data Genius permet d'interroger un entrepôt de données par la conversation et d'en tirer des analyses, des artefacts versionnés (tableaux, graphiques, documents), des tableaux de bord, des tendances et des exports. Les administrateurs y branchent leurs sources (PostgreSQL, MySQL, API REST, fichiers CSV ou Excel), publient des jeux, décrivent le catalogue métier et règlent les droits d'accès.

## Pour qui
Deux publics, à parts égales :
- **Les responsables métier** (direction, commerciaux, gestionnaires) : peu techniques. Ils posent des questions, consultent des tableaux et reprennent leurs analyses.
- **Les analystes et administrateurs de données** : ils connectent les sources, combinent les jeux, surveillent la qualité et la synchronisation, et gèrent les droits.

## Rôles
- `Member` : ses conversations, ses analyses, les tableaux et les jeux autorisés.
- `TenantAdmin` : en plus, les sources, la synchronisation, les droits d'accès et les paramètres de l'assistant.

## Ce qui compte
- On arrive à une réponse vite : poser une question doit toujours être à un geste.
- L'état des données doit être lisible : à jour, en attente ou en échec, sans avoir à interpréter.
- L'usage quotidien (conversations, analyses, tableaux) est séparé de l'administration.
- Interface en français par défaut, traduite en anglais, espagnol, arabe (RTL), hindi et chinois.

## Contraintes
- Next.js 14 (App Router), Tailwind 3, composants de type shadcn/Radix, icônes lucide.
- Accessibilité : cibles tactiles de 44 px sous 768 px, focus visible, prise en charge du RTL et de `prefers-reduced-motion`.
- Le chat et les artefacts réutilisent le code de Medic Assist (dossiers `medic-assist`).
