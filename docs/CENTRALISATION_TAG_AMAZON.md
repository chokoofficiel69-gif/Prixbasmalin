# Centralisation du tag Amazon — note de migration

Le tag public `prixbasmalin2-21` est répété dans environ 187 liens de `catalogue.html` et 6 liens de `high-tech.html`. Cette branche ne remplace pas massivement ces URL parce que le comportement de chaque parcours doit être vérifié avant de changer l'attribution.

`js/amazon-search.js` définit un seul point de configuration et laisse l'ajout du tag désactivé par défaut. Il ne doit pas être utilisé pour inventer des liens d'affiliation ni modifier les liens existants tant qu'un test de parcours complet n'est pas prêt.

La prochaine migration doit :
1. remplacer les URL codées en dur par le helper sur une petite portion testable ;
2. vérifier qu'un clic ouvre bien la requête attendue ;
3. vérifier le tag une seule fois dans l'URL finale ;
4. conserver `rel="sponsored noopener noreferrer"` pour les liens affiliés qui ouvrent un nouvel onglet ;
5. étendre seulement après vérification de tous les parcours.
