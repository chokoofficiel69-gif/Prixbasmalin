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

## Vérifications d'exploitation — 3 novembre 2026

- Le projet Supabase dédié à Prix Malin a été restauré et son état est revenu à `ACTIVE_HEALTHY`.
- La table `public.price_alerts` est présente ; la sécurité RLS est activée.
- Les politiques SELECT/INSERT/UPDATE/DELETE sont limitées au rôle `authenticated` et vérifient `auth.uid() = user_id`.
- Les privilèges Data API nécessaires sont présents. Les privilèges de table accordés au rôle `anon` ne donnent pas accès aux lignes : aucune politique RLS anonyme n'est définie.
- Le contrôle Supabase Security Advisor n'a retourné aucun avertissement.
- L'inscription réelle, la confirmation e-mail, les URL de redirection de production et la réinitialisation de mot de passe restent à tester avec une adresse contrôlée par l'éditeur.
- Les alertes sont enregistrées et consultables, mais aucun moteur de surveillance des prix en arrière-plan ni envoi automatique d'e-mail de baisse n'est déclaré opérationnel. Il faudra une source de prix frais et autorisée ainsi qu'un canal d'envoi configuré.

Ne pas présenter les alertes comme des notifications automatiques tant que ces deux dernières briques ne sont pas testées en production.
