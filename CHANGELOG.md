# Foodix — journal des nouveautés

## 0.5.2 — 2026-11-14
« Placard » devient une option d'un ingrédient, plus un rayon.
- Fiche d'un ingrédient : « Souvent au placard ? » (comme « récurrent »). Départ deviné d'après le nom (sel, huile, épices, farine…), modifiable. Filtre « Placard » dans la banque.
- Nouveau rayon « Épices et condiments » ; huile, vinaigre, farine, sucre vont en Épicerie.
- Liste de courses, section « Peut-être au placard » : pour chaque ingrédient, « Je l'ai » (grisé) ou « Il me faut » (il passe dans son rayon avec le reste ; le bouton boîte permet de le remettre au placard). Le choix vaut pour la liste en cours : chaque nouveau menu repart de zéro.

## 0.5.1 — 2026-11-14
La banque devient une vraie fenêtre (plein écran), rangée par rayons.
- Réglages › Banque d'ingrédients : liste par rayon (fruits, légumes, boucherie, crèmerie, boulangerie, conserves, épicerie, placard) sur 2 colonnes. Même chose pour les produits ménagers (vaisselle, linge, nettoyage, papier et sacs, hygiène).
- Toucher un ingrédient ouvre sa fiche : modifier le nom (les recettes qui l'utilisent sont réécrites), changer le rayon, choisir l'icône, le rendre récurrent, voir toutes ses recettes (on peut les ouvrir), ou le supprimer (retiré aussi des recettes, avec « Annuler »).
- Le rayon choisi dans la banque est celui de la liste de courses. Nouveaux rayons « Fruits », « Légumes et herbes » et « Conserves » (avant : « Fruits et légumes »).
- L'icône choisie s'affiche partout (liste de courses, fiche recette, formulaire).
- Plus de compteurs ni de textes d'explication.

## 0.5.0 — 2026-11-14
La banque d'ingrédients.
- Réglages › Courses › « Banque d'ingrédients » : tous les ingrédients de mes recettes, une seule fois chacun (« tomate » et « 2 tomates » = même fiche), avec le nombre de recettes qui l'utilisent. Recherche, ajout à la main, retrait de ce qui a été ajouté à la main.
- Onglet « Produits ménagers » (avec quelques idées à ajouter d'un geste). Ils ont leur rayon dans la liste de courses.
- Articles « récurrents » : bouton ↻ sur chaque ligne. À chaque « Nouveau menu », Foodix demande lesquels je veux dans la liste (tous cochés au départ). L'ancien « Toujours dans la liste » est repris tel quel dans les récurrents.
- Liste de courses : en tapant un article, la banque propose ceux qui correspondent (on touche pour ajouter). Un article nouveau entre dans la banque, en ingrédient ou en produit ménager.
- Formulaire de recette : en écrivant un ingrédient, la banque propose les noms qui ressemblent, pour éviter les doublons d'écriture.

## 0.4.1 — 2026-11-09
- Réglages › Notes : bloc-notes libre pour noter mes idées d'amélioration, synchronisé entre le téléphone et le PC, avec un bouton Copier.
- Correctif : plus de barre de remplissage automatique (clé / carte / adresse) au-dessus du clavier dans les cases de saisie.
- Sur téléphone, les listes déroulantes s'ouvrent dans un petit panneau en bas (coche sur le choix actuel, case « Chercher… » au-delà de 10 choix). Sur PC, rien ne change.

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
