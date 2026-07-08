// Headless batch runner (MK2.3): plays N full battles through the pure logic
// layer with a simple bot and reports aggregate metrics — no rendering
// involved. This is the seed of the Section 2 "random play / autobattle
// balance-testing" tooling. Run with `npm run batch`.

import { findValidMove } from '../src/logic/board';
import { UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { BattleMetrics } from '../src/logic/metrics';
import { UNIT_ORDER } from '../src/logic/types';

const N = 100;

// Bot policy: fire every charged program in the pre-match phase, then play the
// first valid move found. Never fires shake (it is pure anti-lock now and the
// auto-reshuffle covers deadlocks). This is NOT human play — treat numbers as
// a floor/ceiling indicator, not a difficulty measurement.
function playOne(seed: number): BattleMetrics {
  const g = new Game('normal', seed);
  g.startPlayerPhase();
  let safety = 0;
  while (!g.state.winner && safety++ < 2000) {
    for (let i = 0; i < 4; i++) {
      if (g.state.winner) break;
      const u = g.state.units.player[i];
      if (u.charge >= UNIT_DEFS[u.type].cost) g.fireProgram(i);
    }
    if (g.state.winner) break;
    const mv = findValidMove(g.state.board);
    if (!mv) throw new Error('deadlock prevention failed');
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  if (!g.state.winner) throw new Error(`battle did not finish (seed ${seed})`);
  return g.state.metrics;
}

const results: BattleMetrics[] = [];
for (let seed = 1; seed <= N; seed++) results.push(playOne(seed));

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const max = (xs: number[]): number => Math.max(...xs);
const f1 = (n: number): string => n.toFixed(1);

const wins = results.filter((m) => m.winner === 'player').length;
console.log(`=== ${N} battles, normal scenario (player 150 HP vs enemy 350 HP), seeds 1-${N} ===`);
console.log(`Player win rate: ${wins}/${N} (${((wins / N) * 100).toFixed(1)}%)`);
console.log(`Turns: avg ${f1(avg(results.map((m) => m.turns)))}, max ${max(results.map((m) => m.turns))}`);
console.log(`Match-locks (auto-reshuffles): avg ${f1(avg(results.map((m) => m.autoReshuffles)))}, total ${results.reduce((a, m) => a + m.autoReshuffles, 0)}`);

for (const side of ['player', 'enemy'] as const) {
  const s = results.map((m) => m.sides[side]);
  console.log(`--- ${side.toUpperCase()} (averages per battle) ---`);
  console.log(`  Total damage: ${f1(avg(s.map((x) => x.totalDamage)))}  (match ${f1(avg(s.map((x) => x.matchDamage)))}, attacker ${f1(avg(s.map((x) => x.attackerDamage)))}, bomb ${f1(avg(s.map((x) => x.bombDamage)))})`);
  const critPcts = s.map((x) => (x.matchDamage > 0 ? (x.critExtra / x.matchDamage) * 100 : 0));
  console.log(`  Crit bonus damage: ${f1(avg(s.map((x) => x.critExtra)))} (avg ${f1(avg(critPcts))}% of match damage)`);
  console.log(`  Largest single hit: avg ${f1(avg(s.map((x) => x.largestHit)))}, max ${max(s.map((x) => x.largestHit))}`);
  console.log(`  Deepest cascade: avg ${f1(avg(s.map((x) => x.deepestCascade)))}, max ${max(s.map((x) => x.deepestCascade))}`);
  for (const t of UNIT_ORDER) {
    const fires = avg(s.map((x) => x.units[t].fires));
    const effect = avg(s.map((x) => x.units[t].effect));
    const wasted = avg(s.map((x) => x.units[t].chargeWasted));
    console.log(`  ${UNIT_DEFS[t].label}: fires ${f1(fires)}, effect ${f1(effect)}, charge wasted ${f1(wasted)}`);
  }
}
