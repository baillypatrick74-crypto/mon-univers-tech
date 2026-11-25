import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAssistant } from './assistant-api.js';

const { PORT = 4173, HOST = '0.0.0.0', PUBLIC_URL } = process.env;
const configuredUrl = URL.parse(PUBLIC_URL ?? '');
const publicUrl = configuredUrl?.protocol === 'https:' && configuredUrl.pathname === '/'
  && !configuredUrl.username && !configuredUrl.password && !configuredUrl.search && !configuredUrl.hash
  ? configuredUrl : null;
const assistant = createAssistant({ env: process.env, publicUrl });
const indexing = Boolean(publicUrl && process.env.SEO_INDEXING === 'true');
const fileTypes = new Map([
  ['html', 'text/html; charset=utf-8'], ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'], ['svg', 'image/svg+xml'], ['png', 'image/png'],
  ['webp', 'image/webp'], ['webmanifest', 'application/manifest+json'],
]);
const routes = new Set([
  'index.html', 'informations.html', 'styles.css', 'app.js', 'assistant.js', 'offers.js',
  'catalog.js', 'product-details.js', 'config.js', 'sw.js', 'manifest.webmanifest', 'assets/logo.svg', 'assets/hero.webp',
  'assets/prix-malin.png', 'assets/theme.js', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/galaxy-s24.webp', 'assets/iphone-16.webp', ...[0, 1, 2, 3].map(index => `assets/category-${index}.webp`),
]);

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function ask(request, response) {
  if (request.method === 'GET') return json(response, 200, { enabled: assistant.enabled() });
  if (request.method !== 'POST') return json(response, 405, { error: 'Méthode non autorisée' });
  if (!assistant.enabled()) return json(response, 503, { error: 'IA externe désactivée' });
  if (request.headers.origin !== publicUrl.origin || request.headers['sec-fetch-site'] === 'cross-site') {
    return json(response, 403, { error: 'Origine refusée' });
  }
  if (!assistant.authenticated(request.headers.authorization)) {
    return json(response, 401, { error: 'Accès réservé aux testeurs' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    return json(response, 415, { error: 'Format non pris en charge' });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) {
      request.resume();
      return json(response, 413, { error: 'Message trop long' });
    }
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return json(response, 400, { error: 'JSON invalide' }); }
  const message = payload?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 240) {
    return json(response, 400, { error: 'Message invalide' });
  }
  const result = await assistant.ask(message.trim());
  if (result.retryAfter) response.setHeader('Retry-After', result.retryAfter);
  if (result.status === 200) return json(response, 200, { answer: result.answer });
  const error = result.status === 429 ? 'Quota IA atteint' : 'Conseil IA indisponible';
  return json(response, result.status, { error });
}

const server = createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://baillypatrick74-crypto.github.io; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  if (!indexing) response.setHeader('X-Robots-Tag', 'noindex');
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === '/healthz' && request.method === 'GET') return json(response, 200, { ok: true });
    if (pathname === '/api/assistant') return await ask(request, response);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Méthode non autorisée' });
    if (pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end(request.method === 'HEAD' ? undefined : `User-agent: *\nAllow: /\n${indexing ? 'Sitemap: ' + publicUrl.origin + '/sitemap.xml\n' : ''}`);
    }
    if (indexing && pathname === '/sitemap.xml') {
      const entries = ['/', '/informations.html'].map(path => `<url><loc>${publicUrl.origin}${path}</loc></url>`).join('');
      response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return response.end(request.method === 'HEAD' ? undefined : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`);
    }
    const path = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!routes.has(path)) return json(response, 404, { error: 'Page introuvable' });
    const file = await readFile(new URL(path, import.meta.url));
    response.writeHead(200, { 'Content-Type': fileTypes.get(path.split('.').at(-1)),
      'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') return response.end();
    if (publicUrl && path.endsWith('.html')) {
      const url = publicUrl.origin + (path === 'index.html' ? '/' : '/informations.html');
      return response.end(file.toString().replace('</head>', `  <link rel="canonical" href="${url}">\n</head>`));
    }
    response.end(file);
  } catch {
    if (!response.headersSent) json(response, 502, { error: 'Service indisponible' });
  }
});

server.listen(Number(PORT), HOST, () => console.log(`MON UNIVERS TECH sur le port ${server.address().port}`));
