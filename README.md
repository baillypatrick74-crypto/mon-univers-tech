# MON UNIVERS TECH V2.1

Site en français avec catalogue PRIX MALIN, comparaison des offres, assistant d’achat local et installation PWA. Le dossier peut être servi statiquement. Le serveur Node ajoute l’API facultative et la configuration SEO du domaine final.

## Démarrer

Node 22 ou supérieur, sans dépendance externe.

```sh
npm test
npm start
```

Adresse locale par défaut : `http://localhost:4173`. La PWA requiert HTTPS en production. Sur Safari iOS, l’installation se fait via Partager puis « Sur l’écran d’accueil ».

## Catalogue et offres

`catalog.js` et `offers.js` reprennent le catalogue et le format d’offres de [PRIX MALIN](https://baillypatrick74-crypto.github.io/prix-malin/). Les fiches de `product-details.js` renvoient vers les constructeurs. Une durée d’autonomie mentionne son protocole. Les photos du Galaxy S24 et de l’iPhone 16 proviennent de Wikimedia Commons. Les autres produits conservent une illustration de catégorie en attendant des photos autorisées. Pour ajouter des modèles, synchroniser les identifiants avec le catalogue de PRIX MALIN.

La V2 lit le fichier public `offers.json` de PRIX MALIN au chargement, au retour sur l’onglet et toutes les cinq minutes pendant la consultation. Le programme d’actualisation des prix source reste celui du dépôt PRIX MALIN. Ses identifiants marchands sont nécessaires pour alimenter le flux. Seules les offres neuves en euros, datées, non expirées et munies d’un lien HTTPS sont affichées. Le filtre budget utilise le total livraison incluse pour les offres en stock. Une livraison inconnue reste visible dans la comparaison avec un total indisponible.

### Diagnostic AWIN

- Le flux public de PRIX MALIN répond et contient zéro offre. Les [deux derniers déclenchements planifiés vérifiés](https://github.com/baillypatrick74-crypto/prix-malin/actions/runs/45559232364) sur `main` ont ignoré les tâches `build` et `deploy`. À la révision `6e12d61`, la condition du workflow indique que `PRIX_MALIN_AUTO_REFRESH` n’était pas évaluée à `true`. L’accès aux paramètres et aux secrets du dépôt a répondu HTTP 403. La présence des identifiants marchands reste donc à confirmer par le propriétaire.
- Dans PRIX MALIN, obtenir l’acceptation du programme AWIN et les droits de publier prix, photos et liens, puis enregistrer l’URL de flux dans le secret d’environnement `merchant-feeds` correspondant. L’importeur accepte `AWIN_FNAC_FR_FEED_URL`, `AWIN_FNAC_PRO_FR_FEED_URL` et `AWIN_SAMSUNG_PRO_FR_FEED_URL`.
- Renseigner la variable d’environnement `MERCHANT_SOURCES_JSON` avec les en-têtes réels, les EAN/GTIN des variantes, les prix TTC et règles de validité. Lancer le workflow PRIX MALIN sur `main`, vérifier le diagnostic par source et le fichier publié. Pour la planification quotidienne, définir `PRIX_MALIN_AUTO_REFRESH=true` comme variable de dépôt. La cadence doit correspondre à la durée de validité des offres. L’importeur PRIX MALIN publie seulement les champs nécessaires au comparateur.
- La page V2.1 lit ce flux public normalisé et propose Google Shopping et Idealo si la recherche n’a aucune offre achetable. Les deux comparateurs affichent leurs propres résultats.

### Crédits photo

- Galaxy S24, [C.Stadler/Bwag](https://commons.wikimedia.org/wiki/File:Samsung_Galaxy_S24,_Sperrbildschirm.JPG), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Version redimensionnée et convertie en WebP, sous la même licence.
- iPhone 16, [Padgriffin](https://commons.wikimedia.org/wiki/File:IPhone_16_Ultramarine_Rear.png), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Version redimensionnée et convertie en WebP.

## Applications et affiliation

- PRIX MALIN propose les installateurs officiels pour Android 8+ et Windows 11 x64 via sa [release GitHub](https://github.com/baillypatrick74-crypto/prix-malin/releases/tag/installateurs-v1.0.0). Les fichiers ont été téléchargés et comparés à `SHA256SUMS.txt`. La release indique que l’EXE n’a pas de signature d’éditeur reconnue.
- Ajouter à `downloads` dans `config.js` une entrée nommée comme le titre de l’application et des liens HTTPS vers les fichiers de publication vérifiés. Par exemple, une entrée peut contenir les clés `Android` pour un APK et `Windows` pour un EXE, MSI ou MSIX. Préférer des fichiers signés et vérifier chaque lien après publication.
- Dans `awin`, configurer pour chaque marchand approuvé une entrée ayant trois champs. `merchantId` est l’identifiant annonceur, `publisherId` l’identifiant éditeur et `domains` une liste des noms d’hôte marchands approuvés pour le deep linking. Les identifiants utilisés dans les liens sont publics. Les jetons d’accès AWIN et les identifiants de flux privés restent sur les services qui les utilisent.
- Remplir `informations.html` avec l’identité et les coordonnées de l’éditeur, de la direction de publication et de l’hébergeur avant une ouverture commerciale. Préciser le traitement des données et les modalités d’exercice des droits avant d’activer l’IA externe.

## Préparer l’hébergement commercial

`render.yaml` propose un service Node sur un plan payant Render Starter, avec déploiements automatiques désactivés. Relier le dépôt à un compte Render, confirmer le plan et ses conditions commerciales, configurer le domaine HTTPS et lancer le déploiement manuellement après validation. Lorsque la branche de production sera approuvée, adapter l’entrée `branch` du manifeste à la branche retenue. Le dépôt GitHub Pages peut continuer à servir la version statique existante.

Configurer `PUBLIC_URL` avec l’origine HTTPS finale, sans sous-chemin. Le serveur s’en sert pour publier le sitemap et la balise canonique. Une fois le domaine public, soumettre `/sitemap.xml` dans Google Search Console. En mode statique, ajouter les URL canoniques et le sitemap du domaine retenu au moment de la publication.

L’IA externe est facultative. Pour la tester, définir `OPENAI_API_KEY` et `OPENAI_MODEL` dans les variables secrètes du service Node, ainsi que `PUBLIC_URL`. L’API vérifie l’origine des requêtes navigateur, limite la taille des messages et plafonne globalement le débit à dix appels par minute et deux appels simultanés par instance. Pour une ouverture publique avec IA, prévoir un plafond fournisseur et une limitation côté hébergeur adaptée au trafic. Le mode local fonctionne dès le premier démarrage et continue de fonctionner si le fournisseur externe est indisponible.
