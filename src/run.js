import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { checkHttp, tlsDaysLeft } from './check.js';
import { append, uptime, incidents, avgLatency } from './history.js';

const DAY = 86400000;

export async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// Writes atomically so a page request never reads a half-written file.
async function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, path);
}

// Probes every target once, updates history and returns the public status document.
export async function runOnce(config, history, { now = Date.now(), probe = checkHttp, tlsProbe = tlsDaysLeft } = {}) {
  const keep = config.keep || 4032;
  const results = await Promise.all(
    config.targets.map(async (target) => {
      const r = await probe(target, { timeout: config.timeoutMs || 10000 });
      const url = new URL(target.url);
      const tlsDays = url.protocol === 'https:' ? await tlsProbe(url.hostname, Number(url.port) || 443) : null;
      return { target, r, tlsDays };
    }),
  );
  const nextHistory = { ...history };
  const targets = results.map(({ target, r, tlsDays }) => {
    const id = target.id;
    const entries = append(nextHistory[id] || [], { t: now, ok: r.ok, ms: r.ms }, keep);
    nextHistory[id] = entries;
    return {
      id,
      name: target.name || id,
      url: target.public === false ? null : target.url,
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      error: r.error,
      tlsDays,
      avgMs: avgLatency(entries),
      uptime24h: uptime(entries, DAY, now),
      uptime7d: uptime(entries, 7 * DAY, now),
      recent: entries.slice(-90),
      incidents: incidents(entries).slice(-5).reverse(),
    };
  });
  const status = {
    title: config.title || 'Status',
    generatedAt: now,
    intervalMin: config.intervalMin || 5,
    summary: { up: targets.filter((t) => t.ok).length, total: targets.length },
    targets,
  };
  return { status, history: nextHistory };
}

export async function runAndWrite(configPath, outDir, opts = {}) {
  const config = await loadJson(configPath, null);
  if (!config || !Array.isArray(config.targets) || !config.targets.length) throw new Error(`No targets in ${configPath}`);
  const ids = new Set();
  for (const t of config.targets) {
    if (!t.id || !t.url) throw new Error('Every target needs an id and a url.');
    if (ids.has(t.id)) throw new Error(`Duplicate target id "${t.id}".`);
    ids.add(t.id);
  }
  await mkdir(outDir, { recursive: true });
  const history = await loadJson(join(outDir, 'history.json'), {});
  const { status, history: next } = await runOnce(config, history, opts);
  await writeJson(join(outDir, 'history.json'), next);
  await writeJson(join(outDir, 'status.json'), status);
  return status;
}
