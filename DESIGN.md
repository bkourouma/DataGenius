---
name: Data Genius
description: Atelier de données conversationnel, charte « cour de conteneurs ».
colors:
  background: "hsl(210 22% 95%)"
  foreground: "hsl(218 45% 12%)"
  card: "hsl(0 0% 100%)"
  primary: "hsl(216 84% 36%)"
  primary-foreground: "hsl(0 0% 100%)"
  secondary: "hsl(212 24% 92%)"
  muted: "hsl(212 24% 93%)"
  muted-foreground: "hsl(215 16% 36%)"
  accent: "hsl(212 40% 94%)"
  border: "hsl(213 20% 86%)"
  input: "hsl(215 14% 57%)"
  ring: "hsl(216 86% 46%)"
  shell: "hsl(218 62% 13%)"
  shell-foreground: "hsl(212 30% 92%)"
  shell-muted: "hsl(214 24% 68%)"
  shell-line: "hsl(218 40% 24%)"
  success: "hsl(140 56% 28%)"
  success-soft: "hsl(140 45% 93%)"
  warning: "hsl(40 92% 46%)"
  warning-soft: "hsl(42 100% 92%)"
  destructive: "hsl(6 72% 42%)"
  danger-soft: "hsl(8 70% 94%)"
  info: "hsl(188 72% 26%)"
  info-soft: "hsl(188 50% 92%)"
typography:
  display:
    fontFamily: "var(--font-sans), system-ui, Segoe UI, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "var(--font-sans), system-ui, Segoe UI, Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.012em"
  title:
    fontFamily: "var(--font-sans), system-ui, Segoe UI, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "var(--font-sans), system-ui, Segoe UI, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "var(--font-sans), system-ui, Segoe UI, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  code:
    fontFamily: "var(--font-code), ui-monospace, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    fontFeature: "\"tnum\""
rounded:
  sm: "2px"
  DEFAULT: "3px"
  md: "4px"
  lg: "6px"
  xl: "8px"
  2xl: "10px"
  full: "9999px"
spacing:
  row: "12px"
  row-lg: "16px"
  card: "20px"
  section: "24px"
  section-lg: "32px"
  rail: "240px"
  topbar: "56px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.accent}"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "40px"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.DEFAULT}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    rounded: "{rounded.DEFAULT}"
    padding: "2px 8px"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.DEFAULT}"
    padding: "2px 8px"
  badge-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.DEFAULT}"
    padding: "2px 8px"
  rail:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-muted}"
    width: "240px"
  rail-item-active:
    textColor: "{colors.card}"
    rounded: "{rounded.md}"
    height: "36px"
  list-panel:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    width: "512px"
---

# Design System: Data Genius

## Overview

**Creative North Star: "La cour de conteneurs"**

Un atelier de données posé dans une cour portuaire : béton froid au sol, panneaux blancs à trait fin posés dessus, un mur marine nervuré qui porte la navigation, et des couleurs d'état peintes comme les conteneurs d'une pile. La question est toujours à un geste : Ctrl K ouvre la palette de commandes partout, et l'accueil met un grand champ de question au centre.

La densité est celle d'un outil de travail quotidien : texte courant à 14 px, titres de page resserrés (22 px), listes à filet fin plutôt que cartes empilées. Les chiffres sont le premier niveau de lecture ; les titres restent sobres pour leur laisser la place. La profondeur vient du trait de 1 px ; l'ombre ne fait qu'asseoir un panneau. Les angles sont presque vifs.

L'état des données se lit d'un coup d'œil : une couleur par état, toujours la même (cobalt pour agir, vert pour achevé, ocre pour en attente, rouge oxyde pour bloqué ou expiré, sarcelle pour information).

**Key Characteristics:**
- Rail latéral marine nervuré de 15 rem (groupes Travail et Administration, recherche Ctrl K en tête, compte en pied) ; barre haute de 56 px sous 1024 px.
- Panneaux blancs à trait fin sur fond béton froid.
- Une seule action primaire cobalt par page, dans l'en-tête.
- Badges d'état doux (aplat pâle, texte saturé), une couleur par état.
- Codes et identifiants en chasse fixe ; chiffres tabulaires dans tout tableau.
- Mouvement bref et utilitaire, coupé sous `prefers-reduced-motion`.

## Colors

Neutres froids teintés marine, un seul accent d'action, et une famille d'états peints. Les valeurs canoniques sont des triplets HSL dans `app/globals.css` (thème sombre défini sous `.dark`) ; les échelles Tailwind `slate`, `gray`, `blue`, `green`, `red`, `yellow`, `amber` sont redéfinies dans `tailwind.config.ts` pour suivre la même charte.

### Primary
- **Cobalt d'action** (primary) : boutons primaires, liens, onglet actif, anneau de focus (ring, un cran plus clair), icône de l'entrée active du rail (blue-300 sur marine), fond pâle des pastilles d'état vide (cobalt à 10 %). C'est la couleur « agir », rien d'autre.

