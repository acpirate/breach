// Side-agnostic move-selection heuristic (MK3.4, promoted to the logic layer
// in MK5.1 so it can drive the ENEMY's turn when ENEMY_MATCHING is on, as
// well as the headless harness bot). Deliberately weak tier: prefer any move
// that produces a 4+-tile match (which includes every line clear), else the
// first valid move. No look-ahead, no board evaluation — this tier doubles as
// the enemy's difficulty knob later (future work, not a setting now).

import { BOARD_HEIGHT, BOARD_WIDTH } from './constants';
import { swap } from './board';
import { detectMatches } from './match';
import { Board, Pt } from './types';

export function findBotMove(board: Board): { a: Pt; b: Pt } | null {
  const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  let firstValid: { a: Pt; b: Pt } | null = null;
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      for (const d of dirs) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx >= BOARD_WIDTH || ny >= BOARD_HEIGHT) continue;
        const a: Pt = { x, y };
        const b: Pt = { x: nx, y: ny };
        swap(board, a, b);
        const matches = detectMatches(board);
        const makesBig = matches.some((m) => m.length >= 4);
        swap(board, a, b);
        if (makesBig) return { a, b };
        if (matches.length && !firstValid) firstValid = { a, b };
      }
    }
  }
  return firstValid;
}
