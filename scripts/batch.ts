// Headless batch runner (MK2.3 + MK3.5 + MK5): plays N full battles through
// the pure logic layer with the shared bot and reports aggregate metrics
// SPLIT BY OUTCOME, for BOTH enemy modes (ENEMY_MATCHING off and on).
// Run with `npm run batch`.

import { DEFAULT_BATTLE_CONFIG, STARTING_HP_ENEMY, STARTING_HP_PLAYER_NORMAL, UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { BattleMetrics } from '../src/logic/metrics';
import { BattleConfig, UNIT_ORDER } from '../src/logic/types';
import { botFireAbilities, findBotMove } from './bot';

const N = 100;

function playOne(seed: number, config: BattleConfig): BattleMetrics {
  const g = new Game('normal', config, seed);
  g.startPlayerPhase();
  let safety = 0;
  while (!g.state.winner && safety++ < 2000) {
    botFireAbilities(g);
    if (g.state.winner) break;
    const mv = findBotMove(g.state.board);
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
    console.log(`  Total damage: ${f1(avg(s.map((x) => x.totalDamage)))}  (match ${f1(avg(s.map((x) => x.matchDamage)))}, attacker ${f1(avg(s.map((x) => x.attackerDamage)))}, bomb ${f1(avg(s.map((x) => x.bombDamage)))})`);
    const critPcts = s.map((x) => (x.matchDamage > 0 ? (x.critExtra / x.matchDamage) * 100 : 0));
    console.log(`  Crit bonus damage: ${f1(avg(s.map((x) => x.critExtra)))} (avg ${f1(avg(critPcts))}% of match damage)`);
    console.log(`  Largest single hit: avg ${f1(avg(s.map((x) => x.largestHit)))}, max ${max(s.map((x) => x.largestHit))}`);
    console.log(`  Deepest cascade: avg ${f1(avg(s.map((x) => x.deepestCascade)))}, max ${max(s.map((x) => x.deepestCascade))}`);
    const contPcts = s.map((x) => (x.tilesDestroyed > 0 ? (x.contentionTiles / x.tilesDestroyed) * 100 : 0));
    console.log(`  Contention: ${f1(avg(s.map((x) => x.contentionTiles)))} opp-bound tiles of ${f1(avg(s.map((x) => x.tilesDestroyed)))} destroyed (avg ${f1(avg(contPcts))}%)`);
    for (const t of UNIT_ORDER) {
      const fires = avg(s.map((x) => x.units[t].fires));
      const effect = avg(s.map((x) => x.units[t].effect));
      const wasted = avg(s.map((x) => x.units[t].chargeWasted));
      console.log(`  ${UNIT_DEFS[t].label}: fires ${f1(fires)}, effect ${f1(effect)}, charge wasted ${f1(wasted)}`);
    }
  }
}

function runMode(label: string, config: BattleConfig): void {
  const results: BattleMetrics[] = [];
  for (let seed = 1; seed <= N; seed++) results.push(playOne(seed, config));
  const won = results.filter((m) => m.winner === 'player');
  const lost = results.filter((m) => m.winner === 'enemy');
  console.log(`\n############################################################`);
  console.log(`#  ${label}`);
  console.log(`#  BOT WIN RATE: ${won.length}/${N} won, ${lost.length}/${N} lost (${((won.length / N) * 100).toFixed(1)}% wins)`);
  console.log(`#  normal scenario, player ${STARTING_HP_PLAYER_NORMAL} HP vs enemy ${STARTING_HP_ENEMY} HP, seeds 1-${N}`);
  console.log(`############################################################`);
  report('BATTLES THE PLAYER WON', won);
  report('BATTLES THE PLAYER LOST', lost);
}

runMode('ENEMY_MATCHING OFF (default config)', { ...DEFAULT_BATTLE_CONFIG });
runMode('ENEMY_MATCHING ON', { ...DEFAULT_BATTLE_CONFIG, enemyMatching: true });
