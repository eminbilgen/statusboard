import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHttp } from '../src/check.js';
import { append, uptime, incidents, avgLatency } from '../src/history.js';
import { runOnce, runAndWrite } from '../src/run.js';

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

test('checkHttp: 200 is up, 500 is down, keyword is enforced', async () => {
  const { s, url } = await server((req, res) => {
    if (req.url === '/ok') return res.end('hello world');
    if (req.url === '/redirect') return res.writeHead(302, { location: '/ok' }).end();
    res.writeHead(500).end('boom');
  });
  try {
    const ok = await checkHttp({ url: `${url}/ok` });
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.equal((await checkHttp({ url: `${url}/redirect` })).ok, true);
    const bad = await checkHttp({ url: `${url}/boom` });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'HTTP 500');
    assert.equal((await checkHttp({ url: `${url}/ok`, keyword: 'hello' })).ok, true);
    const missing = await checkHttp({ url: `${url}/ok`, keyword: 'absent' });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'keyword not found');
    assert.equal((await checkHttp({ url: `${url}/boom`, expect: [500, 500] })).ok, true);
  } finally {
    s.close();
  }
});

test('checkHttp: timeout and refused connection are reported, never thrown', async () => {
  const { s, url } = await server(() => {}); // never answers
  try {
    const slow = await checkHttp({ url }, { timeout: 150 });
    assert.equal(slow.ok, false);
    assert.equal(slow.error, 'timeout');
  } finally {
    s.closeAllConnections?.();
    s.close();
  }
  const refused = await checkHttp({ url: 'http://127.0.0.1:1' });
  assert.equal(refused.ok, false);
  assert.ok(refused.error);
});

test('history: append caps length, uptime respects the window', () => {
  let h = [];
  for (let i = 0; i < 10; i++) h = append(h, { t: i * 1000, ok: i !== 3, ms: 100 }, 5);
  assert.equal(h.length, 5);
  assert.equal(uptime([{ t: 0, ok: true }, { t: 1, ok: false }, { t: 2, ok: true }, { t: 3, ok: true }], 10, 5), 75);
  assert.equal(uptime([{ t: 0, ok: true }], 10, 1000), null);
});

test('history: consecutive failures make one incident, open ones stay open', () => {
  const e = [
    { t: 0, ok: true }, { t: 10, ok: false }, { t: 20, ok: false }, { t: 30, ok: true },
    { t: 40, ok: false },
  ];
  const inc = incidents(e);
  assert.equal(inc.length, 2);
  assert.deepEqual([inc[0].startedAt, inc[0].endedAt, inc[0].checks], [10, 30, 2]);
  assert.equal(inc[1].endedAt, null);
  assert.equal(incidents([{ t: 0, ok: true }]).length, 0);
});

test('history: avgLatency ignores failures', () => {
  assert.equal(avgLatency([{ ok: true, ms: 100 }, { ok: false, ms: 9999 }, { ok: true, ms: 300 }]), 200);
  assert.equal(avgLatency([]), null);
});

test('runOnce builds the status document and extends history', async () => {
  const config = { title: 'T', targets: [{ id: 'a', name: 'A', url: 'https://a.test/' }, { id: 'b', url: 'http://b.test/', public: false }] };
  const probe = async (t) => (t.id === 'a' ? { ok: true, status: 200, ms: 120, error: null } : { ok: false, status: null, ms: 10, error: 'timeout' });
  const tlsProbe = async () => 40;
  const first = await runOnce(config, {}, { now: 1000, probe, tlsProbe });
  assert.deepEqual(first.status.summary, { up: 1, total: 2 });
  assert.equal(first.status.targets[0].tlsDays, 40);
  assert.equal(first.status.targets[1].tlsDays, null); // plain http: no TLS probe
  assert.equal(first.status.targets[1].url, null); // public:false hides the URL
  const second = await runOnce(config, first.history, { now: 2000, probe, tlsProbe });
  assert.equal(second.history.a.length, 2);
  assert.equal(second.status.targets[1].incidents[0].endedAt, null);
});

test('runAndWrite validates the config and writes both JSON files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-'));
  const { s, url } = await server((req, res) => res.end('ok'));
  try {
    const cfg = join(dir, 'c.json');
    await writeFile(cfg, JSON.stringify({ targets: [{ id: 'x', url }] }));
    const status = await runAndWrite(cfg, join(dir, 'out'));
    assert.equal(status.summary.up, 1);
    assert.equal(JSON.parse(await readFile(join(dir, 'out', 'status.json'), 'utf8')).targets[0].id, 'x');
    assert.equal(JSON.parse(await readFile(join(dir, 'out', 'history.json'), 'utf8')).x.length, 1);
    await writeFile(cfg, JSON.stringify({ targets: [{ id: 'x', url }, { id: 'x', url }] }));
    await assert.rejects(runAndWrite(cfg, join(dir, 'out')), /Duplicate/);
    await writeFile(cfg, JSON.stringify({ targets: [] }));
    await assert.rejects(runAndWrite(cfg, join(dir, 'out')), /No targets/);
  } finally {
    s.close();
  }
});
