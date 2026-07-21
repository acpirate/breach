// Alpha 0.1.0 §11 — the resolved runtime content model, and the single active
// registry the engine reads. Resolved definitions are immutable for the
// application session: they are constructed once by the loader (load.ts),
// installed via setActiveContent() before any battle can start, and never
// reloaded or hot-swapped (§5.3). Mutable battle state (charge, placed
// specials, HP, countdowns) lives in GameState, never here.

import { AreaPatternId } from './areas';
import { EffectId, EffectParamName } from './effects';
import type { Color, Shape, Side } from '../types';

export const GAME_VERSION = 'alpha-0.1.0';
export const DATA_SCHEMA_VERSION = 1;

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
}

export interface ResolvedFunction {
  id: string;
  name: string;
  cost: number;
  composite: boolean;
  plan: ReadonlyArray<PlanOp>;
  notes: string;
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

export interface ResolvedContent {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string; // normalized gameplay-content fingerprint (§14.3)
  hacker: ReadonlyArray<ResolvedProgram>; // player side, slot order
  system: ReadonlyArray<ResolvedProgram>; // enemy side, slot order
  functions: ReadonlyMap<string, ResolvedFunction>;
  programsById: ReadonlyMap<string, ResolvedProgram>;
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

// §13.2 — content identity stamped into battle/simulation records.
export interface ContentStamp {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string;
  hackerPrograms: string[];
  systemPrograms: string[];
  functions: { id: string; cost: number }[];
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
  };
}

export type { EffectParamName };
