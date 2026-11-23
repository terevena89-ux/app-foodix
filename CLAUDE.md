# Foodix — notes pour Claude

Appli web (PWA) de recettes, menu de la semaine et liste de courses. Fichiers à la racine : `app.js` (tout le code de l'appli, découpé en parties numérotées), `style.css`, `pixel.js` (icônes), `index.html`, `sw.js` (cache : changer le numéro à chaque version), `CHANGELOG.md`.
Tester sans compte : ajouter `?demo` à l'adresse (données gardées dans le navigateur).
Le propriétaire travaille parfois dans le cloud puis récupère la branche sur son ordi.

## À rappeler quand on me demande un résumé de ce qu'on a fait

Renommage « À l'avance » → « Prepmeal » → « Lunchbox » (v0.18.0). Restent à faire / à vérifier :
- Le sens a changé : « préparé à l'avance » ≠ « à emporter ». Les recettes déjà cochées l'avaient été pour « à l'avance » : les repasser en revue.
- Tirage du menu : la pastille Lunchbox (réglage `avance`) multiplie encore par 2,5 les chances des recettes cochées. Décider si c'est toujours voulu pour des plats à emporter.
- Dans le code et la base, la case s'appelle toujours `prep` et le réglage du tirage `avance` : seuls les libellés ont changé. Renommer seulement si on accepte une migration des données.
- Fiche recette : l'étiquette Lunchbox est encore verte (`.t.acc`) alors qu'elle est orange dans le formulaire.
- Excel : la colonne s'appelle « Lunchbox » ; l'import accepte aussi « À l'avance » et « Prepmeal ». Les anciens fichiers Excel gardés sur l'ordi ont l'ancien en-tête.
