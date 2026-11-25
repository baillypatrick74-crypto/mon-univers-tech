import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { interpret, localReply, results } from '../assistant.js';
import { readOffers } from '../offers.js';
import { downloads, awin } from '../config.js';

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

test('Affiliation et téléchargements restent inactifs sans configuration', () => {
  assert.deepEqual(downloads, {});
  assert.deepEqual(awin, {});
});

async function startServer(t, env, code = "await import('./server.js')") {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', OPENAI_API_KEY: '', OPENAI_MODEL: '', PUBLIC_URL: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const [line] = await once(child.stdout, 'data');
  return `http://127.0.0.1:${line.toString().match(/port (\d+)/)[1]}`;
}

test('Pages, ressources PWA, mentions légales et SEO', async t => {
  const origin = await startServer(t, { PUBLIC_URL: 'https://tech.example' });
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

test('L’API garde sa clé côté serveur, valide les entrées et limite le débit', async t => {
  const code = `
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (url !== 'https://api.openai.com/v1/responses'
          || options.headers.Authorization !== 'Bearer test-only' || body.store !== false) {
        throw Error('Requête fournisseur inattendue');
      }
      const text = body.input.includes('montant') ? '99 euros' : 'Comparez le confort.';
      return Response.json({ output: [{ content: [{ type: 'output_text', text }] }] });
    };
    await import('./server.js');
  `;
  const origin = await startServer(t, { PUBLIC_URL: 'https://tech.example', OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'test-model' }, code);
  const api = origin + '/api/assistant';
  const send = (message, site = 'https://tech.example') => fetch(api, {
    method: 'POST',
    headers: { Origin: site, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, budget: null }),
  });
  assert.deepEqual(await (await fetch(api)).json(), { enabled: true });
  assert.equal((await send('casque', 'https://elsewhere.example')).status, 403);
  assert.equal((await send('a'.repeat(241))).status, 400);
  assert.equal((await send('a'.repeat(2200))).status, 413);
  assert.equal((await send('montant')).status, 502);
  assert.deepEqual(await (await send('casque')).json(), { answer: 'Comparez le confort.' });
  for (let i = 0; i < 8; i++) assert.equal((await send('casque')).status, 200);
  assert.equal((await send('casque')).status, 429);
});
