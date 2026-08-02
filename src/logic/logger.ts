// MK4.3 — Logic-layer battle logging, fed by the SAME event stream the
// metrics collector consumes (Game.collect routes every batch through both;
// there is no second pipeline). Pure data in, pure data out — persistence is
// the platform adapter's job (src/storage.ts in the browser).
//
// Tier 1: one MetricLogEntry per completed battle (final metrics + the
//         Alpha content-identity stamp, §13.2).
// Tier 2: one TurnLogEntry per game turn — the actions taken and their
//         outcome; stamps the content fingerprint so entries stay
//         attributable without duplicating the full content identity.

import { ContentStamp, GAME_VERSION, getContent } from './data/content';
import type { EffectId } from './data/effects';
import { BattleMetrics } from './metrics';
import {
  BattleConfig,
  BattleIdentity,
  BuildOrigin,
  ChargeAssignment,
  ChargeStreamSource,
  GameEvent,
  GameState,
  Mode,
  NaturalOutcome,
  Pt,
  Readiness,
  RunStep,
  SelectionSource,
  Side,
  TileView,
  WizardAction,
  opponentOf,
} from './types';

// Version tag stamped on every log entry. Alpha 0.1.0: no active output path
// may continue to emit a stale MK tag (§13.1).
export const LOG_VERSION = GAME_VERSION;

// ============================================================================
// Alpha 0.4.1 §3 — LOGGING LEVELS
//
// Alpha 0.4 persisted one fixed, maximally detailed turn record and kept 4,000
// of them. Measured at ~2,778 B each that projected to ~10.9 MB against a
// ~5 MB localStorage budget, and every append re-serialized the whole history.
// The levels below let normal play stay lean while a developer can still opt
// into full reconstruction detail for a short investigation.
// ============================================================================

export type LoggingLevel = 'BASIC' | 'VERBOSE' | 'COMPLETE';

export const LOGGING_LEVELS: ReadonlyArray<LoggingLevel> = ['BASIC', 'VERBOSE', 'COMPLETE'];

export function isLoggingLevel(v: unknown): v is LoggingLevel {
  return typeof v === 'string' && (LOGGING_LEVELS as readonly string[]).includes(v);
}

// §17 — the browser logging schema, versioned INDEPENDENTLY of the active save
// schema (which stays at 3; this patch changes no gameplay persistence).
export const LOGGING_SCHEMA_VERSION = 1;
// §8.4 — bumped because per-Program `chargeWasted` no longer absorbs routing
// discard; that now aggregates into a battle-level total.
export const METRICS_SCHEMA_VERSION = 2;

// §12.1 — every cap and budget is a named constant here, never a scattered
// literal. Retention is governed FIRST by the byte budget and second by these.
export const LOG_BUDGET_BYTES = 3 * 1024 * 1024; // 3 MiB across all log keys
export const MAX_METRIC_LOG_ENTRIES = 500; // one per completed battle
export const MAX_EVENT_LOG_ENTRIES = 1500; // routes / targeted / drains
export const MAX_SELECTION_LOG_ENTRIES = 300;
export const MAX_WIZARD_LOG_ENTRIES = 200;
// Compact turn records exist only at VERBOSE and above, with COMPLETE kept
// deliberately short since it also carries every ordinary route.
export const MAX_TURN_LOG_ENTRIES: Record<LoggingLevel, number> = {
  BASIC: 0,
  VERBOSE: 750,
  COMPLETE: 150,
};

// The level new records are created under. Set once at startup by the platform
// adapter; changing it affects FUTURE records only (§3.2) — retained records
// keep the level tag they were written with.
let activeLevel: LoggingLevel = 'BASIC';

export function setLoggingLevel(level: LoggingLevel): void {
  activeLevel = level;
}

export function loggingLevel(): LoggingLevel {
  return activeLevel;
}

const atLeast = (level: LoggingLevel): boolean => LOGGING_LEVELS.indexOf(activeLevel) >= LOGGING_LEVELS.indexOf(level);

interface SideDamage {
  match: number;
  attacker: number;
  bomb: number;
  lineslice: number; // Alpha 0.4.0 §15.3 — its own disjoint bucket
  total: number;
}

