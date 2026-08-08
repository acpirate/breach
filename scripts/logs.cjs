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
// Alpha 0.2.0 §13.2 — mode/Run context prefix, shared by metrics/turn/wizard
// lines. Quick Match entries carry no runStep (never fake Run values).
const modeStr = (entry) =>
  entry.mode === 'RUN' ? `mode=RUN step=${entry.runStep ?? '?'}` : entry.mode === 'QUICK_MATCH' ? 'mode=QUICK_MATCH' : 'mode=?';
// Alpha 0.3.0: `hb` (hardcoded Hacker bonus) is gone — that passive is now the
// Hacker's Skill records. `nmd` is now `rc` (Reinforced Connection), `nl` is
// Normal LINK, and the HP pair reads as effective LINK/ICE. Historical records
// with the old field names still format (missing values show as '?') — prior
// logs are never rewritten (§21.5).
// Alpha 0.4.1 §6.1 normalized turn records intentionally OMIT config, so
// `cfgStr` is only ever called where config is genuinely expected (the
// battle-level record). Alpha 0.5.0 §38.2 removes the misleading
// `cfg[missing]` marker that normalized turn lines used to print: an absent
// value that is absent BY DESIGN is not a defect and must not read as one.
const cfgStr = (c) =>
  c
    ? `cfg[em:${c.enemyMatching ? 1 : 0} sa:${c.singleAxisPayout ? 1 : 0} rc:${(c.reinforcedConnection ?? c.noMatchDamage) ? 1 : 0}` +
      ` nl:${c.normalLink ? 1 : 0} cap:${c.maxCascadeSteps === null ? 'inf' : c.maxCascadeSteps} link:${c.playerHp ?? '?'} ice:${c.enemyHp ?? '?'}` +
      ` strongC:P[${arr(c.strongColors && c.strongColors.player)}]E[${arr(c.strongColors && c.strongColors.enemy)}]` +
      ` strongS:P[${arr(c.strongShapes && c.strongShapes.player)}]E[${arr(c.strongShapes && c.strongShapes.enemy)}]]`
    : '';
// Alpha 0.3.0 §21.2 — selection/build identity on battle, turn, and Run records.
// Alpha 0.5.0 §36 — plus the opponent System and how it was chosen.
const idStr = (i) =>
  i
    ? `id[${i.hackerId ?? '?'}/${i.deckId ?? '?'} vs ${i.systemId ?? '?'}${i.systemSelectionSource ? `(${i.systemSelectionSource})` : ''}` +
      ` fn:${i.deckFunctionId ?? '?'} skills:[${arr(i.skillIds)}] src:${i.selectionSource ?? '?'}]`
    : '';

// §38.1 — the battle-level context every child record joins to by `battleId`.
// Turn lines resolve their config from HERE rather than repeating it, which is
// exactly what makes omitting it from the turn record correct.
const battleContextById = new Map();

// ---- build the readable body from all raw source lines ----
const rawParts = [];
const bodyLines = [];
let metrics = 0;
let turns = 0;
let wizards = 0;
let selections = 0;
let events = 0;
let omitted = 0;
let unsupported = 0;
let bad = 0;

// §38.1 — every valid record is classified as rendered / summarized /
// intentionally omitted / unsupported. `bad` is now reserved for records that
// genuinely could not be parsed (malformed JSON or a missing envelope), so the
// session header stops describing structurally valid logs as "unparsable".
const parsed = [];
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  rawParts.push(content);
  const lines = content.split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    let rec = null;
    try {
      rec = JSON.parse(line);
    } catch {
      bad++; // malformed JSON is still legitimately unparsable
      continue;
    }
    if (!rec || typeof rec !== 'object' || typeof rec.kind !== 'string' || !('entry' in rec)) {
      bad++; // valid JSON, but not a log envelope at all
      continue;
    }
    records.push(rec);
    // Pass 1: index battle-level context so turn/event lines can JOIN to it
    // (§38.2) instead of carrying a repeated copy of the config.
    if (rec.kind === 'metrics' && rec.entry && rec.entry.battleId) {
      battleContextById.set(rec.entry.battleId, rec.entry);
    }
  }
  parsed.push({ file, records });
}

