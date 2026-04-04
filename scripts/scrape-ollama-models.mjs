#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_AGENT = 'tengra-market-ollama-scraper/1.1';
const OLLAMA_BASE = 'https://ollama.com';
const OLLAMA_LIBRARY = `${OLLAMA_BASE}/library`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'models', 'ollama-models.json');

/**
 * Basic delay to avoid rate limiting
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model';
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&nbsp;', ' ');
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, ' ');
}

function sanitizeDescription(text) {
  return stripHtml(decodeHtmlEntities(text)).replace(/\s+/g, ' ').trim();
}

function parsePullCount(raw) {
  if (!raw) return 0;
  const normalized = raw.toLowerCase().trim().replace(/,/g, '');
  let multiplier = 1;

  if (normalized.endsWith('m')) {
    multiplier = 1000000;
  } else if (normalized.endsWith('k')) {
    multiplier = 1000;
  } else if (normalized.endsWith('b')) {
    multiplier = 1000000000;
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : Math.floor(num * multiplier);
}

async function httpGet(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.text();
}

function extractModelsFromLibrary(html) {
  const models = [];
  // Match li items with x-test-model or data-x-test-model
  const liRegex = /<li[^>]*\s+(?:data-)?x-test-model[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    const liContent = match[1];

    // Extract basic model ID and URL
    const hrefMatch = liContent.match(/<a[^>]*href=["']\/library\/([^"']+)["'][^>]*>/i);
    if (!hrefMatch) continue;
    const modelId = hrefMatch[1];

    // Extract title and short description from x-test-model-title
    const titleSectionMatch = liContent.match(/<div[^>]*\s+(?:data-)?x-test-model-title[^>]*>([\s\S]*?)<\/div>/i);
    let name = modelId;
    let description = '';

    if (titleSectionMatch) {
      const titleContent = titleSectionMatch[1];
      const h2Match = titleContent.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (h2Match) name = sanitizeDescription(h2Match[1]);

      const pMatch = titleContent.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) description = sanitizeDescription(pMatch[1]);
    }

    models.push({
      id: modelId,
      name,
      description
    });
  }

  return models;
}

function extractModelDetail(html) {
  // Extract pull count from x-test-pull-count span
  const pullCountMatch = html.match(/<span[^>]*\s+(?:data-)?x-test-pull-count[^>]*>([\s\S]*?)<\/span>/i);
  const pullCountRaw = pullCountMatch ? pullCountMatch[1].trim() : '0';

  // Extract README from #display div
  const displayMatch = html.match(/<div[^>]*id=["']display["'][^>]*>([\s\S]*?)<\/div>/i);
  let readme = displayMatch ? displayMatch[1].trim() : '';

  // Strip all class attributes from README html as requested
  readme = readme.replace(/\s+class=["'][^"']*["']/gi, '');

  return {
    pullCount: parsePullCount(pullCountRaw),
    readme
  };
}

function extractTags(html) {
  if (!html) return [];
  const submodels = [];

  // Each tag block is in a "group px-4 py-3" div
  const blocks = html.split(/<div[^>]*class=["']group px-4 py-3["'][^>]*>/i).slice(1);

  for (const block of blocks) {
    // End of block is usually the end of the div or start of next block. 
    // Since we split by the start, we just take the content.
    
    const tagLinkMatch = block.match(/<a[^>]*href=["']\/library\/([^"']+)["'][^>]*>/i);
    if (!tagLinkMatch) continue;
    const fullTag = tagLinkMatch[1];

    const tagNameMatch = block.match(/<span[^>]*class=["']group-hover:underline["'][^>]*>([\s\S]*?)<\/span>/i);
    const tagName = tagNameMatch ? tagNameMatch[1].trim() : fullTag.split(':')[1] || 'latest';

    // Extract Size (usually first col-span-2 p)
    const sizeMatch = block.match(/<p[^>]*col-span-2[^>]*>([\d.]+\s*(?:GB|MB|KB|B))<\/p>/i);

    // Extract Context (usually second col-span-2 p)
    const contextMatch = block.match(/<p[^>]*col-span-2[^>]*>([\d.]+[KkMm]?)<\/p>/i);

    // Extract Input Type (usually a div with col-span-2)
    const inputMatch = block.match(/<div[^>]*col-span-2[^>]*>([\s\S]*?)<\/div>/i);

    submodels.push({
      id: fullTag,
      name: tagName,
      size: sizeMatch ? sizeMatch[1].trim() : '',
      contextWindow: contextMatch ? contextMatch[1].trim() : '',
      inputType: inputMatch ? sanitizeDescription(inputMatch[1]) : ''
    });
  }

  return submodels;
}

async function buildSnapshot() {
  console.log(`Fetching library index from ${OLLAMA_LIBRARY}...`);
  const libraryHtml = await httpGet(OLLAMA_LIBRARY);
  if (!libraryHtml) throw new Error('Failed to fetch library index');

  const skeletonModels = extractModelsFromLibrary(libraryHtml);
  console.log(`Found ${skeletonModels.length} models. Fetching details and tags...`);

  const models = [];

  for (const item of skeletonModels) {
    const detailUrl = `${OLLAMA_LIBRARY}/${item.id}`;
    const tagsUrl = `${OLLAMA_LIBRARY}/${item.id}/tags`;

    try {
      const [detailHtml, tagsHtml] = await Promise.all([
        httpGet(detailUrl),
        httpGet(tagsUrl)
      ]);

      const detailInfo = detailHtml ? extractModelDetail(detailHtml) : { pullCount: 0, readme: '' };
      const submodels = tagsHtml ? extractTags(tagsHtml) : [];

      models.push({
        id: item.id,
        slug: `ollama-${slugify(item.id)}`,
        name: item.name,
        description: item.description,
        readme: detailInfo.readme,
        pullCount: detailInfo.pullCount,
        submodels: submodels,
        provider: 'ollama',
        sourceUrl: detailUrl,
        author: 'ollama' // Default author for library models
      });

      console.log(`  [OK] ${item.id} (${detailInfo.pullCount} pulls, ${submodels.length} tags)`);
      
      // Delay to be polite to Ollama servers
      await delay(200);
    } catch (err) {
      console.warn(`  [FAILED] ${item.id}: ${err.message}`);
      // Add skeleton at least
      models.push({
        ...item,
        slug: `ollama-${slugify(item.id)}`,
        provider: 'ollama',
        sourceUrl: detailUrl,
        author: 'ollama',
        pullCount: 0,
        submodels: []
      });
    }
  }

  return {
    source: 'ollama',
    generatedAt: new Date().toISOString(),
    total: models.length,
    models: models.sort((a, b) => b.pullCount - a.pullCount) // Sort by popularity by default
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

async function main() {
  const newSnapshot = await buildSnapshot();
  const oldSnapshot = await readExistingSnapshot();

  // Basic check for changes (ignoring generatedAt)
  const isChanged = !oldSnapshot || 
    newSnapshot.total !== oldSnapshot.total ||
    JSON.stringify(newSnapshot.models) !== JSON.stringify(oldSnapshot.models);

  if (isChanged) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(newSnapshot, null, 2)}\n`, 'utf8');
    console.log(`Updated ${outputPath} with ${newSnapshot.total} models.`);
  } else {
    console.log('No significant changes detected. Skipping update.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