// Alpha 0.3.0 §21.2 — the selection/build identity every relevant record
// carries. Derived from the battle's own BattleIdentity so a log entry can
// never disagree with the battle it describes.
export interface IdentityStamp {
  hackerId: string;
  deckId: string;
  skillIds: string[];
  deckFunctionId: string;
  hackerPrograms: string[]; // Alpha 0.4.0 — the ordered ACTIVE build
  inventory: string[]; // §18.2 — the ordered six-Program inventory
  systemPrograms: string[];
  selectionSource: SelectionSource;
  buildOrigin: BuildOrigin; // §18.3
}

export function identityStamp(id: BattleIdentity): IdentityStamp {
  return {
    hackerId: id.hackerId,
    deckId: id.deckId,
    skillIds: [...id.skillIds],
    deckFunctionId: id.deckFunctionId,
    hackerPrograms: [...id.hackerPrograms],
    inventory: [...id.inventory],
    systemPrograms: [...id.systemPrograms],
    selectionSource: id.selectionSource,
    buildOrigin: id.buildOrigin,
  };
}

// ---- Alpha 0.4.0 structured per-turn records ----
// These extend the ESTABLISHED turn entry rather than opening parallel log
// streams (§11/§18.6). `actions` keeps its human-readable line per event; the
// records below carry the machine-analyzable detail.

// §8.2 — enough to reconstruct priority, fill, overflow and discard. Alpha
// 0.4.1 §8.3 drops `order` and `eligible` below COMPLETE: the active order is
// battle-static (it is on the metrics record), and eligibility is derivable
// from that order plus the Program bindings, axis, and token.
export interface ChargeRouteRecord {
  side: Side;
  axis: 'color' | 'shape';
  token: number;
  amount: number;
  source: ChargeStreamSource;
  sourceId?: string;
  assignments: ChargeAssignment[];
  discarded: number;
  order?: string[]; // COMPLETE only
  eligible?: string[]; // COMPLETE only
}

// §8.1 — a route earns persistence below COMPLETE only when it shows something
// the routing rules could not be predicted to do: charge reaching more than one
// Program, charge being thrown away, or a non-Sync source generating it.
// Ordinary "the single compatible Program took the lot" routes are the bulk of
// the volume and prove nothing.
export function routeIsInteresting(r: ChargeRouteRecord): boolean {
  if (r.discarded > 0) return true;
  if (r.source === 'SKILL_MODIFIED_SYNC' || r.source === 'EFFECT_DESTRUCTION') return true;
  return r.assignments.filter((a) => a.assigned > 0).length > 1;
}

// §18.5 — one per targeted Function activation.
export interface TargetedRecord {
  side: Side;
  programId: string;
  fnId: string;
  effectId: EffectId;
  target: Pt | null;
  targetTile: TileView | null;
  dimension?: 'row' | 'column';
  slicedCount: number;
  sliced?: Pt[]; // full coordinate list is COMPLETE-only reconstruction detail
  retainedCount: number;
  directDamage: number;
  directCharge: number;
  resolved: boolean;
  reason?: string;
}

// §16.4 — one per ACTUAL Drain activation. A withheld System activation is
// not an activation and is deliberately absent here.
export interface DrainRecord {
  side: Side;
  programId: string; // the activating Program
  fnId: string;
  targetProgramId: string;
  readiness: Readiness;
  chargeBefore: number;
  chargeAfter: number;
  targetCost: number;
  removed: number;
}

// Alpha 0.4.1 §6.1 — the COMPACT per-turn record, written only at VERBOSE and
// above. Battle-static context (identity, config, inventory, active order,
// content fingerprint) is deliberately absent: it lives once on the battle's
// metrics record and joins through `battleId` (§4.1). That removes ~767 B of
// pure repetition from every turn.
export interface TurnLogEntry {
  v: string; // LOG_VERSION (build)
  ls: number; // LOGGING_SCHEMA_VERSION
  lvl: LoggingLevel; // level this record was created under (§3.2)
  battleId: string; // §4.1 join key
  // Alpha 0.2.0 §13.2 — mode/Run context, stamped by the orchestrator at the
  // persistence boundary (the pure logger is mode-agnostic). Quick Match
  // entries carry no runStep (never fake Run values).
  mode?: Mode;
  runStep?: RunStep;
  turn: number;
  damage: Record<Side, SideDamage>; // dealt BY each side this turn
  hpAfter: Record<Side, number>;
  chargesAfter: { player: number[]; enemy: number[]; deck: number };
  thinkMs?: number; // MK6.6 — RAW think-time for this turn's committed move
  hintShown?: boolean; // MK7.7
  result?: Side; // present on a battle's final entry: who won
  // §6.3 — the human-readable mirror duplicates structured data and is kept
  // only at COMPLETE. Readable text is otherwise derived at export time.
  actions?: string[];
}

