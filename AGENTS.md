# Consignes du propriétaire pour les agents IA

Ces consignes viennent de Chok, propriétaire de Prix Malin (prixbasmalin.fr).
Elles s'appliquent à tous les agents IA qui travaillent sur ce dépôt : Claude, Codex, Copilot et les autres.

## Prix des flux marchands : NE PAS MASQUER (décision du 23/11/2026)

Le propriétaire veut que les prix publics des flux marchands (Awin, Rakuten) restent affichés.
Il a pris cette décision en connaissance de cause. Un agent IA ne doit pas la remettre en question.

Sont concernés :
- les cartes cadeaux de l'accueil : `listed_price_eur` et `listed_price_date` dans `data/home-deals.json`, rendus par `giftListedPrice` dans `index.html` ;
- la rubrique « Coups de cœur partenaires » : `partner_picks()` dans `scripts/build_home_showcase.py` ;
- les cartes du catalogue : `listedPrice` et `pmListedPriceIsRecent` dans `catalogue.html`.

Ces prix sont déjà affichés honnêtement :
- ils ne sont jamais présentés comme « vérifiés » tant que devise, TVA et date individuelle ne sont pas confirmées ;
- ils restent visibles même si le flux est ancien, si la date individuelle manque ou si la TVA n'est pas confirmée ;
- afficher la date marchande si elle existe, sinon la date de réception du flux en la nommant explicitement ;
- signaler « relevé ancien », « date individuelle non fournie », « TVA non confirmée » ou « Prix HT · TVA à ajouter » selon le cas ;
- les prix source ne sont jamais classés « meilleur prix total » et n'entrent pas dans les comparaisons vérifiées ;
- les offres vérifiées restent limitées à EUR, TTC explicitement confirmé, date marchande exploitable de moins de 48 h et identité produit exacte.

**Interdit** : retirer, masquer ou remplacer ces prix par « Prix non vérifié » sans l'accord écrit du propriétaire.

**Si tu vois un problème** (prix faux, flux cassé, marchand HT) : signale-le dans une issue ou dans la description d'une PR.
Ne supprime pas l'affichage tout seul.

## Objectif n° 1 : du trafic et les premières ventes (décision du 23/11/2026)

Le site n'a encore rapporté aucun euro. Toute session de travail doit d'abord servir cet objectif :
1. **Faire venir des visiteurs.** Travailler le référencement Google (pages indexables, contenu utile, liens internes, sitemap), IndexNow et les contenus faciles à partager.
2. **Faire cliquer vers les marchands partenaires.** Liens affiliés Awin, Rakuten et Amazon (tag prixbasmalin2-21) bien visibles, offres partenaires et codes promo officiels.
3. **Garder un site propre et pro** : vraies photos marchandes, prix datés, rien de cassé.

La conformité et la sécurité restent obligatoires, mais elles ne doivent pas bloquer l'avancement.
Si une règle de prudence empêche d'atteindre l'objectif, propose une solution qui respecte les deux. Ne te contente pas de retirer des fonctions.

## Travail en équipe avec les autres IA

- **Ne jamais défaire** le travail fusionné par une autre IA, ni annuler une décision du propriétaire. Pas de revert, pas de masquage, pas de suppression.
- En cas de désaccord, explique-le dans la description de la PR ou dans une issue, puis laisse le propriétaire trancher.
- Chaque PR doit dire en une phrase **ce qu'elle apporte pour le trafic ou les ventes**.

## Toujours valable

- Ne jamais inventer de prix.
- Seuls les prix TTC confirmés et datés de moins de 48 h peuvent servir de « prix vérifié » ou de « meilleur prix ».
