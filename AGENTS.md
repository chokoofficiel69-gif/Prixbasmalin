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
- ils ne sont jamais présentés comme « vérifiés » ;
- ils portent la mention « flux marchand du JJ/MM · à confirmer » ;
- ils disparaissent quand le flux a plus de 7 jours ;
- les marchands qui affichent leurs prix hors taxes (Lusini) sont exclus.

**Interdit** : retirer, masquer ou remplacer ces prix par « Prix non vérifié » sans l'accord écrit du propriétaire.

**Si tu vois un problème** (prix faux, flux cassé, marchand HT) : signale-le dans une issue ou dans la description d'une PR.
Ne supprime pas l'affichage tout seul.

## Toujours valable

- Ne jamais inventer de prix.
- Seuls les prix TTC confirmés et datés de moins de 48 h peuvent servir de « prix vérifié » ou de « meilleur prix ».
