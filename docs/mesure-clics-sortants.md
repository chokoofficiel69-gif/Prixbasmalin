# Mesure des clics sortants — décision à valider

## État actuel
Le site est servi comme site statique. Sans endpoint de collecte ni fournisseur d'analytics configuré, le navigateur peut détecter un clic mais ne peut pas créer un compteur global fiable à lui seul. Les statistiques privées de visiteurs, de sources et de clics ne sont pas accessibles depuis le dépôt GitHub public.

Aucun outil d'analyse n'est activé par ce document. Aucun appel réseau de suivi, cookie ou stockage d'identifiant n'est ajouté.

## Option gratuite à examiner en premier
Choisir un service d'analytics respectueux de la vie privée qui propose explicitement un mode sans cookies et vérifier ses conditions pour la France avant toute intégration. Le caractère « sans cookies » ne suffit pas, à lui seul, à conclure qu'aucun consentement n'est nécessaire : cela dépend notamment des finalités, de la configuration et des exemptions applicables. À faire valider au regard des recommandations CNIL en vigueur.

Avant d'activer quoi que ce soit, le propriétaire doit approuver :
1. le fournisseur et ses conditions de traitement/transferts ;
2. les événements collectés (idéalement seulement clic sortant, marchand/catégorie, horodatage agrégé) ;
3. la durée de conservation et les mentions de confidentialité ;
4. la configuration sans cookie et sans identifiant publicitaire ;
5. un test confirmant qu'aucune donnée n'est envoyée avant activation explicite.

## Solution auto-hébergée
Un compteur first-party nécessite un endpoint côté serveur et un hébergement. Le dépôt GitHub Pages seul ne fournit pas de fonction serveur. L'auto-hébergement peut avoir un coût opérationnel et n'est pas activé ici. Ne pas introduire Cloudflare ni Supabase pour ce projet.

## Ce qui ne constitue pas une mesure
- Un compteur JavaScript en mémoire ou dans localStorage ne mesure que le navigateur local, pas tous les visiteurs.
- Des paramètres UTM sur les liens ne comptent pas les clics par eux-mêmes.
- Les statistiques Amazon/Awin, si accessibles ultérieurement, mesurent généralement leurs propres événements et ne remplacent pas les statistiques de trafic du site.

## Décision
**En attente d'accord du propriétaire.** Aucun service, script d'analytics, cookie, endpoint ni transfert de données n'a été activé.