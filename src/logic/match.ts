// Match detection: straight-line runs of 3+ sharing color, shape, or
// both-neutral. No blob merging, no L/T shapes — each maximal run is its own
// independent match and its tier is judged on its own length alone (spec 1.4).

import { BOARD_HEIGHT, BOARD_WIDTH, MATCH_3_MULTIPLIER, MATCH_4_MULTIPLIER, MATCH_5_LINE_MULTIPLIER } from './constants';
import { Board, Cell, Pt } from './types';

export type MatchCondition = 'color' | 'shape' | 'neutral';

export interface Match {
  cells: Pt[];
  length: number;
  orientation: 'h' | 'v';
  condition: MatchCondition;
}

function keyOf(c: Cell, cond: MatchCondition): number | null {
  if (!c) return null;
  if (cond === 'neutral') return c.kind === 'neutral' ? 0 : null;
  if (c.kind !== 'standard') return null;
  return cond === 'color' ? c.color! : c.shape!;
}

export function detectMatches(board: Board): Match[] {
  const out: Match[] = [];
  const conds: MatchCondition[] = ['color', 'shape', 'neutral'];

  const scan = (
    n: number,
    cellAt: (i: number) => Cell,
    ptAt: (i: number) => Pt,
    orientation: 'h' | 'v',
    cond: MatchCondition,
  ): void => {
    let runKey: number | null = null;
    let runStart = 0;
    for (let i = 0; i <= n; i++) {
      const k = i < n ? keyOf(cellAt(i), cond) : null;
      if (k === null || k !== runKey) {
        const len = i - runStart;
        if (runKey !== null && len >= 3) {
          const cells: Pt[] = [];
          for (let j = runStart; j < i; j++) cells.push(ptAt(j));
          out.push({ cells, length: len, orientation, condition: cond });
        }
        runKey = k;
        runStart = i;
      }
    }
  };

  for (const cond of conds) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      scan(BOARD_WIDTH, (i) => board[y][i], (i) => ({ x: i, y }), 'h', cond);
    }
    for (let x = 0; x < BOARD_WIDTH; x++) {
      scan(BOARD_HEIGHT, (i) => board[i][x], (i) => ({ x, y: i }), 'v', cond);
    }
  }
  return out;
}

// Damage-only multiplier by match length. Runs of 6+ (possible after refills)
// are treated as the 5-line tier: crit + line clear.
export function multiplierForLength(len: number): number {
  return len >= 5 ? MATCH_5_LINE_MULTIPLIER : len === 4 ? MATCH_4_MULTIPLIER : MATCH_3_MULTIPLIER;
}

export function clearsLine(len: number): boolean {
  return len >= 4;
}
