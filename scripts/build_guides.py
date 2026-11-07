#!/usr/bin/env python3
"""Génère les guides d'achat Prix Malin (même gabarit que guide-choisir-smartphone.html)
et la page sommaire /guides.html.

Contenu éditorial rédigé à la main dans GUIDES. Aucun prix n'est cité : les guides renvoient
vers le comparateur (/prix/), le catalogue et les liens partenaires existants.
"""
import argparse
import json
import re
import sys
from html import escape as e
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://prixbasmalin.fr"
TAG = "prixbasmalin2-21"


def amazon(q):
    return "https://www.amazon.fr/s?" + urlencode({"k": q, "tag": TAG})


GUIDES = [
    {
        "slug": "guide-air-fryer-pas-cher",
        "title": "Meilleur air fryer pas cher : bien choisir | Prix Malin",
        "h1": "Meilleur air fryer pas cher : comment bien le choisir ?",
        "description": "Capacité, puissance, panier ou double tiroir, revêtement, nettoyage : les critères pour choisir un air fryer pas cher sans regretter son achat.",
        "eyebrow": "Guide d'achat · Maison & cuisine",
        "crumb": ("Maison & Déco", "/maison-deco.html"),
        "lead": "La friteuse sans huile (ou air fryer) est devenue l'appareil de cuisine le plus offert. Mais entre un modèle d'entrée de gamme et un appareil à double tiroir, les écarts de capacité, de confort et de durée de vie sont réels. Voici comment choisir sans payer pour des fonctions inutiles.",
        "sections": [
            ("Comment fonctionne un air fryer ?", """<p>Un air fryer est un petit four à convection très puissant : une résistance chauffe l'air, et un ventilateur le fait circuler à grande vitesse autour des aliments. Résultat : une surface dorée et croustillante avec peu ou pas de matière grasse. Comme la cavité est petite, il chauffe vite et se contente souvent de cuissons plus courtes qu'un grand four, ce qui en fait un appareil pratique au quotidien.</p>
<p>Il ne remplace pas tout : les grosses pièces, les gratins familiaux ou plusieurs plaques de biscuits restent plus simples au four. Pensez-le comme un complément, idéal pour les frites, les légumes rôtis, les nuggets, le poisson pané ou le réchauffage.</p>"""),
            ("1. La capacité : le critère numéro un", """<p>La capacité s'exprime en litres et conditionne le nombre de portions. Un panier trop petit oblige à cuire en plusieurs fois, ce qui annule le gain de temps. Repères courants :</p>
<div class="tablewrap"><table><thead><tr><th>Foyer</th><th>Capacité conseillée</th><th>Format</th></tr></thead><tbody>
<tr><td>1 à 2 personnes</td><td>2 à 4 litres</td><td>Panier unique compact</td></tr>
<tr><td>3 à 4 personnes</td><td>4,5 à 6 litres</td><td>Grand panier</td></tr>
<tr><td>Famille de 5 et plus</td><td>7 litres et plus</td><td>Double tiroir ou modèle « four »</td></tr>
</tbody></table></div>
<p>Attention : la capacité annoncée correspond au volume du panier, pas à la quantité de frites cuites de façon homogène. Pour un résultat croustillant, il faut laisser l'air circuler et ne pas remplir le panier à ras bord.</p>"""),
            ("2. Panier unique, double tiroir ou modèle four ?", """<h3>Le panier unique</h3><p>C'est le format le moins cher et le plus simple. Il suffit largement pour une ou deux personnes ou pour un accompagnement.</p>
<h3>Le double tiroir</h3><p>Deux zones indépendantes permettent de cuire deux aliments à des températures différentes et de les faire finir en même temps (par exemple du poulet d'un côté, des légumes de l'autre). Très pratique pour les familles, mais plus encombrant et plus cher.</p>
<h3>Le modèle « four » avec porte</h3><p>Il ressemble à un mini-four avec des grilles et parfois une broche. Polyvalent, mais plus long à nettoyer et souvent moins croustillant qu'un panier.</p>"""),
            ("3. Puissance, réglages et programmes", """<p>La puissance des modèles courants se situe généralement entre 1 400 et 2 400 watts : plus le panier est grand, plus il faut de puissance pour chauffer vite. Un modèle peu puissant avec un gros panier risque de cuire de façon inégale.</p>
<p>Vérifiez la plage de température (souvent jusqu'à 200 °C environ) et la minuterie. Les programmes préréglés sont pratiques mais pas indispensables : la température et le temps suffisent dans la plupart des recettes. Une fenêtre de contrôle ou une lumière intérieure évite d'ouvrir le tiroir pendant la cuisson.</p>"""),
            ("4. Nettoyage et revêtement", """<p>Un air fryer s'utilise souvent : un panier difficile à laver finit au placard. Privilégiez un panier et une grille compatibles lave-vaisselle, avec un revêtement antiadhésif de bonne qualité. Les revêtements céramiques sont une alternative aux revêtements classiques. Dans tous les cas, évitez les ustensiles métalliques qui rayent la surface et ne faites pas chauffer l'appareil à vide plus que nécessaire.</p>
<div class="tip"><strong>Le réflexe Prix Malin :</strong> regardez si le panier et la grille sont vendus en pièces détachées. Un appareil réparable dure plus longtemps et revient moins cher sur la durée.</div>"""),
            ("5. Les pièges à éviter", """<ol class="checklist">
<li><strong>Acheter trop petit</strong> pour gagner quelques euros, puis cuire en plusieurs fournées.</li>
<li><strong>Ignorer l'encombrement</strong> : mesurez votre plan de travail et la place sous les placards, l'air chaud sort par l'arrière.</li>
<li><strong>Se fier à une « remise » non vérifiable</strong> : comparez le prix chez plusieurs marchands et la livraison.</li>
<li><strong>Oublier le bruit</strong> : le ventilateur est audible ; les avis d'utilisateurs renseignent sur ce point.</li>
<li><strong>Négliger la garantie</strong> : la garantie légale de conformité de 2 ans s'applique aux produits neufs achetés auprès d'un professionnel.</li>
</ol>"""),
        ],
        "faq": [
            ("Quelle taille d'air fryer pour 4 personnes ?", "Comptez environ 4,5 à 6 litres pour 3 à 4 personnes, ou un modèle à double tiroir si vous cuisinez souvent un plat et un accompagnement en même temps."),
            ("Un air fryer consomme-t-il beaucoup d'électricité ?", "Sa puissance est élevée, mais il chauffe une petite cavité et les cuissons sont souvent courtes. Pour de petites quantités, il est généralement plus économe qu'un grand four ; pour un plat familial, le four reste adapté."),
            ("Faut-il ajouter de l'huile ?", "Ce n'est pas obligatoire. Une cuillère d'huile ou un spray léger améliore toutefois le doré des légumes et des frites maison."),
        ],
        "links": [("Voir les air fryers sur Amazon", amazon("air fryer friteuse sans huile")), ("Chercher dans le catalogue", "/catalogue.html?q=air%20fryer"), ("Idées cadeaux maison", "/idees-cadeaux/")],
    },
    {
        "slug": "guide-ecouteurs-sans-fil-petit-prix",
        "title": "Écouteurs sans fil à petit prix : le guide | Prix Malin",
        "h1": "Les meilleurs écouteurs sans fil à petit prix : comment choisir ?",
        "description": "Autonomie, réduction de bruit, compatibilité iPhone ou Android, étanchéité, micro : les critères pour choisir des écouteurs sans fil sans trop dépenser.",
        "eyebrow": "Guide d'achat · Audio",
        "crumb": ("High-tech", "/high-tech.html"),
        "lead": "On trouve aujourd'hui des écouteurs sans fil corrects à petit prix, mais les écarts de confort, d'autonomie et de qualité d'appel sont importants. Le bon choix dépend surtout de votre téléphone et de vos usages : transports, sport, télétravail ou simple musique à la maison.",
        "sections": [
            ("1. Commencez par votre téléphone", """<p>Les écouteurs Bluetooth fonctionnent avec tous les smartphones, mais certaines fonctions sont réservées à un écosystème. Les AirPods s'appairent instantanément à un iPhone et profitent du codec AAC ; sur Android, de nombreux modèles proposent des codecs comme aptX ou LDAC, utiles si vous écoutez de la musique en haute qualité. Si vous avez un iPhone, un modèle compatible AAC suffit ; sur Android, vérifiez les codecs pris en charge par votre téléphone.</p>
<p>Le <strong>multipoint</strong> (connexion simultanée à deux appareils, par exemple téléphone et ordinateur) est très pratique en télétravail : vérifiez qu'il figure bien dans la fiche technique.</p>"""),
            ("2. Réduction de bruit : utile ou gadget ?", """<p>La réduction de bruit active (ANC) atténue les bruits graves et continus : moteur, métro, avion, ventilation. Dans les transports, elle permet d'écouter moins fort, ce qui protège l'audition. À petit prix, son efficacité varie beaucoup d'un modèle à l'autre : fiez-vous à des tests indépendants plutôt qu'à la mention « ANC » sur la boîte.</p>
<p>Le <strong>mode transparence</strong> fait l'inverse : il laisse entrer les sons extérieurs pour rester attentif dans la rue. C'est un vrai plus pour la sécurité.</p>"""),
            ("3. Autonomie : lisez bien les chiffres", """<p>Les fabricants annoncent souvent deux valeurs : l'autonomie des écouteurs seuls (une écoute continue) et l'autonomie totale avec les recharges du boîtier. Pour un usage quotidien, plusieurs heures d'écoute continue suffisent si le boîtier recharge rapidement. L'autonomie baisse avec la réduction de bruit activée et un volume élevé.</p>
<p>La recharge sans fil du boîtier est un confort, pas une nécessité. Un connecteur USB-C est en revanche devenu la norme.</p>"""),
            ("4. Confort, maintien et étanchéité", """<p>Des écouteurs mal ajustés sonnent moins bien et tombent. Les modèles intra-auriculaires avec embouts de plusieurs tailles isolent mieux ; les modèles ouverts sont plus légers mais laissent passer le bruit. Pour le sport, cherchez un indice d'étanchéité (IPX4 au minimum contre la sueur et la pluie légère) et éventuellement des ailettes de maintien.</p>"""),
            ("5. Le micro et les appels", """<p>Si vous téléphonez souvent, la qualité des micros compte autant que le son. Les modèles d'entrée de gamme captent parfois beaucoup de vent et de bruit ambiant. Cherchez la mention de plusieurs micros et d'une réduction du bruit en appel, puis vérifiez les avis sur ce point précis.</p>"""),
            ("6. Comment payer moins cher", """<ol class="checklist">
<li><strong>Visez la génération précédente</strong> : à la sortie d'un nouveau modèle, l'ancien baisse souvent sans être dépassé pour un usage courant.</li>
<li><strong>Comparez le même modèle chez plusieurs marchands</strong> : l'écart peut être important pour un produit identique.</li>
<li><strong>Regardez l'évolution du prix</strong> avant d'acheter, surtout à l'approche des grandes promotions.</li>
<li><strong>Méfiez-vous des copies</strong> vendues par des vendeurs inconnus : achetez auprès d'un marchand identifiable.</li>
</ol>
<div class="tip"><strong>Le réflexe Prix Malin :</strong> sur nos fiches AirPods, JBL ou Bose, vous voyez le prix relevé chez chaque marchand et son évolution, pour acheter au bon moment.</div>"""),
        ],
        "faq": [
            ("Les AirPods fonctionnent-ils avec Android ?", "Oui, en Bluetooth classique, mais certaines fonctions (appairage automatique, réglages avancés) sont réservées aux appareils Apple."),
            ("La réduction de bruit est-elle indispensable ?", "Non. Elle est très utile dans les transports et les open spaces ; pour écouter à la maison ou faire du sport, un bon maintien et une bonne autonomie comptent davantage."),
            ("Quelle autonomie viser ?", "Plusieurs heures d'écoute continue et un boîtier capable de recharger les écouteurs plusieurs fois couvrent la plupart des usages quotidiens."),
        ],
        "links": [("Comparer les écouteurs et casques", "/prix/ecouteurs-casques.html"), ("Prix des AirPods 4", "/prix/airpods-4.html"), ("Voir les écouteurs sur Amazon", amazon("écouteurs sans fil bluetooth"))],
    },
    {
        "slug": "guide-choisir-aspirateur-robot",
        "title": "Comment choisir un aspirateur robot ? | Prix Malin",
        "h1": "Comment choisir un aspirateur robot sans se tromper ?",
        "description": "Navigation laser, station, serpillière, poils d'animaux, entretien : les critères pour choisir un aspirateur robot adapté à votre logement.",
        "eyebrow": "Guide d'achat · Maison",
        "crumb": ("Maison & Déco", "/maison-deco.html"),
        "lead": "Un aspirateur robot fait gagner du temps chaque semaine, à condition de choisir un modèle adapté à votre logement. Surface, type de sol, animaux, meubles bas : ce sont ces critères, plus que la fiche technique la plus impressionnante, qui font la différence.",
        "sections": [
            ("1. La navigation : le critère qui change tout", """<p>Un robot qui se repère mal oublie des zones, se bloque et vide sa batterie inutilement. Trois grandes familles existent :</p>
<div class="tablewrap"><table><thead><tr><th>Navigation</th><th>Points forts</th><th>Limites</th></tr></thead><tbody>
<tr><td>Laser (LiDAR)</td><td>Cartographie précise, fonctionne dans le noir, nettoyage méthodique</td><td>Tourelle qui augmente la hauteur du robot</td></tr>
<tr><td>Caméra</td><td>Reconnaissance des obstacles, robot souvent plus bas</td><td>Dépend de la lumière ; vérifiez les réglages de confidentialité</td></tr>
<tr><td>Gyroscope / aléatoire</td><td>Modèles les moins chers</td><td>Pas de vraie carte, nettoyage moins régulier</td></tr>
</tbody></table></div>
<p>Pour un logement de plusieurs pièces, une navigation avec cartographie permet de définir des zones interdites et de nettoyer pièce par pièce depuis l'application.</p>"""),
            ("2. Aspiration, brosses et poils d'animaux", """<p>La puissance d'aspiration est souvent exprimée en pascals (Pa). C'est un indicateur, mais la conception de la brosse et de la bouche d'aspiration compte autant. Avec des animaux ou des cheveux longs, privilégiez une brosse principale en caoutchouc ou anti-enchevêtrement, beaucoup plus facile à entretenir. Sur les tapis, une fonction d'augmentation automatique de puissance est utile.</p>"""),
            ("3. Serpillière : simple lingette ou vrai lavage ?", """<p>Beaucoup de robots combinent aspiration et lavage. Les systèmes basiques traînent une lingette humide ; les plus avancés utilisent des mops rotatifs avec pression. Si vous avez des tapis, choisissez un modèle capable de <strong>relever la serpillière</strong> ou de détecter les tapis pour ne pas les mouiller.</p>"""),
            ("4. La station : confort ou dépense inutile ?", """<p>La station d'auto-vidage aspire le contenu du bac du robot dans un sac, pour plusieurs semaines sans intervention. Les stations « tout-en-un » lavent et sèchent aussi les serpillières et remplissent le réservoir d'eau. C'est un vrai confort, mais aussi un encombrement important et des consommables supplémentaires (sacs, filtres). Mesurez la place disponible avant d'acheter.</p>"""),
            ("5. Les détails qui comptent au quotidien", """<ol class="checklist">
<li><strong>La hauteur</strong> : mesurez l'espace sous le canapé et les lits.</li>
<li><strong>Le franchissement</strong> : seuils de porte et bords de tapis peuvent bloquer certains robots.</li>
<li><strong>Le bruit</strong> : programmez le nettoyage quand vous êtes absent.</li>
<li><strong>Les consommables</strong> : brosses, filtres, sacs et serpillières se remplacent ; vérifiez qu'ils sont faciles à trouver.</li>
<li><strong>L'application</strong> : zones interdites, nettoyage par pièce et programmation sont plus utiles que la commande vocale.</li>
</ol>
<div class="tip"><strong>Le réflexe Prix Malin :</strong> les robots haut de gamme changent souvent de prix. Sur nos fiches Roborock, Dreame, Ecovacs ou iRobot, comparez les marchands et l'évolution du prix avant de vous décider.</div>"""),
            ("6. Quel robot pour quel logement ?", """<p><strong>Studio ou petit appartement :</strong> un modèle simple avec cartographie suffit souvent ; la station est un luxe.</p>
<p><strong>Appartement familial ou maison :</strong> navigation laser, carte multi-niveaux si vous avez un étage, et station d'auto-vidage pour limiter l'entretien.</p>
<p><strong>Avec animaux :</strong> brosse anti-enchevêtrement, bon filtre et bac ou station de grande capacité.</p>
<p><strong>Beaucoup de carrelage :</strong> un modèle avec serpillière rotative et station de lavage prend tout son sens.</p>"""),
        ],
        "faq": [
            ("Un aspirateur robot remplace-t-il un aspirateur classique ?", "Pour l'entretien régulier, souvent oui. Les escaliers, les recoins et le nettoyage en profondeur demandent encore un aspirateur balai ou traîneau de temps en temps."),
            ("Faut-il une station d'auto-vidage ?", "Elle n'est pas indispensable mais réduit fortement l'entretien, surtout avec des animaux. Elle prend de la place et utilise des sacs à racheter."),
            ("Un robot avec caméra pose-t-il un problème de vie privée ?", "Vérifiez dans l'application les réglages de confidentialité, la possibilité de désactiver l'envoi d'images et la politique du fabricant."),
        ],
        "links": [("Comparer les aspirateurs", "/prix/aspirateurs.html"), ("Prix du Roborock Qrevo Curv", "/prix/roborock-qrevo-curv.html"), ("Voir les robots sur Amazon", amazon("aspirateur robot laveur"))],
    },
    {
        "slug": "guide-black-friday-2026",
        "title": "Black Friday 2026 : vrais bons plans | Prix Malin",
        "h1": "Black Friday 2026 : comment repérer les vraies bonnes affaires ?",
        "description": "Dates du Black Friday 2026, prix de référence, historique des prix, alertes, droit de rétractation : la méthode pour éviter les fausses promotions.",
        "eyebrow": "Guide pratique · Bons plans",
        "crumb": ("Offres du moment", "/offres.html"),
        "lead": "Le Black Friday 2026 tombe le vendredi 27 novembre, suivi du Cyber Monday le lundi 30 novembre. Beaucoup d'enseignes lancent leurs offres dès le début du mois. Entre vraies baisses et remises gonflées, voici une méthode simple pour acheter au bon prix.",
        "sections": [
            ("1. Préparez votre liste avant les promotions", """<p>Les meilleures affaires profitent à ceux qui savent déjà ce qu'ils veulent. Notez les produits dont vous avez réellement besoin, la référence exacte (capacité, couleur, version) et un prix maximal. Sans liste, on achète surtout ce qui est mis en avant.</p>
<p>C'est aussi le bon moment pour préparer les cadeaux de Noël : les offres de fin novembre peuvent couvrir une bonne partie de la liste.</p>"""),
            ("2. Vérifiez le prix de référence", """<p>En France, depuis 2022, une annonce de réduction doit se calculer à partir du <strong>prix le plus bas pratiqué par le vendeur au cours des 30 jours précédents</strong> (article L112-1-1 du Code de la consommation). Cette règle limite les hausses de prix juste avant une promotion, mais elle ne garantit pas que l'offre soit la moins chère du marché : un autre marchand peut vendre moins cher sans afficher de « remise ».</p>
<div class="tip"><strong>Le réflexe Prix Malin :</strong> consultez l'évolution du prix sur nos fiches produits. Si le prix « remisé » est proche du prix habituel, ce n'est pas une affaire exceptionnelle.</div>"""),
            ("3. Suivez les prix dès maintenant", """<p>Plus vous connaissez le prix habituel d'un produit, plus il est facile de repérer une vraie baisse. Créez des alertes prix sur les produits de votre liste : vous serez prévenu lorsqu'un prix descend, sans surveiller les sites tous les jours.</p>
<p>Les produits high-tech très demandés (consoles, écouteurs, smartphones, aspirateurs robots) sont souvent ceux dont le prix varie le plus d'un marchand à l'autre.</p>"""),
            ("4. Comparez le coût total, pas seulement l'étiquette", """<ol class="checklist">
<li><strong>Les frais de livraison</strong>, parfois plus élevés en période de forte demande.</li>
<li><strong>Le vendeur réel</strong> : sur une place de marché, le produit peut être vendu par un tiers avec d'autres conditions.</li>
<li><strong>La garantie</strong> : la garantie légale de conformité de 2 ans s'applique aux produits neufs ; les extensions payantes sont rarement indispensables.</li>
<li><strong>Le paiement en plusieurs fois</strong>, qui peut entraîner des frais.</li>
<li><strong>Les accessoires</strong> indispensables non inclus (chargeur, câble, sacs pour une station…).</li>
</ol>"""),
            ("5. Achetez sereinement en ligne", """<p>Pour un achat à distance auprès d'un professionnel, vous disposez en principe d'un <strong>droit de rétractation de 14 jours</strong> après la réception, avec quelques exceptions. Vérifiez qui paie les frais de retour. Méfiez-vous des sites inconnus aux prix très inférieurs au marché, des paiements par virement à l'étranger et des offres reçues par SMS ou message privé.</p>"""),
            ("6. Nos raccourcis pour le Black Friday", """<p>Pour gagner du temps : le comparateur Prix Malin classe les offres du moins cher au plus cher pour des dizaines de produits high-tech, et nos pages d'idées cadeaux sont organisées par budget. Les offres du jour Amazon regroupent aussi des promotions limitées dans le temps.</p>"""),
        ],
        "faq": [
            ("Quand a lieu le Black Friday 2026 ?", "Le vendredi 27 novembre 2026. Le Cyber Monday suit le lundi 30 novembre, et de nombreuses enseignes proposent des offres sur plusieurs jours, voire tout le mois."),
            ("Les prix sont-ils vraiment plus bas pendant le Black Friday ?", "Parfois, mais pas toujours. Comparez avec le prix habituel et avec les autres marchands avant d'acheter."),
            ("Peut-on retourner un produit acheté pendant le Black Friday ?", "Les règles habituelles s'appliquent : en ligne, le droit de rétractation de 14 jours vaut en principe pour les achats auprès d'un professionnel, sauf exceptions prévues par la loi."),
        ],
        "links": [("Comparer les prix high-tech", "/prix/"), ("Idées cadeaux par budget", "/idees-cadeaux/"), ("Offres du jour Amazon", "https://www.amazon.fr/gp/goldbox?tag=" + TAG)],
    },
    {
        "slug": "guide-payer-moins-cher-en-ligne",
        "title": "Payer moins cher en ligne : 10 astuces | Prix Malin",
        "h1": "10 astuces pour payer moins cher en ligne",
        "description": "Prix total, historique, alertes, reconditionné, frais cachés : 10 astuces simples pour payer moins cher en ligne sans perdre de temps.",
        "eyebrow": "Guide pratique · Économies",
        "crumb": ("Offres du moment", "/offres.html"),
        "lead": "Payer moins cher en ligne ne demande ni coupons introuvables ni heures de recherche. Quelques réflexes suffisent pour éviter de payer un produit plus cher qu'ailleurs ou de tomber dans une fausse promotion.",
        "sections": [
            ("1. Comparez toujours le même produit", """<p>Deux références proches peuvent cacher des différences de capacité, de version ou d'accessoires. Comparez le modèle exact, puis le prix chez plusieurs marchands : pour un produit identique, l'écart peut être de plusieurs dizaines d'euros.</p>"""),
            ("2. Calculez le prix total", """<p>Le prix affiché n'est pas le prix payé. Ajoutez la livraison, les éventuels frais de paiement et les accessoires indispensables. Un produit un peu plus cher mais livré gratuitement peut revenir moins cher.</p>"""),
            ("3. Regardez l'historique du prix", """<p>Un prix « barré » ne dit pas si l'offre est exceptionnelle. L'évolution du prix sur plusieurs semaines montre si le tarif actuel est bas, normal ou élevé.</p>"""),
            ("4. Créez des alertes prix", """<p>Plutôt que de surveiller un produit tous les jours, créez une alerte : vous êtes prévenu quand le prix baisse. C'est particulièrement utile pour les achats non urgents.</p>"""),
            ("5. Pensez à la génération précédente", """<p>À la sortie d'un nouveau modèle, l'ancien baisse souvent. Pour un smartphone, des écouteurs ou une tablette, l'écart de performance est parfois faible au regard de l'économie.</p>"""),
            ("6. Envisagez le reconditionné garanti", """<p>Un produit reconditionné vendu par un professionnel bénéficie d'une garantie légale de conformité (au moins 12 mois pour un bien d'occasion). Vérifiez l'état annoncé, la batterie pour un téléphone, la garantie et la politique de retour.</p>"""),
            ("7. Achetez au bon moment", """<p>Les soldes d'hiver et d'été, le Black Friday, les ventes de fin de série et la sortie de nouveaux modèles sont des périodes favorables. Préparez votre liste en avance pour ne pas acheter sur un coup de tête.</p>"""),
            ("8. Vérifiez le vendeur", """<p>Sur une place de marché, le vendeur peut être un tiers. Regardez qui expédie, les conditions de retour et les avis. Fuyez les sites inconnus aux prix anormalement bas.</p>"""),
            ("9. Ne payez pas les options inutiles", """<p>Extensions de garantie, assurances et services ajoutés au panier augmentent la facture. La garantie légale de 2 ans couvre déjà les produits neufs achetés auprès d'un professionnel.</p>"""),
            ("10. Gardez vos droits en tête", """<p>Pour un achat à distance auprès d'un professionnel, le droit de rétractation de 14 jours permet en principe de renvoyer un produit, sauf exceptions. Conservez les confirmations de commande et les factures.</p>
<div class="tip"><strong>Le réflexe Prix Malin :</strong> le comparateur classe les offres du moins cher au plus cher, affiche la date de chaque prix et son évolution. Le prix final reste celui du marchand au moment de l'achat.</div>"""),
        ],
        "faq": [
            ("Les prix barrés sont-ils fiables ?", "En France, une réduction doit être calculée par rapport au prix le plus bas pratiqué par le vendeur sur les 30 jours précédents. Comparez tout de même avec les autres marchands."),
            ("Le reconditionné est-il une bonne affaire ?", "Souvent, s'il est vendu par un professionnel avec garantie, un état clairement décrit et une politique de retour."),
            ("Faut-il prendre une extension de garantie ?", "Rarement. La garantie légale de conformité couvre déjà 2 ans pour un produit neuf acheté auprès d'un professionnel."),
        ],
        "links": [("Ouvrir le comparateur", "/prix/"), ("Voir le catalogue", "/catalogue.html"), ("Offres du jour Amazon", "https://www.amazon.fr/gp/goldbox?tag=" + TAG)],
    },
]

