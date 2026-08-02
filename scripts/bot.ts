// Harness bot glue. The move-selection heuristics live in the LOGIC layer
// (src/logic/bot.ts) — re-exported here for the smoke/batch scripts. Use
// botMove(g) so the harness player follows the same config-aware tier
// selection as the enemy (MK7.13 charge-aware NMD tier + sub-option).

import { programById, targetKindOf } from '../src/logic/data/content';
import { Game } from '../src/logic/game';
import { pickBotMove } from '../src/logic/bot';
import { Pt } from '../src/logic/types';

export { findBotMove, findChargeMove, pickBotMove } from '../src/logic/bot';

export function botMove(g: Game): { a: Pt; b: Pt } | null {
  return pickBotMove(g.state.board, g.state.config);
}

// Fire every charged Program in the battle's ACTIVE BUILD (Alpha: against the
// resolved data costs). Targeted Programs get a dumb but deterministic-enough
// policy suitable for a floor-indicator bot:
//   - unit target (Drain): the System slot holding the most charge. §7.4 —
//     only Programs are candidates; the Deck Function's pool is not in
//     state.units and is therefore never offered.
//   - packet target (LineSlice / targeted Bomb): the occupied coordinate whose
//     row currently holds the most Packets, i.e. simply the fullest row.
export function botFireAbilities(g: Game): void {
  const units = g.state.units.player;
  for (let i = 0; i < units.length; i++) {
    if (g.state.winner) return;
    const u = units[i];
    const prog = programById(u.programId);
    if (u.charge < prog.cost) continue;
    switch (targetKindOf(prog)) {
      case 'unit': {
        const charges = g.state.units.enemy.map((e) => e.charge);
        g.fireProgram(i, { kind: 'unit', idx: charges.indexOf(Math.max(...charges)) });
        break;
      }
      case 'packet': {
        const p = fullestRowCell(g);
        if (p) g.fireProgram(i, { kind: 'packet', p });
        break;
      }
      default:
        g.fireProgram(i);
    }
  }
}

function fullestRowCell(g: Game): Pt | null {
  let best: Pt | null = null;
  let bestCount = 0;
  g.state.board.forEach((row, y) => {
    const count = row.reduce((n, t) => n + (t ? 1 : 0), 0);
    if (count <= bestCount) return;
    const x = row.findIndex((t) => !!t);
    if (x < 0) return;
    bestCount = count;
    best = { x, y };
  });
  return best;
}
