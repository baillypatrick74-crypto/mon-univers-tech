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

export function createAssistant({ env, publicUrl, quota }) {
  const outputTokens = limit(env.OPENAI_MAX_OUTPUT_TOKENS, 220, 512);
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const enabled = Boolean(env.OPENAI_ENABLED === 'true' && publicUrl && key && quota.configured
    && outputTokens >= 100 && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(model));

  async function ask(message) {
    if (!enabled) return { status: 503 };
    try {
      const reserved = await quota.reserve();
      if (reserved.status !== 200) return reserved;
    } catch {
      return { status: 503 };
    }
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
    }
  }

  return { enabled, ask };
}