EXISTING = [
    ("guide-choisir-smartphone", "Comment choisir un smartphone sans payer trop cher ?", "Écran, autonomie, stockage, photo et mises à jour."),
    ("guide-cadeaux", "Guide cadeaux 2026 : idées pour tous les budgets", "Des idées high-tech, beauté, mode et enfants."),
]


def all_guides():
    return [(g["slug"], g["h1"], g["description"]) for g in GUIDES] + EXISTING


def template_head():
    src = (ROOT / "guide-choisir-smartphone.html").read_text(encoding="utf-8")
    return re.search(r"<style>.*?</style>", src, re.S).group(0)


def related(current):
    items = [(s, h, d) for s, h, d in all_guides() if s != current][:4]
    lis = "".join(f'<li><a href="/{s}.html">{e(h)}</a> — <span class="muted">{e(d)}</span></li>' for s, h, d in items)
    return f'<h2>À lire aussi</h2><ul class="checklist">{lis}</ul><p><a href="/guides.html">Tous les guides d’achat →</a></p>'


def render(g, style, footer):
    url = f"{SITE}/{g['slug']}.html"
    body = "".join(f"<h2>{e(t)}</h2>\n{h}\n" for t, h in g["sections"])
    faq = "".join(f'<section class="faq"><h3>{e(q)}</h3><p>{e(a)}</p></section>' for q, a in g["faq"])
    links = " ".join(
        f'<a class="cta" href="{e(u)}"' + (' target="_blank" rel="sponsored nofollow noopener"' if u.startswith("http") else "") + f">{e(t)}</a>"
        for t, u in g["links"])
    ld = [
        {"@context": "https://schema.org", "@type": "Article", "headline": g["h1"], "description": g["description"], "inLanguage": "fr-FR",
         "mainEntityOfPage": {"@type": "WebPage", "@id": url}, "publisher": {"@type": "Organization", "name": "Prix Malin", "url": SITE + "/"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in g["faq"]]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Accueil", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Guides d’achat", "item": SITE + "/guides.html"},
            {"@type": "ListItem", "position": 3, "name": g["h1"], "item": url}]},
    ]
    ld_html = "\n".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    return f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#ff650b">
  <title>{e(g['title'])}</title>
  <meta name="description" content="{e(g['description'])}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Prix Malin">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="{e(g['h1'])}">
  <meta property="og:description" content="{e(g['description'])}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/assets/prixmalin-publicite.webp">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="any">
  {style}
{ld_html}
<link rel="stylesheet" href="/css/prix-malin-theme.css?v=3">
<link rel="stylesheet" href="/css/pm-site-footer.css">
</head>
<body>
<header><nav class="nav" aria-label="Navigation principale"><a class="brand" href="/">Prix <span>Malin</span></a><div class="navlinks"><a href="/guides.html">Guides</a><a href="/prix/">Comparateur</a><a href="/idees-cadeaux/">Cadeaux</a><a href="/catalogue.html">Catalogue</a></div></nav></header>
<main>
  <div class="crumb"><a href="/">Accueil</a> › <a href="/guides.html">Guides d’achat</a> › <a href="{g['crumb'][1]}">{e(g['crumb'][0])}</a></div>
  <article>
    <section class="hero">
      <div class="eyebrow">{e(g['eyebrow'])}</div>
      <h1>{e(g['h1'])}</h1>
      <p class="lead">{e(g['lead'])}</p>
    </section>
{body}
    <h2>Questions fréquentes</h2>
    {faq}
    <h2>Passer à la comparaison</h2>
    <p>Une fois vos critères définis, comparez les offres. Les prix et les stocks doivent être revérifiés chez le vendeur avant l’achat.</p>
    {links}
    {related(g['slug'])}
    <p class="disclaimer">Prix Malin fournit des repères pour comparer les offres. Les tarifs, disponibilités, garanties et conditions finales sont ceux affichés par chaque vendeur au moment de l’achat. Certains liens sont des liens d’affiliation : Prix Malin peut percevoir une commission, sans surcoût pour vous.</p>
  </article>