// Pass 2: render.
for (const { file, records } of parsed) {
  bodyLines.push(`----- ${path.basename(file)} -----`);
  for (const { kind, at, entry } of records) {
    try {
      if (kind === 'metrics') {
        metrics++;
        const m = entry.metrics;
        bodyLines.push(
          `[${at}] === BATTLE ${entry.battleId} v=${entry.v} ${modeStr(entry)} natural=${entry.natural ?? '?'} ${cfgStr(entry.config)} ${idStr(entry.identity)} winner=${entry.winner} turns=${m.turns}` +
            `${entry.encounterSystemHp !== undefined ? ` encounterIce=${entry.encounterSystemHp}` : ''}` +
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
            // §11.3/§6.4 — five DISJOINT buckets: base Sync + bomb + atk +
            // buffer + skill == total. `skill` is Hacker-Skill damage and is
            // never folded into base Sync damage.
            // §11.3/§6.4 — DISJOINT buckets: base Sync + bomb + atk + slice +
            // transform + buffer + skill == total. `skill` is Hacker-Skill
            // damage and is never folded into base Sync damage; `xform`
            // (Alpha 0.5.0) is damage from Syncs an EFFECT_TRANSFORM created,
            // credited to the Effect rather than left in the Sync bucket.
            `  ${side}: dmg ${s.totalDamage} [sync ${s.matchDamage} | bomb ${s.bombDamage} | atk ${s.attackerDamage}` +
              ` | slice ${s.linesliceDamage ?? 0} | xform ${s.transformDamage ?? 0} | buffer ${s.bufferDamageAdded ?? 0} | skill ${s.skillDamage ?? 0}]` +
              ` cascadeDmg ${s.cascadeDamage ?? 0} axis(c/s) ${s.matchDamageColor ?? 0}/${s.matchDamageShape ?? 0}` +
              ` critExtra ${s.critExtra} contention ${s.contentionTiles ?? 0}/${s.tilesDestroyed ?? 0}` +
              ` largestHit ${s.largestHit} biggestRound ${s.biggestRound ?? 0} avgRound ${avgRound} deepestCascade ${s.deepestCascade}` +
              ` lineClears ${s.lineClears ?? 0}` +
              // §39.1/§39.2 — ONE side-level total. `chargeDiscardedTotal` is
              // the Alpha 0.4.1 field name, read here only so retained older
              // logs still format (§38.3); it is no longer written.
              ` chargeWasted ${s.chargeWastedTotal ?? s.chargeDiscardedTotal ?? 0}`,
          );
          for (const [t, u] of Object.entries(s.units)) {
            const placed = u.bombsPlaced ? `, bombsPlaced ${u.bombsPlaced}` : '';
            // §39.2 — per-Program chargeWasted is deliberately NOT printed: it
            // is no longer the analytical authority for waste.
            bodyLines.push(`    ${t}: fires ${u.fires}, effect ${u.effect}${placed}`);
          }
          // §21.3 — the Deck-owned Function has its OWN bucket, never listed
          // among the Programs.
          const d = s.deck;
          if (d) {
            bodyLines.push(
              `    [deck]: fires ${d.fires ?? 0}, ops ${d.ops ?? 0}, fizzles ${d.fizzles ?? 0},` +
                ` neutralCharge ${d.chargeFromNeutral ?? 0} (wasted ${d.chargeWasted ?? 0}),` +
                ` shake ${d.shakeSuccesses ?? 0}/${d.shakeAttempts ?? 0} (legalFizzles ${d.shakeFizzles ?? 0})`,
            );
          }
          for (const [sid, k] of Object.entries(s.skills || {})) {
            bodyLines.push(`    [skill ${sid}]: triggers ${k.triggers ?? 0}, damage ${k.damage ?? 0}, charge ${k.charge ?? 0}`);
          }
        }
        if (m.thinkTimesMs && m.thinkTimesMs.length) {
          bodyLines.push(`  thinkTimesMs (raw): [${m.thinkTimesMs.join(', ')}]`);
        }
        if (m.hintsShown) bodyLines.push(`  hintsShown: ${m.hintsShown}`);
      } else if (kind === 'turn') {
        turns++;
        // §38.2 — config is JOINED from the battle-level record by `battleId`.
        // A compact turn record that omits it is correct, not deficient; when
        // no battle record is retained alongside it the marker is simply left
        // off rather than printing a false `cfg[missing]`.
        const ctx = battleContextById.get(entry.battleId);
        const cfg = cfgStr(entry.config ?? (ctx && ctx.config));
        bodyLines.push(
          `[${at}] turn ${entry.turn} (${entry.battleId} v=${entry.v} ${modeStr(entry)}${cfg ? ` ${cfg}` : ''})` +
            `${entry.thinkMs !== undefined ? ` think=${(entry.thinkMs / 1000).toFixed(1)}s` : ''}` +
            `${entry.hintShown ? ' HINTED' : ''}` +
            `${entry.result ? `  RESULT: ${entry.result} wins` : ''}`,
        );
        // Alpha 0.4.1 §6.3 — the readable `actions` mirror exists only at
        // COMPLETE. Reading it unconditionally threw a TypeError on every
        // VERBOSE record, and the catch below then counted the record as
        // unparsable; that was the real cause of the misclassification §38.1
        // describes.
        if (Array.isArray(entry.actions) && entry.actions.length) {
          bodyLines.push(`  actions: ${entry.actions.join('; ')}`);
        }
        const d = entry.damage || { player: {}, enemy: {} };
        const hp = entry.hpAfter || {};
        // Alpha 0.4.1 moved detonations/reshuffles/lineClears to AGGREGATE
        // counters on the battle record, so they are absent from turn records
        // by design and are printed only when a legacy record still carries
        // them (§38.3 — version-aware, never destructive).
        const legacyAgg =
          entry.detonations !== undefined || entry.reshuffles !== undefined || entry.lineClears !== undefined
            ? `  detonations:${entry.detonations ?? 0} reshuffles:${entry.reshuffles ?? 0} lineClears:${entry.lineClears ?? 0}`
            : '';
        bodyLines.push(
          `  dmg H:${(d.player && d.player.total) ?? 0} S:${(d.enemy && d.enemy.total) ?? 0}` +
            `  link:${hp.player ?? '?'} ice:${hp.enemy ?? '?'}${legacyAgg}`,
        );
        const ch = entry.chargesAfter || {};
        bodyLines.push(
          `  charges H:[${arr(ch.player)}] S:[${arr(ch.enemy)}] deck:${ch.deck ?? ch.shake ?? '?'}`,
        );
      } else if (kind === 'event') {
        // Alpha 0.4.1 §4.3 promoted routes/targeted/drains out of the turn
        // record into their own stream; Alpha 0.5.0 adds TRANSFORM and
        // COUNTDOWN. The compact formatter had NO branch for this stream at
        // all, so every structurally valid event record fell through to the
        // `bad` counter and was reported as unparsable (§38.1).
        events++;
        const e = entry;
        if (e.kind === 'ROUTE' && e.route) {
          const r = e.route;
          const landed = arr(r.assignments)
            .filter((a) => a.assigned > 0)
            .map((a) => `${a.programId}+${a.assigned}`)
            .join(' ');
          bodyLines.push(
            `[${at}] route ${e.battleId} t${e.turn} ${r.side} ${r.axis}:${r.token} amount=${r.amount} src=${r.source}` +
              `${r.sourceId ? `(${r.sourceId})` : ''} -> ${landed || 'nothing'} discarded=${r.discarded}`,
          );
        } else if (e.kind === 'TARGETED' && e.targeted) {
          const t = e.targeted;
          bodyLines.push(
            `[${at}] targeted ${e.battleId} t${e.turn} ${t.side} ${t.effectId} [${t.fnId}] by ${t.programId}` +
              ` ${t.resolved ? `at (${t.target ? `${t.target.x},${t.target.y}` : '?'}) sliced=${t.slicedCount} retained=${t.retainedCount} dmg=${t.directDamage} charge=${t.directCharge}` : `fizzled — ${t.reason ?? 'no target'}`}`,
          );
        } else if (e.kind === 'DRAIN' && e.drain) {
          const dr = e.drain;
          bodyLines.push(
            `[${at}] drain ${e.battleId} t${e.turn} ${dr.side} ${dr.programId} [${dr.fnId}] -> ${dr.targetProgramId}` +
              ` ${dr.readiness} ${dr.chargeBefore}->${dr.chargeAfter} of ${dr.targetCost} (removed ${dr.removed})`,
          );
        } else if (e.kind === 'TRANSFORM' && e.transform) {
          const x = e.transform;
          bodyLines.push(
            `[${at}] transform ${e.battleId} t${e.turn} ${x.side} ${x.programId} [${x.fnId}]` +
              ` ${x.axisTarget} -> c${x.resultColor}/s${x.resultShape} converted=${x.converted}/${x.candidates} (requested ${x.requested})` +
              ` specials kept=${x.specialsRetained} destroyed=${x.specialsDestroyed}`,
          );
        } else if (e.kind === 'COUNTDOWN' && e.countdown) {
          const c = e.countdown;
          bodyLines.push(
            `[${at}] countdown ${e.battleId} t${e.turn} ${c.side} delivered ${c.effectId}` +
              `${c.fnId ? ` [${c.fnId}]` : ''} at (${c.p.x},${c.p.y})${c.magnitude !== undefined ? ` magnitude=${c.magnitude}` : ''}`,
          );
        } else {
          // A well-formed event of a kind this formatter does not render.
          // UNSUPPORTED is not a parse failure: the record is valid and is
          // retained; only this exporter lacks a branch for it (§38.1).
          unsupported++;
          bodyLines.push(`[${at}] event ${e.battleId ?? '?'} t${e.turn ?? '?'} kind=${e.kind ?? '?'} (unsupported by this formatter)`);
        }
      } else if (kind === 'wizard') {
        // Alpha 0.2.0 §5.4/§21.4 — wizard invocation, distinct from the
        // natural battle outcome it acted on (never overwrites it).
        wizards++;
        bodyLines.push(
          `[${at}] WIZARD ${entry.battleId} v=${entry.v} ${modeStr(entry)} natural=${entry.natural} action=${entry.action}`,
        );
      } else if (kind === 'selection') {
        // Alpha 0.3.0 §21.2 — COMMITTED selection / battle-creation events only
        // (never preselection, screen views, or Back navigation).
        selections++;
        bodyLines.push(
          `[${at}] SELECT ${entry.event} v=${entry.v} ${modeStr(entry)} ${idStr(entry.identity)}` +
            `${entry.battleId ? ` battle=${entry.battleId}` : ''}` +
            `${entry.hackerMaxLink !== undefined ? ` link=${entry.hackerMaxLink}` : ''}` +
            `${entry.systemMaxIce !== undefined ? ` ice=${entry.systemMaxIce}` : ''}`,
        );
        // §36 — the committed opponent resolution.
        if (entry.systemId) {
          bodyLines.push(
            `  system=${entry.systemId}${entry.systemSelectionSource ? ` (${entry.systemSelectionSource})` : ''}` +
              `${entry.systemPrograms ? ` build=[${arr(entry.systemPrograms)}]` : ''}` +
              `${entry.systemStrongColors ? ` strongC=[${arr(entry.systemStrongColors)}] strongS=[${arr(entry.systemStrongShapes)}]` : ''}`,
          );
        }
      } else {
        // §38.1 — a valid envelope of an unrecognized kind is INTENTIONALLY
        // OMITTED from the readable body, not a parse failure. It stays in the
        // raw .jsonl untouched (§38.3 — never destructively cleared merely
        // because this formatter has no branch for it).
        omitted++;
      }
    } catch (err) {
      // Reaching here means a rendering bug against a record that DID parse.
      // Surfacing it as a formatter error keeps it from being silently
      // miscounted as unparsable source data, which is what §38.1 is about.
      unsupported++;
      bodyLines.push(`[${at}] ${kind} record could not be formatted: ${err && err.message ? err.message : err}`);
    }
  }
}

