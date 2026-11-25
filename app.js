import { productDetails, productFeatures } from './product-details.js';
import { availability, rankOffers, readOffers } from './offers.js';
import { interpret, localReply, money, results } from './assistant.js';
import { affiliateUrl, downloads, offerFeed, prixMalin } from './config.js';

const $ = id => document.getElementById(id);
const node = (tag, content, className) => {
  const el = document.createElement(tag);
  if (content) el.textContent = content;
  if (className) el.className = className;
  return el;
};
const link = (label, href, sponsored = false) => {
  const el = node('a', label);
  el.href = href;
  el.target = '_blank';
  el.rel = sponsored ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  return el;
};
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
const pictures = { phone: 0, laptop: 1, audio: 2, monitor: 3 };

function searchLinks(query) {
  const term = encodeURIComponent(query || 'produits high-tech');
  return [
    link('Rechercher sur Google Shopping', `https://shopping.google.com/search?q=${term}`),
    link('Rechercher sur Idealo', `https://www.idealo.fr/prechcat.html?q=${term}`),
    link('Ouvrir PRIX MALIN', prixMalin),
  ];
}

const mobile = matchMedia('(max-width:720px)');
function menuState() {
  $('menu').hidden = !mobile.matches;
  $('menu').setAttribute('aria-expanded', 'false');
  $('navigation').dataset.collapsed = String(mobile.matches);
}
mobile.addEventListener('change', menuState);
$('menu').onclick = () => {
  const open = $('menu').getAttribute('aria-expanded') === 'true';
  $('menu').setAttribute('aria-expanded', String(!open));
  $('navigation').dataset.collapsed = String(open);
};
$('navigation').onclick = event => { if (event.target.closest('a')) menuState(); };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('menu').getAttribute('aria-expanded') === 'true') {
    menuState();
    $('menu').focus();
  }
});
menuState();

document.querySelectorAll('.app-card').forEach(card => {
  const files = downloads[card.querySelector('h3').textContent];
  if (!files) return;
  card.querySelector('h3').after(node('small', `Version ${files.version}`, 'version'));
  const actions = node('div', null, 'download-links');
  for (const [platform, extension, type] of [['Android', /\.apk$/i, 'APK'], ['Windows', /\.exe$/i, 'EXE']]) {
    if (!files[platform]) continue;
    let url;
    try { url = new URL(files[platform]); } catch { continue; }
    if (url.protocol === 'https:' && !url.username && !url.password && extension.test(url.pathname)) {
      const download = link(`${platform} · ${type}`, url.href);
      download.className = 'button outline';
      download.setAttribute('aria-label', `Télécharger ${card.querySelector('h3').textContent} pour ${platform} (${type})`);
      actions.append(download);
    }
  }
  if (actions.childElementCount) card.append(actions);
  card.append(link('Notes de version', files.release), link('Sommes SHA-256', files.checksums));
});

let selection = [];
try {
  const saved = JSON.parse(localStorage.getItem('mut-selection'));
  if (Array.isArray(saved)) selection = saved.filter(item => typeof item === 'string');
} catch {}
function renderSelection() {
  $('selection').hidden = selection.length === 0;
  $('liste').textContent = selection.join(' • ');
  try { localStorage.setItem('mut-selection', JSON.stringify(selection)); } catch {}
}
$('shop').onclick = event => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  selection = [...new Set([...selection, button.dataset.category])];
  renderSelection();
};
$('clear').onclick = () => { selection = []; renderSelection(); };
renderSelection();

function merchantLink(offer) {
  const affiliate = affiliateUrl(offer);
  return affiliate ? link('Voir l’offre · lien affilié', affiliate, true) : link('Voir l’offre', offer.url);
}

let offers = [];
let activeProduct;
let fetching = false;
let updatedAt = null;
let feedAvailable = false;
let feedRows = null;
let productFilters;

function renderComparison(product) {
  $('comparison-title').textContent = `${product.brand} ${product.model}`;
  const ranked = rankOffers(offers, product.id);
  $('comparison-offers').replaceChildren();
  if (!ranked.length) {
    const actions = node('div', null, 'actions');
    actions.append(...searchLinks(`${product.brand} ${product.model} ${productDetails[product.id]?.storageGB ? productDetails[product.id].storageGB + ' Go' : ''}`.trim()));
    $('comparison-offers').append(node('p', 'Aucune offre valide pour ce modèle.'), actions);
  }
  for (const offer of ranked) {
    const row = node('div', null, 'offer');
    const shipping = offer.shipping === null ? 'livraison inconnue' : `livraison ${money(offer.shipping)}`;
    row.append(node('strong', offer.merchant), node('small', `${money(offer.price)} · ${shipping} · ${availability.get(offer.availability)}`),
      node('small', `${offer.source} · ${date.format(offer.observed)} (heure de Paris)`),
      node('p', offer.total === null ? 'Total indisponible' : `Total : ${money(offer.total)}`), merchantLink(offer));
    $('comparison-offers').append(row);
  }
}

