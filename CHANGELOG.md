# Foodix — journal des nouveautés

## 0.17.0 — 2026-11-21
- Liste de courses : un article coché quitte son rayon et part dans le bloc « Dans le panier », replié tout en bas (on l'ouvre pour décocher).
- Bouton « liste compacte » (icône à droite du champ d'ajout) : sans le nom des plats, lignes plus serrées. Gardé sur chaque appareil.
- Barre Parcourir / Nouvelle / Précédente plus fine, titres de rayon en bandeau, blocs du bas (placard, panier) avec leur nombre à droite.

## 0.16.0 — 2026-11-21
- Liste de courses : un article tapé à la main ne va plus tout seul dans la banque. Bouton « + Banque » dans la liste déroulante, ou icône carotte sur la ligne de l'article.
- Les propositions pendant la saisie s'affichent en liste déroulante, avec l'icône de chaque ingrédient.
- Toucher un article ajouté à la main : on choisit son rayon pour cette liste.
- Fiche d'un article de la banque (hors recettes) : bouton « Produit ménager ».

## 0.15.0 — 2026-11-21
- Import Excel : l'image posée devant un ingrédient ou un produit (1re colonne des onglets Ingrédients / Produits ménagers) devient son icône. On choisit donc les icônes une fois pour toutes dans l'Excel, puis on importe.
- Les images arrivent avec le fichier (rien d'autre à importer) et s'affichent avec le style d'icônes Minecraft, que l'import active sur l'appareil.

## 0.14.0 — 2026-11-21
- Import Excel en trois façons : « Ajouter le nouveau » (rien d’existant n’est touché), « Fusionner » (ajoute et met à jour, comme avant) ou « Tout remplacer » (recettes et banque deviennent celles du fichier ; ce qui manque est supprimé). Chaque bouton montre ce qui va changer ; « Tout remplacer » demande un 2e appui.
- Produits ménagers : nouveau rayon « Divers maison » (piles, ampoules, allumettes, bougies…).
- Import d’un fichier qui ne contient que des ingrédients : il n’est plus lu par erreur comme des recettes.

## 0.13.0 — 2026-11-21
- Export Excel plus lisible : un dessin devant chaque recette, ingrédient et produit (celui affiché sur l'appareil : Foodix ou Minecraft), toutes les lignes de la même hauteur, image et nom figés à gauche, colonnes resserrées.
- Recettes groupées par catégorie, ingrédients et produits groupés par rayon (une ligne de titre par groupe).
- La banque est coupée en deux onglets : « Ingrédients » et « Produits ménagers ». Les anciens fichiers (« Banque d'ingrédients ») se réimportent toujours.
- À l'import, on peut changer l'écriture d'un ingrédient (« carotte » au lieu de « carottes ») : la banque garde le nouveau nom.

## 0.12.0 — 2026-11-21
- Version bureau (grand écran + souris) : barre verte à gauche (Recettes, Menu, Liste de courses, Banque, catégories, Réglages), recettes en grille de cartes au centre, Liste / Menu dans une colonne à droite qu’on ouvre ou ferme avec le bouton « Liste ».
- Sur PC, la fiche et le formulaire d’une recette s’ouvrent dans la colonne de droite (la grille reste visible).
- Largeur de la barre de gauche et de la colonne de droite réglable en glissant leur bord (gardée sur cet appareil).
- Style bureau : police IBM Plex, gris sauge, commandes plus serrées. Le téléphone ne change pas.

## 0.11.1 — 2026-11-21
- Banque › Produits ménagers : la rangée « Idées » (produits proposés en pointillés) est retirée.

## 0.11.0 — 2026-11-21
- Beaucoup plus de textures possibles (paquet de 1 376 : Minecraft, Farmer's Delight, Expanded et Ocean's Delight, Pam's HarvestCraft 2).
- Correspondances revues pour presque tous les ingrédients et les 106 recettes (ail, poivron, courgette, fromage, curry, quiche, paella…).
- Choix de texture : case « Chercher… » (en français ou en anglais) et grille qui défile.
- Recette : menu ⋯ › Icône pour choisir sa texture à la main (style Minecraft).
- Textures rangées en plusieurs morceaux dans Firebase (un document ne dépasse pas 1 Mo).

## 0.10.0 — 2026-11-21
- Icônes au style Minecraft (facultatif) : Réglages › Icônes › Foodix / Minecraft (choix gardé par appareil).
- Textures importées depuis un paquet `.json` ou des `.png`, gardées dans Firebase (synchronisées, jamais dans le dépôt public). Effacer avec Annuler.
- Ingrédients et plats reconnus d'après leur nom ; sans texture adaptée, Foodix garde son dessin.
- Fiche d'un ingrédient de la banque : choix d'une autre texture parmi celles importées.

## 0.9.9 — 2026-11-20
- Un ingrédient tout juste ajouté (par le + de la banque, une idée de produit ménager, ou un article nouveau tapé dans les Courses) ouvre directement sa fiche de réglage : rayon, icône, récurrent, placard. Depuis les Courses, Retour ramène à la liste.

## 0.9.8 — 2026-11-17
- La saison (Été / Hiver) est recalculée à chaque fois, et plus seulement à l'ouverture de l'appli.
- Nettoyage : code qui ne servait plus retiré.

## 0.9.7 — 2026-11-17
- Excel, onglet « Banque d'ingrédients » : nouvelle colonne **Icône** (le dessin choisi à la main). Relue à l'import : on peut y écrire un nom de dessin (« Oignon », « Pot »…) ou « Auto » pour revenir au dessin automatique.

## 0.9.6 — 2026-11-17
- Sur PC : une petite croix apparaît au survol d'un ingrédient de la liste de courses pour le retirer (au doigt, on glisse toujours).

## 0.9.5 — 2026-11-17
- Bouton **Retour** d'Android : ferme la fenêtre ou l'écran ouvert (fiche, Réglages, Thème, banque, Compléter, Notes) au lieu de quitter l'appli. Sur un formulaire, il faut appuyer deux fois (pour ne pas perdre la saisie). Rien d'ouvert : quitte comme avant.

## 0.9.4 — 2026-11-17
Lecture des ingrédients plus juste :
- Fractions (« 1/2 citron », « 1 ½ ») et fourchettes (« 2-3 carottes », « 2 à 3 » : on garde le plus grand).
- Unités reconnues en plus : « c. à s. », « càs », « cuillère à soupe », « c. à c. », pincée, verre, brin.
- Petites quantités jamais arrondies à 0 (« 2 g sel » reste 2 g, « 2 ml vanille » s'affiche 2 ml).
- « pâtes » et « pâte » ne sont plus additionnées ; pluriels mieux rangés (« pommes de terre » en Légumes, « huile d'olive » en Épicerie) ; dessin des courgettes corrigé.
- Nouveaux rayons : **Sucré**, **Boissons**, **Surgelés** (ce qui contient « surgelé »).
- Un article tapé à la main avec une quantité (« 2 L lait ») s'additionne au même ingrédient venu des recettes.

## 0.9.3 — 2026-11-17
- Démarrage : si les serveurs de Google ne répondent pas, message « Impossible de joindre le serveur » avec un bouton **Réessayer** (au lieu de rester sur « Chargement… »). Le mode démo n'en dépend plus.
- Réseau lent : au bout de 3 secondes, l'appli s'ouvre avec la copie gardée sur l'appareil (la nouvelle version est rangée pour la fois suivante).
- Mise à jour automatique : attend aussi que je ne sois pas en train de taper, ni dans la banque, « Compléter » ou les Notes.

## 0.9.2 — 2026-11-17
- Liste de courses : une coche retient la **quantité prise**. Si un plat ajouté ensuite en demande plus, la ligne redevient à prendre pour ce qui manque (« 3 » avec « 2 déjà pris » sous le nom).
- Un ingrédient retiré d'un glissement revient si un nouveau plat en redemande.
- Liste précédente : s'ouvre plus vite (banque calculée une seule fois).

## 0.9.1 — 2026-11-15
- Excel : nouvel onglet **« Banque d'ingrédients »** (Nom, Type ingrédient / ménager, Rayon, Récurrent, Souvent au placard, Nb de recettes, Recettes), rangé par rayon.
- Il est relu à l'import : on peut y changer le type, le rayon, « récurrent » et « souvent au placard », ou ajouter des articles (une case vide ne change rien). L'aperçu avant import compte les articles nouveaux et les réglages changés.

## 0.9.0 — 2026-11-15
Assembler un plat complet (un plat principal + un ou plusieurs accompagnements).
- Fiche d'un plat principal ou d'un accompagnement › « Avec quoi ? Assembler un plat complet ». L'appli propose ce qui va avec : d'abord ce que j'ai déjà mangé ensemble (« déjà ensemble »), puis les favoris, puis ce qui est de saison (« Tout voir » pour le reste).
- Plusieurs accompagnements possibles. Nom automatique « Saumon à l'oseille & riz basmati, haricots verts », modifiable.
- Deux boutons :
  - **Juste au menu** (par défaut, provisoire) : le plat arrive dans les propositions, rien n'est créé dans mes recettes ;
  - **Garder dans mes recettes** : une vraie recette « Plat complet » (étiquette « Assemblé »), liée à ses morceaux : `[Saumon à l'oseille]; [Riz basmati]`. Si je modifie le riz, le plat suit. Elle va aussi au menu.
- Menu › toucher un plat principal › « Assembler avec d'autres accompagnements ».
- Liste de courses : chaque morceau à son échelle (portions), et leurs bases (« je la fais / je l'achète ») comprises.
- Correctif : après un changement d'onglet, la page pouvait glisser sur le côté.

## 0.8.0 — 2026-11-14
Filtres multiples, variantes d'un plat, bases (sous-recettes).
- **Filtres** : bouton « Filtres » dans Recettes. Une feuille avec des cases : plusieurs catégories et protéines à la fois (l'une ou l'autre). Les filtres choisis restent en pastilles, une croix pour les enlever.
- **Variantes** : des recettes de la même *famille* sont des versions du même plat (Burger bœuf / végé / poulet).
  - Liste : une seule ligne « Burger · Bœuf · Végé ». Fiche : pastilles pour passer d'une variante à l'autre, les ingrédients propres à la variante sont marqués d'un point orange.
  - Menu : une seule variante d'une famille par menu, tirée au hasard (la famille ne sort pas plus souvent qu'un autre plat) ; pastilles pour changer de variante dans la proposition. Avec le réglage Végé, seules les variantes végé sont proposées.
  - Fiche › ⋯ › « Nouvelle variante » ; formulaire › Plus : Famille et Variante.
- **Bases (sous-recettes)** : une recette de catégorie « Base » (pâte brisée, sauce…) s'utilise dans une autre en écrivant son nom entre crochets : `[Pâte brisée maison]` (proposé en tapant un ingrédient).
  - Dans la fiche, la base se déplie. Les bases sont rangées à part dans la liste et ne sont jamais proposées dans le menu. Un seul niveau.
  - En ajoutant le plat à la liste : « Je la fais » (ses ingrédients vont dans la liste) ou « Je l'achète » (elle y va toute prête). Demandé à chaque fois.
- **Excel** : colonnes « Famille » et « Variante », bases entre crochets dans « Ingrédients », onglet « Familles » en plus (pour lire seulement, ignoré à l'import).

## 0.7.0 — 2026-11-14
Animations, vibrations et mode « Compléter ».
- **Gestes** :
  - glisser la page à gauche / à droite pour changer d'onglet (la page suit le doigt) ;
  - glisser un article de la liste vers la gauche pour le retirer (bandeau rouge « Retirer », avec Annuler). Un ingrédient venu d'une recette est seulement caché de la liste : « remettre » le fait revenir.
- **Animations** : la case cochée rebondit, un trait barre le nom, puis l'article descend en bas de son rayon ; « Nouveau menu » fait arriver les propositions en cascade ; un plat accepté « vole » vers l'onglet Courses ; les fenêtres redescendent en douceur ; les boutons s'enfoncent sous le doigt. Réglages › Animations « Simples » coupe tout.
- **Vibrations** (comme Médiathèque) : une différente par geste (cocher, ajouter, retirer, nouveau menu, nouvelle liste, seuil d'un glissement…). Réglages › Vibrations Oui / Non (réglage de cet appareil).
- **Réglages › Compléter mes recettes** : je choisis quoi compléter (catégorie et protéine, ingrédients, prix / difficulté / temps / maîtrise, saison et options), puis les recettes incomplètes défilent en cartes. Tout est enregistré au toucher. Carte jetée à gauche = suivante, à droite = retour (ou les boutons en bas).

## 0.6.0 — 2026-11-14
Nouvelle allure pour le téléphone, et le menu ne remplit plus la liste tout seul.
- **Onglets en bas** (Courses · Recettes · Menu), à portée de pouce ; l'appli s'ouvre sur la liste de courses.
- Calée sur la largeur d'un Galaxy S26 : **plus de zoom** (ni pincer, ni double-toucher), boutons et lignes plus grands, fenêtres qui montent du bas de l'écran.
- **Menu = des propositions** : « Nouveau menu » propose des plats, rien n'arrive dans la liste. « + Liste » sur un plat (ou « Tout ajouter ») l'envoie dans la liste de courses. Section « Dans ma liste » : les plats acceptés, avec la case « cuisiné ».
- Fiche recette : « À la liste » met le plat directement dans la liste de courses.
- **Liste de courses** :
  - « Nouvelle liste » : repart de zéro, en demandant ce qu'on garde (plats pas encore cuisinés, articles pas encore cochés, articles récurrents ; tout est coché au départ, ou « Partir de zéro »).
  - « Précédente » : l'ancienne liste reste en archive (une seule). On peut la consulter, toucher un article pour le reprendre, ou la remettre en cours.
  - « Parcourir » : la banque d'ingrédients et de produits ménagers en grand ; toucher un article l'ajoute à la liste (retoucher l'enlève).
- **Banque d'ingrédients** : déplacée de Réglages vers l'onglet Recettes (bouton « Ingrédients »).

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
