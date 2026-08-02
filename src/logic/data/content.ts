// Alpha 0.1.0 §11 / Alpha 0.3.0 §4.8 — the resolved runtime content model, and
// the single active registry the engine reads. Resolved definitions are
// immutable for the application session: they are constructed once by the
// loader (load.ts), installed via setActiveContent() before any battle can
// start, and never reloaded or hot-swapped (§5.3). Mutable battle state
// (charge, placed specials, LINK/ICE, countdowns) lives in GameState.
//
// Alpha 0.3.0 adds Hacker, Skill, and Deck identity to this model. All human
// play, setup UI, battle construction, saves, logs, and headless tools consume
// these shared resolved definitions rather than reparsing CSV or keeping
// hardcoded copies (§4.8).

import { AreaPatternId } from './areas';
import { EffectId, EffectParamName, TargetKind } from './effects';
import { SkillEffectId } from './skills';
import type { Color, Shape, Side } from '../types';

export const GAME_VERSION = 'alpha-0.4.0';
// Alpha 0.4.0 §17.1 — schema 3: ordered Hacker/Deck Program portfolios, the
// derived six-Program inventory, the ordered four-Program active build, the
// pre-battle Build phase, and the parameterized Bomb/LineSlice contracts.
// Alpha 0.3 saves (schema 2) are rejected, never migrated.
export const DATA_SCHEMA_VERSION = 3;

// §5.1/§4.4/§4.5 — every Hacker and every Deck contributes exactly this many
// ordered Programs; the two portfolios combine into the Run inventory.
export const PORTFOLIO_SIZE = 3;
export const INVENTORY_SIZE = PORTFOLIO_SIZE * 2;
// §5.3 — exactly this many distinct inventory Programs are active, in order.
export const ACTIVE_BUILD_SIZE = 4;

// §5.2 — explicit default identity. Until a configuration or account-selection
// system exists these are named constants; they are NEVER inferred from the
// first dataset row, and a missing/invalid default blocks startup.
export const DEFAULT_HACKER_ID = 'HAK_01';
export const DEFAULT_DECK_ID = 'DEK_01';

// ---- EFFECT_SHAKE typed parameters (§8.2-8.6) ----

// Enum value names, kept as named constants so combat code never compares bare
// integers. Resolved once at startup into ShakeParams.
export const SHAKE_REARRANGE = 0; // permute existing tile objects
export const SHAKE_REPLACE = 1; // regenerate affected tiles as ordinary Packets
export const SHAKE_RETAIN_SPECIALS = 0;
export const SHAKE_REMOVE_SPECIALS = 1;
export const SHAKE_PREVENT_MATCHES = 0;
export const SHAKE_ALLOW_MATCHES = 1;
export const SHAKE_CASCADE_NONE = 0; // initial post-Shake wave only
export const SHAKE_CASCADE_CONFIGURED = 1; // the battle's saved cascade limit
export const SHAKE_CASCADE_UNTIL_STABLE = 2; // ignore the finite limit

export interface ShakeParams {
  boardComposition: 0 | 1;
  specialGems: 0 | 1;
  matches: 0 | 1;
  cascades: 0 | 1 | 2;
}

// ---- Alpha 0.4.0 shared targeting/damage/charge enums (§13.2/§14.2) ----
// Named constants so combat code never compares bare integers, exactly as the
// Shake enums above. Resolved once at startup into the typed objects below.
export const TARGETING_RANDOM = 0;
export const TARGETING_TARGETED = 1;
export const DEAL_DAMAGE_YES = 0;
export const DEAL_DAMAGE_NO = 1;
export const GAIN_CHARGE_YES = 0;
export const GAIN_CHARGE_NO = 1;

// ---- EFFECT_LINESLICE typed parameters (§13.2) ----
export const LINE_DIMENSION_ROW = 0;
export const LINE_DIMENSION_COLUMN = 1;
export const SPECIALS_DESTROY = 0;
export const SPECIALS_RETAIN_ALL = 1;
export const SPECIALS_RETAIN_OWN = 2;

