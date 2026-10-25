# Prix Malin — comptes et alertes prix

## État et sécurité

Cette migration crée le stockage des alertes dans **un projet Supabase dédié à Prix Malin**. Ne l'exécutez pas sur le projet Supabase existant associé à Job Agent IA.

- Les alertes sont rattachées à `auth.users` et protégées par Row Level Security (RLS).
- Un utilisateur authentifié ne peut lire, créer, modifier ou supprimer que ses propres alertes.
- Aucun mot de passe, clé secrète, jeton ou identifiant de projet n'est stocké dans ce dépôt.
- Cette migration ne prétend pas, à elle seule, activer l'inscription sur le site ni envoyer des emails/SMS.

## Étapes d'intégration restantes

1. Projet dédié créé : `eulzthypxffmfpaqzqld` (région `eu-west-1`, statut initial actif).
2. Migration `create_price_alerts` appliquée ; la table `public.price_alerts` et RLS ont été vérifiées via le connecteur.
3. Le client `js/prix-malin-auth.js` raccorde l'interface compte à Supabase Auth (inscription, connexion, déconnexion, réinitialisation) et propose l'enregistrement d'un seuil de prix dans `public.price_alerts`.
4. Configurer/valider dans Supabase les URL de redirection et l'envoi des e-mails de confirmation/réinitialisation pour `prixbasmalin.fr`.
5. Tester inscription, confirmation email, connexion, isolation entre deux comptes, création d'alerte et persistance après reconnexion.
6. Implémenter l'envoi automatique des notifications côté serveur (Edge Function/cron) après validation de la source de prix. Ne jamais placer une clé service-role dans le navigateur.
7. Tester le site déployé et le parcours complet avant fusion/activation en production.

## Critères d'acceptation

- Un visiteur peut créer un compte et se connecter, avec des erreurs compréhensibles.
- Un visiteur non connecté est invité à se connecter avant d'enregistrer une alerte.
- Une alerte enregistrée réapparaît après reconnexion.
- Deux comptes ne peuvent pas consulter ou modifier les alertes de l'autre.
- Aucune notification n'est envoyée sur la base d'un prix non vérifié.
