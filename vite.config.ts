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
  const file = path.join(dir, 'breach-logs.jsonl');
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
            fs.appendFileSync(file, body.trim() + '\n');
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
