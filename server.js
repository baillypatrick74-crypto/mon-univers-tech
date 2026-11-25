import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const { PORT = 4173, HOST = '0.0.0.0', PUBLIC_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;
const configuredUrl = PUBLIC_URL ? new URL(PUBLIC_URL) : null;
const publicUrl = configuredUrl?.protocol === 'https:' && configuredUrl.pathname === '/'
  && !configuredUrl.username && !configuredUrl.password && !configuredUrl.search && !configuredUrl.hash
  ? configuredUrl : null;
const aiEnabled = Boolean(publicUrl?.protocol === 'https:' && OPENAI_API_KEY && OPENAI_MODEL);
const fileTypes = new Map([
  ['html', 'text/html; charset=utf-8'], ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'], ['svg', 'image/svg+xml'], ['png', 'image/png'],
  ['webp', 'image/webp'], ['webmanifest', 'application/manifest+json'],
]);
const routes = new Set([
  'index.html', 'informations.html', 'styles.css', 'app.js', 'assistant.js', 'offers.js',
  'catalog.js', 'config.js', 'sw.js', 'manifest.webmanifest', 'assets/logo.svg', 'assets/hero.webp',
  'assets/icon-192.png', 'assets/icon-512.png', ...[0, 1, 2, 3].map(index => `assets/category-${index}.webp`),
]);
const calls = [];
let inFlight = 0;

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function ask(request, response) {
  if (request.method === 'GET') return json(response, 200, { enabled: aiEnabled });
  if (request.method !== 'POST') return json(response, 405, { error: 'Méthode non autorisée' });
  if (!aiEnabled) return json(response, 503, { error: 'IA externe désactivée' });
  if (request.headers.origin !== publicUrl.origin || request.headers['sec-fetch-site'] === 'cross-site') {
    return json(response, 403, { error: 'Origine refusée' });
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
  const budget = payload?.budget;
  const message = payload?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 240
    || (budget !== null && (!Number.isSafeInteger(budget) || budget < 0 || budget > 100_000_000))) {
    return json(response, 400, { error: 'Critères invalides' });
  }
  const now = Date.now();
  while (calls[0] <= now - 60_000) calls.shift();
  if (calls.length >= 10 || inFlight >= 2) {
    response.setHeader('Retry-After', '60');
    return json(response, 429, { error: 'Limite temporaire atteinte' });
  }
  calls.push(now);
  inFlight++;
  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(11_000),
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL, store: false, max_output_tokens: 400,
        instructions: 'Donne uniquement des critères techniques généraux en français. Ne cite aucun prix marchand, promotion, stock, lien, disponibilité ou modèle précis. Le catalogue traite seul les offres.',
        input: JSON.stringify({ message, budgetCentimes: budget }),
      }),
    });
    if (!upstream.ok) return json(response, 502, { error: 'Fournisseur indisponible' });
    const data = await upstream.json();
    const answer = data.output?.flatMap(item => item.content ?? [])
      .filter(part => part.type === 'output_text').map(part => part.text).join('\n').trim();
    // L'IA peut sortir de ses consignes. Rejeter les liens et montants explicites.
    if (!answer || /https?:|www\.|€|\beuros?\b|\bEUR\b|\bprix\b|\bpromotions?\b/iu.test(answer)) {
      return json(response, 502, { error: 'Conseil général indisponible' });
    }
    return json(response, 200, { answer: answer.slice(0, 1200) });
  } finally {
    inFlight--;
  }
}

const server = createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://baillypatrick74-crypto.github.io; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname === '/api/assistant') return await ask(request, response);
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { error: 'Méthode non autorisée' });
    if (publicUrl && pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end(request.method === 'HEAD' ? undefined : `User-agent: *\nAllow: /\nSitemap: ${publicUrl.origin}/sitemap.xml\n`);
    }
    if (publicUrl && pathname === '/sitemap.xml') {
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
