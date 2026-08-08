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

// Alpha 0.5.0 §32 — how the battle's opponent System was chosen. Recorded on
// the battle and in logs so an analyst can separate a rolled encounter from a
// deliberately chosen one without inferring it from the mode.
export type SystemSelectionSource =
  | 'RUN_RANDOM' // §11 — rolled for a Run battle before its Build screen
  | 'QUICK_RANDOM' // §13 — rolled by Random Quick Match
  | 'QUICK_CONSTRUCTED' // §12 — explicitly picked on the System Selection screen
  | 'HEADLESS_PINNED'; // §44 — pinned by a simulation harness, never in play

export const SYSTEM_SELECTION_SOURCES: ReadonlyArray<SystemSelectionSource> = [
  'RUN_RANDOM',
  'QUICK_RANDOM',
  'QUICK_CONSTRUCTED',
  'HEADLESS_PINNED',
];

// Lives here with the type (not in save.ts or session.ts) so both the save
// validator and the session envelope can use it without an import cycle.
export function isSystemSelectionSource(v: unknown): v is SystemSelectionSource {
  return typeof v === 'string' && (SYSTEM_SELECTION_SOURCES as readonly string[]).includes(v);
}

// Alpha 0.4.0 §18.3 — where the ordered active build came from. Recorded on
// the battle and in logs so an analyst can separate a default build from an
// edited one without diffing Program lists.
export type BuildOrigin =
  | 'DEFAULT' // derived from portfolio order (§5.4)
  | 'RANDOM' // Random Quick Match, isolated setup RNG (§9.2)
  | 'REMEMBERED_CONSTRUCTED' // the stored Constructed preset (§9.4)
  | 'CARRIED_RUN' // carried forward from the previous Run battle (§8.4)
  | 'PLAYER_EDITED'; // any of the above, then changed on the Build screen

// Concrete whitebox identities for the 6 colors and 6 shapes (agent discretion,
// approved): colors are six maximally-separated primary/secondary hues; shapes
// are six simple canvas-drawable glyphs.
export enum Color { Red = 0, Yellow, Magenta, Green, Cyan, Blue }
export enum Shape { Circle = 0, Square, Triangle, Diamond, Star, Cross }

