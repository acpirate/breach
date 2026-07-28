// Pure data types shared by all game-logic modules. No DOM, no rendering.

import type { RNG } from './rng';
import type { BattleMetrics } from './metrics';
import type { AreaPatternId } from './data/areas';
import type { EffectId } from './data/effects';

export type Side = 'player' | 'enemy';
export function opponentOf(s: Side): Side {
  return s === 'player' ? 'enemy' : 'player';
}

// ---- Alpha 0.2.0 session vocabulary (§3.1/§5.4) ----
// Typed mode discriminator — mode is never inferred from screen state, Run
// step, labels, or nullable fields.
export type Mode = 'QUICK_MATCH' | 'RUN';
export type RunStep = 1 | 2 | 3 | 4;
// Natural outcomes and wizard actions are recorded SEPARATELY: a later wizard
// decision never overwrites the battle's natural result.
export type NaturalOutcome = 'NATURAL_VICTORY' | 'NATURAL_DEFEAT';
export type WizardAction = 'WIZARD_FORCE_WIN' | 'WIZARD_RESTART_LOST_BATTLE' | 'WIZARD_RESTART_RUN';

// Alpha 0.3.0 §21.2 — how the active Hacker/Deck identity was chosen. Quick
// Match records defaulted identity; New Run records an explicit selection.
export type SelectionSource = 'EXPLICIT_SELECTION' | 'QUICK_MATCH_DEFAULT';

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

// ---- Alpha 0.3.0 §10.2 — player-chosen SETTINGS ----
// The menu-persisted configuration. These are the values a player actually
// picks; everything identity-derived (effective LINK/ICE maxima, strong sets)
// is RESOLVED at battle creation into BattleConfig below, so the settings can
// never become a competing authority for Hacker strength (§5.4).
export interface BattleSettings {
  enemyMatching: boolean; // MK5.1: System matches on the shared Datastream
  singleAxisPayout: boolean; // on = a Sync grants CHARGE only on its own axis
  maxCascadeSteps: number | null; // null = infinite (sentinel, NOT a large integer); 0-9 otherwise
  // §11 — formerly "No Match Damage". Suppresses ordinary BASE Sync damage for
  // both sides; Skill- and Function-originated effects triggered by a Sync
  // still resolve (§11.2).
  reinforcedConnection: boolean;
  // §10.2 — when ON, maximum LINK/ICE derive from the selected Hacker and Deck
  // and (in a Run) the encounter table. When OFF, the manual values below are
  // used for the Hacker and for EVERY Run encounter.
  normalLink: boolean;
  manualHackerLink: number; // used only when normalLink is OFF
  manualSystemIce: number; // used only when normalLink is OFF
  // MK7.7: hint system (default off; delay in seconds)
  hintEnabled: boolean;
  hintDelaySeconds: number;
  // MK7.13 + designer addendum: under Reinforced Connection the bot matches for
  // CHARGE instead of damage — unless this sub-option is off, which restores the
  // charge-agnostic prefer-4 logic. Inert when reinforcedConnection is off.
  reinforcedChargeAwareBot: boolean;
}

// The per-battle configuration: the chosen settings PLUS the values resolved
// from the active Hacker/Deck identity at battle creation. Immutable for the
// battle's lifetime (MK5.4) and stamped into saves and logs.
export interface BattleConfig extends BattleSettings {
  // §10.1 — internal names retained deliberately: these ARE the effective
  // Hacker maximum LINK and System maximum ICE for this battle. Renaming the
  // persisted fields would create migration risk for no behavioral gain.
  playerHp: number;
  enemyHp: number;
  // §5.4 — per-side STRONG bindings, RESOLVED from the selected Hacker: the
  // Hacker's authored strong sets, and the System's as their complements. A
  // tile whose color is in a side's strongColors deals the HIGH color value for
  // that side's own Sync/blast damage (LOW otherwise); likewise strongShapes.
  // Charge bindings (Program data) remain independent of these (§5.4).
  strongColors: Record<Side, Color[]>;
  strongShapes: Record<Side, Shape[]>;
}

// ---- Alpha 0.3.0 §5.1 — active battle identity ----
// An active battle has EXPLICIT Hacker, Deck, Skill, Deck-Function, and ordered
// Program identity. None of it is ever inferred from a display name, the
// current screen, a Function ID, the Program roster, or a row position.
export interface BattleIdentity {
  hackerId: string;
  deckId: string;
  skillIds: string[]; // ordered; duplicates are meaningful (§6.4)
  deckFunctionId: string;
  hackerPrograms: string[]; // ordered stable PRG_H_* IDs
  systemPrograms: string[]; // ordered stable PRG_S_* IDs
  selectionSource: SelectionSource;
}

