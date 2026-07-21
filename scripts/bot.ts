// Harness bot glue. The move-selection heuristics live in the LOGIC layer
// (src/logic/bot.ts) — re-exported here for the smoke/batch scripts. Use
// botMove(g) so the harness player follows the same config-aware tier
// selection as the enemy (MK7.13 charge-aware NMD tier + sub-option).

import { getContent, requiresTarget } from '../src/logic/data/content';
import { Game } from '../src/logic/game';
import { pickBotMove } from '../src/logic/bot';
import { Pt } from '../src/logic/types';

export { findBotMove, findChargeMove, pickBotMove } from '../src/logic/bot';

export function botMove(g: Game): { a: Pt; b: Pt } | null {
  return pickBotMove(g.state.board, g.state.config);
}

// Fire every charged Program (Alpha: against the resolved data costs). A
// targeted Program (plan leads with player-choice Drain) targets the enemy
// slot with the highest current charge — a reasonable dumb policy for the
// floor-indicator bot.
export function botFireAbilities(g: Game): void {
  const hacker = getContent().hacker;
  for (let i = 0; i < hacker.length; i++) {
    if (g.state.winner) return;
    const u = g.state.units.player[i];
    const prog = hacker[i];
    if (u.charge < prog.cost) continue;
    if (requiresTarget(prog)) {
      const charges = g.state.units.enemy.map((e) => e.charge);
      const target = charges.indexOf(Math.max(...charges));
      g.fireProgram(i, target);
    } else {
      g.fireProgram(i);
    }
  }
}
