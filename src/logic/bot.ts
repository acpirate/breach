// Side-agnostic move-selection heuristic (MK3.4, promoted to the logic layer
// in MK5.1 so it can drive the ENEMY's turn when ENEMY_MATCHING is on, as
// well as the headless harness bot). Deliberately weak tier: prefer any move
// that produces a 4+-tile match (which includes every line clear), else the
// first valid move. No look-ahead, no board evaluation — this tier doubles as
// the enemy's difficulty knob later (future work, not a setting now).

import { BOARD_HEIGHT, BOARD_WIDTH, unitDefsFor } from './constants';
import { swap } from './board';
import { detectMatches } from './match';
import { BattleConfig, Board, Pt, Side } from './types';

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

// MK7.13 — charge-aware tier for NO_MATCH_DAMAGE: prefer-4 is a DAMAGE
// heuristic and under NMD it optimizes for a quantity that no longer exists.
// This tier scores each valid move by how many matched tiles feed the mover's
// unit bindings (color or shape), i.e. it matches for CHARGE. Still one dumb
// selection rule — the bot remains a floor indicator.
// MK9.4: bindings now differ per side, so the scorer uses the ACTING side's
// bindings (the harness drives the player; the enemy's own matching turn
// passes 'enemy').
export function findChargeMove(board: Board, side: Side = 'player'): { a: Pt; b: Pt } | null {
  const defs = unitDefsFor(side);
  const boundColors = new Set(Object.values(defs).map((d) => d.color));
  const boundShapes = new Set(Object.values(defs).map((d) => d.shape));
  const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  let best: { a: Pt; b: Pt } | null = null;
  let bestScore = -1;
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
        let score = -1;
        if (matches.length) {
          score = 0;
          const seen = new Set<number>();
          for (const m of matches) {
            for (const c of m.cells) {
              const k = c.y * BOARD_WIDTH + c.x;
              if (seen.has(k)) continue;
              seen.add(k);
              const t = board[c.y][c.x];
              if (!t || t.kind !== 'standard') continue;
              if (boundColors.has(t.color!)) score++;
              if (boundShapes.has(t.shape!)) score++;
            }
          }
        }
        swap(board, a, b);
        if (score > bestScore) {
          bestScore = score;
          best = { a, b };
        }
      }
    }
  }
  return bestScore >= 0 ? best : null;
}

// Config-aware selection: the NMD charge-aware tier applies only when
// noMatchDamage is on AND the nmdChargeAwareBot sub-option (designer
// addendum, default on) hasn't been switched back to the classic heuristic.
export function pickBotMove(board: Board, config: BattleConfig, side: Side = 'player'): { a: Pt; b: Pt } | null {
  if (config.noMatchDamage && config.nmdChargeAwareBot) return findChargeMove(board, side);
  return findBotMove(board);
}

// MK7.7/MK7.8 — hint helper: a move that produces a 4+ match, if one exists
// (the hint system shows nothing otherwise).
export function findHintMove(board: Board): { a: Pt; b: Pt } | null {
  const dirs = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      for (const d of dirs) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx >= BOARD_WIDTH || ny >= BOARD_HEIGHT) continue;
        const a: Pt = { x, y };
        const b: Pt = { x: nx, y: ny };
        swap(board, a, b);
        const big = detectMatches(board).some((m) => m.length >= 4);
        swap(board, a, b);
        if (big) return { a, b };
      }
    }
  }
  return null;
}
