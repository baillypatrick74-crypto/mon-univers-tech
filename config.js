export const prixMalin = 'https://baillypatrick74-crypto.github.io/prix-malin/';
export const offerFeed = new URL('offers.json', prixMalin).href;
const release = 'https://github.com/baillypatrick74-crypto/prix-malin/releases/tag/installateurs-v1.0.0';
const files = release.replace('/tag/', '/download/') + '/';

export const downloads = {
  'PRIX MALIN': {
    version: '1.0.0',
    release,
    Android: files + 'PRIX-MALIN-Android.apk',
    Windows: files + 'PRIX-MALIN-Windows-x64.exe',
    checksums: files + 'SHA256SUMS.txt',
  },
};

// Ajouter seulement les programmes approuvés et leurs hôtes commerçants exacts.
export const awin = {};

export function affiliateUrl(offer, programmes = awin) {
  const rule = Object.hasOwn(programmes, offer.merchant) ? programmes[offer.merchant] : null;
  const destination = new URL(offer.url);
  if (rule?.enabled !== true || destination.protocol !== 'https:' || destination.username || destination.password
    || !Array.isArray(rule.domains) || !rule.domains.includes(destination.hostname)
    || !/^\d+$/.test(rule.merchantId) || !/^\d+$/.test(rule.publisherId)) return null;
  const url = new URL('https://www.awin1.com/cread.php');
  url.search = new URLSearchParams({ awinmid: rule.merchantId, awinaffid: rule.publisherId, ued: destination.href });
  return url.href;
}
