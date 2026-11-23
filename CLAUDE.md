# Foodix — notes pour Claude

Appli web (PWA) de recettes, menu de la semaine et liste de courses. Fichiers à la racine : `app.js` (tout le code de l'appli, découpé en parties numérotées), `style.css`, `pixel.js` (icônes), `index.html`, `sw.js` (cache : changer le numéro à chaque version), `CHANGELOG.md`.
Tester sans compte : ajouter `?demo` à l'adresse (données gardées dans le navigateur).
Catégories du propriétaire : Principal seul, Plat complet, Accompagnement, Mezzé / Apéro, Dessert…, Bases (sous-recettes).
Méthode de travail demandée : montrer des exemples (captures du vrai écran) et poser des questions ; ne coder que quand il écrit « code ».
Le propriétaire travaille parfois dans le cloud puis récupère la branche sur son ordi.

## À rappeler quand on me demande un résumé de ce qu'on a fait

Renommage « À l'avance » → « Prepmeal » → « Lunchbox » (v0.18.0). Restent à faire / à vérifier :
- Le sens a changé : « préparé à l'avance » ≠ « à emporter ». Les recettes déjà cochées l'avaient été pour « à l'avance » : les repasser en revue.
- Tirage du menu : la pastille Lunchbox (réglage `avance`) multiplie encore par 2,5 les chances des recettes cochées. Décider si c'est toujours voulu pour des plats à emporter.
- Dans le code et la base, la case s'appelle toujours `prep` et le réglage du tirage `avance` : seuls les libellés ont changé. Renommer seulement si on accepte une migration des données.
- Excel : la colonne s'appelle « Lunchbox » ; l'import accepte aussi « À l'avance » et « Prepmeal ». Les anciens fichiers Excel gardés sur l'ordi ont l'ancien en-tête.

## Idées mises de côté (à reproposer plus tard)

- Créer une sous-recette depuis la recette en cours : dernière ligne « Créer la sous-recette « … » » dans les suggestions, qui ouvre un petit encadré (nom repris de la saisie, ingrédients un par ligne, « Créer et ajouter »). Maquette faite, validée sur le principe, mise de côté par le propriétaire.
