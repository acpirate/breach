// Match detection (MK3.3): straight-line 3+ base runs, then blob/merge.
//
// Base runs are detected PER AXIS — color-runs, shape-runs, and neutral-runs
// separately — and tagged with their (condition, value) identity. The merge
// pass then unions any two matches of the SAME condition+value whose tiles
// overlap or sit orthogonally adjacent, repeating until no merges occur
// (handles multi-way merge chains). Color-matches and shape-matches are
// different match-types and never merge into each other; different-axis
// matches that merely touch still do not combine.
//
// The merge is deliberately naive O(n^2) over simultaneous matches — at 8x8
// with a handful of matches this is microseconds. Do not micro-optimize.
//
// A merged blob's tile count sets its tier; its shape (line vs non-line) sets
// clear/crit per the 1.4 table: line 4+ clears its row/column, 5+ crits;
// non-line 5+ crits with no clear. (Merges always produce >=5 tiles — two
// >=3-tile runs sharing one tile is 5 — so a non-line 4 cannot occur; it
// would resolve as a plain 1.0x clear if it ever did.)

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MATCH_3_MULTIPLIER,
  MATCH_4_MULTIPLIER,
  MATCH_5_LINE_MULTIPLIER,
  MATCH_5_NONLINE_MULTIPLIER,
} from './constants';
import { Board, Cell, Pt } from './types';

export type MatchCondition = 'color' | 'shape' | 'neutral';

export interface Match {
  cells: Pt[]; // unique tiles
  length: number;
  condition: MatchCondition; // match-type axis
  value: number; // color index / shape index (0 for neutral)
  isLine: boolean; // all cells share one row or one column
  orientation: 'h' | 'v' | null; // set when isLine
}

function keyOf(c: Cell, cond: MatchCondition): number | null {
  if (!c) return null;
  if (cond === 'neutral') return c.kind === 'neutral' ? 0 : null;
  if (c.kind !== 'standard') return null;
  return cond === 'color' ? c.color! : c.shape!;
}

function detectBaseRuns(board: Board): Match[] {
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
          out.push({ cells, length: len, condition: cond, value: runKey, isLine: true, orientation });
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

// Two matches touch when any tile of one equals or is orthogonally adjacent
// to any tile of the other (confirmed semantics: physically touching only —
// a one-tile gap does NOT bridge).
function touchesOrOverlaps(a: Match, b: Match): boolean {
  for (const ca of a.cells) {
    for (const cb of b.cells) {
      if (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) <= 1) return true;
    }
  }
  return false;
}

function mergeTwo(a: Match, b: Match): Match {
  const seen = new Set<number>();
  const cells: Pt[] = [];
  for (const c of [...a.cells, ...b.cells]) {
    const k = c.y * BOARD_WIDTH + c.x;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push(c);
  }
  const sameRow = cells.every((c) => c.y === cells[0].y);
  const sameCol = cells.every((c) => c.x === cells[0].x);
  return {
    cells,
    length: cells.length,
    condition: a.condition,
    value: a.value,
    isLine: sameRow || sameCol,
    orientation: sameRow ? 'h' : sameCol ? 'v' : null,
  };
}

export function detectMatches(board: Board): Match[] {
  const matches = detectBaseRuns(board);
  // Repeat-until-stable merge loop: same condition+value, touching/overlapping.
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < matches.length; i++) {
      for (let j = i + 1; j < matches.length; j++) {
        const a = matches[i];
        const b = matches[j];
        if (a.condition !== b.condition || a.value !== b.value) continue;
        if (!touchesOrOverlaps(a, b)) continue;
        matches[i] = mergeTwo(a, b);
        matches.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return matches;
}

// Damage-only multiplier by tier (1.4 table). Line 6+ counts as the 5-line
// tier; non-line 5+ as the non-line-5 (crit, no clear) tier.
export function matchMultiplier(m: Match): number {
  if (m.length >= 5) return m.isLine ? MATCH_5_LINE_MULTIPLIER : MATCH_5_NONLINE_MULTIPLIER;
  if (m.length === 4) return MATCH_4_MULTIPLIER;
  return MATCH_3_MULTIPLIER;
}

// Row/column clears require a STRAIGHT line of 4+ (non-line blobs never clear).
export function matchClearsLine(m: Match): boolean {
  return m.isLine && m.length >= 4;
}
