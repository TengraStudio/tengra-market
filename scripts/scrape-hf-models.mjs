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
    sourceUrl: `${HF_BASE_URL}/${modelId}`
  };
}

async function buildSnapshot() {
  const models = [];
  const seenIds = new Set();
  const seenCursors = new Set();
  let cursor = '';
  let pagesFetched = 0;

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
    if (pagesFetched % 10 === 0) {
      console.log(`Fetched ${pagesFetched} pages, collected ${models.length} models...`);
    }

    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
    await sleep(PAGE_DELAY_MS);
  }

  models.sort((a, b) => a.id.localeCompare(b.id));

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