// Alpha 0.4.1 §4.3 — rare, high-value events, keyed by battle. BASIC has no
// turn stream at all, so targeted-Function, Drain, and interesting charge-route
// telemetry had to be promoted OUT of the turn record to survive there. One
// stream, written at every level; the level tag records how it was produced.
export type BattleEventKind = 'ROUTE' | 'TARGETED' | 'DRAIN';

export interface BattleEventEntry {
  v: string;
  ls: number;
  lvl: LoggingLevel;
  battleId: string;
  turn: number;
  mode?: Mode;
  runStep?: RunStep;
  kind: BattleEventKind;
  route?: ChargeRouteRecord;
  targeted?: TargetedRecord;
  drain?: DrainRecord;
}

// Alpha 0.4.1 §4.1 — the battle-level record is the AUTHORITY for everything
// battle-static: identity, config, inventory, active build and order, build
// source, and content fingerprint. Turn and event records join to it by
// `battleId` instead of repeating any of it.
export interface MetricLogEntry {
  v: string; // LOG_VERSION
  ls: number; // LOGGING_SCHEMA_VERSION
  ms: number; // METRICS_SCHEMA_VERSION (§8.4 changed chargeWasted semantics)
  lvl: LoggingLevel;
  battleId: string;
  config: BattleConfig; // MK5.5 — active config stamp (HP included)
  // §4.1 — the ContentStamp is byte-identical for every battle sharing a
  // fingerprint, so it is stored once in its own keyed table and referenced
  // here. `content` is populated only when a caller needs a self-contained
  // record (exports resolve it from the table).
  fp: string;
  content?: ContentStamp;
  endedAt: string; // ISO timestamp
  winner: Side;
  // Alpha 0.2.0 §13.2/§5.4 — the battle's NATURAL outcome and its mode/Run
  // context. Wizard actions are recorded as separate WizardLogEntry records;
  // they never overwrite `natural`/`winner` here.
  natural: NaturalOutcome;
  mode: Mode;
  runStep?: RunStep; // RUN only
  encounterSystemHp?: number; // RUN only
  identity: IdentityStamp; // §21.2
  wallClockMs?: number; // MK6.6 — total battle wall-clock (this session)
  metrics: BattleMetrics;
}

// Alpha 0.3.0 §21.2 — one record per COMMITTED selection event. Mere
// preselection, screen viewing, and Back navigation are deliberately NOT
// logged as committed choices.
export interface SelectionLogEntry {
  v: string; // LOG_VERSION
  at: string; // ISO timestamp
  // Alpha 0.4.0 §18.3 — build events extend this ESTABLISHED committed-choice
  // stream. Mere modal opens, preselection, and Back navigation remain
  // deliberately unlogged.
  event:
    | 'HACKER_SELECTED'
    | 'DECK_SELECTED'
    | 'RUN_CREATED'
    | 'QUICK_MATCH_CREATED'
    | 'BUILD_OPENED'
    | 'BUILD_REPLACE'
    | 'BUILD_REORDER'
    | 'BATTLE_BUILD_APPLIED';
  mode?: Mode;
  runStep?: RunStep;
  battleId?: string; // present once a battle exists
  fp: string; // content fingerprint
  identity: Partial<IdentityStamp>;
  hackerMaxLink?: number;
  systemMaxIce?: number;
  // §18.2/§18.3 — portfolio, inventory and build context.
  hackerPortfolio?: string[];
  deckPortfolio?: string[];
  inventory?: string[];
  inventorySources?: string[];
  buildContext?: 'INITIAL_RUN' | 'RUN_BETWEEN' | 'RUN_RETRY' | 'CONSTRUCTED_QUICK_MATCH' | 'RANDOM_QUICK_MATCH';
  buildOrigin?: BuildOrigin;
  buildBefore?: string[];
  build?: string[];
  buildEdited?: boolean; // was the final build changed during this Build visit
  // §18.4 — Random Quick Match reproducibility. This is the SETUP random
  // source only; the battle seeds its gameplay RNG independently.
  setupSeed?: number;
  gameplayRngIndependent?: true;
}

