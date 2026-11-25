import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createAssistant } from './assistant-api.js';
import { clearOwnerCookie, createSupabase } from './supabase.js';

const { PORT = 4173, HOST = '0.0.0.0', PUBLIC_URL } = process.env;
const configuredUrl = URL.parse(PUBLIC_URL ?? '');
const publicUrl = configuredUrl?.protocol === 'https:' && configuredUrl.pathname === '/'
  && !configuredUrl.username && !configuredUrl.password && !configuredUrl.search && !configuredUrl.hash
  ? configuredUrl : null;
const supabase = createSupabase(process.env);
const assistant = createAssistant({ env: process.env, publicUrl, quota: supabase });
const loginAttempts = [];
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

function sameOrigin(request) {
  return request.headers.origin === publicUrl?.origin && request.headers['sec-fetch-site'] !== 'cross-site';
}

async function readBody(request, response) {
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
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  json(response, 400, { error: 'JSON invalide' });
}

async function ownerSession(request, response) {
  if (request.method === 'GET') {
    if (!assistant.enabled) return json(response, 200, { enabled: false });
    try {
      const signedIn = await supabase.authenticated(request.headers.cookie);
      return json(response, 200, { enabled: true, signedIn });
    } catch {
      return json(response, 503, { error: 'Authentification indisponible' });
    }
  }
  if (!['POST', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'Méthode non autorisée' });
  if (!publicUrl || !sameOrigin(request)) return json(response, 403, { error: 'Origine refusée' });
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearOwnerCookie());
    return json(response, 200, { signedIn: false });
  }
  if (!assistant.enabled) return json(response, 503, { error: 'IA externe désactivée' });
  const body = await readBody(request, response);
  if (!body) return;
  const { email, password } = body;
  if (typeof email !== 'string' || !email.trim() || email.length > 254
      || typeof password !== 'string' || !password || password.length > 256) {
    return json(response, 400, { error: 'Identifiants invalides' });
  }
  const now = Date.now();
  while (loginAttempts[0] <= now - 60_000) loginAttempts.shift();
  if (loginAttempts.length >= 5) {
    response.setHeader('Retry-After', '60');
    return json(response, 429, { error: 'Réessayez plus tard' });
  }
  loginAttempts.push(now);
  try {
    const cookie = await supabase.login(email.trim(), password);
    if (!cookie) return json(response, 401, { error: 'Accès réservé au propriétaire' });
    response.setHeader('Set-Cookie', cookie);
    return json(response, 200, { signedIn: true });
  } catch {
    return json(response, 503, { error: 'Authentification indisponible' });
  }
}

async function ask(request, response) {
  if (request.method === 'GET') return json(response, 200, { enabled: assistant.enabled });
  if (request.method !== 'POST') return json(response, 405, { error: 'Méthode non autorisée' });
  if (!assistant.enabled) return json(response, 503, { error: 'IA externe désactivée' });
  if (!sameOrigin(request)) return json(response, 403, { error: 'Origine refusée' });
  try {
    if (!await supabase.authenticated(request.headers.cookie)) {
      return json(response, 401, { error: 'Accès réservé au propriétaire' });
    }
  } catch {
    return json(response, 503, { error: 'Authentification indisponible' });
  }
  const body = await readBody(request, response);
  if (!body) return;
  const message = body.message;
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
    if (pathname === '/api/assistant/session') return await ownerSession(request, response);
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
