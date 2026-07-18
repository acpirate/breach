// MK4.3/MK6.8/MK9.6 server-side log commands:
//   npm run logs:dump  -> APPEND a readable session block to logs/breach-logs.txt
//                         from all logs/breach-logs*.jsonl (lossless: version,
//                         config incl. per-side strong bindings, shield & bomb
//                         metrics, timing). Cumulative across sessions with a
//                         separator and session metadata; re-running with no new
//                         events is a no-op (retry-safe dedup by content hash).
//   npm run logs:wipe  -> delete ONLY the raw .jsonl files. The readable dump
//                         (breach-logs.txt) and all unrelated files are PRESERVED
//                         (MK9.6).
// Storage protection (MK9.6/9.7): before appending a dump, if the filesystem
// holding logs/ is over LOG_STORAGE_THRESHOLD, the dump is suppressed and the
// dump file's content is replaced with the exact sentinel line. Bounded/safe:
// re-running while over threshold does not grow storage.
// (Browser-side localStorage logs are wiped from the app console: breachWipe().)
'use strict';

const fs = require('fs');
const path = require('path');
const { STORAGE_SENTINEL, overThreshold } = require('./logConfig.cjs');

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

// djb2 over the raw source — a session's identity is exactly the events on
// disk, so an unchanged source dumps to the same id (dedup) and any new event
// changes it (fresh session). Deterministic; no timestamps in the hash.
function digest(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// ---- wipe: raw .jsonl only; preserve the readable dump + everything else ----
if (cmd === 'wipe') {
  let n = 0;
  for (const f of logFiles()) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      n++;
    }
  }
  console.log(n ? `wiped ${n} raw log file(s) in ${dir}` : 'no raw log files to wipe');
  console.log(`readable dump preserved: ${fs.existsSync(out) ? out : '(none yet)'}`);
  console.log('note: browser-side localStorage logs are wiped from the app console with breachWipe()');
  process.exit(0);
}

if (cmd !== 'dump') {
  console.log('usage: node scripts/logs.cjs dump|wipe');
  process.exit(1);
}

const files = logFiles();
if (!files.length) {
  console.log(`no raw log files in ${dir} — play some battles with the dev server running`);
  process.exit(0);
}

const arr = (a) => (Array.isArray(a) ? a : []);
const cfgStr = (c) =>
  c
    ? `cfg[em:${c.enemyMatching ? 1 : 0} hb:${c.hackerBonusEnabled ? 1 : 0} sa:${c.singleAxisPayout ? 1 : 0} nmd:${c.noMatchDamage ? 1 : 0} cap:${c.maxCascadeSteps === null ? 'inf' : c.maxCascadeSteps} hp:${c.playerHp ?? '?'}v${c.enemyHp ?? '?'}` +
      ` strongC:P[${arr(c.strongColors && c.strongColors.player)}]E[${arr(c.strongColors && c.strongColors.enemy)}]` +
      ` strongS:P[${arr(c.strongShapes && c.strongShapes.player)}]E[${arr(c.strongShapes && c.strongShapes.enemy)}]]`
    : 'cfg[missing]';

// ---- build the readable body from all raw source lines ----
const rawParts = [];
const bodyLines = [];
let metrics = 0;
let turns = 0;
let bad = 0;

