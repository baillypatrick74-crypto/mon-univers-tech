import { availability, rankOffers, readOffers } from './offers.js';
import { interpret, localReply, money, results } from './assistant.js';
import { awin, downloads, offerFeed, prixMalin } from './config.js';

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
  const files = downloads[card.querySelector('h3').textContent] ?? {};
  for (const [platform, extension] of [['Android', /\.apk$/i], ['Windows', /\.(?:exe|msi|msix)$/i]]) {
    const url = URL.parse(files[platform] ?? '');
    if (url?.protocol === 'https:' && !url.username && !url.password && extension.test(url.pathname)) {
      card.append(link(`Télécharger pour ${platform}`, url.href));
    }
  }
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
  const button = event.target.closest('button');
  if (!button) return;
  selection = [...new Set([...selection, button.textContent])];
  renderSelection();
};
$('clear').onclick = () => { selection = []; renderSelection(); };
renderSelection();

function merchantLink(offer) {
  const rule = awin[offer.merchant];
  const destination = new URL(offer.url);
  if (rule?.domains?.includes(destination.hostname)
      && /^\d+$/.test(rule.merchantId) && /^\d+$/.test(rule.publisherId)) {
    const url = new URL('https://www.awin1.com/cread.php');
    url.search = new URLSearchParams({ awinmid: rule.merchantId, awinaffid: rule.publisherId, ued: destination.href });
    return link('Voir l’offre · lien affilié', url.href, true);
  }
  return link('Voir l’offre', destination.href);
}

let offers = [];
let activeProduct;
let fetching = false;
let updatedAt = null;
let feedAvailable = false;

function renderComparison(product) {
  $('comparison-title').textContent = `${product.brand} ${product.model}`;
  const ranked = rankOffers(offers, product.id);
  $('comparison-offers').replaceChildren();
  if (!ranked.length) $('comparison-offers').append(node('p', 'Aucune offre valide pour ce modèle.'));
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
  const rows = results(query, $('category').value, budget, offers);
  const article = rows.map(({ product, best, ranked }) => {
    const card = node('article', null, 'card product');
    const image = node('img');
    image.src = `./assets/category-${pictures[product.image]}.webp`;
    image.alt = `Illustration de la catégorie ${product.category}`;
    image.width = 400;
    image.height = 533;
    image.loading = 'lazy';
    const compare = node('button', 'Comparer les offres', 'outline');
    compare.setAttribute('aria-label', `Comparer les offres pour ${product.brand} ${product.model}`);
    compare.onclick = () => {
      activeProduct = product;
      renderComparison(product);
      $('comparison').showModal();
    };
    card.append(image, node('h3', `${product.brand} ${product.model}`), node('p', product.specs),
      node('strong', best ? `${money(best.total)} · ${best.merchant}` : 'Prix comparable indisponible'),
      node('small', best ? 'Livraison comprise' : `${ranked.length} offre(s) publiée(s)`), compare);
    return card;
  });
  $('products').replaceChildren(...article);
  $('count').textContent = rows.length ? `${rows.length} produit(s)` : 'Aucun produit ne correspond à ces filtres.';
  $('external-search').hidden = !query;
  if (query) {
    const search = encodeURIComponent(query);
    $('external-search').replaceChildren(
      link('Google Shopping', `https://shopping.google.com/search?q=${search}`),
      link('Idealo', `https://www.idealo.fr/prechcat.html?q=${search}`),
      link('PRIX MALIN', prixMalin),
    );
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
  let status = offers.length ? 'Offres marchandes issues de PRIX MALIN.' : 'Aucune offre marchande disponible actuellement.';
  if (updatedAt && offers.length) status += ` Relevé du ${date.format(updatedAt)} (heure de Paris).`;
  if (!feedAvailable) status += ' Actualisation indisponible.';
  $('offer-status').textContent = status;
  renderProducts();
  if ($('comparison').open && activeProduct) renderComparison(activeProduct);
}
$('filters').onsubmit = event => { event.preventDefault(); renderProducts(); };
$('filters').onreset = () => setTimeout(renderProducts, 0);
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
fetch(api, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
  .then(response => response.ok ? response.json() : null)
  .then(value => { $('ai-opt-in').hidden = value?.enabled !== true; })
  .catch(() => {});
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
    $('produit').value = snapshot.query;
    $('category').value = snapshot.category;
    $('max').value = snapshot.budget === null ? '' : snapshot.budget / 100;
    renderProducts();
    $('bonsplans').scrollIntoView();
    $('produit').focus({ preventScroll: true });
  };
  $('conversation').append(open);
  $('conversation').scrollTop = $('conversation').scrollHeight;
  if ($('ai-opt-in').hidden || !$('use-ai').checked) return;
  const submit = $('chat-form').querySelector('button');
  submit.disabled = true;
  const pending = bubble('Consultation de l’IA…');
  try {
    const response = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, budget: snapshot.budget }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('IA indisponible');
    const { answer } = await response.json();
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('Réponse vide');
    pending.textContent = `Conseil général de l’IA : ${answer}`;
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
