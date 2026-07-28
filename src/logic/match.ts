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
// A merged blob's tile count sets its DAMAGE tier per the 1.4 table: 5+ crits
// (line or non-line). (Merges always produce >=5 tiles — two >=3-tile runs
// sharing one tile is 5 — so a non-line 4 cannot occur.)
//
// Alpha 0.3.0 §9: row/column CLEAR qualification no longer comes from a single
// match group's own shape. It is computed per resolution wave from the combined
// directly matched footprint — see computeLineClears() below.

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LINE_CLEAR_RUN_LENGTH,
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

// ---- Alpha 0.3.0 §9 — combined direct-match line-clear qualification (B1) ----
//
// This is the ONE authority for row/column-clear qualification. The Alpha 0.2
// per-group predicate (a single straight 4+ blob clears its own line) is gone
// rather than kept alongside it, so there is no second, competing rule.

// One qualifying row or column clear for a resolution wave. `index` is the row
// y for 'h' and the column x for 'v'.
export interface LineClear {
  orientation: 'h' | 'v';
  index: number;
}

const cellKey = (x: number, y: number): number => y * BOARD_WIDTH + x;

// §9.1 — the approved B1 rule: within each resolution wave, UNION every tile
// belonging directly to a detected color-axis or shape-axis Sync, then any
// contiguous horizontal or vertical run of LINE_CLEAR_RUN_LENGTH+ cells in that
// union triggers the corresponding row/column clear. The player-visible
// directly matched footprint controls qualification — not hidden group
// composition — so two adjacent internally separate match-3 groups CAN combine,
// and overlapping color/shape Syncs CAN combine.
//
// Neutral Syncs are deliberately NOT folded into the color/shape union
// (approved decision): a straight neutral run of 4+ keeps its own standalone
// qualification, exactly as in Alpha 0.2, and neutral tiles are never pulled
// into a color/shape union.
//
// Each qualifying row and column fires exactly ONCE per wave (§9.2 step 4), and
// only DIRECT match footprints contribute — line-clear collateral, Bomb or
// countdown destruction, Function/Skill destruction, and prior line clears are
// all excluded (§9.3), which is what makes the rule non-recursive.
export function computeLineClears(matches: ReadonlyArray<Match>): LineClear[] {
  const union = new Set<number>();
  for (const m of matches) {
    if (m.condition === 'neutral') continue;
    for (const c of m.cells) union.add(cellKey(c.x, c.y));
  }

  const out: LineClear[] = [];
  const seen = new Set<string>();
  const add = (orientation: 'h' | 'v', index: number): void => {
    const k = `${orientation}${index}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ orientation, index });
  };

  // maximal contiguous runs in the combined footprint, per row then per column
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    let run = 0;
    for (let x = 0; x <= BOARD_WIDTH; x++) {
      const on = x < BOARD_WIDTH && union.has(cellKey(x, y));
      if (on) run++;
      else {
        if (run >= LINE_CLEAR_RUN_LENGTH) add('h', y);
        run = 0;
      }
    }
  }
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let run = 0;
    for (let y = 0; y <= BOARD_HEIGHT; y++) {
      const on = y < BOARD_HEIGHT && union.has(cellKey(x, y));
      if (on) run++;
      else {
        if (run >= LINE_CLEAR_RUN_LENGTH) add('v', x);
        run = 0;
      }
    }
  }

  // preserved Alpha 0.2 behavior: a straight neutral run of 4+ clears its own
  // row/column independently of the color/shape union
  for (const m of matches) {
    if (m.condition !== 'neutral' || !m.isLine || m.length < LINE_CLEAR_RUN_LENGTH) continue;
    if (m.orientation === 'h') add('h', m.cells[0].y);
    else if (m.orientation === 'v') add('v', m.cells[0].x);
  }

  return out;
}