### Secondary
- **Couleurs d'état** : vert MedicPro (success) pour publié, à jour, achevé ; ocre (warning) pour en attente ; rouge oxyde (destructive) pour échec, bloqué, expiré et actions destructrices ; sarcelle (info) pour l'information. Chacune a sa variante `-soft` pâle qui sert de fond de badge.

### Neutral
- **Béton froid** (background) : fond de toutes les pages.
- **Encre marine** (foreground) : texte principal.
- **Panneau blanc** (card) : listes, cartes, dialogues, champs.
- **Brume** (secondary, muted, accent) : survol des lignes, fond des listes d'onglets, pastilles d'icône neutres.
- **Gris ardoise** (muted-foreground) : descriptions, métadonnées, dates.
- **Filet** (border) : trait de 1 px de tous les panneaux et séparateurs de liste.
- **Bord de champ** (input) : contour des champs et des boutons outline, plus marqué que le filet.
- **Mur marine** (shell, shell-foreground, shell-muted, shell-line) : rail latéral, tiroir mobile, panneau gauche de la connexion.

### Named Rules
**La règle de la peinture d'état.** Une couleur par état, partout la même : vert achevé, ocre en attente, rouge oxyde bloqué, sarcelle information. Une couleur d'état ne décore jamais.

**La règle du cobalt seul.** Le cobalt signifie « agir » ou « ici ». Il n'est pas une couleur de fond de section.

## Typography

**Body Font:** `var(--font-sans)` (actuellement `system-ui`), repli Segoe UI, Arial, sans-serif ; polices système dédiées en chinois, arabe (interligne 1,7) et hindi (interligne 1,6).
**Label/Mono Font:** `var(--font-code)` (ui-monospace, Consolas) pour codes, numéros de lot, raccourcis clavier.

**Character:** Une seule famille sans empattement, en graisses 400 à 600, sur une échelle resserrée ; la chasse fixe marque les codes comme le marquage d'un conteneur. La famille sans est un réglage hérité, pas encore une décision de charte (voir Do's and Don'ts).

