---
version: 1
slug: "app-dashboard-layout-tsx"
primary_target: "app/(dashboard)/layout.tsx"
related_targets: ["components/medic-assist/chat/accueil.tsx","app/(dashboard)/sources/page.tsx"]
---

Scope: coquille de l'espace de travail (navigation, palette de commandes, accueil du chat, en-têtes de page) et pages liste Sources, Tableaux, Espaces, Tendances. Mode : Operate.

Audience : responsables métier et analystes à parts égales. Tâche : poser une question, retrouver une analyse ou un tableau, administrer les sources.

## Direction contract
THESIS: un atelier de données où la question est toujours à un geste (Ctrl K partout, champ de question central à l'accueil). Refuse la barre de liens texte sans état et les pages qui empilent des formulaires repliés.
OWN-WORLD: charte « cour de conteneurs » conservée : rail latéral marine nervuré (.rib-wall, tokens shell), panneaux blancs à trait fin sur béton froid, cobalt pour agir, vert/ocre/rouge oxyde pour les états, plaques mono pour les codes. Angles presque vifs.
STORY: l'utilisateur voit où il est (rail, page active), sait ce qu'il peut faire (action principale dans l'en-tête), lit l'état des données d'un coup d'œil (badges), et pose sa question de n'importe où.
FIRST VIEWPORT: rail de 15 rem à gauche (groupes Travail et Administration, recherche Ctrl K en tête, compte en pied). Accueil : salutation, grand champ de question centré, questions de départ en puces, analyses récentes dessous. Sous 1024 px : barre haute de 56 px avec menu et recherche.
FORM: option B « Atelier de données », choisie par l'utilisateur parmi trois maquettes (A raffinement, B atelier, C accompagnant). seed:2550d7a1273e81b8 (choix de l’utilisateur prioritaire sur le tirage)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
