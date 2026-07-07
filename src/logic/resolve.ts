// Damage / charge / cascade resolution. The heart of the combat rules:
//  - damage and charge are computed per DESTROYED TILE over an explicit set
//    (never per match — shared tiles count exactly once, at their highest
//    qualifying multiplier),
//  - charge is flat per tile (no multipliers), owner-scoped, capped at cost,
//  - buff bonus applies once per STEP,
//  - bomb detonations destroy neighbors as normal tiles (no chains, no charge).

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOARD_SHAKE_COST,
  BUFFER_DAMAGE_BONUS,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_NEUTRAL,
  HACKER_BONUS_CHARGE,
  HACKER_BONUS_COLOR,
  HACKER_BONUS_DAMAGE,
  HIGH_COLORS,
  SHAKE_CHARGE_PER_NEUTRAL_TILE,
  UNIT_DEFS,
} from './constants';
import { clearsLine, detectMatches, multiplierForLength } from './match';
import { hasAnyValidMove, randomTile, reshuffleBoard } from './board';
import { GameEvent, GameState, Pt, Side, Tile, UnitState, gridViewOf, opponentOf, tileViewOf } from './types';

export function buffBonus(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'buff' && t.special.owner === side) n++;
    }
  }
  return n * BUFFER_DAMAGE_BONUS;
}

// Per-tile base damage value. The Hacker passive (+1 on Red) applies only to
// PLAYER-owned MATCH events — never to bomb blasts and never to enemy events.
export function baseDamage(t: Tile, owner: Side, fromMatch: boolean): number {
  if (t.kind === 'neutral') return DAMAGE_PER_TILE_NEUTRAL;
  let v = HIGH_COLORS.includes(t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
  if (fromMatch && owner === 'player' && t.color === HACKER_BONUS_COLOR) v += HACKER_BONUS_DAMAGE;
  return v;
}

// Charge cap = activation cost, applied at the moment charge is added.
export function addUnitCharge(u: UnitState, amount: number): void {
  u.charge = Math.min(UNIT_DEFS[u.type].cost, u.charge + amount);
}

export function addShakeCharge(state: GameState, amount: number): void {
  state.shakeCharge = Math.min(BOARD_SHAKE_COST, state.shakeCharge + amount);
}

export function dealDamage(state: GameState, target: Side, amount: number, label: string, events: GameEvent[]): void {
  if (state.winner || amount <= 0) return;
  state.hp[target] -= amount;
  events.push({ t: 'damage', target, amount, label });
  if (state.hp[target] <= 0) {
    state.winner = opponentOf(target);
    state.phase = 'over';
    events.push({ t: 'over', winner: state.winner });
  }
}

// Charge from one destroyed tile in a MATCH step. Owner-scoped: only the
// event-owning side's units (and, for the player, the shake meter) gain.
function chargeFromDestroyedTile(state: GameState, owner: Side, t: Tile): void {
  if (t.kind === 'neutral') {
    if (owner === 'player') addShakeCharge(state, SHAKE_CHARGE_PER_NEUTRAL_TILE);
    return;
  }
  for (const u of state.units[owner]) {
    const def = UNIT_DEFS[u.type];
    if (def.color === t.color) {
      let c = CHARGE_PER_TILE_COLOR_MATCH;
      if (owner === 'player' && t.color === HACKER_BONUS_COLOR) c += HACKER_BONUS_CHARGE;
      addUnitCharge(u, c);
    }
    if (def.shape === t.shape) addUnitCharge(u, CHARGE_PER_TILE_SHAPE_MATCH);
  }
}

export function applyGravityAndRefill(state: GameState, events: GameEvent[]): void {
  const moves: { from: Pt; to: Pt }[] = [];
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let write = BOARD_HEIGHT - 1;
    for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
      const t = state.board[y][x];
      if (!t) continue;
      if (y !== write) {
        state.board[write][x] = t;
        state.board[y][x] = null;
        moves.push({ from: { x, y }, to: { x, y: write } });
      }
      write--;
    }
  }
  if (moves.length) events.push({ t: 'fall', moves });

  const spawns: { p: Pt; view: ReturnType<typeof tileViewOf> }[] = [];
  for (let x = 0; x < BOARD_WIDTH; x++) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (!state.board[y][x]) {
        const nt = randomTile(state);
        state.board[y][x] = nt;
        spawns.push({ p: { x, y }, view: tileViewOf(nt) });
      }
    }
  }
  if (spawns.length) events.push({ t: 'spawn', tiles: spawns });
}

