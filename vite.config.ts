// Dev-server config. The breach-log-sink plugin is MK4.3 tooling: in dev, the
// app POSTs each log entry to /__breach/log and this middleware appends it as
// a JSON line to logs/breach-logs.jsonl on the dev machine — which also
// captures entries from a phone playing over the LAN, whose localStorage
// would otherwise be unreachable. Dump/wipe via `npm run logs:dump` /
// `npm run logs:wipe`. Dev-only; production builds have no sink.

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';

function breachLogSink(): Plugin {
  const dir = path.resolve(process.cwd(), 'logs');
  // MK6.8b: date-stamped files — a new file rolls automatically on a new day
  // (a day/session tends to be one experiment, so it becomes the natural
  // unit of analysis). Computed per write, which also covers a dev server
  // left running across midnight.
  const fileForToday = (): string => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return path.join(dir, `breach-logs-${stamp}.jsonl`);
  };
  return {
    name: 'breach-log-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__breach/log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c: Buffer) => {
          body += c.toString();
        });
        req.on('end', () => {
          try {
            JSON.parse(body); // only append well-formed lines
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(fileForToday(), body.trim() + '\n');
            res.end('ok');
          } catch {
            res.statusCode = 400;
            res.end();
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [breachLogSink()],
});
