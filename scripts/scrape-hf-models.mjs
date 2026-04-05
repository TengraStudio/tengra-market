#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HF_BASE_URL = 'https://huggingface.co';
const HF_API_URL = `${HF_BASE_URL}/api/models`;
const USER_AGENT = 'tengra-market-hf-scraper/1.0';
const PAGE_SIZE = 1000;
const SEARCH_QUERY = 'GGUF';
const PAGE_DELAY_MS = 120;
const MAX_RETRIES = 6;
const MAX_BACKOFF_MS = 20000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'models', 'huggingface-models.json');

// Tengra-compatible categories (mirrors Tengra categorizeModel logic)
const ALLOWED_CATEGORIES = ['coding', 'chat', 'multimodal', 'embedding', 'reasoning', 'general'];
const ALLOWED_PIPELINES = new Set([
  'text-generation',
  'text2text-generation',
  'conversational',
  'image-to-text',
  'visual-question-answering',
  'automatic-speech-recognition',
  'text-to-image',
  'feature-extraction',
  'sentence-similarity',
  'question-answering',
  'fill-mask',
  'token-classification'
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickString(value) {
  return typeof value === 'string' ? value : '';
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model';
}

function classifyCategory(tags, description, modelId) {
  const blob = `${tags.join(' ')} ${description} ${modelId}`.toLowerCase();
  if (/(code|coding|programming|instruct-coder)/.test(blob)) {
    return 'coding';
  }
  if (/(vision|image|multimodal|vlm|audio|speech)/.test(blob)) {
    return 'multimodal';
  }
  if (/(embed|embedding|retrieval)/.test(blob)) {
    return 'embedding';
  }
  if (/(reason|math|logic|thinking)/.test(blob)) {
    return 'reasoning';
  }
  if (/(chat|assistant|instruct)/.test(blob)) {
    return 'chat';
  }
  return 'general';
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json'
      }
    });

    if (response.ok) {
      return response;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`HF API request failed ${response.status}`);
    }

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = Number.parseInt(retryAfterHeader ?? '', 10);
    const backoffMs = Number.isFinite(retryAfterSeconds)
      ? Math.max(1000, retryAfterSeconds * 1000)
      : Math.min(MAX_BACKOFF_MS, 1000 * (attempt + 1) ** 2);

    await sleep(backoffMs);
  }

  throw new Error('HF API request failed after retries');
}

async function fetchModelsPage(cursor = '') {
  const params = new URLSearchParams({
    search: SEARCH_QUERY,
    sort: 'downloads',
    direction: '-1',
    full: 'true',
    limit: String(PAGE_SIZE)
  });
  if (cursor) {
    params.set('cursor', cursor);
  }

  const response = await fetchWithRetry(`${HF_API_URL}?${params.toString()}`);
  const body = await response.json();

  const linkHeader = response.headers.get('link') || response.headers.get('Link') || '';
  const nextMatch = linkHeader.match(/<([^>]+)>\s*;\s*rel="next"/i);
  let nextCursor = '';

  if (nextMatch?.[1]) {
    const absolute = nextMatch[1].startsWith('http') ? nextMatch[1] : `${HF_BASE_URL}${nextMatch[1]}`;
    const nextUrl = new URL(absolute);
    nextCursor = nextUrl.searchParams.get('cursor') || '';
  }

  return {
    items: Array.isArray(body) ? body : [],
    nextCursor
  };
}

function unescapeHtml(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
}

