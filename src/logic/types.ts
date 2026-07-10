// Pure data types shared by all game-logic modules. No DOM, no rendering.

import type { RNG } from './rng';
import type { BattleMetrics } from './metrics';

export type Side = 'player' | 'enemy';
export function opponentOf(s: Side): Side {
  return s === 'player' ? 'enemy' : 'player';
}

// Concrete whitebox identities for the 6 colors and 6 shapes (agent discretion,
// approved): colors are six maximally-separated primary/secondary hues; shapes
// are six simple canvas-drawable glyphs.
export enum Color { Red = 0, Yellow, Magenta, Green, Cyan, Blue }
export enum Shape { Circle = 0, Square, Triangle, Diamond, Star, Cross }

export type UnitType = 'bomber' | 'buffer' | 'attacker' | 'disabler';
export const UNIT_ORDER: UnitType[] = ['bomber', 'buffer', 'attacker', 'disabler'];

export interface Special {
  type: 'bomb' | 'buff';
  owner: Side;
  countdown?: number; // bombs only
  seq: number; // global placement order — bombs tick oldest-first
}

export interface Tile {
  id: number;
  kind: 'standard' | 'neutral';
  color?: Color; // standard only
  shape?: Shape; // standard only
  special?: Special; // only standard (non-neutral) tiles can be special
}

export type Cell = Tile | null;
export type Board = Cell[][]; // [y][x], y = 0 is the top row

export interface Pt { x: number; y: number; }

export interface UnitState { type: UnitType; charge: number; }

export type Scenario = 'normal' | 'forcedLoss';
export type Phase = 'playerPre' | 'resolving' | 'enemy' | 'over';

export interface GameState {
  board: Board;
  rng: RNG;
  nextId: number;
  nextSeq: number;
  hp: Record<Side, number>;
  units: Record<Side, UnitState[]>; // 4 per side, in UNIT_ORDER
  shakeCharge: number; // player only — enemy has no board-shake
  phase: Phase;
  winner: Side | null;
  scenario: Scenario;
  turn: number;
  metrics: BattleMetrics; // MK2.3 — accumulated in the logic layer
  battleId: string; // MK4.3 — tags this battle's log entries; survives save/restore
}

// ---- Render-facing snapshots & events (plain serializable data) ----

export interface TileView {
  kind: 'standard' | 'neutral';
  color?: Color;
  shape?: Shape;
  special?: { type: 'bomb' | 'buff'; owner: Side; countdown?: number };
}

export function tileViewOf(t: Tile): TileView {
  const v: TileView = { kind: t.kind };
  if (t.kind === 'standard') {
    v.color = t.color;
    v.shape = t.shape;
  }
  if (t.special) {
    v.special = { type: t.special.type, owner: t.special.owner, countdown: t.special.countdown };
  }
  return v;
}

// Only valid on a settled (fully populated) board.
export function gridViewOf(board: Board): TileView[][] {
  return board.map((row) => row.map((t) => tileViewOf(t!)));
}

export type GameEvent =
  | { t: 'swap'; a: Pt; b: Pt }
  | { t: 'revert'; a: Pt; b: Pt }
  | { t: 'noMatch' }
  | { t: 'destroy'; cells: Pt[] }
  | { t: 'fall'; moves: { from: Pt; to: Pt }[] }
  | { t: 'spawn'; tiles: { p: Pt; view: TileView }[] }
  | { t: 'board'; grid: TileView[][] }
  | { t: 'setTile'; p: Pt; view: TileView }
  | { t: 'countdown'; p: Pt; value: number }
  | { t: 'detonate'; p: Pt }
  // damage carries metrics enrichment (MK2.3): source bucket, the portion
  // added by the 1.5x crit multiplier (pre-floor), and the buff-tile bonus
  // portion included in `amount`
  | { t: 'damage'; target: Side; amount: number; label: string; source: 'match' | 'attacker' | 'bomb'; critExtra?: number; buffBonus?: number }
  | { t: 'msg'; text: string }
  | { t: 'over'; winner: Side }
  // metrics/logging-only events (no visual representation; renderer skips them)
  | { t: 'shakeUsed' }
  | { t: 'ability'; side: Side; unit: UnitType; drained?: number }
  | { t: 'chargeWaste'; side: Side; unit: UnitType; amount: number }
  | { t: 'autoReshuffle' }
  | { t: 'cascadeDepth'; side: Side; depth: number };