const sessionId = digest(rawParts.join('\n'));
const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';

// retry-safe dedup: this exact source was already appended (the session id is
// written into the header below, so a re-run with identical source finds it)
if (existing.includes(`SESSION ${sessionId} `)) {
  console.log(
    `session ${sessionId} already appended to ${out} — nothing to do (${metrics} battle-metrics + ${turns} turns + ${events} events + ${wizards} wizard + ${selections} selection entries in source)`,
  );
  process.exit(0);
}

// MK9.6 storage threshold: over-limit → replace dump content with the sentinel
// (once) and suppress the append. Bounded: if already the sentinel, do nothing.
if (overThreshold(dir)) {
  if (existing.trim() !== STORAGE_SENTINEL) fs.writeFileSync(out, STORAGE_SENTINEL + '\n');
  console.log(`storage over threshold — dump suppressed; ${out} replaced with sentinel line`);
  process.exit(0);
}

// §38.1 — the header reports each classification separately, so "this
// formatter has no branch for it" can never again be read as "the log is
// corrupt". `unparsable` now means only malformed JSON or a missing envelope.
const classified =
  `${metrics} battle-metrics, ${turns} turns, ${events} events, ${wizards} wizard, ${selections} selection` +
  `${unsupported ? `, ${unsupported} unsupported` : ''}${omitted ? `, ${omitted} omitted` : ''}${bad ? `, ${bad} unparsable` : ''}`;
const header =
  `\n===== SESSION ${sessionId} | ${new Date().toISOString()} | files: ${files.map((f) => path.basename(f)).join(', ')} ` +
  `| ${classified} =====`;
fs.appendFileSync(out, `${header}\n${bodyLines.join('\n')}\n`);
console.log(`appended session ${sessionId}: ${classified} from ${files.length} file(s) -> ${out}`);
