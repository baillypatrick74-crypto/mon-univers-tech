# MON UNIVERS TECH V3.1

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

- PRIX MALIN propose les installateurs officiels pour Android 8+ et Windows 11 x64 via sa [release GitHub](https://github.com/baillypatrick74-crypto/prix-malin/releases/tag/installateurs-v1.0.0). Les fichiers V1.0.0 ont été téléchargés et comparés à `SHA256SUMS.txt`. L’icône PRIX MALIN provient de cet APK. Les autres fiches utilisent des pictogrammes du site. La release indique que l’EXE n’a pas de signature d’éditeur reconnue.
- Ajouter à `downloads` dans `config.js` une entrée nommée comme le titre de l’application et des liens HTTPS vers les fichiers de publication vérifiés. Par exemple, une entrée peut contenir les clés `Android` pour un APK et `Windows` pour un EXE, MSI ou MSIX. Préférer des fichiers signés et vérifier chaque lien après publication.
- Dans `awin`, configurer pour chaque marchand approuvé une entrée avec `enabled: true` et les champs suivants. `merchantId` est l’identifiant annonceur, `publisherId` l’identifiant éditeur et `domains` une liste des noms d’hôte marchands approuvés pour le deep linking. Les identifiants utilisés dans les liens sont publics. Les jetons d’accès AWIN et les identifiants de flux privés restent sur les services qui les utilisent.
- Remplir `informations.html` avec l’identité et les coordonnées de l’éditeur, de la direction de publication et de l’hébergeur avant une ouverture commerciale. Préciser le traitement des données et les modalités d’exercice des droits avant d’activer l’IA externe.

## Render gratuit et publication manuelle

Le Blueprint `render.yaml` utilise le plan **Free**, sans disque Render, avec `autoDeployTrigger: off` et `OPENAI_ENABLED=false`. Le stockage des quotas est séparé du serveur Render. Le plan gratuit Render peut se mettre en veille et son premier accès après inactivité peut être plus lent.

**Pour un service Render déjà en ligne**, dans le [tableau de bord Render](https://dashboard.render.com/), ouvrir le service **mon-univers-tech → Settings → Build & Deploy → Auto-Deploy → Edit**, sélectionner **Off** et enregistrer. Revenir à ce réglage pour confirmer **Off** avant tout push vers la branche surveillée ou **Manual Deploy**. Le fichier Blueprint de la branche ne désactive pas rétroactivement un service existant tant que sa configuration n’a pas été appliquée. [Documentation Render](https://render.com/docs/deploys#automatic-deploys)

Après validation des mentions et du domaine, `PUBLIC_URL` contient l’origine HTTPS du site, sans sous-chemin. Passer `SEO_INDEXING=true` uniquement si l’indexation est souhaitée. Le serveur publie alors `/sitemap.xml` pour Google Search Console. Le mode local fonctionne sans Supabase ni OpenAI.

## Préparer Supabase Free, puis activer OpenAI après accord

1. Dans [Supabase](https://supabase.com/dashboard), créer ou sélectionner un projet **Free**. Dans **SQL Editor**, exécuter [la migration de quotas](supabase/migrations/202611250001_assistant_quota.sql). Elle crée un compteur unique, privé et accessible en écriture uniquement par la fonction de réservation du serveur.
2. Dans **Authentication → Users**, créer le compte e-mail du propriétaire avec un mot de passe fort et unique. Confirmer son adresse, puis relever son **User ID** (UUID). Dans les réglages Auth, désactiver les inscriptions publiques pour ce projet dédié. Conserver l’authentification par e-mail et mot de passe et ne créer aucun autre compte pour le site.
3. Dans **Project Settings → API Keys**, relever l’URL du projet, la clé **Publishable** et une clé **Secret** dédiée à ce serveur. La clé Secret a des droits privilégiés sur le projet. La saisir uniquement dans l’environnement Render et la révoquer en cas d’exposition.
4. Dans **Render → mon-univers-tech → Environment**, définir les variables ci-dessous et conserver `OPENAI_ENABLED=false`. Configurer un service **Free** et confirmer **Auto-Deploy: Off** avant un déploiement manuel autorisé.

   | Variable | Valeur |
   | --- | --- |
   | `PUBLIC_URL` | Origine HTTPS exacte du site Render ou du domaine choisi |
   | `SUPABASE_URL` | URL du projet, `https://<projet>.supabase.co` |
   | `SUPABASE_OWNER_ID` | UUID du compte propriétaire confirmé |
   | `SUPABASE_PUBLISHABLE_KEY` | Clé Supabase `sb_publishable_…`, utilisée côté serveur |
   | `SUPABASE_SECRET_KEY` | Clé Supabase `sb_secret_…`, utilisée uniquement pour le quota |
   | `OPENAI_ENABLED` | `false` jusqu’à l’accord d’activation |
   | `OPENAI_MODEL` | `gpt-4o-mini` par défaut |
   | `OPENAI_MAX_OUTPUT_TOKENS` | Facultatif, `220` par défaut, plage `100` à `512` |
   | `OPENAI_API_KEY` | À saisir dans Render uniquement après accord |

5. Vérifier `/healthz` et `/api/assistant`. Avec l’API désactivée, ils renvoient respectivement `{"ok":true}` et `{"enabled":false}`. Tester le mode local. Après autorisation, définir la clé OpenAI du projet dédié, passer `OPENAI_ENABLED=true` et déployer manuellement. Ouvrir **Accès propriétaire** dans l’assistant, se connecter, puis cocher OpenAI uniquement pour envoyer une demande connectée. La connexion seule ne contacte pas OpenAI. Pour couper les appels, remettre `OPENAI_ENABLED=false` et appliquer la configuration.

### Protection de la consommation et des données

Supabase Auth vérifie l’identité du propriétaire côté serveur sur chaque demande connectée. Le cookie est `Secure`, `HttpOnly` et `SameSite=Strict`. L’accès expire au bout de 10 minutes maximum et le serveur ne conserve pas de jeton de rafraîchissement. Les origines externes et les autres comptes ne peuvent pas réserver de quota via le site.

La fonction SQL réserve chaque tentative avant tout appel OpenAI. Le verrou dans PostgreSQL impose **5 tentatives par jour, 50 par mois et une par minute**, même après un redémarrage Render. Les fenêtres journalières et mensuelles suivent l’heure UTC. Les échecs du fournisseur consomment aussi une tentative. Le compteur ne stocke ni messages ni clés. En cas de pause, de panne ou d’erreur Supabase, le mode connecté se bloque et le mode local reste disponible. Si un projet Free est mis en pause, vérifier son état dans Supabase plutôt que d’utiliser un projet payant sans accord.

Les suggestions OpenAI sont limitées aux fiches du catalogue. Les prix et la validation du budget dépendent uniquement du flux PRIX MALIN. `npm test` simule Supabase et OpenAI, sans identifiant réel.

[Plans Render](https://render.com/docs/free) · [Clés Supabase](https://supabase.com/docs/guides/api/api-keys)
