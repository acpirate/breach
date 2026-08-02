// Headless batch runner (MK2.3 + MK3.5 + MK5): plays N full battles through
// the pure logic layer with the shared bot and reports aggregate metrics
// SPLIT BY OUTCOME, for the main config modes. Alpha 0.1.0: definitions load
// from the same CSV datasets as the browser; the summary header stamps the
// content identity (§13.2). Run with `npm run batch`.

import { contentStamp, deckById, getContent, programsFor } from '../src/logic/data/content';
import { BattleMetrics } from '../src/logic/metrics';
import { defaultIdentity } from '../src/logic/session';
import { BattleSettings } from '../src/logic/types';
import { botFireAbilities, botMove } from './bot';
import { initContentOrExit } from './dataNode';
import { D, defaultActiveBuild, defaultInventory, newBattle } from './harness';

initContentOrExit();

const N = 100;

function playOne(seed: number, settings: BattleSettings, build?: string[]): BattleMetrics {
  const g = newBattle(settings, seed, build ?? defaultActiveBuild(), build ? 'PLAYER_EDITED' : 'DEFAULT');
  g.startPlayerPhase();
  let safety = 0;
  while (!g.state.winner && safety++ < 2000) {
    botFireAbilities(g);
    if (g.state.winner) break;
    const mv = botMove(g);
    if (!mv) throw new Error('deadlock prevention failed');
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  if (!g.state.winner) throw new Error(`battle did not finish (seed ${seed})`);
  return g.state.metrics;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const max = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0);
const f1 = (n: number): string => n.toFixed(1);

function report(label: string, group: BattleMetrics[]): void {
  console.log(`\n=== ${label}: ${group.length} battles ===`);
  if (!group.length) return;
  console.log(`Turns: avg ${f1(avg(group.map((m) => m.turns)))}, max ${max(group.map((m) => m.turns))}`);
  console.log(`Match-locks (auto-reshuffles): avg ${f1(avg(group.map((m) => m.autoReshuffles)))}, total ${group.reduce((a, m) => a + m.autoReshuffles, 0)}`);
  for (const side of ['player', 'enemy'] as const) {
    const s = group.map((m) => m.sides[side]);
    console.log(`--- ${side.toUpperCase()} (averages per battle) ---`);
    const abilityPcts = s.map((x) =>
      x.totalDamage > 0 ? ((x.attackerDamage + x.bombDamage + x.linesliceDamage) / x.totalDamage) * 100 : 0,
    );
    // MK7.3/7.4 + §11.3 + §15.3: SIX DISJOINT causal buckets
    // (sync + bomb + atk + slice + buffer + skill = total)
    console.log(`  Total damage: ${f1(avg(s.map((x) => x.totalDamage)))}  [sync ${f1(avg(s.map((x) => x.matchDamage)))} | bomb ${f1(avg(s.map((x) => x.bombDamage)))} | atk ${f1(avg(s.map((x) => x.attackerDamage)))} | slice ${f1(avg(s.map((x) => x.linesliceDamage)))} | buffer ${f1(avg(s.map((x) => x.bufferDamageAdded)))} | skill ${f1(avg(s.map((x) => x.skillDamage)))}]  Function share ${f1(avg(abilityPcts))}%`);
    console.log(`  Cascade (RNG-refill) damage, any cause: ${f1(avg(s.map((x) => x.cascadeDamage)))}`);
    console.log(`  Sync dmg by axis: color ${f1(avg(s.map((x) => x.matchDamageColor)))} / shape ${f1(avg(s.map((x) => x.matchDamageShape)))}`);
    // §9.5 — line-clear frequency, so B1 board churn is observable
    console.log(`  Line clears: avg ${f1(avg(s.map((x) => x.lineClears)))}, max ${max(s.map((x) => x.lineClears))}`);
    console.log(`  Biggest round: avg ${f1(avg(s.map((x) => x.biggestRound)))}, max ${max(s.map((x) => x.biggestRound))}   Avg nonzero round: ${f1(avg(s.map((x) => (x.roundDamageCount ? x.roundDamageSum / x.roundDamageCount : 0))))}`);
    const critPcts = s.map((x) => (x.matchDamage > 0 ? (x.critExtra / x.matchDamage) * 100 : 0));
    console.log(`  Crit bonus damage: ${f1(avg(s.map((x) => x.critExtra)))} (avg ${f1(avg(critPcts))}% of match damage)`);
    console.log(`  Largest single hit: avg ${f1(avg(s.map((x) => x.largestHit)))}, max ${max(s.map((x) => x.largestHit))}`);
    console.log(`  Deepest cascade: avg ${f1(avg(s.map((x) => x.deepestCascade)))}, max ${max(s.map((x) => x.deepestCascade))}`);
    const contPcts = s.map((x) => (x.tilesDestroyed > 0 ? (x.contentionTiles / x.tilesDestroyed) * 100 : 0));
    console.log(`  Contention: ${f1(avg(s.map((x) => x.contentionTiles)))} opp-bound tiles of ${f1(avg(s.map((x) => x.tilesDestroyed)))} destroyed (avg ${f1(avg(contPcts))}%)`);
    // Alpha 0.4.1 §8.4 — charge generated that no active Program could absorb.
    console.log(`  Charge discarded by routing: ${f1(avg(s.map((x) => x.chargeDiscardedTotal)))}`);
    // Alpha §21.3: per-Program rows by stable ID, display name joined here
    for (const p of programsFor(side)) {
      // Alpha 0.4.0 §5.8 — an inactive inventory Program has no metrics slot in
      // any battle of this cell; printing a row of zeroes for it would read as
      // "it did nothing" rather than "it was not in the build".
      if (!s.some((x) => x.units[p.id])) continue;
      const fires = avg(s.map((x) => x.units[p.id]?.fires ?? 0));
      const effect = avg(s.map((x) => x.units[p.id]?.effect ?? 0));
      const wasted = avg(s.map((x) => x.units[p.id]?.chargeWasted ?? 0));
      const fizzles = avg(s.map((x) => x.units[p.id]?.fizzles ?? 0));
      console.log(`  ${p.name} [${p.id}]: fires ${f1(fires)}, effect ${f1(effect)}, charge wasted ${f1(wasted)}, fizzles ${f1(fizzles)}`);
    }
    // §21.3 — the Deck-owned Function and Hacker Skills report separately from
    // the Programs; only the Hacker side carries them.
    if (side === 'player') {
      const deck = deckById(defaultIdentity().deckId);
      console.log(
        `  ${deck.fn.name} [${deck.id} deck]: fires ${f1(avg(s.map((x) => x.deck.fires)))},` +
          ` neutral charge ${f1(avg(s.map((x) => x.deck.chargeFromNeutral)))} (wasted ${f1(avg(s.map((x) => x.deck.chargeWasted)))}),` +
          ` shake ${f1(avg(s.map((x) => x.deck.shakeSuccesses)))}/${f1(avg(s.map((x) => x.deck.shakeAttempts)))}` +
          ` (legal fizzles ${f1(avg(s.map((x) => x.deck.shakeFizzles)))})`,
      );
      for (const sid of Object.keys(getContent().skills)) void sid; // (skills map, iterated below)
      const skillIds = new Set<string>();
      for (const x of s) for (const k of Object.keys(x.skills)) skillIds.add(k);
      for (const sid of [...skillIds].sort()) {
        console.log(
          `  Skill ${sid}: triggers ${f1(avg(s.map((x) => x.skills[sid]?.triggers ?? 0)))},` +
            ` damage ${f1(avg(s.map((x) => x.skills[sid]?.damage ?? 0)))},` +
            ` charge ${f1(avg(s.map((x) => x.skills[sid]?.charge ?? 0)))}`,
        );
      }
    }
  }
}

function runMode(label: string, settings: BattleSettings, build?: string[]): void {
  const results: BattleMetrics[] = [];
  for (let seed = 1; seed <= N; seed++) results.push(playOne(seed, settings, build));
  const won = results.filter((m) => m.winner === 'player');
  const lost = results.filter((m) => m.winner === 'enemy');
  const active = build ?? defaultActiveBuild();
  const probe = newBattle(settings, 1, active, 'DEFAULT');
  console.log(`\n############################################################`);
  console.log(`#  ${label}`);
  console.log(`#  BOT WIN RATE: ${won.length}/${N} won, ${lost.length}/${N} lost (${((won.length / N) * 100).toFixed(1)}% wins)`);
  console.log(`#  Hacker LINK ${probe.state.config.playerHp} vs System ICE ${probe.state.config.enemyHp}, seeds 1-${N}`);
  // Alpha 0.4.0 — the ACTIVE BUILD is now a variable of the simulation, so
  // every record states which four Programs (and in what order) produced it.
  console.log(`#  Active build: ${active.join(' > ')}`);
  console.log(`############################################################`);
  report('BATTLES THE HACKER WON', won);
  report('BATTLES THE HACKER LOST', lost);
}

// §21.2 — simulation records are attributable to the loaded content and to the
// explicit Hacker/Deck identity the harness used.
const stamp = contentStamp();
const ids = defaultIdentity();
console.log(`build ${stamp.gameVersion} | schema ${stamp.schemaVersion} | content ${stamp.fingerprint}`);
console.log(`hacker programs: ${stamp.hackerPrograms.join(', ')}`);
console.log(`system programs: ${stamp.systemPrograms.join(', ')}`);
console.log(`functions: ${stamp.functions.map((f) => `${f.id}=${f.cost}`).join(', ')}`);
console.log(`identity: ${ids.hackerId}/${ids.deckId} (${ids.selectionSource}) skills=[${stamp.skills.join(', ')}]`);
console.log(`fingerprint: ${getContent().fingerprint}`);

console.log(`inventory: ${defaultInventory().join(', ')}`);

// Alpha matrix: data-driven costs (7/8/10/9) across the main modes
runMode('DEFAULT (cap-0, data costs, Normal LINK)', { ...D });
runMode('SYSTEM_MATCHING ON', { ...D, enemyMatching: true });
runMode('REINFORCED_CONNECTION ON (charge-aware bot)', { ...D, reinforcedConnection: true });
runMode('REINFORCED_CONNECTION + SYSTEM_MATCHING (charge-aware bot)', { ...D, reinforcedConnection: true, enemyMatching: true });

// Alpha 0.4.0 — the default build leaves NINJA and WEASEL in the inventory, so
// these two cells are what actually exercise DATACUT, PLINK, and overlapping
// charge bindings (WEASEL shares RED with BOMBER and CIR with DISABLER). The
// second ordering is the same four Programs with WEASEL moved to the top, so
// the reports can be read against each other to see routing priority move.
runMode('ALPHA 0.4 BUILD — NINJA/WEASEL active', { ...D }, ['PRG_H_005', 'PRG_H_006', 'PRG_H_001', 'PRG_H_004']);
runMode('ALPHA 0.4 BUILD — WEASEL first (charge priority flipped)', { ...D }, ['PRG_H_006', 'PRG_H_001', 'PRG_H_004', 'PRG_H_005']);
