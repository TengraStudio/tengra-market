import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PLUGIN_ID = process.env.TENGRA_MCP_PLUGIN_ID || '';
const STORAGE_PATH = process.env.TENGRA_MCP_STORAGE_PATH || path.join(os.tmpdir(), 'tengra-mcp-storage');
const MAX_TEXT = 20000;
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 30000;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : fallback;
}

function asPositiveInteger(value, fallback, max) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function truncateText(value) {
  return String(value || '').slice(0, MAX_TEXT);
}

function parseJsonLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

function validateHost(value) {
  const host = asString(value).toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.endsWith('.')) {
    throw new Error('Invalid host or domain.');
  }
  return host;
}

function validatePath(value) {
  const candidate = asString(value);
  if (!candidate) {
    return process.cwd();
  }
  return path.resolve(candidate);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runCommand(command, args, options = {}) {
  const timeout = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ? validatePath(options.cwd) : process.cwd();
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return {
      success: true,
      command,
      args,
      cwd,
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr),
    };
  } catch (error) {
    return {
      success: false,
      command,
      args,
      cwd,
      error: error instanceof Error ? error.message : String(error),
      stdout: truncateText(error?.stdout),
      stderr: truncateText(error?.stderr),
    };
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  return truncateText(await response.text());
}

function validateHttpUrl(value) {
  const url = new URL(asString(value));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  return url.toString();
}

const weatherActions = {
  forecast: async args => {
    const location = encodeURIComponent(asString(args.location));
    return fetchJson(`https://wttr.in/${location}?format=j1`);
  },
};

const webActions = {
  search: async args => {
    const query = asString(args.query);
    if (!query) {
      throw new Error('Search query is required.');
    }
    const count = asPositiveInteger(args.count, 5, MAX_RESULTS);
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const data = await fetchJson(url);
    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics.slice(0, count) : [];
    return {
      query,
      heading: data.Heading || '',
      abstract: data.AbstractText || '',
      abstractUrl: data.AbstractURL || '',
      results: related.map(item => ({
        text: item.Text || '',
        url: item.FirstURL || '',
      })),
    };
  },
  read_page: async args => {
    return {
      url: validateHttpUrl(args.url),
      content: await fetchText(validateHttpUrl(args.url)),
    };
  },
  fetch_json: async args => {
    const url = validateHttpUrl(args.url);
    return {
      url,
      data: await fetchJson(url),
    };
  },
};

const networkActions = {
  ping: async args => {
    const host = validateHost(args.host);
    const commandArgs = process.platform === 'win32' ? ['-n', '4', host] : ['-c', '4', host];
    return runCommand('ping', commandArgs, { timeoutMs: 30000 });
  },
  traceroute: async args => {
    const host = validateHost(args.host);
    const command = process.platform === 'win32' ? 'tracert' : 'traceroute';
    return runCommand(command, [host], { timeoutMs: 60000 });
  },
  whois: async args => {
    return runCommand('whois', [validateHost(args.domain)], { timeoutMs: 30000 });
  },
};

const dockerActions = {
  listContainers: async () => {
    const result = await runCommand('docker', ['ps', '-a', '--format', '{{json .}}'], { timeoutMs: 30000 });
    return { ...result, containers: result.success ? parseJsonLines(result.stdout) : [] };
  },
  stats: async () => {
    const result = await runCommand('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeoutMs: 30000 });
    return { ...result, stats: result.success ? parseJsonLines(result.stdout) : [] };
  },
  listImages: async () => {
    const result = await runCommand('docker', ['images', '--format', '{{json .}}'], { timeoutMs: 30000 });
    return { ...result, images: result.success ? parseJsonLines(result.stdout) : [] };
  },
};

const gitActions = {
  status: async args => runCommand('git', ['status', '--short', '--branch'], { cwd: args.cwd || args.repoPath, timeoutMs: 30000 }),
  diff: async args => runCommand('git', ['diff', '--', asString(args.pathspec, '.')], { cwd: args.cwd || args.repoPath, timeoutMs: 30000 }),
  log: async args => runCommand('git', ['log', '--oneline', '-n', String(asPositiveInteger(args.limit, 20, 100))], { cwd: args.cwd || args.repoPath, timeoutMs: 30000 }),
  branches: async args => runCommand('git', ['branch', '--all'], { cwd: args.cwd || args.repoPath, timeoutMs: 30000 }),
};

async function readMemoryStore() {
  await fs.mkdir(STORAGE_PATH, { recursive: true });
  const filePath = path.join(STORAGE_PATH, 'memory.json');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return [];
  }
}

async function writeMemoryStore(records) {
  await fs.mkdir(STORAGE_PATH, { recursive: true });
  await fs.writeFile(path.join(STORAGE_PATH, 'memory.json'), JSON.stringify(records, null, 2), 'utf8');
}

