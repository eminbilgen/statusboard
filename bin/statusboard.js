#!/usr/bin/env node
import { runAndWrite } from '../src/run.js';

const HELP = `statusboard - self-hosted status page monitor

Usage:
  statusboard run [--config <file>] [--out <dir>]

Probes every target in the config once, appends to <dir>/history.json and writes <dir>/status.json.
Run it from cron (every 5 minutes works well) and serve <dir> plus index.html as static files.

Options:
  --config <file>   Config file (default: statusboard.config.json)
  --out <dir>       Output directory (default: public)
  --quiet           No output unless something is down
  -h, --help        Show this help
`;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes('-h') || args.includes('--help') || args[0] !== 'run') {
  console.log(HELP);
  process.exit(args[0] === 'run' || args.includes('-h') || args.includes('--help') ? 0 : 1);
}

try {
  const status = await runAndWrite(opt('--config', 'statusboard.config.json'), opt('--out', 'public'));
  const down = status.targets.filter((t) => !t.ok);
  if (!args.includes('--quiet') || down.length) {
    for (const t of status.targets) console.log(`${t.ok ? 'UP  ' : 'DOWN'} ${t.name.padEnd(20)} ${String(t.ms).padStart(5)} ms${t.error ? `  ${t.error}` : ''}${t.tlsDays != null ? `  tls ${t.tlsDays}d` : ''}`);
  }
  process.exit(down.length ? 1 : 0);
} catch (err) {
  console.error(`statusboard: ${err.message}`);
  process.exit(2);
}
