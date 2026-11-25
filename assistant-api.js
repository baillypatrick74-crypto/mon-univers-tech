import { closeSync, fsyncSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { products } from './catalog.js';
import { productFeatures } from './product-details.js';

const topics = {
  compatibilite: 'Vérifiez la compatibilité avec votre réseau et vos accessoires.',
  autonomie: 'Comparez les mesures d’autonomie obtenues avec le même usage.',
  stockage: 'Choisissez le stockage selon vos applications, photos et fichiers.',
  performance: 'Privilégiez les essais portant sur les logiciels que vous utilisez.',
  audio: 'Comparez le confort, le microphone et la réduction de bruit.',
  ecran: 'Comparez la définition, la fréquence et les entrées vidéo.',
  garantie: 'Vérifiez la garantie et les conditions de retour chez le vendeur.',
};

const catalogue = products.map(product => ({
  id: product.id, marque: product.brand, modele: product.model, categorie: product.category,
  fiche: [product.specs, ...productFeatures(product)],
}));
const byId = new Map(catalogue.map(product => [product.id, product]));
const noSelection = 'Je n’ai pas trouvé de référence à conseiller dans le catalogue pour cette demande.';
const responseSchema = {
  type: 'object', additionalProperties: false, required: ['produits', 'conseil'],
  properties: {
    produits: { type: 'array', items: { type: 'string', enum: [...byId.keys()] } },
    conseil: { type: 'string', enum: Object.keys(topics) },
  },
};

function limit(value, fallback, max) {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : null;
}

export function createAssistant({ env, publicUrl, now = () => new Date() }) {
  const perMinute = limit(env.OPENAI_REQUESTS_PER_MINUTE, 3, 10);
  const perDay = limit(env.OPENAI_REQUESTS_PER_DAY, 25, 1000);
  const perMonth = limit(env.OPENAI_REQUESTS_PER_MONTH, 300, 10_000);
  const outputTokens = limit(env.OPENAI_MAX_OUTPUT_TOKENS, 220, 512);
  const directory = env.OPENAI_USAGE_DIR;
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const enabled = Boolean(env.OPENAI_ENABLED === 'true' && publicUrl && key && directory && isAbsolute(directory)
    && perMinute && perDay && perMonth && outputTokens && outputTokens >= 100
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model));
  const calls = [];
  let inFlight = false;

  function reserve(instant) {
    // Le disque Render survit aux redémarrages. Un appel est réservé avant l'envoi.
    const day = instant.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (!statSync(directory).isDirectory()) throw new Error('Dossier de quota indisponible');
    const path = join(directory, `openai-${month}.log`);
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (size > 110_000) throw new Error('Journal de quota invalide');
    const fd = openSync(path, 'a+', 0o600);
    try {
      const log = readFileSync(fd, 'utf8');
      const entries = log ? log.trimEnd().split('\n') : [];
      if ((log && !log.endsWith('\n')) || entries.some(entry => !/^\d{4}-\d{2}-\d{2}$/.test(entry) || !entry.startsWith(month))) {
        throw new Error('Journal de quota invalide');
      }
      if (entries.length >= perMonth || entries.filter(entry => entry === day).length >= perDay) return false;
      if (writeSync(fd, day + '\n') !== 11) throw new Error('Écriture du quota incomplète');
      fsyncSync(fd);
      return true;
    } finally {
      closeSync(fd);
    }
  }

  async function ask(message) {
    const instant = now();
    while (calls[0] <= +instant - 60_000) calls.shift();
    if (inFlight || calls.length >= perMinute) return { status: 429, retryAfter: 60 };
    try {
      if (!reserve(instant)) return { status: 429 };
    } catch {
      return { status: 503 };
    }
    calls.push(+instant);
    inFlight = true;
    try {
      const upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(11_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, store: false, max_output_tokens: outputTokens,
          instructions: 'Tu comprends les questions en français. Identifie au plus trois références dont les caractéristiques du catalogue répondent à la question, et choisis un thème de conseil. Si aucune référence ne convient, renvoie un tableau vide. Les prix, le stock, les promotions et le respect d’un budget sont traités exclusivement par le comparateur. Ne suppose aucune information absente du catalogue.',
          input: JSON.stringify({ question: message, catalogue }),
          text: { format: { type: 'json_schema', name: 'conseil_catalogue', strict: true, schema: responseSchema } },
        }),
      });
      if (!upstream.ok) return { status: 502 };
      const data = await upstream.json();
      if (data.status !== 'completed' || !Array.isArray(data.output)) return { status: 502 };
      const content = data.output.flatMap(item => item.type === 'message' && Array.isArray(item.content) ? item.content : []);
      if (content.length !== 1 || content[0].type !== 'output_text') return { status: 502 };
      const choice = JSON.parse(content[0].text);
      if (!Array.isArray(choice?.produits) || choice.produits.length > 3
          || choice.produits.some(id => !byId.has(id)) || typeof choice.conseil !== 'string'
          || !Object.hasOwn(topics, choice.conseil) || Object.keys(choice).length !== 2) return { status: 502 };
      const lines = [...new Set(choice.produits)].map(id => {
        const product = byId.get(id);
        return `${product.marque} ${product.modele} · ${product.fiche.join(' · ')}`;
      });
      return { status: 200, answer: [...(lines.length ? lines : [noSelection]), topics[choice.conseil]].join('\n') };
    } catch {
      return { status: 502 };
    } finally {
      inFlight = false;
    }
  }

  return { enabled, ask };
}
