// Board generation, swaps, deadlock detection, and the two reshuffle paths
// (player board-shake: matches allowed; automatic deadlock reshuffle: must
// yield >=1 valid move and no pre-existing match). Pure logic, no rendering.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, NEUTRAL_TILE_DROP_RATE, SHAPE_COUNT } from './constants';
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

// Shared reshuffle core (spec 1.7, as revised by MK2.2): the player-paid
// board-shake and the automatic deadlock reshuffle are now IDENTICAL. Both
// reposition ALL tiles (special tiles persist with color/shape/owner/duration
// unchanged, at new random positions; non-special tiles get entirely new
// random assignments), and both guarantee >=1 valid move with NO pre-existing
// match — no damage, no charge, no cascades. The old "player shake may land
// on matches as a cascade payoff" rule is removed.
export function reshuffleBoard(state: { board: Board; rng: RNG; nextId: number }): void {
  const specials: Tile[] = [];
  for (const row of state.board) for (const t of row) if (t?.special) specials.push(t);

  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = emptyBoard();
    const cells: Pt[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) cells.push({ x, y });
    state.rng.shuffle(cells);
    specials.forEach((s, i) => {
      const p = cells[i];
      board[p.y][p.x] = s;
    });

    // Constrained fill: local rejection keeps most matches from forming; the
    // full-board validation below catches the rest (e.g. runs completed by a
    // pre-placed special to the right/below) and retries.
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
  throw new Error('failed to produce a valid deadlock reshuffle');
}
