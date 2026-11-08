// Pure helpers over a list of checks: [{ t: epoch ms, ok: boolean, ms: number }], oldest first.

export function append(entries, entry, keep = 4032) {
  const next = [...entries, entry];
  return next.length > keep ? next.slice(next.length - keep) : next;
}

// Share of successful checks inside the window, as a percentage with one decimal. null when there is no data.
export function uptime(entries, windowMs, now = Date.now()) {
  const inWindow = entries.filter((e) => e.t >= now - windowMs);
  if (!inWindow.length) return null;
  const up = inWindow.filter((e) => e.ok).length;
  return Math.round((up / inWindow.length) * 1000) / 10;
}

// Consecutive failed checks form one incident. An open incident has endedAt: null.
// Each incident is bounded by the surrounding checks, so its duration is an estimate at check resolution.
export function incidents(entries) {
  const out = [];
  let open = null;
  for (const e of entries) {
    if (!e.ok && !open) open = { startedAt: e.t, endedAt: null, checks: 1 };
    else if (!e.ok && open) open.checks++;
    else if (e.ok && open) {
      open.endedAt = e.t;
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out.map((i) => ({ ...i, durationMs: (i.endedAt ?? Date.now()) - i.startedAt }));
}

export function avgLatency(entries, n = 20) {
  const ok = entries.filter((e) => e.ok).slice(-n);
  return ok.length ? Math.round(ok.reduce((s, e) => s + e.ms, 0) / ok.length) : null;
}
