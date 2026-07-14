// Harness bot glue. The move-selection heuristics live in the LOGIC layer
// (src/logic/bot.ts) — re-exported here for the smoke/batch scripts. Use
// botMove(g) so the harness player follows the same config-aware tier
// selection as the enemy (MK7.13 charge-aware NMD tier + sub-option).

import { effectiveCost } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { pickBotMove } from '../src/logic/bot';
import { Pt, UNIT_ORDER } from '../src/logic/types';

export { findBotMove, findChargeMove, pickBotMove } from '../src/logic/bot';

export function botMove(g: Game): { a: Pt; b: Pt } | null {
  return pickBotMove(g.state.board, g.state.config);
}

// Fire every charged program (MK7.1: against EFFECTIVE costs). The Disabler
// (player-targetable per MK3.2) targets the enemy minion with the highest
// current charge — a reasonable dumb policy for the floor-indicator bot.
export function botFireAbilities(g: Game): void {
  for (let i = 0; i < 4; i++) {
    if (g.state.winner) return;
    const u = g.state.units.player[i];
    if (u.charge < effectiveCost(g.state.config, u.type)) continue;
    if (u.type === 'disabler') {
      const charges = g.state.units.enemy.map((e) => e.charge);
      const target = charges.indexOf(Math.max(...charges));
      g.fireProgram(UNIT_ORDER.indexOf('disabler'), target);
    } else {
      g.fireProgram(i);
    }
  }
}