### Hierarchy
- **Display** (600, 1,75 rem, interligne serré, -0,02 em) : salutation de l'accueil uniquement.
- **Headline** (600, 1,375 rem / 1,75 rem, -0,012 em) : titre de page dans l'en-tête commun.
- **Title** (600, 1,125 rem) : titre de section dans une page ; 1 rem pour le titre d'une carte.
- **Body** (400, 0,875 rem / 1,25 rem) : texte courant, lignes de liste, descriptions (largeur max 42 rem dans l'en-tête).
- **Label** (500, 0,75 rem) : libellés de groupe du rail, métadonnées, badges (600).
- **Code** (500, 0,75 rem, chasse fixe, chiffres tabulaires) : identifiants et touches.

### Named Rules
**La règle des chiffres alignés.** Toute cellule de tableau et tout élément `data-figure` est en chiffres tabulaires ; les colonnes s'alignent à la virgule.

**La règle du titre resserré.** Aucun titre de page au-delà de 1,375 rem ; seule la salutation de l'accueil monte à 1,75 rem.

## Layout

Bureau (≥ 1024 px) : rail fixe de 240 px à gauche, contenu dans le reste, plafonné à 1800 px, marges 16 / 24 / 32 px selon la largeur, 20 à 28 px en haut. Les pages liste se centrent dans une colonne de 56 rem (sources, droits) ou 64 rem (tableaux, espaces) ; l'accueil dans 760 px, ouvert à 6 à 12 vh du haut.

Sous 1024 px : barre haute de 56 px (menu, marque, recherche) et rail dans un tiroir de 17 rem maximum (85 vw).

Rythme : 32 px entre sections d'une page d'administration, 24 px dans une page liste, 12 px entre un titre de section et son contenu. Lignes de liste 12 à 16 px de marge interne, cartes 16 à 20 px. Cibles tactiles d'au moins 44 px sous 768 px ; champs à 16 px sous 768 px. Le RTL est géré par des propriétés logiques (start/end, ps/pe).

**La règle de l'en-tête unique.** Chaque page s'ouvre sur le même en-tête : retour éventuel, titre, une phrase qui dit à quoi sert la page, et au plus une action primaire à droite ; les autres actions passent en outline ou en lien.

## Elevation & Depth

Système à plat, porté par le trait. Les panneaux sont blancs à filet de 1 px sur le béton ; le survol d'une ligne change le fond, pas l'ombre. Les ombres sont teintées marine et courtes, réservées aux éléments qui flottent : bouton primaire (sm), onglet actif (sm), dialogue et tiroir (xl). Les voiles de dialogue sont marine à 50 % avec un léger flou.

### Shadow Vocabulary
- **Assise** (sm, `0 1px 2px 0 rgb(11 27 56 / 0.06)`) : bouton plein, onglet actif.
- **Pose** (md, `0 3px 8px -2px rgb(11 27 56 / 0.10), 0 1px 3px -1px rgb(11 27 56 / 0.06)`) : survol rare d'un panneau.
- **Flottant** (xl, `0 16px 36px -10px rgb(11 27 56 / 0.22), 0 4px 10px -4px rgb(11 27 56 / 0.10)`) : dialogue, palette, tiroir.

### Named Rules
**La règle du trait d'abord.** La profondeur vient du filet de 1 px ; une ombre n'apparaît que sur ce qui flotte au-dessus de la page.

## Shapes

Angles presque vifs, comme un conteneur : 3 px pour les badges et onglets, 4 px pour boutons, champs et entrées du rail, 6 px pour les panneaux et listes, 8 px pour les dialogues. Le cercle est réservé aux avatars et pastilles. Le rail porte la texture nervurée : bandes verticales blanches à 2,8 % (2 px tous les 7 px) sur le marine. Les états vides utilisent un contour pointillé.

## Components

### Buttons
Francs et compacts.
- **Shape:** angles presque vifs (4 px), hauteur 40 px (36 px en petit, 44 px en tactile), texte 14 px en 600.
- **Primary:** cobalt plein, texte blanc, ombre d'assise ; une seule par page.
- **Hover / Focus:** fond à 90 % ; anneau cobalt de 2 px décalé de 2 px ; roue de chargement et `aria-busy` pendant l'action.
- **Outline / Ghost / Link:** outline blanc à bord de champ, survol brume ; ghost sans fond ; lien cobalt souligné au survol. Variantes success et destructive pour les confirmations d'état.

### Status Badges
- **Style:** aplat pâle de la couleur d'état, texte saturé de la même couleur, 12 px en 600, angles de 3 px, sans bordure.
- **State:** success (publié, à jour), warning (en attente), danger (échec), info ; outline neutre pour un simple libellé.

### Cards / Containers
- **Corner Style:** 6 px.
- **Background:** panneau blanc.
- **Shadow Strategy:** aucune au repos (voir Elevation & Depth).
- **Border:** filet de 1 px.
- **Internal Padding:** 16 à 20 px ; pied séparé par un filet.

### Listes à filet
Le motif par défaut pour une collection : un panneau blanc à 6 px, lignes séparées par des filets, icône 16 px en gris ardoise, titre 14 px en 500, métadonnée et date à droite, survol brume, focus en anneau intérieur.

### Inputs / Fields
- **Style:** fond blanc, contour bord de champ, 4 px, hauteur 40 px, icône facultative à gauche.
- **Focus:** anneau cobalt de 2 px décalé ; caret cobalt.
- **Error / Disabled:** contour et anneau rouge oxyde sur `aria-invalid` ; désactivé en brume à 60 %.

### Navigation
- **Rail:** mur marine nervuré, marque en tête (pastille cobalt + nom), bouton de recherche avec touche `Ctrl K` en chasse fixe, groupes Travail et Administration titrés en 12 px gris clair, entrées de 36 px. Actif : fond blanc à 11 %, texte blanc en 500, icône blue-300, `aria-current`. Survol : blanc à 5 %. Compte et déconnexion en pied, sous un filet.
- **Mobile:** barre haute blanche de 56 px ; le même rail dans un tiroir.

### Palette de commandes
Dialogue flottant ouvert par Ctrl K / ⌘K depuis n'importe quel écran : sections « Aller à », « Analyses » (recherche anti-rebond), « Demander », navigation au clavier, comparaison sans accents.

### Dialogs
Panneau blanc de 512 px à 8 px, ombre flottante, en-tête et pied séparés par des filets, corps défilant. Les formulaires secondaires vivent ici plutôt qu'empilés dans la page.

### Accueil (lanceur)
Salutation en display, grand champ de question centré, questions de départ en puces outline (icône cobalt, survol cobalt à 6 %), analyses récentes en liste à filet dessous.

### État vide
Panneau blanc à contour pointillé, pastille d'icône cobalt à 10 %, titre en 600, une phrase qui explique pourquoi c'est vide et le geste suivant, une action.

## Do's and Don'ts

### Do:
- **Do** ouvrir chaque page par l'en-tête commun, avec au plus une action primaire cobalt.
- **Do** exprimer l'état des données par un badge doux de la couleur d'état correspondante.
- **Do** présenter une collection en liste à filet dans un panneau blanc de 6 px.
- **Do** placer les formulaires secondaires dans un dialogue.
- **Do** écrire un état vide qui enseigne : ce qui viendra, pourquoi c'est vide, le geste suivant.
- **Do** garder Ctrl K accessible depuis chaque écran.
- **Do** utiliser les tokens de la charte et les propriétés logiques (start/end) pour le RTL.

### Don't:
- **Don't** utiliser une couleur d'état comme décoration ou le cobalt comme fond de section.
- **Don't** empiler des formulaires repliés dans une page.
- **Don't** poser une ombre sur un panneau au repos ; le trait suffit.
- **Don't** dépasser 10 px d'arrondi hors avatars et pastilles.
- **Don't** introduire des couleurs hors charte (hex codés en dur, palette Tailwind d'origine).
- **Don't** reprendre les libellés en capitales espacées au-dessus des titres présents dans d'anciens écrans ; ce n'est pas une règle de la charte.
