import { matchesFeatures, productFeatures } from './product-details.js';
import { searchProducts } from './catalog.js';
import { bestComparableOffer, rankOffers } from './offers.js';

const categoryPatterns = {
  Smartphones: /\b(?:smartphones?|téléphones?)\b/iu,
  'PC portables': /\b(?:ordinateurs?|portables?|pc)\b/iu,
  Audio: /\b(?:casques?|écouteurs?|audio)\b/iu,
  Écrans: /(?:^|\s)(?:écrans?|moniteurs?)(?=\s|$)/iu,
};

const advice = {
  Smartphones: 'Comparez l’autonomie, le stockage et la durée des mises à jour.',
  'PC portables': 'Comparez la mémoire, le SSD et l’autonomie en fonction de vos usages.',
  Audio: 'Comparez le confort, l’autonomie et la réduction de bruit.',
  Écrans: 'Comparez la définition, la connectique et la fréquence de rafraîchissement.',
};

export const money = cents => new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR',
}).format(cents / 100);

export function results(query, category, budget, offers, features) {
  const candidates = [...new Set(query.split(/\s+(?:ou|contre)\s+/iu)
    .flatMap(term => searchProducts(term.trim(), category)))];
  return candidates.filter(product => matchesFeatures(product, features)).map(product => {
    const ranked = rankOffers(offers, product.id);
    return { product, ranked, best: bestComparableOffer(ranked) };
  }).filter(({ best }) => budget === null || (best && best.total <= budget))
    .sort((a, b) => (a.best?.total ?? Infinity) - (b.best?.total ?? Infinity));
}

export function interpret(message, previous = {}) {
  const match = message.match(/(\d+(?:[ .\u00a0\u202f]\d{3})*(?:[,.]\d{1,2})?)\s*(?:€|euros?\b|EUR\b)/iu);
  const budget = match ? Math.round(Number(match[1].replace(/[ .\u00a0\u202f](?=\d{3})/gu, '').replace(',', '.')) * 100)
    : /sans (?:limite|budget)/iu.test(message) ? null : previous.budget ?? null;
  let remainder = message.replace(match?.[0] ?? '', '').replace(/sans (?:limite|budget)/giu, '');
  const features = /sans (?:critères|filtres)/iu.test(remainder) ? {} : { ...previous.features };
  remainder = remainder.replace(/sans (?:critères|filtres)/giu, '');
  remainder = remainder.replace(/wi[\s‑-]?fi\s*([67])(e?)\b/giu, (_, generation, suffix) => {
    features.wifi = Number(generation);
    features.wifi6e = generation === '6' && suffix.toLowerCase() === 'e';
    return '';
  });
  remainder = remainder.replace(/\b5g\b/giu, () => { features.cellular = '5G'; return ''; });
  remainder = remainder.replace(/\b(\d+(?:[,.]\d+)?)\s*(go|to|gb|tb)\b(?!\s*(?:de\s+)?(?:ram|mémoire vive))/giu,
    (_, amount, unit) => {
      features.storageGB = Math.round(Number(amount.replace(',', '.')) * (/^t/i.test(unit) ? 1024 : 1));
      return '';
    });
  remainder = remainder.replace(/\b(\d+(?:[,.]\d+)?)\s*(?:heures?|h)\b/giu,
    (_, amount) => { features.batteryHours = Number(amount.replace(',', '.')); return ''; });
  const category = Object.keys(categoryPatterns).find(key => categoryPatterns[key].test(remainder));
  const query = remainder.replace(/[?!.,]/g, ' ').split(/\s+/u).filter(word =>
    word && !/^(?:je|voudrais|veux|chez|marque|modèle|autonomie|stockage|au|minimum|mini|ayant|compatible|en|entre|d[’']autonomie|cherche|recherche|trouve|compare|comparer|les?|la|des?|du|un|une|à|a|pour|avec|moins|plus|maximum|max|budget|mon|et|de|sous|svp|quels?|meilleurs?|me|propose)$/iu.test(word)).join(' ');
  const categoryOnly = category && !query.replace(categoryPatterns[category], '').trim();
  const named = query && !categoryOnly ? searchProducts(query, category) : [];
  return {
    budget,
    ...(Object.keys(features).length ? { features } : {}),
    category: category ?? named[0]?.category ?? (query ? '' : previous.category ?? ''),
    query: categoryOnly ? '' : query || previous.query || '',
  };
}

export function localReply(criteria, offers) {
  const { budget, category, query, features } = criteria;
  const rows = results(query, category, budget, offers, features);
  const alternatives = budget === null ? rows : results(query, category, null, offers, features);
  const lines = [];
  if (budget !== null) lines.push(`Budget maximum : ${money(budget)}, livraison comprise.`);
  if (!rows.length) {
    lines.push(alternatives.length
      ? 'Aucune offre en stock avec un total connu ne correspond à ce budget.'
      : 'Le catalogue ne contient aucun produit correspondant à tous les critères vérifiés.');
    if (alternatives.length) {
      lines.push('Modèles correspondant aux critères techniques :');
      for (const { product } of alternatives.slice(0, 4)) {
        lines.push([product.brand + ' ' + product.model, ...productFeatures(product)].join(' · '));
      }
    }
  } else {
    for (const { product, best } of rows.slice(0, 4)) {
      const price = best ? `${money(best.total)} chez ${best.merchant}, livraison comprise` : 'prix comparable indisponible';
      lines.push(`${product.brand} ${product.model} · ${[product.specs, ...productFeatures(product)].join(' · ')} · ${price}`);
    }
  }
  if (advice[category]) lines.push(advice[category]);
  return lines.join('\n');
}