function renderProducts() {
  const query = $('produit').value.trim();
  const budget = $('max').value ? Math.round($('max').valueAsNumber * 100) : null;
  const category = $('category').value;
  const rows = results(query, category, budget, offers, productFilters);
  const article = rows.map(({ product, best, ranked }) => {
    const card = node('article', null, 'card product');
    const details = productDetails[product.id] ?? {};
    const photo = details.photo;
    const image = node('img');
    image.src = photo?.path ?? `./assets/category-${pictures[product.image]}.webp`;
    image.alt = photo ? `${product.brand} ${product.model}` : '';
    image.width = 400;
    image.height = 533;
    image.loading = 'lazy';
    const picture = node('div', null, 'product-picture');
    picture.append(image);
    card.append(picture, node('small', photo ? 'Photo du modèle' : 'Illustration de la catégorie', 'product-caption'));
    if (photo) card.append(link(`Photo redimensionnée : ${photo.author} · ${photo.license}`, photo.source));
    const compare = node('button', 'Comparer les offres', 'outline');
    compare.setAttribute('aria-label', `Comparer les offres pour ${product.brand} ${product.model}`);
    compare.onclick = () => {
      activeProduct = product;
      renderComparison(product);
      $('comparison').showModal();
    };
    const technical = node('ul', null, 'technical');
    for (const feature of productFeatures(product)) technical.append(node('li', feature));
    card.append(node('h3', `${product.brand} ${product.model}`), node('p', product.specs, 'product-specs'));
    if (technical.childElementCount) card.append(technical);
    if (details.source) card.append(link('Fiche constructeur', details.source));
    const firstAvailable = ranked.find(offer => offer.availability === 'in_stock');
    card.append(
      node('strong', best ? `${money(best.total)} · ${best.merchant}` : firstAvailable
        ? `${money(firstAvailable.price)} · ${firstAvailable.merchant}` : 'Prix comparable indisponible', 'product-price'),
      node('small', best ? 'Livraison comprise' : firstAvailable ? 'Frais de livraison inconnus' : `${ranked.length} offre(s) publiée(s)`),
      compare,
    );
    return card;
  });
  $('products').replaceChildren(...article);
  $('count').textContent = rows.length ? `${rows.length} produit(s)` : 'Aucun produit ne correspond à ces filtres.';
  const alternative = rows.length === 0 || rows.every(({ ranked }) =>
    !ranked.some(offer => offer.availability === 'in_stock'));
  $('external-search').hidden = !alternative;
  if (alternative) {
    const actions = node('div', null, 'actions');
    const budgetText = budget !== null && Number.isFinite(budget) ? `moins de ${budget / 100} euros` : '';
    actions.append(...searchLinks([query || category || 'high-tech', budgetText].filter(Boolean).join(' ')));
    $('external-search').replaceChildren(node('h3', 'Rechercher chez les comparateurs'),
      node('p', 'Vérifiez les prix et la livraison sur le site marchand.'), actions);
  }
}

async function refreshOffers() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetch(offerFeed, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Flux indisponible');
    const data = await response.json();
    if (data?.version !== 1 || !Array.isArray(data.offers)) throw new Error('Flux invalide');
    feedRows = data.offers.length;
    offers = readOffers(data);
    const stamp = Date.parse(data.refreshedAt);
    updatedAt = Number.isFinite(stamp) && stamp <= Date.now() ? stamp : null;
    feedAvailable = true;
  } catch {
    feedAvailable = false;
  } finally {
    fetching = false;
  }
  offers = offers.filter(offer => offer.expires > Date.now());
  let status = offers.length ? `${offers.length} offre(s) marchande(s) issue(s) du flux public de PRIX MALIN.`
    : feedAvailable && feedRows === 0 ? 'Le flux marchand de PRIX MALIN est vide pour le moment.'
    : feedAvailable ? 'Aucun relevé marchand valide et à jour dans le flux PRIX MALIN.'
    : 'Aucune offre marchande disponible pour le moment.';
  if (updatedAt && offers.length) status += ` Relevé du ${date.format(updatedAt)} (heure de Paris).`;
  if (!feedAvailable) status += ' Actualisation indisponible.';
  $('offer-status').textContent = status;
  renderProducts();
  if ($('comparison').open && activeProduct) renderComparison(activeProduct);
}
$('filters').onsubmit = event => { event.preventDefault(); productFilters = undefined; renderProducts(); };
$('filters').onreset = () => { productFilters = undefined; setTimeout(renderProducts, 0); };
for (const shortcut of document.querySelectorAll('[data-shop-filter]')) {
  shortcut.onclick = () => {
    $('produit').value = '';
    $('max').value = '';
    $('category').value = shortcut.dataset.shopFilter;
    productFilters = undefined;
    renderProducts();
  };
}
renderProducts();
void refreshOffers();
setInterval(() => { if (!document.hidden) void refreshOffers(); }, 5 * 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshOffers(); });

