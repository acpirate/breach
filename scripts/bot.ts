// Shared harness bot (MK3.4). Deliberately weak FLOOR indicator, one notch
// above first-found-move: prefer any move that produces a 4-or-larger match
// (which includes every line clear), else fall back to the first valid move.
// NO cascade look-ahead, NO 5-match prioritization, NO board evaluation —
// its job is to lose most games so human win-rate reads as a delta above a
// known-weak baseline.

import { swap } from '../src/logic/board';
import { UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { detectMatches } from '../src/logic/match';
import { Board, Pt, UNIT_ORDER } from '../src/logic/types';

export function findBotMove(board: Board): { a: Pt; b: Pt } | null {
  const h = board.length;
  const w = board[0].length;
  const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  let firstValid: { a: Pt; b: Pt } | null = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const d of dirs) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx >= w || ny >= h) continue;
        const a: Pt = { x, y };
        const b: Pt = { x: nx, y: ny };
        swap(board, a, b);
        const matches = detectMatches(board);
        const makesBig = matches.some((m) => m.length >= 4);
        swap(board, a, b);
        if (makesBig) return { a, b }; // first 4+-producing move wins
        if (matches.length && !firstValid) firstValid = { a, b };
      }
    }
  }
  return firstValid;
}

// Fire every charged program. The Disabler (player-targetable per MK3.2)
// targets the enemy minion with the highest current charge — mimicking the
// pre-MK3 auto rule as a reasonable dumb policy.
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
