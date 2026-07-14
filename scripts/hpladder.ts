// Symmetric-HP ladder (designer-requested, MK6): plays batches at mirrored
// 100v100, 500v500, and 2000v2000 HP under the new default config, in BOTH
// enemy modes, and reports turns-to-win distributions. The equal pools
// isolate tempo/fairness from HP asymmetry. Run with `npm run hpladder`.

import { DEFAULT_BATTLE_CONFIG } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { BattleConfig } from '../src/logic/types';
import { botFireAbilities, botMove } from './bot';

const N = 100;
const TIERS = [100, 500, 2000];

interface Result {
  winner: 'player' | 'enemy';
  turns: number;
}

function playOne(seed: number, config: BattleConfig): Result {
  const g = new Game(config, seed);
  g.startPlayerPhase();
  let safety = 0;
  while (!g.state.winner && safety++ < 5000) {
    botFireAbilities(g);
    if (g.state.winner) break;
    const mv = botMove(g);
    if (!mv) throw new Error('deadlock prevention failed');
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  if (!g.state.winner) throw new Error(`battle did not finish (seed ${seed})`);
  return { winner: g.state.winner, turns: g.state.turn };
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const f1 = (n: number): string => n.toFixed(1);

console.log(`=== Symmetric-HP ladder: ${N} battles per cell, new default config (cap-0, hacker off) ===`);
for (const matching of [false, true]) {
  console.log(`\n--- ENEMY_MATCHING ${matching ? 'ON' : 'OFF'} ---`);
  for (const hp of TIERS) {
    const cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, enemyMatching: matching, playerHp: hp, enemyHp: hp };
    const results: Result[] = [];
    for (let seed = 1; seed <= N; seed++) results.push(playOne(seed, cfg));
    const wins = results.filter((r) => r.winner === 'player');
    const losses = results.filter((r) => r.winner === 'enemy');
    const all = results.map((r) => r.turns);
    console.log(
      `${hp}v${hp}: player wins ${wins.length}/${N} (${((wins.length / N) * 100).toFixed(0)}%)  ` +
        `turns-to-win: avg ${f1(avg(wins.map((r) => r.turns)))} med ${median(wins.map((r) => r.turns))}  ` +
        `turns-to-loss: avg ${f1(avg(losses.map((r) => r.turns)))} med ${median(losses.map((r) => r.turns))}  ` +
        `all battles: avg ${f1(avg(all))} med ${median(all)} max ${Math.max(...all)}`,
    );
  }
}
