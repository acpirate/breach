// Board generation, swaps, deadlock detection, and the two reshuffle paths
// (player board-shake: matches allowed; automatic deadlock reshuffle: must
// yield >=1 valid move and no pre-existing match). Pure logic, no rendering.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, NEUTRAL_TILE_DROP_RATE, SHAPE_COUNT } from './constants';
import {
  SHAKE_PREVENT_MATCHES,
  SHAKE_REMOVE_SPECIALS,
  SHAKE_REPLACE,
  ShakeParams,
} from './data/content';
import { detectMatches } from './match';
import { Board, Cell, Pt, Tile } from './types';
import type { RNG } from './rng';

// Structural subset of GameState that tile generation needs.
export interface TileGen {
  rng: RNG;
  nextId: number;
}

export function randomTile(gen: TileGen): Tile {
  const id = gen.nextId++;
  if (gen.rng.next() < NEUTRAL_TILE_DROP_RATE) return { id, kind: 'neutral' };
  return { id, kind: 'standard', color: gen.rng.int(COLOR_COUNT), shape: gen.rng.int(SHAPE_COUNT) };
}

function emptyBoard(): Board {
  const b: Board = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) b.push(new Array<Cell>(BOARD_WIDTH).fill(null));
  return b;
}

// Would placing tile t at (x,y) complete a horizontal or vertical run of 3
// with the two already-placed tiles to its left / above it? (Used during
// row-major fills to avoid pre-existing matches, and by the MK5 constrained
// refill to bias replacement tiles away from new matches.)
export function completesRun(board: Board, x: number, y: number, t: Tile): boolean {
  const trip = (a: Cell, b: Cell): boolean => {
    if (!a || !b) return false;
    if (t.kind === 'neutral') return a.kind === 'neutral' && b.kind === 'neutral';
    if (a.kind !== 'standard' || b.kind !== 'standard') return false;
    if (a.color === t.color && b.color === t.color) return true;
    if (a.shape === t.shape && b.shape === t.shape) return true;
    return false;
  };
  if (x >= 2 && trip(board[y][x - 1], board[y][x - 2])) return true;
  if (y >= 2 && trip(board[y - 1][x], board[y - 2][x])) return true;
  return false;
}

// Initial board: no pre-existing matches, and at least one valid move (a dead
// starting board would just trigger the auto-reshuffle anyway, so guarantee it
// here directly).
export function generateInitialBoard(gen: TileGen): Board {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = emptyBoard();
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        let t = randomTile(gen);
        let guard = 0;
        while (completesRun(board, x, y, t) && guard++ < 200) t = randomTile(gen);
        board[y][x] = t;
      }
    }
    if (detectMatches(board).length === 0 && hasAnyValidMove(board)) return board;
  }
  throw new Error('failed to generate a valid initial board');
}

export function swap(board: Board, a: Pt, b: Pt): void {
  const t = board[a.y][a.x];
  board[a.y][a.x] = board[b.y][b.x];
  board[b.y][b.x] = t;
}

// Brute-force deadlock scan (spec 1.7 reference implementation): tentatively
// swap every tile with its east and south neighbor, test for a match, revert.
export function findValidMove(board: Board): { a: Pt; b: Pt } | null {
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
        const ok = detectMatches(board).length > 0;
        swap(board, a, b);
        if (ok) return { a, b };
      }
    }
  }
  return null;
}

export function hasAnyValidMove(board: Board): boolean {
  return findValidMove(board) !== null;
}

