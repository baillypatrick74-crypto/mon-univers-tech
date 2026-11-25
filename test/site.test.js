import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { interpret, localReply, results } from '../assistant.js';
import { readOffers } from '../offers.js';
import { downloads, awin, affiliateUrl } from '../config.js';

const now = Date.now();
const offer = {
  productId: 'sony-wh-1000xm5', currency: 'EUR', condition: 'new', merchant: 'Fnac',
  priceCents: 18000, shippingCents: 500, source: 'Test', availability: 'in_stock',
  observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
  url: 'https://www.fnac.com/test',
};
const feed = (...offers) => ({ version: 1, offers });

test('Catalogue réel, recherche par modèle et filtres combinés', () => {
  assert.equal(results('', '', null, []).length, 8);
  assert.equal(results('sony wh1000xm5', 'Audio', null, []).length, 1);
  assert.equal(results('sony', 'Smartphones', null, []).length, 0);
  assert.equal(results('', 'Audio', 20000, []).length, 0);
});

test('Prix validés, livraison et disponibilité dans le budget', () => {
  const rows = readOffers(feed(
    offer,
    { ...offer, merchant: 'Darty', priceCents: 10000, shippingCents: null },
    { ...offer, merchant: 'Boulanger', priceCents: 12000, availability: 'out_of_stock' },
    { ...offer, url: 'javascript:alert(1)' },
    { ...offer, currency: 'USD' },
    { ...offer, expiresAt: offer.observedAt },
    { ...offer, productId: 'absent' },
  ), now);
  assert.equal(rows.length, 3);
  assert.equal(results('', 'Audio', 18499, rows).length, 0);
  const [match] = results('', 'Audio', 18500, rows);
  assert.equal(match.best.merchant, 'Fnac');
  assert.equal(match.best.total, 18500);
  assert.equal(match.ranked.at(-1).total, null);
});

test('Conversation locale avec relance et valeurs françaises', () => {
  const first = interpret('Comparer les casques à moins de 200 €');
  assert.deepEqual(first, { budget: 20_000, category: 'Audio', query: '' });
  const followup = interpret('1 200,50 euros', first);
  assert.deepEqual(followup, { ...first, budget: 120_050 });
  assert.deepEqual(interpret('sans budget', followup), { ...first, budget: null });
  assert.match(localReply(first, []), /Aucune offre en stock/);
  assert.match(localReply(first, readOffers(feed(offer), now)), /Fnac/);
  assert.equal(interpret('Samsung Galaxy S24').category, 'Smartphones');
});

test('Critères techniques sourcés et alternatives par marque', () => {
  const criteria = interpret('Un iPhone avec Wi-Fi 7, 5G et 128 Go sous 700 €');
  assert.equal(criteria.budget, 70_000);
  assert.equal(criteria.query, 'iPhone');
  assert.deepEqual(criteria.features, { wifi: 7, wifi6e: false, cellular: '5G', storageGB: 128 });
  assert.equal(results(criteria.query, criteria.category, null, [], criteria.features).length, 1);
  assert.match(localReply(criteria, []), /Wi-Fi 7/);
  assert.equal(results('Samsung ou Apple', 'Smartphones', null, []).length, 2);
  assert.equal(results('', 'Audio', null, [], { batteryHours: 30 }).length, 1);
  assert.equal(results('iPhone', 'Smartphones', null, [], { storageGB: 256 }).length, 0);
});

test('Affiliation inactive et installateurs publics PRIX MALIN', () => {
  assert.match(downloads['PRIX MALIN'].Android, /PRIX-MALIN-Android\.apk$/);
  assert.match(downloads['PRIX MALIN'].Windows, /PRIX-MALIN-Windows-x64\.exe$/);
  assert.deepEqual(awin, {});
  assert.equal(downloads['PRIX MALIN'].version, '1.0.0');
  assert.equal(Object.keys(downloads).length, 1);
  const offer = { merchant: 'Fnac', url: 'https://www.fnac.com/casque?a=1&b=2' };
  const programmes = { Fnac: { enabled: true, merchantId: '111', publisherId: '222', domains: ['www.fnac.com'] } };
  assert.equal(affiliateUrl(offer), null);
  const tracked = new URL(affiliateUrl(offer, programmes));
  assert.equal(tracked.host, 'www.awin1.com');
  assert.equal(tracked.searchParams.get('ued'), offer.url);
  assert.equal(affiliateUrl({ ...offer, url: 'https://www.fnac.com.example.test/casque' }, programmes), null);
});

async function startServer(t, env, code = "await import('./server.js')") {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', OPENAI_ENABLED: '', OPENAI_API_KEY: '', OPENAI_MODEL: '', PUBLIC_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const [line] = await once(child.stdout, 'data');
  return `http://127.0.0.1:${line.toString().match(/port (\d+)/)[1]}`;
}

