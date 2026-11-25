export const prixMalin = 'https://baillypatrick74-crypto.github.io/prix-malin/';
export const offerFeed = new URL('offers.json', prixMalin).href;

// Insérer uniquement des liens de téléchargement publics vérifiés.
const release = "https://github.com/baillypatrick74-crypto/prix-malin/releases/download/installateurs-v1.0.0/";
export const downloads = {
  "PRIX MALIN": { Android: release + "PRIX-MALIN-Android.apk", Windows: release + "PRIX-MALIN-Windows-x64.exe" },
};

// Par marchand, ajouter une URL Awin HTTPS approuvée dont l'annonceur
// et la destination ont été vérifiés. La destination est encodée à part.
export const awin = {};
