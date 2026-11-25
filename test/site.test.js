import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
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

async function startServer(t, env, code = '') {
  const script = `
    globalThis.fetch = async () => { throw Error('Appel réseau non simulé'); };
    ${code || "await import('./server.js')"}
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    // Chaque scénario fournit sa propre configuration, sans les variables ni les clés de Render.
    env: { PORT: '0', HOST: '127.0.0.1', ...env },
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

const owner = '77d785ea-6f25-4fbe-988c-bd1164f54e1a';
const enabledEnv = {
  PUBLIC_URL: 'https://tech.example', OPENAI_API_KEY: 'test-only', OPENAI_ENABLED: 'true',
  SUPABASE_URL: 'https://mutmock.supabase.co', SUPABASE_OWNER_ID: owner,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-only', SUPABASE_SECRET_KEY: 'sb_secret_test-only',
};
const jwt = (signature, age = 0) => {
  const now = Math.floor(Date.now() / 1000);
  return 'header.' + Buffer.from(JSON.stringify({ iat: now - age, exp: now + 3600 })).toString('base64url') + '.' + signature;
};
const ownerToken = jwt('owner');
const otherToken = jwt('other');
const sessionCookie = '__Host-mut-owner=' + ownerToken;
const mockResponses = `
  const owner = '${owner}';
  let reserved = false;
  globalThis.fetch = async (value, options) => {
    const url = new URL(value);
    const headers = options.headers;
    if (process.env.SUPABASE_DIAGNOSTIC_ENABLED === 'true'
        && (url.origin === 'https://api.openai.com' || url.pathname.endsWith('mut_reserve_assistant_call'))) {
      process.exit(71);
    }
    if (url.origin === 'https://mutmock.supabase.co') {
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') !== 'password' || headers.apikey !== 'sb_publishable_test-only') throw Error('Auth');
        const { email, password } = JSON.parse(options.body);
        if (password !== 'test-password') return Response.json({}, { status: 400 });
        return Response.json({ user: { id: email === 'owner@example.test' ? owner : 'another-user', email_confirmed_at: 'date' },
          access_token: '${ownerToken}', expires_in: 3600, refresh_token: 'private-refresh-token' });
      }
      if (url.pathname === '/auth/v1/user') {
        if (headers.apikey !== 'sb_publishable_test-only') throw Error('User');
        if (headers.Authorization === 'Bearer ${ownerToken}') return Response.json({ id: owner, email_confirmed_at: 'date' });
        if (headers.Authorization === 'Bearer ${otherToken}') return Response.json({ id: 'another-user', email_confirmed_at: 'date' });
        return Response.json({}, { status: 401 });
      }
      if (url.pathname === '/rest/v1/rpc/mut_check_assistant_quota') {
        if (headers.apikey !== 'sb_secret_test-only' || options.method !== 'POST' || options.body !== '{}') throw Error('RPC');
        return process.env.MOCK_QUOTA === 'down' ? Response.json({ private: 'secret' }, { status: 503 })
          : Response.json(process.env.MOCK_QUOTA !== 'missing');
      }
      if (url.pathname === '/rest/v1/rpc/mut_reserve_assistant_call') {
        if (headers.apikey !== 'sb_secret_test-only' || options.method !== 'POST' || options.body !== '{}') throw Error('RPC');
        if (process.env.MOCK_QUOTA === 'down') return Response.json({}, { status: 503 });
        if (process.env.MOCK_QUOTA === 'limit') return Response.json({ allowed: false, retry_after: 46 });
        if (process.env.MOCK_QUOTA === 'malformed') return Response.json({ allowed: 'true' });
        reserved = true;
        return Response.json({ allowed: true });
      }
    }
    if (url.href !== 'https://api.openai.com/v1/responses' || !reserved
      || headers.Authorization !== 'Bearer test-only' || process.env.MOCK_QUOTA) throw Error('Appel OpenAI inattendu');
    reserved = false;
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input);
    if (body.model !== 'gpt-4o-mini' || body.store !== false || body.max_output_tokens !== 220
        || body.text.format.strict !== true || input.catalogue.length !== 8 || input.catalogue.some(item => 'price' in item)
        || JSON.stringify(body).includes('test-password') || JSON.stringify(body).includes('${ownerToken}')) {
      throw Error('Requête fournisseur inattendue');
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

function ask(origin, message, cookie = sessionCookie, site = 'https://tech.example') {
  return fetch(origin + '/api/assistant', {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ message }),
  });
}