</main>
{footer}</body>
</html>
"""


def render_index(style, footer):
    cards = "".join(f'<section class="faq"><h3><a href="/{s}.html">{e(h)}</a></h3><p>{e(d)}</p></section>' for s, h, d in all_guides())
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Accueil", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Guides d’achat", "item": SITE + "/guides.html"}]}
    desc = "Guides d’achat Prix Malin : air fryer, écouteurs sans fil, aspirateur robot, smartphone, Black Friday et astuces pour payer moins cher en ligne."
    return f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#ff650b">
  <title>Guides d’achat : choisir et payer moins cher | Prix Malin</title>
  <meta name="description" content="{e(desc)}">
  <link rel="canonical" href="{SITE}/guides.html">
  <meta property="og:type" content="website"><meta property="og:site_name" content="Prix Malin"><meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="Guides d’achat Prix Malin"><meta property="og:description" content="{e(desc)}">
  <meta property="og:url" content="{SITE}/guides.html"><meta property="og:image" content="{SITE}/assets/prixmalin-publicite.webp">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="any">
  {style}
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<link rel="stylesheet" href="/css/prix-malin-theme.css?v=3">
<link rel="stylesheet" href="/css/pm-site-footer.css">
</head>
<body>
<header><nav class="nav" aria-label="Navigation principale"><a class="brand" href="/">Prix <span>Malin</span></a><div class="navlinks"><a href="/prix/">Comparateur</a><a href="/idees-cadeaux/">Cadeaux</a><a href="/catalogue.html">Catalogue</a></div></nav></header>
<main>
  <div class="crumb"><a href="/">Accueil</a> › Guides d’achat</div>
  <section class="hero"><div class="eyebrow">Guides d’achat</div><h1>Bien choisir et payer moins cher</h1>
  <p class="lead">Nos guides pratiques pour comprendre les critères qui comptent vraiment, éviter les options inutiles et repérer les vraies bonnes affaires.</p></section>
  {cards}
  <h2>Comparer les prix</h2>
  <p><a class="cta" href="/prix/">Comparateur high-tech</a> <a class="cta" href="/idees-cadeaux/">Idées cadeaux par budget</a> <a class="cta" href="/catalogue.html">Catalogue</a></p>
</main>
{footer}</body>
</html>
"""


def build():
    style = template_head()
    footer = (ROOT / "scripts" / "partials" / "site-footer.html").read_text(encoding="utf-8")
    files = {f"{g['slug']}.html": render(g, style, footer) for g in GUIDES}
    files["guides.html"] = render_index(style, footer)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    files = build()
    if args.check:
        stale = [r for r, t in files.items() if not (ROOT / r).exists() or (ROOT / r).read_text(encoding="utf-8") != t]
        if stale:
            print("Guides à régénérer : " + ", ".join(stale), file=sys.stderr)
            return 1
        return 0
    for rel, text in files.items():
        (ROOT / rel).write_text(text, encoding="utf-8")
    print(f"{len(files)} pages guides écrites")
    return 0


if __name__ == "__main__":
    sys.exit(main())
