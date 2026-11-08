import tls from 'node:tls';

// One HTTP probe. Never throws: every failure becomes { ok: false, error }.
// target: { url, method?, expect?: [min, max], keyword? }
export async function checkHttp(target, { timeout = 10000, fetchImpl = fetch } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetchImpl(target.url, {
      method: target.method || 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'statusboard/0.1 (+https://github.com/eminbilgen/statusboard)' },
    });
    const [min, max] = target.expect || [200, 399];
    const statusOk = res.status >= min && res.status <= max;
    let keywordOk = true;
    if (target.keyword) keywordOk = (await res.text()).includes(target.keyword);
    else await res.body?.cancel?.().catch(() => {});
    const ms = Math.round(performance.now() - started);
    const error = !statusOk ? `HTTP ${res.status}` : !keywordOk ? 'keyword not found' : null;
    return { ok: statusOk && keywordOk, status: res.status, ms, error };
  } catch (err) {
    const error = err.name === 'AbortError' ? 'timeout' : err.cause?.code || err.message;
    return { ok: false, status: null, ms: Math.round(performance.now() - started), error };
  } finally {
    clearTimeout(timer);
  }
}

// Days until the TLS certificate served on host:port expires, or null when it cannot be read.
export function tlsDaysLeft(host, port = 443, timeout = 8000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert && cert.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}
