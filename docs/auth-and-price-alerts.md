# Prix Malin — comptes et alertes prix

## État et sécurité

Cette migration crée le stockage des alertes dans **un projet Supabase dédié à Prix Malin**. Ne l'exécutez pas sur le projet Supabase existant associé à Job Agent IA.

- Les alertes sont rattachées à `auth.users` et protégées par Row Level Security (RLS).
- Un utilisateur authentifié ne peut lire, créer, modifier ou supprimer que ses propres alertes.
- Aucun mot de passe, clé secrète, jeton ou identifiant de projet n'est stocké dans ce dépôt.
- Cette migration ne prétend pas, à elle seule, activer l'inscription sur le site ni envoyer des emails/SMS.

## Étapes d'intégration restantes

1. Créer ou désigner explicitement un projet Supabase dédié à Prix Malin.
2. Appliquer `supabase/migrations/202610250001_price_alerts.sql` à ce projet.
3. Configurer les URL de redirection d'authentification pour le domaine Prix Malin et vérifier les modèles d'email.
4. Ajouter le client Supabase côté navigateur avec uniquement l'URL et la clé publishable/anon du projet dédié.
5. Remplacer la fenêtre « Compte » de `index.html` par inscription, connexion, déconnexion et récupération de mot de passe.
6. Relier le bouton d'alerte du catalogue à la session et à `public.price_alerts`.
7. Implémenter l'envoi des notifications côté serveur (Edge Function/cron) après validation de la source de prix. Ne jamais placer une clé service-role dans le navigateur.
8. Tester inscription, confirmation email, connexion, isolation entre deux comptes, création/modification/suppression d'alerte et livraison de notification avant activation en production.

## Critères d'acceptation

- Un visiteur peut créer un compte et se connecter, avec des erreurs compréhensibles.
- Un visiteur non connecté est invité à se connecter avant d'enregistrer une alerte.
- Une alerte enregistrée réapparaît après reconnexion.
- Deux comptes ne peuvent pas consulter ou modifier les alertes de l'autre.
- Aucune notification n'est envoyée sur la base d'un prix non vérifié.
