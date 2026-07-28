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
import { EffectId, EffectParamName } from './effects';
import { SkillEffectId } from './skills';
import type { Color, Shape, Side } from '../types';

export const GAME_VERSION = 'alpha-0.3.0';
// Alpha 0.3.0 §17.1 — schema 2: Hacker/Skill/Deck datasets and the extended
// Function schema. Alpha 0.2 saves (schema 1) are rejected, never migrated.
export const DATA_SCHEMA_VERSION = 2;

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

// One validated leaf operation of a Function's payload plan. A leaf Function
// has exactly one op (its own Effect); a composite Function has one op per
// child Function reference, in payload order (§7.2 — repeats allowed and
// intentional). Strings are resolved to typed IDs at startup; combat never
// re-parses colon lists (§11.2).
export interface PlanOp {
  fnId: string; // the LEAF Function this op came from (self for a leaf)
  effectId: EffectId;
  params: EffectParams;
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

// §3.3 — a Program requires a player-chosen target when its (validated) plan
// leads with the non-random targeted operation. Alpha: EFFECT_DRAIN only.
export function requiresTarget(p: ResolvedProgram): boolean {
  return p.fn.plan[0]?.effectId === 'EFFECT_DRAIN';
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
  hackerPrograms: string[];
  systemPrograms: string[];
  functions: { id: string; cost: number }[];
  hackers: string[];
  decks: string[];
  skills: string[];
}

export function contentStamp(): ContentStamp {
  const c = getContent();
  return {
    gameVersion: c.gameVersion,
    schemaVersion: c.schemaVersion,
    fingerprint: c.fingerprint,
    hackerPrograms: c.hacker.map((p) => p.id),
    systemPrograms: c.system.map((p) => p.id),
    functions: [...c.functions.values()].map((f) => ({ id: f.id, cost: f.cost })),
    hackers: [...c.hackerOrder],
    decks: [...c.deckOrder],
    skills: [...c.skills.keys()],
  };
}

export type { EffectParamName };