// Resolve all match steps for one owner-side event until the board settles.
// Each loop iteration is one "step" (spec 1.5): all simultaneous matches in
// the current board state resolve together, with a single buff application.
export function resolveCascades(state: GameState, owner: Side, events: GameEvent[]): void {
  while (!state.winner) {
    const matches = detectMatches(state.board);
    if (!matches.length) break;

    // Per destroyed tile: highest multiplier it qualifies for, applied once.
    const mult = new Map<number, { p: Pt; m: number }>();
    const bump = (x: number, y: number, m: number): void => {
      const k = y * BOARD_WIDTH + x;
      const cur = mult.get(k);
      if (!cur || m > cur.m) mult.set(k, { p: { x, y }, m });
    };
    for (const match of matches) {
      const m = multiplierForLength(match.length);
      for (const c of match.cells) bump(c.x, c.y, m);
      if (clearsLine(match.length)) {
        // 4/5-line: the entire row/column is cleared at this match's multiplier.
        if (match.orientation === 'h') {
          const y = match.cells[0].y;
          for (let x = 0; x < BOARD_WIDTH; x++) bump(x, y, m);
        } else {
          const x = match.cells[0].x;
          for (let y = 0; y < BOARD_HEIGHT; y++) bump(x, y, m);
        }
      }
    }

    // Buff bonus: once per step, computed BEFORE removal so a same-side buff
    // destroyed in this step still counts toward this step's damage.
    const bonus = buffBonus(state, owner);

    let raw = 0;
    const destroyed: Pt[] = [];
    for (const { p, m } of mult.values()) {
      const t = state.board[p.y][p.x];
      if (!t) continue;
      destroyed.push(p);
      raw += baseDamage(t, owner, true) * m;
      chargeFromDestroyedTile(state, owner, t);
    }

    events.push({ t: 'destroy', cells: destroyed });
    for (const p of destroyed) state.board[p.y][p.x] = null;

    // Fractional crit sums are floored (documented in README).
    dealDamage(state, opponentOf(owner), Math.floor(raw) + bonus, owner === 'player' ? 'match' : 'enemy match', events);
    applyGravityAndRefill(state, events);
  }
  if (!state.winner) ensureNoDeadlock(state, events);
}

// Bomb detonation: destroys the bomb + its 4 orthogonal neighbors as NORMAL
// tiles (no chain detonations, no re-triggers), deals per-tile damage to the
// owner's opponent (same-side buffs caught in the blast still count for this
// blast), grants NO charge, then resolves resulting cascades as owner-side
// match steps.
export function resolveDetonation(state: GameState, p: Pt, events: GameEvent[]): void {
  const bomb = state.board[p.y][p.x];
  if (!bomb || bomb.special?.type !== 'bomb') return;
  const owner = bomb.special.owner;

  events.push({ t: 'detonate', p });
  const cells: Pt[] = [p];
  for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    const nx = p.x + d.x;
    const ny = p.y + d.y;
    if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT && state.board[ny][nx]) {
      cells.push({ x: nx, y: ny });
    }
  }

  const bonus = buffBonus(state, owner);
  let raw = 0;
  for (const c of cells) raw += baseDamage(state.board[c.y][c.x]!, owner, false);

  events.push({ t: 'destroy', cells });
  for (const c of cells) state.board[c.y][c.x] = null;

  dealDamage(state, opponentOf(owner), raw + bonus, owner === 'player' ? 'your bomb' : 'enemy bomb', events);
  if (state.winner) return;

  applyGravityAndRefill(state, events);
  resolveCascades(state, owner, events);
}

// Run after every settle: if the board has no valid moves, the automatic
// deadlock reshuffle triggers (guaranteed >=1 move, no pre-existing match).
export function ensureNoDeadlock(state: GameState, events: GameEvent[]): void {
  if (hasAnyValidMove(state.board)) return;
  reshuffleBoard(state, false);
  events.push({ t: 'msg', text: 'No moves left — board reshuffled' });
  events.push({ t: 'board', grid: gridViewOf(state.board) });
}
