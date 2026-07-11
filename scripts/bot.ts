// Harness bot glue. The move-selection heuristic itself lives in the LOGIC
// layer (src/logic/bot.ts) since MK5.1, where it also drives the enemy's turn
// when ENEMY_MATCHING is on — re-exported here for the smoke/batch scripts.

import { UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { UNIT_ORDER } from '../src/logic/types';

export { findBotMove } from '../src/logic/bot';

// Fire every charged program. The Disabler (player-targetable per MK3.2)
// targets the enemy minion with the highest current charge — a reasonable
// dumb policy for the floor-indicator bot.
export function botFireAbilities(g: Game): void {
  for (let i = 0; i < 4; i++) {
    if (g.state.winner) return;
    const u = g.state.units.player[i];
    if (u.charge < UNIT_DEFS[u.type].cost) continue;
    if (u.type === 'disabler') {
      const charges = g.state.units.enemy.map((e) => e.charge);
      const target = charges.indexOf(Math.max(...charges));
      g.fireProgram(UNIT_ORDER.indexOf('disabler'), target);
    } else {
      g.fireProgram(i);
    }
  }
}
