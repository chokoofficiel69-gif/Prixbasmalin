# Contrôle de pré-lancement — PrixBasMalin

Dernière revue : 24 octobre 2026  
Périmètre : dépôt public `chokoofficiel69-gif/Prixbasmalin`, branche `main`, et prototype 2027 de la PR #21.

## Décision

**Ne pas présenter le comparateur comme un comparateur de prix en temps réel tant qu'un flux d'offres vérifiées n'est pas alimenté.** Le catalogue éditorial peut rester visible, mais les fiches illustratives ne doivent pas être confondues avec des offres disponibles.

## Constats vérifiés dans le dépôt

- `data/prices.json` contient actuellement une liste vide de produits et d'offres. Il ne faut donc pas fabriquer de prix ni annoncer de comparaison effective.
- `catalogue.html` contient un catalogue de fiches illustratives et affiche un avertissement indiquant que prix et disponibilités ne sont pas récupérés en temps réel.
- `robots.txt` référence `https://prixbasmalin.fr/sitemap.xml`.
- Le sitemap existant ne référence pas de page de mentions légales ni de politique de confidentialité.
- Aucun fichier correspondant à `mentions-legales.html`, `confidentialite.html`, `privacy.html`, `cookies.html` ou `rgpd.html` n'a été trouvé dans l'arborescence de la branche `main` lors de cette revue.
- `js/track-outbound.js` envoie des événements de clic sortant à un Worker et envoie des événements de consultation/attribution à un second Worker. Il conserve un identifiant de session et l'attribution dans `sessionStorage`. Les clics sortants ne prouvent pas une vente.
- Le dépôt inclut un beacon Cloudflare Web Analytics dans certaines pages. Les finalités, durées de conservation, accès aux données et éventuels réglages de consentement doivent être confirmés à partir de la configuration réelle des services.
- La PR #21 fournit un prototype autonome ; il n'est pas raccordé au flux de production et n'a pas été déployé sur le domaine public.

## Bloquants avant lancement public ou candidature à un programme

### 1. Informations légales — à compléter par l'éditeur

Ne pas publier de données inventées. Confirmer et renseigner :
- identité juridique exacte de l'éditeur et, le cas échéant, nom commercial ;
- adresse professionnelle et moyen de contact public ;
- statut et numéro d'immatriculation applicables ;
- directeur/directrice de publication ;
- hébergeur réel et coordonnées demandées par les règles applicables ;
- propriétaire du nom de domaine et responsable des contenus.

### 2. Vie privée et mesure d'audience

- Cartographier les données envoyées par chaque script, y compris les Workers, Cloudflare Web Analytics, les journaux serveur et les éventuels partenaires.
- Vérifier la configuration effective et la nécessité éventuelle d'un consentement avant tout stockage/lecture non essentiel ou suivi publicitaire.
- Définir une base légale, les finalités, les destinataires, les durées de conservation, les droits des personnes et un contact pour les demandes.
- Ajouter une politique de confidentialité exacte et accessible depuis toutes les pages. Ne pas prétendre que la mesure est « anonyme » sans preuve technique et contractuelle.
- Tester le comportement réel du site sans consentement, avec refus, et après choix, si un mécanisme de consentement est applicable.

### 3. Transparence commerciale et prix

- Distinguer clairement fiche produit, lien marchand, offre vérifiée et vente confirmée.
- Pour toute offre publiée, exiger une source autorisée, une identité produit exacte, un prix en euros, les frais de livraison, une date de relevé, un lien produit sûr et une règle de fraîcheur documentée.
- Afficher une mention claire si un lien est affilié et expliquer que le site peut percevoir une commission, uniquement si cela correspond aux partenariats réellement actifs.
- Ne pas afficher de remise, ancien prix, note, disponibilité ou économie sans source vérifiable.
- Conserver un état vide honnête si aucune offre n'est vérifiée.

### 4. Qualité et publication

- Exécuter les tests unitaires et les contrôles de génération du flux.
- Vérifier que l'artefact validé est exactement celui qui sera publié ; éviter toute reconstruction après validation sans nouvelle validation.
- Vérifier les liens internes, erreurs 404, navigation mobile, accessibilité clavier, contrastes, métadonnées, sitemap et redirections HTTPS.
- Faire un test de bout en bout sur le domaine public après déploiement, sans exposer de secrets ni modifier la production avant revue.
- Archiver le commit déployé, les résultats des contrôles et une procédure de retour arrière.

## Conditions pour considérer le produit prêt

- [ ] Informations légales réelles complétées et vérifiées.
- [ ] Politique de confidentialité alignée sur les traitements réellement actifs.
- [ ] Mesure d'audience et consentement vérifiés selon la configuration réelle.
- [ ] Au moins un parcours marchand réel testé de bout en bout, ou état vide clairement assumé.
- [ ] Zéro prix ou économie inventés ; frais de livraison pris en compte.
- [ ] Tests automatiques réussis sur le commit exact proposé au déploiement.
- [ ] Vérification manuelle mobile et desktop.
- [ ] Sitemap et liens de pied de page mis à jour et testés.
- [ ] Publication et retour arrière documentés.

## Limite de cette revue

Ce document est un audit technique de pré-lancement, pas une certification juridique ni une preuve que les services tiers sont configurés d'une manière particulière. Les informations propres à l'éditeur et les réglages des Workers/hébergeur doivent être confirmés par le propriétaire du site.