export interface GameState {
  board: Board;
  rng: RNG;
  nextId: number;
  nextSeq: number;
  hp: Record<Side, number>;
  units: Record<Side, UnitState[]>; // one slot per resolved Program, content order
  // §7.2 — the active Deck's independent charge pool for its directly assigned
  // Function. Capped at that Function's cost; reset at every battle start from
  // `startCharged`; never persisted between Run encounters. Deck-owned, NOT a
  // Program (§7.1) and never an eligible Drain target (§7.4).
  deckCharge: number;
  identity: BattleIdentity;
  phase: Phase;
  winner: Side | null;
  turn: number;
  metrics: BattleMetrics; // MK2.3 — accumulated in the logic layer
  battleId: string; // §17.4 — collision-resistant; survives save/restore
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

// Snapshot of the whole Datastream. A concluded battle's board may legitimately
// contain holes (resolution halts at game over, §5.1 saves pending results),
// so empty cells map to null.
export function gridViewOf(board: Board): (TileView | null)[][] {
  return board.map((row) => row.map((t) => (t ? tileViewOf(t) : null)));
}

// Alpha 0.3.0 §7.1 — an activation's owner is either a Program or the Deck.
// Runtime, save, targeting, metrics, and logs must distinguish them.
export type OwnerKind = 'program' | 'deck';

export type GameEvent =
  | { t: 'swap'; a: Pt; b: Pt }
  | { t: 'revert'; a: Pt; b: Pt }
  | { t: 'noMatch' }
  | { t: 'destroy'; cells: Pt[] }
  | { t: 'fall'; moves: { from: Pt; to: Pt }[] }
  | { t: 'spawn'; tiles: { p: Pt; view: TileView }[] }
  | { t: 'board'; grid: (TileView | null)[][] }
  | { t: 'setTile'; p: Pt; view: TileView }
  | { t: 'countdown'; p: Pt; value: number }
  // Alpha: the blast footprint comes from the bomb's own data, so the event
  // carries the in-bounds cells for the renderer's flash overlay.
  | { t: 'detonate'; p: Pt; cells: Pt[] }
  // damage carries metrics enrichment (MK2.3/MK7): source = the CAUSAL bucket
  // (the action that initiated the chain, not the mechanism); buffBonus = the
  // buff-tile portion of `amount` (subtracted out into the disjoint buffer
  // bucket, MK7.4); colorRaw/shapeRaw = pre-floor per-axis Sync damage
  // (MK7.5); cascadeRaw = pre-floor damage from tiles destroyed exclusively
  // by STOCHASTIC refill matches (MK7.3 cross-cut); programId = the acting
  // Program for Function-caused damage (attacker fire / bomb detonation);
  // skillRaw = the Hacker-Skill portion of `amount`, its own disjoint bucket
  // (Alpha 0.3.0 §6.4/§11.3 — never merged into base Sync damage).
  | { t: 'damage'; target: Side; amount: number; label: string; source: 'match' | 'attacker' | 'bomb'; programId?: string; critExtra?: number; buffBonus?: number; colorRaw?: number; shapeRaw?: number; cascadeRaw?: number; skillRaw?: number }
  | { t: 'msg'; text: string }
  | { t: 'over'; winner: Side }
  // Alpha §7.5/§13.4 — one per parent Function ACTIVATION (the paid event);
  // `fn` is the activated Function, `name` the owner's display name.
  | { t: 'ability'; side: Side; ownerKind: OwnerKind; programId: string; fn: string; name: string }
  // Alpha §7.5 — one per expanded payload OPERATION (child resolution attempt
  // / Effect execution). resolved=false is a LEGAL fizzle (no valid target or
  // placement); unexpected exceptions are implementation failures and
  // propagate through the failure boundary instead of appearing here.
  | { t: 'op'; side: Side; ownerKind: OwnerKind; programId: string; fnId: string; effectId: EffectId; resolved: boolean; drained?: number }
  // MK9.1/9.2/9.3 — bombs or shield tiles actually placed by one activation
  // (may be fewer than requested if the Datastream lacks legal targets).
  | { t: 'placed'; side: Side; ownerKind: OwnerKind; kind: 'bomb' | 'shield'; count: number; programId: string }
  // MK9.3 — one per shield-affected damage instance. preShield = base+buff
  // before absorption; shield = total active defender shield; prevented =
  // min(preShield, shield); final = preShield - prevented (the dealt amount).
  | { t: 'shield'; target: Side; source: 'match' | 'attacker' | 'bomb'; preShield: number; shield: number; prevented: number; final: number }
  // MK9.3 — shield tiles removed from the Datastream this event (synced,
  // cascaded, or blasted away).
  | { t: 'shieldRemoved'; count: number }
  | { t: 'chargeWaste'; side: Side; ownerKind: OwnerKind; programId: string; amount: number }
  | { t: 'autoReshuffle' }
  | { t: 'cascadeDepth'; side: Side; depth: number }
  // MK5.6 — per Sync step: sliced-Packet count and how many of those were
  // bound to the OPPOSING side's Programs (charge-source contention)
  | { t: 'tileStats'; side: Side; destroyed: number; contested: number }
  // Alpha 0.3.0 §7.3 — Deck Function charge earned from neutral Packets sliced
  // during this side's qualifying Sync resolution.
  | { t: 'deckCharge'; side: Side; amount: number; wasted: number }
  // Alpha 0.3.0 §9.2 — one per qualifying row/column clear in a resolution
  // wave. Retained for causal/logging purposes even where the sliced tiles at
  // an intersection are deduplicated.
  | { t: 'lineClear'; side: Side; orientation: 'h' | 'v'; index: number }
  // Alpha 0.3.0 §21.3 — one per qualifying Hacker Skill trigger.
  | { t: 'skill'; side: Side; skillId: string; effect: string; damage?: number; charge?: number }
  // Alpha 0.3.0 §21.3 — EFFECT_SHAKE outcome: `resolved` false is the legal
  // fizzle (no valid final arrangement; the Datastream is left unchanged).
  | { t: 'shake'; side: Side; resolved: boolean }
  // MK6.6 — raw player think-time for the committed move (input-available ->
  // Sync-committed), supplied by the orchestrator, never pre-aggregated
  | { t: 'thinkTime'; ms: number }
  // MK7.7 — a hint was shown before this turn's committed move (so the turn
  // can be excluded from think-time analysis)
  | { t: 'hintShown' };
