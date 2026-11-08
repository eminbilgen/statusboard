# statusboard

A self-hosted status page in two small parts: a Node script that probes your URLs and writes JSON, and a static page that renders it. No database, no framework, no dependencies.

- **Per service:** up/down, response time, TLS certificate expiry, 24 h and 7 d uptime, and a strip of the last 90 checks (bar height is latency, red is a failure).
- **Incidents:** consecutive failed checks are grouped into incidents, open ones shown as ongoing.
- **Honest about itself:** if the monitor stops reporting, the page says so instead of showing stale green.
- Node 18 or newer.

## Quick start

```bash
git clone https://github.com/eminbilgen/statusboard
cd statusboard
cp statusboard.config.example.json statusboard.config.json   # edit your targets
node bin/statusboard.js run                                   # writes public/status.json + history.json
```

Serve the `public/` folder with any static web server (`index.html` reads `status.json` next to it). Then run the monitor on a schedule, for example every five minutes from cron:

```cron
*/5 * * * * cd /path/to/statusboard && node bin/statusboard.js run --quiet
```

`--quiet` prints only when something is down; the exit code is 1 when any target is down, 0 otherwise.

## Config

```json
{
  "title": "bilgen.dev status",
  "timeoutMs": 10000,
  "keep": 4032,
  "intervalMin": 5,
  "targets": [
    { "id": "site", "name": "Website", "url": "https://example.com/" },
    { "id": "api", "name": "API", "url": "https://example.com/health", "keyword": "ok" },
    { "id": "internal", "name": "Admin", "url": "https://admin.example.com/", "expect": [200, 403], "public": false }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique key; history is stored per id. |
| `url` | Probed with GET, redirects followed. |
| `expect` | Accepted status range, default `[200, 399]`. |
| `keyword` | The response body must contain this text, so a "200 with an error page" counts as down. |
| `public` | `false` hides the URL on the page (the name and state still show). |
| `keep` | Checks kept per target. 4032 is two weeks at five-minute intervals. |
| `intervalMin` | Used only to decide when the page should warn that the monitor went quiet. |

## Files it writes

- `public/status.json`: what the page renders. Safe to publish.
- `public/history.json`: the raw check history. It contains nothing secret, but you can block it in your web server if you prefer.

Both are written atomically, so a request never sees half a file.

## Limits

- **It probes from where it runs.** If you run it on the same server it monitors, a full outage of that server stops the monitor too; the page then shows the "monitor has not reported" warning, which is the correct signal, but it cannot tell you why. For an independent view, run it from a second machine.
- Uptime is the share of successful checks, not a contractual SLA. Incident durations are estimates at check resolution.
- One location, one probe per interval. No alerting is built in; use the exit code in a script if you want mail or chat notifications.

## Development

```bash
npm test
```

The tests use a local HTTP server and in-memory data, so they run offline.

## License

MIT, see [LICENSE](LICENSE).