test('Pages, ressources PWA, mentions légales et SEO', async t => {
  const origin = await startServer(t, { PUBLIC_URL: 'https://tech.example', SEO_INDEXING: 'true' });
  const get = path => fetch(origin + path);
  const manifest = await (await get('/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  const sw = await (await get('/sw.js')).text();
  const declared = [...sw.matchAll(/'\.\/([^']*)'/g)].map(match => match[1]);
  for (const path of [...declared, ...[0, 1, 2, 3].map(index => `assets/category-${index}.webp`)]) {
    assert.equal((await get('/' + path)).status, 200, path);
  }
  for (const icon of manifest.icons) {
    const bytes = Buffer.from(await (await get(icon.src.slice(1))).arrayBuffer());
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
  }
  const html = await (await get('/')).text();
  assert.match(html, /canonical" href="https:\/\/tech\.example\//);
  const legal = await (await get('/informations.html')).text();
  for (const id of ['mentions', 'confidentialite', 'affiliation']) assert.match(legal, new RegExp(`id="${id}"`));
  assert.match(await (await get('/sitemap.xml')).text(), /tech\.example\/informations\.html/);
  assert.match(await (await get('/robots.txt')).text(), /sitemap\.xml/);
  assert.equal((await get('/server.js')).status, 404);
  assert.equal((await get('/.env')).status, 404);
  assert.deepEqual(await (await get('/api/assistant')).json(), { enabled: false });
  assert.equal((await fetch(origin + '/api/assistant', { method: 'POST' })).status, 503);
  const css = await readFile('styles.css', 'utf8');
  for (const media of ['max-width:960px', 'max-width:720px', 'max-width:430px', 'prefers-reduced-motion:reduce']) {
    assert.ok(css.includes(media));
  }
});

const mockResponses = `
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input);
    if (url !== 'https://api.openai.com/v1/responses'
        || options.headers.Authorization !== 'Bearer test-only' || body.store !== false
        || body.model !== (process.env.OPENAI_MODEL || 'gpt-4o-mini') || body.max_output_tokens !== 220
        || body.text.format.strict !== true || input.catalogue.length !== 8
        || input.catalogue.some(item => 'price' in item) || typeof input.question !== 'string') {
      throw Error('Requête fournisseur inattendue');
    }
    if (options.headers.Authorization.includes('abababab') || JSON.stringify(input).includes('abababab')) {
      throw Error('Code testeur transmis au fournisseur');
    }
    if (input.question === 'erreur') return Response.json({ error: 'SECRET DU FOURNISSEUR' }, { status: 401 });
    const selection = input.question === 'montant'
      ? { produits: ['sony-wh-1000xm5'], conseil: '99 euros' }
      : { produits: ['sony-wh-1000xm5'], conseil: 'audio' };
    return Response.json({ status: 'completed', output: [{ type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(selection) }] }] });
  };
  await import('./server.js');
`;

async function quotaDirectory(t) {
  const path = await mkdtemp(join(tmpdir(), 'mut-quota-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

const pilot = 'ab'.repeat(32);
const pilotHash = createHash('sha256').update(pilot).digest('hex');
const enabledEnv = { PUBLIC_URL: 'https://tech.example', OPENAI_API_KEY: 'test-only', OPENAI_ENABLED: 'true', OPENAI_PILOT_TOKEN_SHA256: pilotHash };
function ask(origin, message, site = 'https://tech.example', credential = pilot) {
  return fetch(origin + '/api/assistant', {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    body: JSON.stringify({ message }),
  });
}

test('API Responses simulée en français et réponse fondée sur le catalogue', async t => {
  const origin = await startServer(t, { ...enabledEnv, OPENAI_MODEL: 'test-model', OPENAI_USAGE_DIR: await quotaDirectory(t) }, mockResponses);
  assert.deepEqual(await (await fetch(origin + '/healthz')).json(), { ok: true });
  assert.equal((await fetch(origin + '/assistant-api.js')).status, 404);
  assert.deepEqual(await (await fetch(origin + '/api/assistant')).json(), { enabled: true });
  assert.equal((await ask(origin, 'casque', 'https://elsewhere.example')).status, 403);
  assert.equal((await ask(origin, 'casque', 'https://tech.example', '')).status, 401);
  assert.equal((await ask(origin, 'casque', 'https://tech.example', 'cd'.repeat(32))).status, 401);
  assert.equal((await ask(origin, 'a'.repeat(241))).status, 400);
  assert.equal((await ask(origin, 'a'.repeat(2200))).status, 413);
  assert.equal((await ask(origin, 'montant')).status, 502);
  const failure = await ask(origin, 'erreur');
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /SECRET DU FOURNISSEUR/);
  const answer = await (await ask(origin, 'Quel casque recommandez-vous ?')).json();
  assert.match(answer.answer, /Sony WH-1000XM5/);
  assert.match(answer.answer, /Comparez le confort/);
  assert.doesNotMatch(answer.answer, /€|euros|99/);
  const limited = await ask(origin, 'casque');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('Quota journalier et mensuel conservé après redémarrage', async t => {
  const directory = await quotaDirectory(t);
  const env = { ...enabledEnv, OPENAI_USAGE_DIR: directory, OPENAI_REQUESTS_PER_DAY: '1', OPENAI_REQUESTS_PER_MONTH: '2' };
  const first = await startServer(t, env, mockResponses);
  assert.equal((await ask(first, 'casque')).status, 200);
  const afterRestart = await startServer(t, env, mockResponses);
  assert.equal((await ask(afterRestart, 'casque')).status, 429);
  const monthly = await startServer(t, { ...env, OPENAI_REQUESTS_PER_DAY: '3' }, mockResponses);
  assert.equal((await ask(monthly, 'casque')).status, 200);
  assert.equal((await ask(monthly, 'casque')).status, 429);
  const filenames = await readdir(directory);
  assert.equal(filenames.length, 1);
  assert.match(await readFile(join(directory, filenames[0]), 'utf8'), /^(?:\d{4}-\d{2}-\d{2}\n){2}$/);
});

test('Activation explicite et refus d’appeler OpenAI si le journal est inaccessible', async t => {
  const directory = await quotaDirectory(t);
  const disabled = await startServer(t, { ...enabledEnv, OPENAI_ENABLED: 'false', OPENAI_USAGE_DIR: directory }, mockResponses);
  assert.deepEqual(await (await fetch(disabled + '/api/assistant')).json(), { enabled: false });
  const base = await fetch(disabled + '/');
  assert.equal(base.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await fetch(disabled + '/sitemap.xml')).status, 404);
  const missingAuth = await startServer(t, { ...enabledEnv, OPENAI_PILOT_TOKEN_SHA256: '', OPENAI_USAGE_DIR: directory }, mockResponses);
  assert.deepEqual(await (await fetch(missingAuth + '/api/assistant')).json(), { enabled: false });
  const broken = await startServer(t, { ...enabledEnv, OPENAI_USAGE_DIR: join(directory, 'absent') }, mockResponses);
  assert.deepEqual(await (await fetch(broken + '/api/assistant')).json(), { enabled: false });
  assert.equal((await ask(broken, 'casque')).status, 503);
  assert.deepEqual(await readdir(directory), []);
});

test('Thème système, préférence manuelle et restauration de la préférence', async () => {
  const root = { dataset: {} };
  const callbacks = {};
  const control = { value: '', addEventListener: (_, action) => { callbacks.control = action; } };
  const media = { matches: true, addEventListener: (_, action) => { callbacks.system = action; } };
  let saved = 'auto';
  const browser = {
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    matchMedia: () => media,
    document: { documentElement: root, querySelector: () => null, getElementById: () => control,
      addEventListener: (_, action) => { callbacks.ready = action; } },
  };
  const script = await readFile('assets/theme.js', 'utf8');
  runInNewContext(script, browser);
  callbacks.ready();
  assert.equal(root.dataset.theme, 'dark');
  media.matches = false;
  callbacks.system();
  assert.equal(root.dataset.theme, 'light');
  control.value = 'dark';
  callbacks.control();
  assert.equal(saved, 'dark');
  runInNewContext(script, browser);
  assert.equal(root.dataset.theme, 'dark');
});

test('PWA V3 met en cache les ressources du site et laisse les appels IA hors cache', async () => {
  const handlers = {};
  const requests = [];
  const deleted = [];
  const scope = 'https://tech.example/';
  const cache = {
    addAll: async entries => requests.push(...entries.map(entry => new URL(entry, scope).href)),
    match: async request => new Response('hors ligne ' + request.url),
  };
  runInNewContext(await readFile('sw.js', 'utf8'), {
    URL, Request: class { constructor(path) { return new URL(path, scope); } },
    self: { registration: { scope }, clients: { claim: async () => {} }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { open: async () => cache, keys: async () => ['mon-univers-tech-v2.1.1', 'autre-site'],
      delete: async name => deleted.push(name) },
    fetch: async () => { throw Error('hors ligne'); },
  });
  let pending;
  handlers.install({ waitUntil: value => { pending = value; } });
  await pending;
  assert.ok(requests.includes(scope + 'assets/theme.js'));
  assert.ok(requests.includes(scope + 'assets/prix-malin.png'));
  handlers.activate({ waitUntil: value => { pending = value; } });
  await pending;
  assert.deepEqual(deleted, ['mon-univers-tech-v2.1.1']);
  let result;
  const respondWith = value => { result = value; };
  handlers.fetch({ request: { method: 'POST', url: scope + 'api/assistant' }, respondWith });
  assert.equal(result, undefined);
  handlers.fetch({ request: { method: 'GET', url: scope + 'api/assistant' }, respondWith });
  assert.equal(result, undefined);
  handlers.fetch({ request: { method: 'GET', url: scope }, respondWith });
  assert.match(await (await result).text(), /hors ligne/);
});