export interface LineSliceParams {
  dimension: 0 | 1;
  targeting: 0 | 1;
  specialRetention: 0 | 1 | 2;
  dealDamage: 0 | 1;
  gainCharge: 0 | 1;
}

// ---- EFFECT_BOMB typed parameters (§14.2) ----
export interface BombParams {
  targeting: 0 | 1;
  dealDamage: 0 | 1;
  gainCharge: 0 | 1;
}

// One validated leaf operation of a Function's payload plan. A leaf Function
// has exactly one op (its own Effect); a composite Function has one op per
// child Function reference, in payload order (§7.2 — repeats allowed and
// intentional). Strings are resolved to typed IDs at startup; combat never
// re-parses colon lists (§11.2).
export interface PlanOp {
  fnId: string; // the LEAF Function this op came from (self for a leaf)
  effectId: EffectId;
  params: EffectParams;
  // Alpha 0.4.0 §12 — the RESOLVED targeting requirement for this op. Alpha
  // 0.3 read targeting off the Effect contract alone; Bomb and LineSlice now
  // select it per Function row through their typed tuples, so it is resolved
  // once at startup and never recomputed from raw data at runtime.
  target: TargetKind | null;
}

export interface EffectParams {
  quantity?: number;
  countdown?: number;
  areaPattern?: AreaPatternId;
  magnitude?: number;
  damage?: number;
  // §4.6/§8.2 — the resolved compound tuple, present iff the Effect's contract
  // declares one. Runtime execution consumes this typed object.
  shake?: ShakeParams;
  bomb?: BombParams; // §14.2
  line?: LineSliceParams; // §13.2
}

export interface ResolvedFunction {
  id: string;
  name: string;
  cost: number;
  composite: boolean;
  plan: ReadonlyArray<PlanOp>;
  notes: string;
  // §4.6 — a directly assigned owner (Program or Deck) starts each battle with
  // charge equal to cost when true, zero otherwise. Ignored when this Function
  // executes only as a child of a composite.
  startCharged: boolean;
}

export interface ResolvedProgram {
  id: string;
  side: Side;
  name: string;
  colors: ReadonlyArray<Color>; // charge-color bindings (order preserved)
  shapes: ReadonlyArray<Shape>;
  functionId: string;
  fn: ResolvedFunction;
  cost: number; // activation cost of the assigned Function
  chargeCap: number; // §11.1 — at least the highest cost among assigned Functions
  notes: string;
}

// §4.8 — a resolved Hacker Skill. The parsed contract, NOT the display string,
// controls behavior (§4.4).
export interface ResolvedSkill {
  id: string;
  effectType: SkillEffectId;
  color: Color; // typed parameter 0 for both current Skill effects
  magnitude: number; // typed parameter 1
  display: string; // resolved player-facing text (presentation only)
  displayTemplate: string; // authored template, retained for tooling
  paramTokens: ReadonlyArray<string>; // authored tuple tokens, in order
}

export interface ResolvedHacker {
  id: string;
  name: string;
  baseLink: number;
  // §5.4 — the selected Hacker's strong sets are authoritative for Hacker
  // owner-dependent damage strength; weak sets are calculated complements in
  // recognized enum order. No 3/3 partition is required.
  strongColors: ReadonlyArray<Color>;
  weakColors: ReadonlyArray<Color>;
  strongShapes: ReadonlyArray<Shape>;
  weakShapes: ReadonlyArray<Shape>;
  skillIds: ReadonlyArray<string>; // authored order, duplicates meaningful (§6.4)
  skills: ReadonlyArray<ResolvedSkill>;
  // §4.4/§5.1 — the ordered three-Program portfolio from PRG_SET. Order is
  // gameplay-significant: it drives default-build derivation (§5.4) and
  // inventory presentation, and it is fingerprinted (§4.12).
  portfolioProgramIds: ReadonlyArray<string>;
  // §2.12 — schema placeholders only: parsed and retained, never displayed,
  // interpreted, or used to load assets in Alpha 0.3.
  bio: string;
  graphics: string;
}