async function fetchModelDetail(modelId) {
    const detailUrl = `${HF_BASE_URL}/${modelId}`;
    const treeUrl = `${HF_BASE_URL}/${modelId}/tree/main`;
    const filesUrl = `${HF_BASE_URL}/api/models/${modelId}/tree/main`;
    
    try {
        const [htmlResponse, treeResponse, filesResponse] = await Promise.all([
            fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } }),
            fetch(treeUrl, { headers: { 'User-Agent': USER_AGENT } }),
            fetch(filesUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
        ]);

        let readme = '';
        let modelSize = '';
        let totalSize = '';
        let tensorType = '';

        if (htmlResponse.ok) {
            const html = await htmlResponse.text();
            
            // 1. Extract README/Model Card
            const cardMatch = html.match(/<div[^>]*class=["'][^"']*model-card-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                            html.match(/<article[^>]*id=["']model-card["'][^>]*>([\s\S]*?)<\/article>/i) || 
                            html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
            
            if (cardMatch) {
                readme = cardMatch[1].trim()
                    .replace(/\s+class=["'][^"']*["']/gi, '') 
                    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '') 
                    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '');
            }

            // 2. Extract technical specs from Svelte hydration data
            const svelteMatch = html.match(/class="[^"]*SVELTE_HYDRATER[^"]*"[^>]*data-target="ModelTensorsParams"[^>]*data-props="([^"]*)"/i);
            if (svelteMatch) {
                try {
                    const props = JSON.parse(unescapeHtml(svelteMatch[1]));
                    if (props.safetensors?.parameters) {
                        const types = Object.keys(props.safetensors.parameters);
                        tensorType = types.join(', ');
                        
                        // Try to find total params
                        const total = props.safetensors.total;
                        if (total) {
                            if (total >= 1e12) modelSize = `${(total / 1e12).toFixed(1)}T params`;
                            else if (total >= 1e9) modelSize = `${(total / 1e9).toFixed(1)}B params`;
                            else if (total >= 1e6) modelSize = `${(total / 1e6).toFixed(1)}M params`;
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for specific metadata
                }
            }
        }

        // 3. Extract total repository size from tree view HTML
        if (treeResponse.ok) {
            const treeHtml = await treeResponse.text();
            const sizeMatch = treeHtml.match(/class=["'][^"']*font-mono text-xs[^"']*["'][^>]*>\s*([\d.]+\s*[KMGT]B)\s*</i);
            if (sizeMatch) {
                totalSize = sizeMatch[1].trim();
            }
        }

        const submodels = [];
        if (filesResponse.ok) {
            const files = await filesResponse.json();
            if (Array.isArray(files)) {
                for (const file of files) {
                    if (file.path?.toLowerCase().endsWith('.gguf')) {
                        submodels.push({
                            id: file.path,
                            name: file.path,
                            size: file.size ? `${(file.size / 1024 / 1024 / 1024).toFixed(2)} GB` : 'unknown',
                            oid: file.oid,
                            modelSize: modelSize || undefined,
                            tensorType: tensorType || undefined,
                            downloadUrl: `${HF_BASE_URL}/${modelId}/resolve/main/${file.path}`
                        });
                    }
                }
            }
        }

        return { readme, submodels, totalSize };
    } catch (error) {
        console.warn(`      [WARN] Failed to fetch details for ${modelId}:`, error.message);
        return { readme: '', submodels: [], totalSize: '' };
    }
}

function normalizeModel(item) {
  const modelId = pickString(item.id) || pickString(item.modelId);
  if (!modelId) {
    return null;
  }

  if (item.private === true || item.gated === true) {
    return null;
  }

  const pipelineTag = pickString(item.pipeline_tag);
  if (pipelineTag && !ALLOWED_PIPELINES.has(pipelineTag)) {
    return null;
  }

  const tags = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [];
  const description = pickString(item.cardData?.summary) || pipelineTag;
  const category = classifyCategory(tags, description, modelId);

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return null;
  }

  return {
    id: modelId,
    slug: `hf-${slugify(modelId)}`,
    name: modelId.split('/')[1] || modelId,
    author: pickString(item.author) || modelId.split('/')[0] || 'unknown',
    downloads: toNumber(item.downloads),
    likes: toNumber(item.likes),
    pipelineTag,
    category,
    sourceUrl: `${HF_BASE_URL}/${modelId}`,
    readme: '', // Placeholder
    submodels: [], // Placeholder
    totalSize: '' // Placeholder
  };
}

async function buildSnapshot() {
  const models = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor = '';
  let pagesFetched = 0;

  // We limit detailed fetching to avoid extreme execution times, but collect list for all
  const MAX_DETAIL_FETCH = 2000; 

  while (true) {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        break;
      }
      seenCursors.add(cursor);
    }

    const { items, nextCursor } = await fetchModelsPage(cursor);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const model = normalizeModel(item);
      if (!model || seenIds.has(model.id)) {
        continue;
      }
      seenIds.add(model.id);
      models.push(model);
    }

    pagesFetched += 1;
    console.log(`Fetched ${pagesFetched} pages, collected ${models.length} models...`);

    if (!nextCursor || pagesFetched >= 10) { // Limit to 10 pages for sanity
      break;
    }
    cursor = nextCursor;
    await sleep(PAGE_DELAY_MS);
  }

  // Sort by downloads before fetching details so we get rich data for popular ones
  models.sort((a, b) => b.downloads - a.downloads);

  console.log(`Fetching rich metadata (readme/quants) for top ${MAX_DETAIL_FETCH} models...`);
  for (let i = 0; i < Math.min(models.length, MAX_DETAIL_FETCH); i++) {
      const model = models[i];
      process.stdout.write(`  [${i+1}/${MAX_DETAIL_FETCH}] ${model.id}... `);
      const details = await fetchModelDetail(model.id);
      model.readme = details.readme;
      model.submodels = details.submodels;
      model.totalSize = details.totalSize;
      console.log('OK');
      await sleep(150); // Be respectful
  }

  return {
    source: 'huggingface',
    generatedAt: new Date().toISOString(),
    search: SEARCH_QUERY,
    pageSize: PAGE_SIZE,
    pagesFetched,
    total: models.length,
    categories: ALLOWED_CATEGORIES,
    pipelineFilter: [...ALLOWED_PIPELINES].sort(),
    models
  };
}

async function readExistingSnapshot() {
  try {
    const raw = await readFile(outputPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  return {
    source: snapshot.source ?? 'huggingface',
    categories: Array.isArray(snapshot.categories) ? snapshot.categories : [],
    pipelineFilter: Array.isArray(snapshot.pipelineFilter) ? snapshot.pipelineFilter : [],
    total: Array.isArray(snapshot.models) ? snapshot.models.length : 0,
    models: Array.isArray(snapshot.models) ? snapshot.models : []
  };
}

async function main() {
  const newSnapshot = await buildSnapshot();
  const oldSnapshot = await readExistingSnapshot();

  const changed =
    JSON.stringify(normalizeSnapshot(newSnapshot)) !==
    JSON.stringify(normalizeSnapshot(oldSnapshot));

  if (!changed) {
    console.log('No model changes detected. Skipping JSON update.');
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(newSnapshot, null, 2)}\n`, 'utf8');
  console.log(`Updated ${outputPath} with ${newSnapshot.total} models.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