for (const file of files) {
  bodyLines.push(`----- ${path.basename(file)} -----`);
  const content = fs.readFileSync(file, 'utf8');
  rawParts.push(content);
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const { kind, at, entry } = JSON.parse(line);
      if (kind === 'metrics') {
        metrics++;
        const m = entry.metrics;
        bodyLines.push(
          `[${at}] === BATTLE ${entry.battleId} v=${entry.v} ${cfgStr(entry.config)} winner=${entry.winner} turns=${m.turns}` +
            `${entry.wallClockMs !== undefined ? ` wallClock=${(entry.wallClockMs / 1000).toFixed(0)}s` : ''} ===`,
        );
        // MK9.3 — enemy Shielder (prevention is NOT damage dealt)
        bodyLines.push(
          `  enemyShield: created ${m.enemyShieldCreated ?? 0}, removed ${m.enemyShieldRemoved ?? 0}, hits ${m.enemyShieldInstances ?? 0}, prevented ${m.enemyShieldPrevented ?? 0}`,
        );
        for (const side of ['player', 'enemy']) {
          const s = m.sides[side];
          const avgRound = s.roundDamageCount ? (s.roundDamageSum / s.roundDamageCount).toFixed(1) : '0';
          bodyLines.push(
            `  ${side}: dmg ${s.totalDamage} [match ${s.matchDamage} | bomb ${s.bombDamage} | atk ${s.attackerDamage} | buffer ${s.bufferDamageAdded ?? 0}]` +
              ` cascadeDmg ${s.cascadeDamage ?? 0} axis(c/s) ${s.matchDamageColor ?? 0}/${s.matchDamageShape ?? 0}` +
              ` critExtra ${s.critExtra} contention ${s.contentionTiles ?? 0}/${s.tilesDestroyed ?? 0}` +
              ` largestHit ${s.largestHit} biggestRound ${s.biggestRound ?? 0} avgRound ${avgRound} deepestCascade ${s.deepestCascade}`,
          );
          for (const [t, u] of Object.entries(s.units)) {
            // MK9.1/9.2 — bombs placed per activation surfaces on bomber
            const placed = t === 'bomber' ? `, bombsPlaced ${u.bombsPlaced ?? 0}` : '';
            bodyLines.push(`    ${t}: fires ${u.fires}, effect ${u.effect}, chargeWasted ${u.chargeWasted}${placed}`);
          }
        }
        if (m.thinkTimesMs && m.thinkTimesMs.length) {
          bodyLines.push(`  thinkTimesMs (raw): [${m.thinkTimesMs.join(', ')}]`);
        }
        if (m.hintsShown) bodyLines.push(`  hintsShown: ${m.hintsShown}`);
      } else if (kind === 'turn') {
        turns++;
        bodyLines.push(
          `[${at}] turn ${entry.turn} (${entry.battleId} v=${entry.v} ${cfgStr(entry.config)})` +
            `${entry.thinkMs !== undefined ? ` think=${(entry.thinkMs / 1000).toFixed(1)}s` : ''}` +
            `${entry.hintShown ? ' HINTED' : ''}` +
            `${entry.result ? `  RESULT: ${entry.result} wins` : ''}`,
        );
        if (entry.actions.length) bodyLines.push(`  actions: ${entry.actions.join('; ')}`);
        bodyLines.push(
          `  dmg P:${entry.damage.player.total} E:${entry.damage.enemy.total}  hp P:${entry.hpAfter.player} E:${entry.hpAfter.enemy}  detonations:${entry.detonations} reshuffles:${entry.reshuffles}`,
        );
        bodyLines.push(
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

const sessionId = digest(rawParts.join('\n'));
const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';

// retry-safe dedup: this exact source was already appended (the session id is
// written into the header below, so a re-run with identical source finds it)
if (existing.includes(`SESSION ${sessionId} `)) {
  console.log(`session ${sessionId} already appended to ${out} — nothing to do (${metrics} battle-metrics + ${turns} turns in source)`);
  process.exit(0);
}

// MK9.6 storage threshold: over-limit → replace dump content with the sentinel
// (once) and suppress the append. Bounded: if already the sentinel, do nothing.
if (overThreshold(dir)) {
  if (existing.trim() !== STORAGE_SENTINEL) fs.writeFileSync(out, STORAGE_SENTINEL + '\n');
  console.log(`storage over threshold — dump suppressed; ${out} replaced with sentinel line`);
  process.exit(0);
}

const header =
  `\n===== SESSION ${sessionId} | ${new Date().toISOString()} | files: ${files.map((f) => path.basename(f)).join(', ')} ` +
  `| ${metrics} battle-metrics, ${turns} turns${bad ? `, ${bad} unparsable` : ''} =====`;
fs.appendFileSync(out, `${header}\n${bodyLines.join('\n')}\n`);
console.log(
  `appended session ${sessionId}: ${metrics} battle-metrics + ${turns} turn entries from ${files.length} file(s)${bad ? ` (${bad} unparsable)` : ''} -> ${out}`,
);