export interface ResolvedDeck {
  id: string;
  name: string;
  addLink: number;
  functionId: string;
  fn: ResolvedFunction; // §7.1 — exactly one in Alpha 0.3
  // §4.5/§5.1 — the ordered three-Program portfolio from PRG_SET. The Deck
  // FUNCTION is separate and is NEVER one of these Programs (§2.11).
  portfolioProgramIds: ReadonlyArray<string>;
  descript: string; // placeholder only (§2.12)
  graphics: string; // placeholder only (§2.12)
}

export interface ResolvedContent {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string; // normalized gameplay-content fingerprint (§4.10)
  hacker: ReadonlyArray<ResolvedProgram>; // player side, slot order
  system: ReadonlyArray<ResolvedProgram>; // enemy side, slot order
  functions: ReadonlyMap<string, ResolvedFunction>;
  programsById: ReadonlyMap<string, ResolvedProgram>;
  hackers: ReadonlyMap<string, ResolvedHacker>;
  skills: ReadonlyMap<string, ResolvedSkill>;
  decks: ReadonlyMap<string, ResolvedDeck>;
  // Authored row order, for deterministic selection-screen presentation.
  hackerOrder: ReadonlyArray<string>;
  deckOrder: ReadonlyArray<string>;
}

// ---- active-content registry (set once at startup, read-only afterwards) ----

let active: ResolvedContent | null = null;

export function setActiveContent(c: ResolvedContent): void {
  active = c;
}

export function getContent(): ResolvedContent {
  if (!active) throw new Error('content not loaded — setActiveContent() must run before gameplay');
  return active;
}

export function programsFor(side: Side): ReadonlyArray<ResolvedProgram> {
  const c = getContent();
  return side === 'player' ? c.hacker : c.system;
}

export function programById(id: string): ResolvedProgram {
  const p = getContent().programsById.get(id);
  if (!p) throw new Error(`unknown program id: ${id}`);
  return p;
}

export function hackerById(id: string): ResolvedHacker {
  const h = getContent().hackers.get(id);
  if (!h) throw new Error(`unknown hacker id: ${id}`);
  return h;
}

export function deckById(id: string): ResolvedDeck {
  const d = getContent().decks.get(id);
  if (!d) throw new Error(`unknown deck id: ${id}`);
  return d;
}

// Ordered selection lists for the setup screens (§13.1/§14.1 — every loaded
// definition is offered; all Decks are compatible with all Hackers, §2.8).
export function allHackers(): ResolvedHacker[] {
  const c = getContent();
  return c.hackerOrder.map((id) => c.hackers.get(id)!);
}

export function allDecks(): ResolvedDeck[] {
  const c = getContent();
  return c.deckOrder.map((id) => c.decks.get(id)!);
}

// ---- Alpha 0.4.0 §5.2/§5.3 — inventory and active build (ONE authority) ----
// Every consumer (setup UI, Build screen, battle construction, save/restore,
// logs, headless tools) derives inventory and default build here. There is no
// second derivation and no hardcoded default Program list (§5.4).

export type PortfolioSource = 'HACKER_PORTFOLIO' | 'DECK_PORTFOLIO';

export interface InventoryEntry {
  programId: string;
  program: ResolvedProgram;
  source: PortfolioSource;
  // 1-based position WITHIN the contributing portfolio, for display/telemetry.
  portfolioIndex: number;
}

// §5.2 — the fixed six-Program inventory for a Hacker/Deck pairing: the
// Hacker's ordered three followed by the Deck's ordered three. Source
// attribution is presentation/telemetry only — all six are Hacker-side
// Program choices in battle (§2.3).
export function inventoryFor(hackerId: string, deckId: string): InventoryEntry[] {
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  const entries: InventoryEntry[] = [];
  hacker.portfolioProgramIds.forEach((id, i) => {
    entries.push({ programId: id, program: programById(id), source: 'HACKER_PORTFOLIO', portfolioIndex: i + 1 });
  });
  deck.portfolioProgramIds.forEach((id, i) => {
    entries.push({ programId: id, program: programById(id), source: 'DECK_PORTFOLIO', portfolioIndex: i + 1 });
  });
  return entries;
}