// Alpha 0.1.0: a placed special tile carries the DATA that defines its
// behavior — bombs their countdown/footprint, buff/shield tiles their per-tile
// magnitude — plus the placing Program's stable ID for metrics attribution.
// Nothing about a special's behavior is looked up from hardcoded tables.
// Alpha 0.5.0 §27 — the countdown behavioral contract, generalized one step:
//
//   activation/deployment now -> countdown persists -> payload delivered later
//
// An ARMED overlay carries `countdown` plus `delivers`, the Effect whose result
// is produced at expiry. Alpha 0.4 hardcoded "a countdown means a bomb"; naming
// the payload lets a future delayed Effect reuse this exact machinery by adding
// ONE delivery branch. It is deliberately NOT a generalized delayed-Function
// graph or a second scheduler (§27.1) — there is one countdown, one tick, and
// one delivery switch.
export interface Special {
  // The overlay's board identity: what it looks like and how the rest of the
  // engine treats it. A `buff` whose countdown is still positive is PENDING and
  // contributes no magnitude until it is delivered (§28.1).
  type: 'bomb' | 'buff' | 'shield';
  owner: Side;
  countdown?: number; // armed overlays only (bombs; pending Buffs)
  // §27.2 — what this overlay delivers when its countdown reaches zero.
  // Present iff `countdown` is. Absent means the overlay is already live.
  delivers?: EffectId;
  areaPattern?: AreaPatternId; // bombs only — blast footprint from Function data
  magnitude?: number; // buff/shield — per-tile bonus/shield points from data
  programId?: string; // placing Program (metrics/logging attribution)
  // Alpha 0.4.0 §14.2 / Alpha 0.5.0 §27.2 — a delayed overlay resolves turns
  // after it was armed, so the arming Function's typed selections travel WITH
  // the overlay rather than being looked up from whatever is firing at delivery
  // time. This is what makes "resolved parameters must not silently change
  // while the object is armed" true by construction.
  fnId?: string; // the Function that placed it (attribution)
  dealDamage?: 0 | 1; // bombs only
  gainCharge?: 0 | 1; // bombs only
  seq: number; // global placement order — armed overlays tick oldest-first
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
  // §5.4, revised by Alpha 0.5.0 §9 — per-side STRONG bindings, RESOLVED from
  // each side's OWN authored identity: the selected Hacker's strong sets for
  // the player, the selected System's for the enemy. The Alpha 0.4 rule that
  // made the System's sets the Hacker's complements is gone — each System now
  // carries an independent profile (§2.4). A tile whose color is in a side's
  // strongColors deals the HIGH color value for that side's own Sync/blast
  // damage (LOW otherwise); likewise strongShapes. Charge bindings (Program
  // data) remain independent of these (§5.4).
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
  // Alpha 0.5.0 §9/§32 — the resolved opponent. This is the authority for
  // System ICE, strong/weak axes, and the ordered System Program build; it is
  // selected BEFORE the battle exists and is never rerolled by save/resume
  // (§14). There is no default and no fallback (§41).
  systemId: string;
  systemSelectionSource: SystemSelectionSource;
  skillIds: string[]; // ordered; duplicates are meaningful (§6.4)
  deckFunctionId: string;
  // Alpha 0.4.0 §5.3 — the ACTIVE BUILD: exactly four distinct inventory
  // Programs in explicit top-to-bottom order. This order is authoritative for
  // battle display, charge routing, Disabler target state, and save/restore —
  // it is never an unordered set and never the full Program roster.
  hackerPrograms: string[];
  // §5.2 — the fixed six-Program Run/Quick Match inventory the build was drawn
  // from, in Hacker-portfolio-then-Deck-portfolio order. Retained on the
  // battle so a save can be revalidated without re-deriving it from content
  // that may since have changed (§17.2).
  inventory: string[];
  // Alpha 0.5.0 §5.4 — the selected System's ordered PRG_SET, snapshotted the
  // same way the Hacker's active build is. Order is charge-routing priority
  // and display order; it is NOT Function-activation priority (§2.11).
  systemPrograms: string[]; // ordered stable PRG_S_* IDs
  selectionSource: SelectionSource;
  buildOrigin: BuildOrigin; // §18.3
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
  // `countdown` present means the overlay is still ARMED — the renderer shows
  // the remaining turns rather than the live badge (§28.1).
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

// Alpha 0.4.0 §12 — what the player picked for a targeted activation. A
// Function needs zero targets, exactly one opposing Program slot (Drain), or
// exactly one Packet coordinate. There is deliberately no target LIST, no
// counter, and no partial multi-target state (§12.1).
export type ActivationTarget = { kind: 'unit'; idx: number } | { kind: 'packet'; p: Pt };

// ---- Alpha 0.4.0 §11 charge-routing telemetry ----

// Where a routed charge stream came from. Distinguishes an initial Sync from
// a cascade wave, a Skill-inflated Sync, and explicit Effect destruction, so
// allocation can be reconstructed per cause (§11).
export type ChargeStreamSource =
  | 'SYNC'
  | 'CASCADE'
  | 'SKILL_MODIFIED_SYNC'
  | 'EFFECT_DESTRUCTION'
  // Alpha 0.5.0 — charge from a Sync an EFFECT_TRANSFORM created. ALLOCATION is
  // the ordinary top-to-bottom queue rule (§30.1 — the BOUNCER synergy must
  // emerge from bindings and order, never from a hardcoded COERCE->ATTACKER
  // path); this label only makes the GENERATION attributable so the Effect can
  // be balanced.
  | 'EFFECT_TRANSFORM';

export interface ChargeAssignment {
  programId: string;
  before: number;
  assigned: number;
  after: number;
  overflowOut: number; // what was passed DOWN to the next eligible Program
}

// §16.4 — auditable readiness of a Drain target at target-resolution time.
export type Readiness = 'READY' | 'CHARGING' | 'EMPTY';

// Alpha 0.4.0 §15.3 — the DISJOINT causal damage buckets. `lineslice` is its
// own bucket rather than a generic catch-all so DATACUT stays separable from
// base Sync damage, Bomb damage, and Attack damage; totals must still equal
// the sum of the attributed contributions.
// Alpha 0.5.0 (designer ruling, 2026-08-07) — `transform` is its own bucket.
// The handoff §25 wanted Transform-created Sync damage left in the `match`
// bucket; the director overrode that so COERCE can be balanced: without
// attribution its contribution is indistinguishable from ordinary matching.
//
// This is ATTRIBUTION, not reclassification. A Transform-created Sync is still
// mechanically an ordinary Sync — same strong/weak valuation, crit tiers, B1
// qualification, and Reinforced Connection suppression. Only the ledger differs.
export type DamageSource = 'match' | 'attacker' | 'bomb' | 'lineslice' | 'transform';

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
  | { t: 'damage'; target: Side; amount: number; label: string; source: DamageSource; programId?: string; fnId?: string; effectId?: EffectId; critExtra?: number; buffBonus?: number; colorRaw?: number; shapeRaw?: number; cascadeRaw?: number; skillRaw?: number }
  | { t: 'msg'; text: string }
  | { t: 'over'; winner: Side }
  // Alpha §7.5/§13.4 — one per parent Function ACTIVATION (the paid event);
  // `fn` is the activated Function, `name` the owner's display name.
  | { t: 'ability'; side: Side; ownerKind: OwnerKind; programId: string; fn: string; name: string }
  // Alpha §7.5 — one per expanded payload OPERATION (child resolution attempt
  // / Effect execution). resolved=false is a LEGAL fizzle (no valid target or
  // placement); unexpected exceptions are implementation failures and
  // propagate through the failure boundary instead of appearing here.
  // Alpha 0.4.0 §16.4 — an actual Drain activation carries full target
  // telemetry on this ESTABLISHED event rather than in a parallel stream:
  // which Program was hit, how ready it was, and the exact charge delta.
  | {
      t: 'op'; side: Side; ownerKind: OwnerKind; programId: string; fnId: string; effectId: EffectId; resolved: boolean;
      drained?: number;
      targetProgramId?: string;
      targetReadiness?: Readiness;
      targetChargeBefore?: number;
      targetChargeAfter?: number;
      targetCost?: number;
    }
  // Alpha 0.4.0 §11 — one per routed charge stream. Emitted BEFORE the
  // aggregated chargeWaste event so an analyst can verify priority, skipping,
  // fill, downward overflow, and final discard rather than only a total.
  | {
      t: 'chargeRoute'; side: Side; axis: 'color' | 'shape'; token: number; amount: number;
      streamSource: ChargeStreamSource;
      sourceId?: string; // Skill or Function ID where one owns the stream
      order: string[]; // ordered ACTIVE Program IDs at routing time
      eligible: string[]; // of those, the ones compatible with this token
      assignments: ChargeAssignment[];
      discarded: number; // overflow with nowhere left to go
    }
  // Alpha 0.4.0 §18.5 — one per targeted Function activation, capturing the
  // chosen coordinate and the Packet's properties BEFORE mutation.
  | {
      t: 'targeted'; side: Side; ownerKind: OwnerKind; programId: string; fnId: string; effectId: EffectId;
      target: Pt | null; // null when no valid coordinate could be resolved
      targetTile: TileView | null; // color/shape/special as they were pre-slice
      dimension?: 'row' | 'column'; // EFFECT_LINESLICE only
      sliced: Pt[]; // coordinates destroyed by the DIRECT operation
      retained: Pt[]; // specials deliberately left in place (§13.2)
      directDamage: number;
      directCharge: number;
      resolved: boolean;
      reason?: string; // legal-fizzle / failure context when resolved is false
    }
  // MK9.1/9.2/9.3 — bombs or shield tiles actually placed by one activation
  // (may be fewer than requested if the Datastream lacks legal targets).
  | { t: 'placed'; side: Side; ownerKind: OwnerKind; kind: 'bomb' | 'shield'; count: number; programId: string }
  // Alpha 0.5.0 §37.1 — one per EFFECT_TRANSFORM activation. Enough to verify
  // the action without storing a board snapshot: what was asked for, what was
  // actually converted, and the authored axes. The damage and charge the
  // resulting Syncs produce stay in their normal event streams and are NOT
  // duplicated here.
  | {
      t: 'transform'; side: Side; ownerKind: OwnerKind; programId: string; fnId: string;
      axisTarget: string;
      resultColor: Color;
      resultShape: Shape;
      requested: number; // authored quantity (the maximum, §2.5)
      converted: number; // Packets actually transformed
      candidates: number; // eligible Packets that existed
      specialsRetained: number;
      specialsDestroyed: number;
      cells: Pt[];
      resolved: boolean;
    }
  // §28.3 — an armed countdown reached zero and delivered its payload on the
  // same Packet. Bombs already log through `detonate`; this covers the
  // non-destructive deliveries (currently EBUFF becoming a live Buff).
  | { t: 'countdownDelivered'; side: Side; p: Pt; effectId: EffectId; programId?: string; fnId?: string; magnitude?: number }
  // MK9.3 — one per shield-affected damage instance. preShield = base+buff
  // before absorption; shield = total active defender shield; prevented =
  // min(preShield, shield); final = preShield - prevented (the dealt amount).
  | { t: 'shield'; target: Side; source: DamageSource; preShield: number; shield: number; prevented: number; final: number }
  // MK9.3 — shield tiles removed from the Datastream this event (synced,
  // cascaded, or blasted away).
  | { t: 'shieldRemoved'; count: number }
  | { t: 'chargeWaste'; side: Side; ownerKind: OwnerKind; programId: string; amount: number }
  // Alpha 0.5.0 §19.4/§37.2 — a ready System Program that was NOT activated
  // because it had no valid target. Deliberately aggregate-only: it is consumed
  // by metrics as a battle-level count and is never written to the turn or
  // event streams, because a blocked Program re-reports every turn and §37.2
  // forbids reintroducing that volume into BASIC/VERBOSE.
  | { t: 'withhold'; side: Side; programId: string; fnId: string; reason: string }
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
