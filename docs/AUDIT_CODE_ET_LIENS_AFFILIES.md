# Audit de code — état de référence (`main`)

Audit basé sur les fichiers versionnés, pas sur une estimation des pages publiques.

## Produits et prix d'accueil

- `index.html:278` : début du tableau `productData`.
- `index.html:279-330` : produits définis dans le JavaScript, avec des valeurs textuelles `"À vérifier sur Amazon"` ou `"Voir les prix"` ; ce ne sont pas des prix numériques et aucune date d'observation n'est enregistrée.
- `index.html:380-395` : `productCard` affiche la chaîne `p.price`.
- `index.html:413-438` : `renderProducts` applique la recherche/les catégories et rend les cartes.
- `index.html:340` : `amazonSearchUrl(q)` construit une recherche Amazon sans prix.

## Liens affiliés et tag Amazon

- `catalogue.html` : environ 187 occurrences du tag `prixbasmalin2-21`; les liens statiques observés utilisent `rel="sponsored noopener"` sauf le formulaire de recherche final qui construit l'URL en JavaScript.
- `catalogue.html:120` : l'URL du formulaire est construite avec le tag, mais la balise de lien est créée via `window.open` et non par un élément `<a>`.
- `high-tech.html:30-35` : six liens Amazon avec tag mais sans attribut `rel` initialement. À corriger sans changer les URL ni le texte.
- `index.html` : le helper `amazonSearchUrl` n'ajoute pas le tag aujourd'hui ; plusieurs fonctions ouvrent donc des recherches Amazon sans attribution.
- Le tag ne doit pas être centralisé en faisant une transformation massive non testée. Une étape dédiée devra introduire une configuration et couvrir tous les parcours d'un test avant suppression des valeurs en dur.

## Catégories proches/doublons potentiels

- `catalogue.html:73` « Jardin & extérieur » et `catalogue.html:109` « Jardin & plantes d’intérieur » : chevauchement réel à examiner, mais les liens ne sont pas identiques d'après les seuls titres.
- `catalogue.html:79` « Jouets & jeux » et `catalogue.html:108` « Jeux de société & puzzles » : catégories parentes/ spécialisées plutôt que doublon exact.
- `catalogue.html:60` « Audio & écouteurs », `catalogue.html:63` « Accessoires connectés » et d'autres catégories techniques se recouvrent partiellement.
- Le doublon exact de contenu ne peut pas être confirmé par les titres seuls. Toute fusion doit comparer les URL de recherche et éviter de supprimer une catégorie utile.

## État du module de flux

Le module préparatoire dans la branche est séparé du code existant. Il ne récupère aucun prix et attend un flux autorisé. Le fichier d'offres est vide par défaut.