const memoryActions = {
  remember: async args => {
    const content = asString(args.content);
    if (!content) {
      throw new Error('Memory content is required.');
    }
    const records = await readMemoryStore();
    const record = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      tags: Array.isArray(args.tags) ? args.tags.map(tag => asString(tag)).filter(Boolean).slice(0, 20) : [],
      createdAt: new Date().toISOString(),
    };
    records.push(record);
    await writeMemoryStore(records.slice(-1000));
    return record;
  },
  recall: async args => {
    const query = asString(args.query).toLowerCase();
    const limit = asPositiveInteger(args.limit, 10, 50);
    const records = await readMemoryStore();
    const matches = query
      ? records.filter(record => `${record.content} ${(record.tags || []).join(' ')}`.toLowerCase().includes(query))
      : records;
    return { query, results: matches.slice(-limit).reverse() };
  },
  forget: async args => {
    const id = asString(args.id);
    if (!id) {
      throw new Error('Memory id is required.');
    }
    const records = await readMemoryStore();
    const nextRecords = records.filter(record => record.id !== id);
    await writeMemoryStore(nextRecords);
    return { id, removed: records.length - nextRecords.length };
  },
};

const screenshotActions = {
  capture: async args => {
    if (process.platform !== 'win32') {
      throw new Error('Screenshot capture is currently supported on Windows only.');
    }
    await fs.mkdir(STORAGE_PATH, { recursive: true });
    const outputPath = path.resolve(asString(args.outputPath, path.join(STORAGE_PATH, `screenshot-${Date.now()}.png`)));
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      `$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds`,
      `$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height`,
      `$graphics = [System.Drawing.Graphics]::FromImage($bitmap)`,
      `$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)`,
      `$bitmap.Save(${psQuote(outputPath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$graphics.Dispose()',
      '$bitmap.Dispose()',
    ].join('; ');
    const result = await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 30000 });
    return { ...result, outputPath };
  },
};

async function readSshConnections() {
  await fs.mkdir(STORAGE_PATH, { recursive: true });
  const filePath = path.join(STORAGE_PATH, 'ssh-connections.json');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return [];
  }
}

async function writeSshConnections(records) {
  await fs.mkdir(STORAGE_PATH, { recursive: true });
  await fs.writeFile(path.join(STORAGE_PATH, 'ssh-connections.json'), JSON.stringify(records, null, 2), 'utf8');
}

function buildSshTarget(connection) {
  const host = validateHost(connection.host);
  const username = asString(connection.username);
  return username ? `${username}@${host}` : host;
}

const sshActions = {
  connect: async args => {
    const connection = {
      id: asString(args.connectionId, `ssh-${Date.now()}`),
      host: validateHost(args.host),
      username: asString(args.username),
      port: asPositiveInteger(args.port, 22, 65535),
      createdAt: new Date().toISOString(),
    };
    const records = (await readSshConnections()).filter(record => record.id !== connection.id);
    records.push(connection);
    await writeSshConnections(records);
    return { success: true, connectionId: connection.id, host: connection.host, username: connection.username, port: connection.port };
  },
  execute: async args => {
    const records = await readSshConnections();
    const stored = records.find(record => record.id === asString(args.connectionId));
    const connection = stored || {
      host: args.host,
      username: args.username,
      port: args.port,
    };
    const command = asString(args.command);
    if (!command) {
      throw new Error('SSH command is required.');
    }
    const sshArgs = ['-p', String(asPositiveInteger(connection.port, 22, 65535)), buildSshTarget(connection), command];
    return runCommand('ssh', sshArgs, { timeoutMs: 60000 });
  },
  disconnect: async args => {
    const id = asString(args.connectionId);
    const records = await readSshConnections();
    const nextRecords = records.filter(record => record.id !== id);
    await writeSshConnections(nextRecords);
    return { success: true, connectionId: id, removed: records.length - nextRecords.length };
  },
};

const ACTION_GROUPS = {
  'tengra-weather': weatherActions,
  'tengra-web': webActions,
  'tengra-network': networkActions,
  'tengra-docker': dockerActions,
  'tengra-git': gitActions,
  'tengra-memory': memoryActions,
  'tengra-screenshot': screenshotActions,
  'tengra-ssh': sshActions,
};

async function callTool(name, rawArgs) {
  const actions = ACTION_GROUPS[PLUGIN_ID];
  if (!actions) {
    throw new Error(`Unknown Tengra MCP plugin id: ${PLUGIN_ID}`);
  }
  const action = actions[name];
  if (!action) {
    throw new Error(`Unknown tool for ${PLUGIN_ID}: ${name}`);
  }
  return action(asObject(rawArgs));
}

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify(result),
      }],
    },
  })}\n`);
}

function sendError(id, error) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  })}\n`);
}

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

reader.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  void (async () => {
    try {
      const request = JSON.parse(trimmed);
      const params = asObject(request.params);
      if (request.method !== 'tools/call') {
        throw new Error(`Unsupported JSON-RPC method: ${request.method}`);
      }
      const result = await callTool(asString(params.name), params.arguments);
      sendResponse(request.id, result);
    } catch (error) {
      let id = 'unknown';
      try {
        id = JSON.parse(trimmed).id || id;
      } catch {
        id = 'parse-error';
      }
      sendError(id, error);
    }
  })();
});
