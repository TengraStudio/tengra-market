#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_AGENT = 'tengra-market-ollama-scraper/1.0';
const OLLAMA_BASE = 'https://ollama.com';
const OLLAMA_LIBRARY = `${OLLAMA_BASE}/library`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'models', 'ollama-models.json');

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model';
}

function decodeHtmlEntities(text) {
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

async function httpGet(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.text();
}

function extractModelNames(libraryHtml) {
  const regex = /href="\/library\/([^"]+)"/g;
  const names = new Set();

  for (const match of libraryHtml.matchAll(regex)) {
    const candidate = (match[1] ?? '').trim();
    if (!candidate || candidate.includes('/') || candidate.includes('?') || candidate.includes('#')) {
      continue;
    }
    names.add(candidate);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function extractMetaDescription(html) {
  const match = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  return sanitizeDescription(match?.[1] ?? '');
}

function extractTitle(html, fallbackName) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  return title || fallbackName;
}

async function buildSnapshot() {
  const libraryHtml = await httpGet(OLLAMA_LIBRARY);
  const modelNames = extractModelNames(libraryHtml);
  const models = [];

  for (const modelName of modelNames) {
    const detailUrl = `${OLLAMA_LIBRARY}/${encodeURIComponent(modelName)}`;
    let detailHtml = '';

    try {
      detailHtml = await httpGet(detailUrl);
    } catch {
      detailHtml = '';
    }

    models.push({
      id: modelName,
      slug: `ollama-${slugify(modelName)}`,
      name: extractTitle(detailHtml, modelName),
      description: extractMetaDescription(detailHtml),
      provider: 'ollama',
      sourceUrl: `${OLLAMA_BASE}/library/${modelName}`
    });
  }

  return {
    source: 'ollama',
    generatedAt: new Date().toISOString(),
    total: models.length,
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
    source: snapshot.source ?? 'ollama',
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

  if (changed) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(newSnapshot, null, 2)}\n`, 'utf8');
    console.log(`Updated ${outputPath} with ${newSnapshot.total} models.`);
    process.exitCode = 0;
    return;
  }

  console.log('No model changes detected. Skipping JSON update.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
