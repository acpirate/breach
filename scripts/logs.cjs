// MK4.3/MK6.8 server-side log commands:
//   npm run logs:dump  -> pretty-print all logs/breach-logs*.jsonl (date order)
//                         to logs/breach-logs.txt — LOSSLESSLY: version,
//                         config, contention, timing, and buffer fields are
//                         all included (the MK5-era formatter stripped them;
//                         the raw JSONL was always complete)
//   npm run logs:wipe  -> delete the server-side log files
// (Browser-side localStorage logs are wiped from the app console: breachWipe())

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'logs');
const out = path.join(dir, 'breach-logs.txt');
const cmd = process.argv[2];

function logFiles() {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^breach-logs.*\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

if (cmd === 'wipe') {
  let n = 0;
  for (const f of [...logFiles(), out]) {
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

const files = logFiles();
if (!files.length) {
  console.log(`no server log files in ${dir} — play some battles with the dev server running`);
  process.exit(0);
}

const cfgStr = (c) =>
  c
    ? `cfg[em:${c.enemyMatching ? 1 : 0} hb:${c.hackerBonusEnabled ? 1 : 0} sa:${c.singleAxisPayout ? 1 : 0} nmd:${c.noMatchDamage ? 1 : 0} cap:${c.maxCascadeSteps === null ? 'inf' : c.maxCascadeSteps} hp:${c.playerHp ?? '?'}v${c.enemyHp ?? '?'}]`
    : 'cfg[missing]';

const outLines = [];
let metrics = 0;
let turns = 0;
let bad = 0;

for (const file of files) {
  outLines.push(`===== ${path.basename(file)} =====`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const { kind, at, entry } = JSON.parse(line);
      if (kind === 'metrics') {
        metrics++;
        outLines.push(
          `[${at}] === BATTLE ${entry.battleId} v=${entry.v} ${cfgStr(entry.config)} winner=${entry.winner} turns=${entry.metrics.turns}` +
            `${entry.wallClockMs !== undefined ? ` wallClock=${(entry.wallClockMs / 1000).toFixed(0)}s` : ''} ===`,
        );
        for (const side of ['player', 'enemy']) {
          const s = entry.metrics.sides[side];
          outLines.push(
            `  ${side}: dmg ${s.totalDamage} (match ${s.matchDamage}, atk ${s.attackerDamage}, bomb ${s.bombDamage})` +
              ` critExtra ${s.critExtra} bufferAdded ${s.bufferDamageAdded ?? 0}` +
              ` contention ${s.contentionTiles ?? 0}/${s.tilesDestroyed ?? 0} largestHit ${s.largestHit} deepestCascade ${s.deepestCascade}`,
          );
          for (const [t, u] of Object.entries(s.units)) {
            outLines.push(`    ${t}: fires ${u.fires}, effect ${u.effect}, chargeWasted ${u.chargeWasted}`);
          }
        }
        if (entry.metrics.thinkTimesMs?.length) {
          outLines.push(`  thinkTimesMs (raw): [${entry.metrics.thinkTimesMs.join(', ')}]`);
        }
      } else if (kind === 'turn') {
        turns++;
        outLines.push(
          `[${at}] turn ${entry.turn} (${entry.battleId} v=${entry.v} ${cfgStr(entry.config)})` +
            `${entry.thinkMs !== undefined ? ` think=${(entry.thinkMs / 1000).toFixed(1)}s` : ''}` +
            `${entry.result ? `  RESULT: ${entry.result} wins` : ''}`,
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
}

fs.writeFileSync(out, outLines.join('\n') + '\n');
console.log(
  `dumped ${metrics} battle-metrics + ${turns} turn entries from ${files.length} file(s)${bad ? ` (${bad} unparsable)` : ''} -> ${out}`,
);
