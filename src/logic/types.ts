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

// MK9.3: 'shield' is the enemy Shielder's tile — an enemy-owned board object
// that reduces incoming player-to-enemy damage while it sits on the board.
export interface Special {
  type: 'bomb' | 'buff' | 'shield';
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

export type Phase = 'playerPre' | 'resolving' | 'enemy' | 'over';

// MK5.2/MK6 — per-battle configuration. Runtime state (part of GameState and
// the save envelope), not global constants; defaults live in constants.ts.
// The Scenario type is gone (MK6.4): HP is config, so "forced loss" is just
// playerHp: 1.
export interface BattleConfig {
  enemyMatching: boolean; // MK5.1: enemy matches on the shared board (no charge clock)
  hackerBonusEnabled: boolean; // off = no Hacker color bonus at all (symmetric baseline)
  singleAxisPayout: boolean; // on = a match grants CHARGE only on its own axis
  maxCascadeSteps: number | null; // null = infinite (sentinel, NOT a large integer); 0-9 otherwise
  noMatchDamage: boolean; // MK6.2: matches deal ZERO damage (charge unchanged; detonations unaffected)
  playerHp: number; // MK6.4: starting HP, menu-settable (1-9999)
  enemyHp: number;
  // MK7.1: ability costs as config (defaults 7/13/19/22); flatAbilityCost is
  // the diagnostic that prices ALL units at 7 to de-confound effect from
  // firing rate. Expected to play badly — that's the point.
  abilityCosts: Record<UnitType, number>;
  flatAbilityCost: boolean;
  // MK7.7: hint system (default off; delay in seconds)
  hintEnabled: boolean;
  hintDelaySeconds: number;
  // MK7.13 + designer addendum: when noMatchDamage is on, the bot matches for
  // CHARGE instead of damage — unless this sub-option is turned off, which
  // restores the original charge-agnostic prefer-4 logic. Default ON. Inert
  // when noMatchDamage is off.
  nmdChargeAwareBot: boolean;
  // MK9.4: per-side STRONG bindings (approved: "per-side tier swap"). A tile
  // whose color is in a side's strongColors deals the HIGH color value for
  // that side's own match/blast damage (LOW otherwise); likewise strongShapes.
  // Stored independently per side and stamped into logs — NOT derived from
  // prose. A match may be strong for one side and weak for the other.
  strongColors: Record<Side, Color[]>;
  strongShapes: Record<Side, Shape[]>;
}

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
  turn: number;
  metrics: BattleMetrics; // MK2.3 — accumulated in the logic layer
  battleId: string; // MK4.3 — tags this battle's log entries; survives save/restore
  config: BattleConfig; // MK5.2 — authoritative and immutable for this battle's lifetime
}

// ---- Render-facing snapshots & events (plain serializable data) ----

export interface TileView {
  kind: 'standard' | 'neutral';
  color?: Color;
  shape?: Shape;
  special?: { type: 'bomb' | 'buff' | 'shield'; owner: Side; countdown?: number };
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
  // damage carries metrics enrichment (MK2.3/MK7): source = the CAUSAL bucket
  // (the action that initiated the chain, not the mechanism); buffBonus = the
  // buff-tile portion of `amount` (subtracted out into the disjoint buffer
  // bucket, MK7.4); colorRaw/shapeRaw = pre-floor per-axis match damage
  // (MK7.5); cascadeRaw = pre-floor damage from tiles destroyed exclusively
  // by STOCHASTIC refill matches (MK7.3 cross-cut)
  | { t: 'damage'; target: Side; amount: number; label: string; source: 'match' | 'attacker' | 'bomb'; critExtra?: number; buffBonus?: number; colorRaw?: number; shapeRaw?: number; cascadeRaw?: number }
  | { t: 'msg'; text: string }
  | { t: 'over'; winner: Side }
  // metrics/logging-only events (no visual representation; renderer skips them)
  | { t: 'shakeUsed' }
  // MK9: `name` is the player-facing/log identity (e.g. 'E-Bomb', 'Shielder')
  // when the enemy unit diverges from the shared type label; unit stays the
  // canonical UnitType so metrics buckets are unchanged.
  | { t: 'ability'; side: Side; unit: UnitType; drained?: number; name?: string }
  // MK9.1/9.2/9.3 — bombs or shield tiles actually placed by one activation
  // (may be fewer than requested if the board lacks legal targets).
  | { t: 'placed'; side: Side; kind: 'bomb' | 'shield'; count: number }
  // MK9.3 — one per shield-affected player->enemy damage instance. preShield =
  // base+buff before absorption; shield = total active enemy shield; prevented
  // = min(preShield, shield); final = preShield - prevented (the dealt amount).
  | { t: 'shield'; source: 'match' | 'attacker' | 'bomb'; preShield: number; shield: number; prevented: number; final: number }
  // MK9.3 — enemy shield tiles removed from the board this event (matched,
  // cascaded, or blasted away).
  | { t: 'shieldRemoved'; count: number }
  | { t: 'chargeWaste'; side: Side; unit: UnitType; amount: number }
  | { t: 'autoReshuffle' }
  | { t: 'cascadeDepth'; side: Side; depth: number }
  // MK5.6 — per match step: destroyed-tile count and how many of those tiles
  // were bound to the OPPOSING side's units (charge-source contention)
  | { t: 'tileStats'; side: Side; destroyed: number; contested: number }
  // MK6.6 — raw player think-time for the committed move (input-available ->
  // match-committed), supplied by the orchestrator, never pre-aggregated
  | { t: 'thinkTime'; ms: number }
  // MK7.7 — a hint was shown before this turn's committed move (so the turn
  // can be excluded from think-time analysis)
  | { t: 'hintShown' };
