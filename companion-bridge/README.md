# Relais navigateur de Studio IA

Cette extension Chrome donne à La Rue et La Ruse un accès limité à l'onglet actif.

## Installation
1. Ouvre `chrome://extensions` dans Chrome.
2. Active le **mode développeur**.
3. Choisis **Charger l'extension non empaquetée**.
4. Sélectionne le dossier `companion-bridge` de ce dépôt.
5. Copie l'identifiant de l'extension affiché par Chrome.
6. Dans Studio IA → Mon compagnon, colle cet identifiant dans « Relais navigateur » puis enregistre.

## Autorisations
- La communication externe est acceptée uniquement depuis `https://studio.prixbasmalin.prod.page`.
- Les actions de lecture, clic et saisie demandent une confirmation dans la page active.
- La saisie ne soumet jamais le formulaire.
- Les clics sur des libellés de paiement, suppression, publication ou envoi sont bloqués.
- L'ouverture d'une adresse est limitée à HTTP(S) public ; les adresses locales sont refusées.

## Limites
L'extension ne contrôle pas le bureau Windows, les applications natives ni les fenêtres système. Elle agit uniquement dans les pages web. Le contrôle du bureau nécessitera un relais local distinct, installé et lancé volontairement sur le PC.