// Alpha 0.2.0 §5.4/§13.4 — one record per explicit wizard invocation, kept
// DISTINCT from the natural battle outcome (both are preserved). Appended by
// the orchestrator through the same storage/log-sink path as other entries.
export interface WizardLogEntry {
  v: string; // LOG_VERSION
  battleId: string;
  mode: Mode;
  runStep?: RunStep; // RUN only
  natural: NaturalOutcome; // the result the wizard acted on
  action: WizardAction;
  at: string; // ISO timestamp
}

const freshDamage = (): Record<Side, SideDamage> => ({
  player: { match: 0, attacker: 0, bomb: 0, lineslice: 0, total: 0 },
  enemy: { match: 0, attacker: 0, bomb: 0, lineslice: 0, total: 0 },
});

export class TurnLogger {
  private current: TurnLogEntry | null = null;
  // §4.3 — high-value events accumulate here and are drained alongside turns.
  private events: BattleEventEntry[] = [];

  constructor(private battleId: string) {}

  drainEvents(): BattleEventEntry[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private pushEvent(turn: number, kind: BattleEventKind, body: Partial<BattleEventEntry>): void {
    this.events.push({
      v: LOG_VERSION,
      ls: LOGGING_SCHEMA_VERSION,
      lvl: activeLevel,
      battleId: this.battleId,
      turn,
      kind,
      ...body,
    });
  }

  private fresh(state: GameState): TurnLogEntry {
    return {
      v: LOG_VERSION,
      ls: LOGGING_SCHEMA_VERSION,
      lvl: activeLevel,
      battleId: this.battleId,
      turn: state.turn,
      damage: freshDamage(),
      hpAfter: { player: 0, enemy: 0 },
      chargesAfter: { player: [], enemy: [], deck: 0 },
      // §6.3 — readable mirrors are COMPLETE-only.
      ...(atLeast('COMPLETE') ? { actions: [] } : {}),
    };
  }

  // Consume one event batch; returns any turn entries finalized by it. High-
  // value events are pushed to the battle-event stream regardless of level;
  // the readable `actions` mirror is built only at COMPLETE (§6.3).
  consume(state: GameState, events: GameEvent[]): TurnLogEntry[] {
    if (!this.current) this.current = this.fresh(state);
    const e = this.current;
    const act = (line: string): void => {
      if (e.actions) e.actions.push(line);
    };
    for (const ev of events) {
      switch (ev.t) {
        case 'swap':
          act(`swap (${ev.a.x},${ev.a.y})->(${ev.b.x},${ev.b.y})`);
          break;
        case 'ability':
          // One action per parent Function activation, by display name. §7.1:
          // the Deck-owned Function is identified as Deck-owned in logs.
          act(`${ev.side} fired ${ev.name} [${ev.fn}]${ev.ownerKind === 'deck' ? ` (deck ${ev.programId})` : ''}`);
          break;
        case 'op':
          // §7.5: expanded ops log their outcome (drain amounts, fizzles).
          if (ev.drained !== undefined) act(`${ev.side} ${ev.effectId} drained ${ev.drained}`);
          else if (!ev.resolved) act(`${ev.side} ${ev.effectId} fizzled (${ev.fnId})`);
          // §16.4 — full Disabler target telemetry on the actual activation.
          if (ev.targetProgramId !== undefined) {
            this.pushEvent(e.turn, 'DRAIN', {
              drain: {
                side: ev.side,
                programId: ev.programId,
                fnId: ev.fnId,
                targetProgramId: ev.targetProgramId,
                readiness: ev.targetReadiness!,
                chargeBefore: ev.targetChargeBefore!,
                chargeAfter: ev.targetChargeAfter!,
                targetCost: ev.targetCost!,
                removed: ev.drained ?? 0,
              },
            });
          }
          break;
        case 'chargeRoute': {
          // §8.1/§8.3 — below COMPLETE, keep only routes that show something
          // the rules would not predict, and drop the two derivable fields.
          const complete = atLeast('COMPLETE');
          const route: ChargeRouteRecord = {
            side: ev.side,
            axis: ev.axis,
            token: ev.token,
            amount: ev.amount,
            source: ev.streamSource,
            ...(ev.sourceId ? { sourceId: ev.sourceId } : {}),
            assignments: ev.assignments,
            discarded: ev.discarded,
            ...(complete ? { order: ev.order, eligible: ev.eligible } : {}),
          };
          if (complete || routeIsInteresting(route)) this.pushEvent(e.turn, 'ROUTE', { route });
          break;
        }
        case 'targeted':
          this.pushEvent(e.turn, 'TARGETED', {
            targeted: {
              side: ev.side,
              programId: ev.programId,
              fnId: ev.fnId,
              effectId: ev.effectId,
              target: ev.target,
              targetTile: ev.targetTile,
              ...(ev.dimension ? { dimension: ev.dimension } : {}),
              slicedCount: ev.sliced.length,
              // The full coordinate list is reconstruction detail; the count
              // is what BASIC/VERBOSE analysis needs.
              ...(atLeast('COMPLETE') ? { sliced: ev.sliced } : {}),
              retainedCount: ev.retained.length,
              directDamage: ev.directDamage,
              directCharge: ev.directCharge,
              resolved: ev.resolved,
              ...(ev.reason ? { reason: ev.reason } : {}),
            },
          });
          act(
            `${ev.side} ${ev.effectId} ${ev.resolved ? `targeted (${ev.target!.x},${ev.target!.y})` : `fizzled — ${ev.reason ?? 'no target'}`}` +
              (ev.resolved ? ` — sliced ${ev.sliced.length}, retained ${ev.retained.length}` : ''),
          );
          break;
        case 'shake':
          act(`${ev.side} EFFECT_SHAKE ${ev.resolved ? 'resolved' : 'fizzled (legal)'}`);
          break;
        case 'skill':
          act(
            `${ev.side} skill ${ev.skillId} ${ev.effect}` +
              `${ev.damage !== undefined ? ` +${ev.damage} dmg` : ''}${ev.charge !== undefined ? ` +${ev.charge} charge` : ''}`,
          );
          break;
        case 'placed':
          if (ev.count > 0) act(`${ev.side} placed ${ev.count} ${ev.kind}${ev.count === 1 ? '' : 's'}`);
          break;
        case 'shield':
          act(`shield absorbed ${ev.prevented} of ${ev.preShield} (${ev.source})`);
          break;
        // Alpha 0.4.1 (designer ruling, 2026-08-01): detonations, B1 line
        // clears and reshuffles are AGGREGATE counters on the battle metrics
        // record, not per-turn counters or discrete events. They are consumed
        // by metrics.ts; nothing per-turn is written for them here.
        case 'damage': {
          const dealer = opponentOf(ev.target);
          e.damage[dealer][ev.source] += ev.amount;
          e.damage[dealer].total += ev.amount;
          break;
        }
        case 'thinkTime':
          e.thinkMs = ev.ms;
          break;
        case 'hintShown':
          e.hintShown = true;
          break;
        default:
          break;
      }
    }
    const done: TurnLogEntry[] = [];
    if (state.turn !== e.turn || state.winner) {
      e.hpAfter = { player: Math.max(0, state.hp.player), enemy: Math.max(0, state.hp.enemy) };
      e.chargesAfter = {
        player: state.units.player.map((u) => u.charge),
        enemy: state.units.enemy.map((u) => u.charge),
        deck: state.deckCharge,
      };
      if (state.winner) e.result = state.winner;
      // §5.2/§3.2 — BASIC keeps no ordinary per-turn stream at all. The test
      // is against the level this record was BUILT under, not the level that
      // happens to be active now: a mid-turn level change must take effect
      // from the next turn rather than retroactively promoting (or relabelling)
      // a record that was assembled under different rules.
      if (MAX_TURN_LOG_ENTRIES[e.lvl] > 0) done.push(e);
      this.current = state.winner ? null : this.fresh(state);
    }
    return done;
  }
}