export function inventoryProgramIds(hackerId: string, deckId: string): string[] {
  return inventoryFor(hackerId, deckId).map((e) => e.programId);
}

// §5.4 — the DEFAULT build: Hacker portfolio entries 1 and 2, then Deck
// portfolio entries 1 and 2. Derived from portfolio ORDER, never from a
// hardcoded list of Program IDs.
export function defaultBuild(hackerId: string, deckId: string): string[] {
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  const half = ACTIVE_BUILD_SIZE / 2;
  return [...hacker.portfolioProgramIds.slice(0, half), ...deck.portfolioProgramIds.slice(0, half)];
}

// §5.5 — the validity invariant, in one place. A build is valid iff it holds
// exactly ACTIVE_BUILD_SIZE distinct Program IDs, all drawn from the current
// inventory, all resolving. Order is carried by the array itself.
export function isValidBuild(build: readonly string[], inventoryIds: readonly string[]): boolean {
  if (!Array.isArray(build) || build.length !== ACTIVE_BUILD_SIZE) return false;
  if (new Set(build).size !== ACTIVE_BUILD_SIZE) return false;
  return build.every((id) => inventoryIds.includes(id) && getContent().programsById.has(id));
}

// The four resolved Programs of an ordered build, in build order. Throws on an
// unknown ID — callers validate first (the loader guarantees resolution).
export function buildPrograms(build: readonly string[]): ResolvedProgram[] {
  return build.map((id) => programById(id));
}

// §3.3/§12 — the target a Program's activation requires, resolved from its
// validated plan. The leading operation carries it: payload-order validation
// guarantees at most one targeted op and that it comes first (§7.3).
export function targetKindOf(p: ResolvedProgram): TargetKind | null {
  return p.fn.plan[0]?.target ?? null;
}

export function requiresTarget(p: ResolvedProgram): boolean {
  return targetKindOf(p) !== null;
}

// The same question for any directly assigned Function — the Deck-owned one
// included, so a future targeted Deck Function needs no parallel path (§7.1).
export function functionTargetKind(fn: ResolvedFunction): TargetKind | null {
  return fn.plan[0]?.target ?? null;
}

// Approved deviation (System Drain withhold): the System declines to activate
// a Function whose expanded plan consists ENTIRELY of drain ops when no
// opposing Program holds any charge — charge is preserved, not spent on a
// no-op. Mixed composites still fire (the drain op legally fizzles).
export function planIsAllDrain(p: ResolvedProgram): boolean {
  return p.fn.plan.length > 0 && p.fn.plan.every((op) => op.effectId === 'EFFECT_DRAIN');
}

// §21.2 — content identity stamped into battle/simulation records.
export interface ContentStamp {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string;
  hackerPrograms: string[]; // every LOADED Hacker Program, not the active build
  systemPrograms: string[];
  functions: { id: string; cost: number }[];
  hackers: string[];
  decks: string[];
  skills: string[];
  // §4.12/§18.2 — ordered portfolios, so a record identifies the content that
  // produced its inventory and default build.
  portfolios: { id: string; programs: string[] }[];
}

export function contentStamp(): ContentStamp {
  const c = getContent();
  return {
    gameVersion: c.gameVersion,
    schemaVersion: c.schemaVersion,
    fingerprint: c.fingerprint,
    hackerPrograms: c.hacker.map((p) => p.id),
    systemPrograms: c.system.map((p) => p.id),
    portfolios: [
      ...[...c.hackers.values()].map((h) => ({ id: h.id, programs: [...h.portfolioProgramIds] })),
      ...[...c.decks.values()].map((d) => ({ id: d.id, programs: [...d.portfolioProgramIds] })),
    ],
    functions: [...c.functions.values()].map((f) => ({ id: f.id, cost: f.cost })),
    hackers: [...c.hackerOrder],
    decks: [...c.deckOrder],
    skills: [...c.skills.keys()],
  };
}

export type { EffectParamName, TargetKind };
