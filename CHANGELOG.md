# Foodix — journal des nouveautés

## 0.4.0 — 2026-11-07
La liste de courses.
- Ingrédients des repas pas encore cuisinés (plats + accompagnements), quantités additionnées et mises à l'échelle du nombre de personnes.
- Rangée par rayon (fruits et légumes, boucherie, crèmerie, boulangerie, épicerie) ; « Sans doute au placard » replié en bas.
- Case à cocher par article ; sous chaque article, les recettes qui l'utilisent.
- Ajouts à la main : gardés d'un menu à l'autre tant qu'ils ne sont pas cochés, × pour retirer (avec Annuler).
- Réglages › Courses › « Toujours dans la liste » : articles remis à chaque nouveau menu.
- Correctif : le bœuf n'est plus dessiné comme un œuf.

## 0.3.0 — 2026-11-07
Le menu, façon « livraison » de N repas (sans jours ni semaines).
- « Nouveau menu » tire N plats au sort (5 par défaut, 1 à 14), avec « Annuler ».
- Tirage pondéré repris du prototype : favoris plus souvent, plats des 3 menus précédents beaucoup moins, protéines variées, plats « Principal » avec un accompagnement de saison.
- Pastilles : Végé et Rapide (seulement ceux-là), À l'avance et Invités (plus souvent).
- Case à cocher pour les repas déjà cuisinés.
- Toucher un repas : Remplacer, Choisir…, Changer l'accompagnement, Voir la recette, Retirer (avec Annuler).
- Fiche recette : bouton « Au menu ».
- Nombre de personnes réglable (servira à la liste de courses).

## 0.2.0 — 2026-11-07
Édition des recettes.
- Bouton + à côté de la recherche : ajouter une recette.
- Fiche : menu ⋯ avec Modifier, Dupliquer, Supprimer (« Recette supprimée — Annuler » pendant quelques secondes).
- Formulaire : nom, catégorie et protéine en pastilles (+ « Autre… »), cases Végé / Favori / À l'avance / Invités, ingrédients en liste.
- Ingrédients : une ligne chacun avec son dessin qui se met à jour en tapant, Entrée = ligne suivante, × pour retirer, poignée pour réordonner en glissant.
- « Plus » : saison, origine, préparation, prix, difficulté, temps, maîtrise, portions, lien, notes.
- Des ingrédients modifiés ne sont plus marqués « suggérés ».

## 0.1.0 — 2026-11-06
Première version (squelette), reconstruite à partir du prototype « Carnet de recettes ».
- Connexion avec le compte Google, données synchronisées entre le téléphone et le PC (Firebase), marche hors ligne.
- Onglets Menu / Courses / Recettes (style « Compact »). Menu et Courses arrivent dans les prochaines versions.
- Recettes : recherche, filtres (catégorie, protéine, favoris, végé, de saison, à l'avance, invités), dessins pixel art.
- Fiche recette en mini pop-up : étiquettes, prix / difficulté / temps / maîtrise, ingrédients, bouton Favori.
- Réglages : thème Auto / Clair / Sombre, animations Complètes / Simples, export / import Excel, compte, synchro, version.
- Mode démo (adresse finissant par `?demo`) pour tester sans toucher aux vraies données.
- Icône provisoire (bol pixel art + tampon), en SVG et PNG pour Android.