// Alpha 0.3.0 §8 — EFFECT_SHAKE. ONE authoritative Shake implementation, driven
// entirely by the typed parameters resolved from Function data; there is no
// competing hardcoded cost, ownership, parameter, or charge path (§8.1).
//
// Returns true when a valid final Datastream was produced and committed, false
// for the LEGAL FIZZLE (§8.7): the Datastream is left completely unchanged, the
// caller keeps the paid activation cost, and nothing about RNG ownership, turn
// state, or input state is corrupted. All work happens on a scratch arrangement
// and is committed only on success.
export function shakeBoard(
  state: { board: Board; rng: RNG; nextId: number },
  params: ShakeParams,
): boolean {
  const cells: Pt[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) cells.push({ x, y });

  // §8.3 REPLACE is destructive: the prior underlying Packet AND any special
  // state on the tile are removed regardless of the specialGems parameter, so
  // fresh ordinary Packets are generated. REARRANGE permutes the existing tile
  // OBJECTS, preserving board membership and overall composition — positions
  // change, which is the whole point ("preserve the underlying tile" never
  // meant preserving its coordinate).
  const replace = params.boardComposition === SHAKE_REPLACE;
  const stripSpecials = params.specialGems === SHAKE_REMOVE_SPECIALS;
  const preventMatches = params.matches === SHAKE_PREVENT_MATCHES;

  const existing: Tile[] = [];
  for (const row of state.board) for (const t of row) if (t) existing.push(t);
  // A Shake over a board with holes is not a legal starting point (Shake is
  // only reachable from a settled Datastream); fizzle rather than corrupt.
  if (existing.length !== BOARD_WIDTH * BOARD_HEIGHT) return false;

  for (let attempt = 0; attempt < 1000; attempt++) {
    // Draft the arrangement without touching state.board.
    const draft = emptyBoard();
    let draftNextId = state.nextId;
    if (replace) {
      const gen = { rng: state.rng, nextId: draftNextId };
      for (const p of cells) {
        // ordinary Packets only — replacement never carries special state
        draft[p.y][p.x] = randomTile(gen);
      }
      draftNextId = gen.nextId;
    } else {
      const order = existing.slice();
      state.rng.shuffle(order);
      let i = 0;
      for (const p of cells) draft[p.y][p.x] = order[i++];
    }

    // §8.4 under REARRANGE: RETAIN moves each special object with its
    // underlying Packet (automatic — same Tile objects, relocated), while
    // REMOVE strips the overlay/state and keeps the ordinary Packet. Under
    // REPLACE there is no prior state left to retain or strip.
    if (stripSpecials && !replace) {
      for (const p of cells) {
        const t = draft[p.y][p.x];
        if (t?.special) delete t.special;
      }
    }

    // §8.5: when matches are PREVENTED the completed Shake must satisfy the
    // normal post-generation invariants (no pre-existing Sync, at least one
    // legal move) so no wave begins. When matches are ALLOWED the resulting
    // Syncs are meant to resolve, so a pre-existing match is the desired state;
    // playability is re-established by the post-resolution settle.
    const ok = preventMatches
      ? detectMatches(draft).length === 0 && hasAnyValidMove(draft)
      : true;
    if (ok) {
      state.board = draft;
      state.nextId = draftNextId;
      return true;
    }
    // REPLACE burns fresh ids per attempt; keep the counter monotonic so tile
    // identity never repeats across attempts.
    state.nextId = draftNextId;
  }
  return false; // §8.7 legal fizzle — board untouched
}

// Shared reshuffle core (spec 1.7, MK2.2 unification, revised by MK7.9): the
// automatic deadlock reshuffle is a PERMUTATION — the board's composition
// (which tiles exist) is preserved exactly; only positions change. No free
// composition reroll on deadlock, and a future tile-converting ability's
// investment survives it. Special tiles persist with all their data (they're
// the same Tile objects, just relocated).
// Validity contract unchanged: >=1 valid move, NO pre-existing match, so the
// re-permute-until-valid loop remains. Safeguard: if no valid permutation is
// found within the attempt budget (pathologically skewed composition —
// effectively impossible at 64 tiles), fall back to the old constrained
// re-randomization rather than softlock.
export function reshuffleBoard(state: { board: Board; rng: RNG; nextId: number }): void {
  const tiles: Tile[] = [];
  for (const row of state.board) for (const t of row) if (t) tiles.push(t);

  for (let attempt = 0; attempt < 1000; attempt++) {
    state.rng.shuffle(tiles);
    const board = emptyBoard();
    let i = 0;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        board[y][x] = tiles[i++];
      }
    }
    if (detectMatches(board).length === 0 && hasAnyValidMove(board)) {
      state.board = board;
      return;
    }
  }

  // Fallback (composition has no valid arrangement we could find): regenerate
  // non-special tiles with the pre-MK7 constrained fill. Never softlock.
  const specials = tiles.filter((t) => t.special);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = emptyBoard();
    const cells: Pt[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) cells.push({ x, y });
    state.rng.shuffle(cells);
    specials.forEach((s, i) => {
      const p = cells[i];
      board[p.y][p.x] = s;
    });
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (board[y][x]) continue;
        let t = randomTile(state);
        let guard = 0;
        while (completesRun(board, x, y, t) && guard++ < 200) t = randomTile(state);
        board[y][x] = t;
      }
    }
    if (detectMatches(board).length === 0 && hasAnyValidMove(board)) {
      state.board = board;
      return;
    }
  }
  throw new Error('failed to produce a valid reshuffle');
}
