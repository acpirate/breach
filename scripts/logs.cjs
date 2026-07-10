// MK4.3 server-side log commands:
//   npm run logs:dump  -> pretty-print logs/breach-logs.jsonl to logs/breach-logs.txt
//   npm run logs:wipe  -> delete the server-side log files
// (Browser-side localStorage logs are wiped from the app console: breachWipe())

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'logs');
const src = path.join(dir, 'breach-logs.jsonl');
const out = path.join(dir, 'breach-logs.txt');
const cmd = process.argv[2];

if (cmd === 'wipe') {
  let n = 0;
  for (const f of [src, out]) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      n++;
    }
  }
  console.log(n ? `wiped ${n} server log file(s) in ${dir}` : 'no server log files to wipe');
  console.log('note: browser-side logs are wiped from the app console with breachWipe()');
  process.exit(0);
}

if (cmd !== 'dump') {
  console.log('usage: node scripts/logs.cjs dump|wipe');
  process.exit(1);
}

if (!fs.existsSync(src)) {
  console.log(`no server log file at ${src} — play some battles with the dev server running`);
  process.exit(0);
}

const lines = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
const outLines = [];
let metrics = 0;
let turns = 0;
let bad = 0;

for (const line of lines) {
  try {
    const { kind, at, entry } = JSON.parse(line);
    if (kind === 'metrics') {
      metrics++;
      outLines.push(
        `[${at}] === BATTLE ${entry.battleId} (v=${entry.v}) scenario=${entry.scenario} winner=${entry.winner} turns=${entry.metrics.turns} ===`,
      );
      outLines.push(`  metrics: ${JSON.stringify(entry.metrics)}`);
    } else if (kind === 'turn') {
      turns++;
      outLines.push(
        `[${at}] turn ${entry.turn} (${entry.battleId} v=${entry.v})${entry.result ? `  RESULT: ${entry.result} wins` : ''}`,
      );
      if (entry.actions.length) outLines.push(`  actions: ${entry.actions.join('; ')}`);
      outLines.push(
        `  dmg P:${entry.damage.player.total} E:${entry.damage.enemy.total}  hp P:${entry.hpAfter.player} E:${entry.hpAfter.enemy}  detonations:${entry.detonations} reshuffles:${entry.reshuffles}`,
      );
      outLines.push(
        `  charges P:[${entry.chargesAfter.player}] E:[${entry.chargesAfter.enemy}] shake:${entry.chargesAfter.shake}`,
      );
    } else {
      bad++;
    }
  } catch {
    bad++;
  }
}

fs.writeFileSync(out, outLines.join('\n') + '\n');
console.log(`dumped ${metrics} battle-metrics + ${turns} turn entries${bad ? ` (${bad} unparsable)` : ''} -> ${out}`);