test('Session sécurisée limitée au propriétaire Supabase', async t => {
  const origin = await startServer(t, enabledEnv, mockResponses);
  const endpoint = origin + '/api/assistant/session';
  const login = (email, password, site = 'https://tech.example') => fetch(endpoint, {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.deepEqual(await (await fetch(endpoint)).json(), { enabled: true, signedIn: false });
  assert.equal((await login('owner@example.test', 'test-password', 'https://elsewhere.example')).status, 403);
  assert.equal((await login('other@example.test', 'test-password')).status, 401);
  assert.equal((await login('owner@example.test', 'incorrect')).status, 401);
  const signedIn = await login('owner@example.test', 'test-password');
  assert.deepEqual(await signedIn.json(), { signedIn: true });
  assert.equal(signedIn.headers.get('set-cookie'), sessionCookie + '; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Strict');
  assert.deepEqual(await (await fetch(endpoint, { headers: { Cookie: sessionCookie } })).json(), { enabled: true, signedIn: true });
  const signedOut = await fetch(endpoint, { method: 'DELETE', headers: { Origin: 'https://tech.example' } });
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/);
});

test('OpenAI simulé et réservation du quota avant tout appel', async t => {
  const origin = await startServer(t, enabledEnv, mockResponses);
  assert.equal((await fetch(origin + '/supabase.js')).status, 404);
  assert.equal((await ask(origin, 'casque', sessionCookie, 'https://elsewhere.example')).status, 403);
  assert.equal((await ask(origin, 'casque', '')).status, 401);
  assert.equal((await ask(origin, 'casque', '__Host-mut-owner=' + otherToken)).status, 401);
  assert.equal((await ask(origin, 'casque', '__Host-mut-owner=' + jwt('invalid'))).status, 401);
  assert.equal((await ask(origin, 'casque', '__Host-mut-owner=' + jwt('owner', 601))).status, 401);
  assert.equal((await ask(origin, 'a'.repeat(241))).status, 400);
  assert.equal((await ask(origin, 'a'.repeat(2200))).status, 413);
  assert.equal((await ask(origin, 'montant')).status, 502);
  const failure = await ask(origin, 'erreur');
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /SECRET DU FOURNISSEUR/);
  assert.match((await (await ask(origin, 'Quel casque recommandez-vous ?')).json()).answer, /Sony WH-1000XM5/);
});

test('Plafond, panne et réponse invalide Supabase empêchent les appels payants', async t => {
  for (const [mode, status] of [['limit', 429], ['down', 503], ['malformed', 503]]) {
    const origin = await startServer(t, { ...enabledEnv, MOCK_QUOTA: mode }, mockResponses);
    const result = await ask(origin, 'casque');
    assert.equal(result.status, status);
    if (mode === 'limit') assert.equal(result.headers.get('retry-after'), '46');
  }
});

test('L’activation nécessite une configuration complète et explicite', async t => {
  for (const override of [{ OPENAI_ENABLED: 'false' }, { SUPABASE_OWNER_ID: '' }, { SUPABASE_SECRET_KEY: '' }]) {
    const origin = await startServer(t, { ...enabledEnv, ...override }, mockResponses);
    assert.deepEqual(await (await fetch(origin + '/api/assistant')).json(), { enabled: false });
    assert.equal((await ask(origin, 'casque')).status, 503);
  }
  const origin = await startServer(t, { ...enabledEnv, OPENAI_ENABLED: 'false' }, mockResponses);
  assert.equal((await fetch(origin + '/')).headers.get('x-robots-tag'), 'noindex');
  assert.equal((await fetch(origin + '/sitemap.xml')).status, 404);
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
    caches: { open: async () => cache, keys: async () => ['mon-univers-tech-v3.0.0', 'autre-site'],
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
  assert.deepEqual(deleted, ['mon-univers-tech-v3.0.0']);
  let result;
  const respondWith = value => { result = value; };
  handlers.fetch({ request: { method: 'POST', url: scope + 'api/assistant' }, respondWith });
  assert.equal(result, undefined);
  handlers.fetch({ request: { method: 'GET', url: scope + 'api/assistant' }, respondWith });
  assert.equal(result, undefined);
  handlers.fetch({ request: { method: 'GET', url: scope + 'api/assistant/session' }, respondWith });
  assert.equal(result, undefined);
  handlers.fetch({ request: { method: 'GET', url: scope }, respondWith });
  assert.match(await (await result).text(), /hors ligne/);
});

test('Diagnostic propriétaire en lecture seule avec OpenAI désactivé', async t => {
  const env = { ...enabledEnv, OPENAI_ENABLED: 'false', OPENAI_API_KEY: '' };
  const post = (origin, cookie, site = 'https://tech.example') => fetch(origin + '/api/assistant/diagnostic', {
    method: 'POST', headers: { Origin: site, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const off = await startServer(t, { ...env, SUPABASE_DIAGNOSTIC_ENABLED: '' }, mockResponses);
  assert.equal((await post(off, sessionCookie)).status, 404);
  const origin = await startServer(t, { ...env, SUPABASE_DIAGNOSTIC_ENABLED: 'true' }, mockResponses);
  const session = origin + '/api/assistant/session';
  assert.deepEqual(await (await fetch(session)).json(), { enabled: false, signedIn: false, diagnostic: true });
  assert.equal((await post(origin)).status, 401);
  assert.equal((await post(origin, '__Host-mut-owner=' + otherToken)).status, 401);
  assert.equal((await post(origin, sessionCookie, 'https://elsewhere.example')).status, 403);
  const login = await fetch(session, { method: 'POST', headers: {
    Origin: 'https://tech.example', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ email: 'owner@example.test', password: 'test-password' }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  const result = await post(origin, login.headers.get('set-cookie').split(';')[0]);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { owner: true, supabase: true });
  assert.equal((await ask(origin, 'casque')).status, 503);
  for (const mode of ['down', 'missing']) {
    const failed = await startServer(t, { ...env, SUPABASE_DIAGNOSTIC_ENABLED: 'true', MOCK_QUOTA: mode }, mockResponses);
    const response = await post(failed, sessionCookie);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Lecture Supabase indisponible' });
  }
});
