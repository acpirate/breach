// Pure data types shared by all game-logic modules. No DOM, no rendering.

import type { RNG } from './rng';
import type { BattleMetrics } from './metrics';
import type { AreaPatternId } from './data/areas';
import type { EffectId } from './data/effects';

export type Side = 'player' | 'enemy';
export function opponentOf(s: Side): Side {
  return s === 'player' ? 'enemy' : 'player';
}

// Concrete whitebox identities for the 6 colors and 6 shapes (agent discretion,
// approved): colors are six maximally-separated primary/secondary hues; shapes
// are six simple canvas-drawable glyphs.
export enum Color { Red = 0, Yellow, Magenta, Green, Cyan, Blue }
export enum Shape { Circle = 0, Square, Triangle, Diamond, Star, Cross }

// Alpha 0.1.0: a placed special tile carries the DATA that defines its
// behavior — bombs their countdown/footprint, buff/shield tiles their per-tile
// magnitude — plus the placing Program's stable ID for metrics attribution.
// Nothing about a special's behavior is looked up from hardcoded tables.
export interface Special {
  type: 'bomb' | 'buff' | 'shield';
  owner: Side;
  countdown?: number; // bombs only
  areaPattern?: AreaPatternId; // bombs only — blast footprint from Function data
  magnitude?: number; // buff/shield only — per-tile bonus/shield points from data
  programId?: string; // placing Program (metrics/logging attribution)
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

// Alpha 0.1.0: a unit slot is a charge pool bound to a resolved Program by
// stable ID. Program properties (cost, bindings, Function) live in the
// resolved content model, never here.
export interface UnitState { programId: string; charge: number; }

export type Phase = 'playerPre' | 'resolving' | 'enemy' | 'over';

// MK5.2/MK6 — per-battle configuration. Runtime state (part of GameState and
// the save envelope), not global constants; defaults live in constants.ts.
// Alpha 0.1.0: ability costs are CONTENT (Function data), not config — the
// abilityCosts/flatAbilityCost fields are removed (approved change §4.2-4.4).
export interface BattleConfig {
  enemyMatching: boolean; // MK5.1: enemy matches on the shared board (no charge clock)
  hackerBonusEnabled: boolean; // off = no Hacker color bonus at all (symmetric baseline)
  singleAxisPayout: boolean; // on = a match grants CHARGE only on its own axis
  maxCascadeSteps: number | null; // null = infinite (sentinel, NOT a large integer); 0-9 otherwise
  noMatchDamage: boolean; // MK6.2: matches deal ZERO damage (charge unchanged; detonations unaffected)
  playerHp: number; // MK6.4: starting HP, menu-settable (1-9999)
  enemyHp: number;
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
  // Alpha §4.7: charge bindings (Program data) remain independent from these.
  strongColors: Record<Side, Color[]>;
  strongShapes: Record<Side, Shape[]>;
}

export interface GameState {
  board: Board;
  rng: RNG;
  nextId: number;
  nextSeq: number;
  hp: Record<Side, number>;
  units: Record<Side, UnitState[]>; // one slot per resolved Program, content order
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
  // Alpha: the blast footprint comes from the bomb's own data, so the event
  // carries the in-bounds cells for the renderer's flash overlay.
  | { t: 'detonate'; p: Pt; cells: Pt[] }
  // damage carries metrics enrichment (MK2.3/MK7): source = the CAUSAL bucket
  // (the action that initiated the chain, not the mechanism); buffBonus = the
  // buff-tile portion of `amount` (subtracted out into the disjoint buffer
  // bucket, MK7.4); colorRaw/shapeRaw = pre-floor per-axis match damage
  // (MK7.5); cascadeRaw = pre-floor damage from tiles destroyed exclusively
  // by STOCHASTIC refill matches (MK7.3 cross-cut); programId = the acting
  // Program for ability-caused damage (attacker fire / bomb detonation).
  | { t: 'damage'; target: Side; amount: number; label: string; source: 'match' | 'attacker' | 'bomb'; programId?: string; critExtra?: number; buffBonus?: number; colorRaw?: number; shapeRaw?: number; cascadeRaw?: number }
  | { t: 'msg'; text: string }
  | { t: 'over'; winner: Side }
  // metrics/logging-only events (no visual representation; renderer skips them)
  | { t: 'shakeUsed' }
  // Alpha §7.5/§13.4 — one per parent Function ACTIVATION (the player-paid
  // event); `fn` is the activated Function, `name` the Program's display name.
  | { t: 'ability'; side: Side; programId: string; fn: string; name: string }
  // Alpha §7.5 — one per expanded payload OPERATION (child resolution attempt
  // / Effect execution). resolved=false is a LEGAL fizzle (no valid target or
  // placement); unexpected exceptions are implementation failures and
  // propagate through the failure boundary instead of appearing here.
  | { t: 'op'; side: Side; programId: string; fnId: string; effectId: EffectId; resolved: boolean; drained?: number }
  // MK9.1/9.2/9.3 — bombs or shield tiles actually placed by one activation
  // (may be fewer than requested if the board lacks legal targets).
  | { t: 'placed'; side: Side; kind: 'bomb' | 'shield'; count: number; programId: string }
  // MK9.3 — one per shield-affected damage instance. preShield = base+buff
  // before absorption; shield = total active defender shield; prevented =
  // min(preShield, shield); final = preShield - prevented (the dealt amount).
  | { t: 'shield'; target: Side; source: 'match' | 'attacker' | 'bomb'; preShield: number; shield: number; prevented: number; final: number }
  // MK9.3 — shield tiles removed from the board this event (matched,
  // cascaded, or blasted away).
  | { t: 'shieldRemoved'; count: number }
  | { t: 'chargeWaste'; side: Side; programId: string; amount: number }
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