let criteria = {};
function bubble(text, user = false) {
  const element = node('p', text, user ? 'message user' : 'message');
  $('conversation').append(element);
  $('conversation').scrollTop = $('conversation').scrollHeight;
  return element;
}
const api = new URL('./api/assistant', location.href);
const session = new URL('./api/assistant/session', location.href);
function ownerState(signedIn) {
  $('owner-form').hidden = signedIn;
  $('owner-logout').hidden = !signedIn;
  $('ai-opt-in').hidden = !signedIn;
  if (!signedIn) $('use-ai').checked = false;
}
fetch(session, { cache: 'no-store', signal: AbortSignal.timeout(6000) })
  .then(response => response.ok ? response.json() : null)
  .then(value => {
    if (value?.enabled !== true) return;
    $('owner-access').hidden = false;
    ownerState(value.signedIn === true);
  })
  .catch(() => {});

$('owner-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const password = $('owner-password');
  button.disabled = true;
  try {
    const response = await fetch(session, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('owner-email').value, password: password.value }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      $('owner-status').textContent = response.status === 401 ? 'Identifiants refusés.' : 'Connexion indisponible. Réessayez plus tard.';
      return;
    }
    ownerState(true);
    $('owner-status').textContent = 'Session propriétaire ouverte.';
  } catch {
    $('owner-status').textContent = 'Connexion indisponible. Réessayez plus tard.';
  } finally {
    password.value = '';
    button.disabled = false;
  }
};
$('owner-logout').onclick = async () => {
  try {
    const response = await fetch(session, { method: 'DELETE', signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw Error('Déconnexion indisponible');
    ownerState(false);
    $('owner-status').textContent = 'Session fermée.';
  } catch {
    $('owner-status').textContent = 'Déconnexion indisponible. Réessayez.';
  }
};
$('chat-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('message');
  const message = input.value.trim();
  if (!message) return;
  bubble(message, true);
  input.value = '';
  criteria = interpret(message, criteria);
  bubble(localReply(criteria, offers));
  const open = node('button', 'Voir la recherche dans le catalogue', 'outline');
  const snapshot = criteria;
  open.onclick = () => {
    productFilters = snapshot.features;
    $('produit').value = snapshot.query;
    $('category').value = snapshot.category;
    $('max').value = snapshot.budget === null ? '' : snapshot.budget / 100;
    renderProducts();
    $('bonsplans').scrollIntoView();
    $('produit').focus({ preventScroll: true });
  };
  $('conversation').append(open);
  if (!results(snapshot.query, snapshot.category, snapshot.budget, offers, snapshot.features).some(({ best }) => best)) {
    const actions = node('div', null, 'actions');
    const { wifi, wifi6e, cellular, storageGB, batteryHours } = snapshot.features ?? {};
    actions.append(...searchLinks([
      snapshot.query || snapshot.category, wifi && `Wi-Fi ${wifi6e ? '6E' : wifi}`, cellular,
      storageGB && `${storageGB} Go`, batteryHours && `${batteryHours} h autonomie`,
      snapshot.budget !== null && `moins de ${snapshot.budget / 100} euros`,
    ].filter(Boolean).join(' ')).slice(0, 2));
    $('conversation').append(actions);
  }
  $('conversation').scrollTop = $('conversation').scrollHeight;
  if ($('ai-opt-in').hidden || !$('use-ai').checked) return;
  const submit = $('chat-form').querySelector('button');
  submit.disabled = true;
  const pending = bubble('Consultation de l’IA…');
  try {
    const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(22_000) });
    if (response.status === 401) {
      ownerState(false);
      pending.textContent = 'Session propriétaire requise. Le mode local reste disponible.';
      return;
    }
    if (response.status === 429) {
      pending.textContent = 'Quota IA atteint. Le mode local gratuit reste disponible.';
      return;
    }
    if (!response.ok) throw new Error('IA indisponible');
    const { answer } = await response.json();
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('Réponse vide');
    pending.textContent = `Suggestion technique du catalogue (sans validation du budget) : ${answer}`;
  } catch {
    pending.textContent = 'IA externe indisponible. Les résultats du catalogue restent accessibles.';
  } finally {
    submit.disabled = false;
    $('conversation').scrollTop = $('conversation').scrollHeight;
  }
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
let install;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  install = event;
  $('install').hidden = false;
});
$('install').onclick = async () => {
  const prompt = install;
  install = undefined;
  $('install').hidden = true;
  if (prompt) await prompt.prompt();
};
window.addEventListener('appinstalled', () => { $('install').hidden = true; });
