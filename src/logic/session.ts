// Alpha 0.2.0 §§3-7 — SESSION LAYER: application mode, the sequential Run,
// pending-result state, and the versioned save envelope. This module owns the
// state semantics; UI composes dialogs and wires actions through this API but
// never invents progression, save-clearing, or battle-construction logic.
//
// Pure logic: no DOM, no storage APIs. The orchestrator persists the strings
// this module produces and applies the transitions it exposes.

import { Game } from './game';
import { DATA_SCHEMA_VERSION, getContent } from './data/content';
import { PlainGameState, SAVE_VERSION, isValidConfigShape, plainGameState, restoreGameState } from './save';
import { BattleConfig, Mode, NaturalOutcome, RunStep, WizardAction } from './types';

// ---- Run encounter table (§4.1 — explicit definition, NOT a formula) ----

export interface RunEncounter {
  step: RunStep;
  systemHp: number;
}

export const RUN_LENGTH = 4;

export const RUN_ENCOUNTERS: ReadonlyArray<RunEncounter> = [
  { step: 1, systemHp: 100 },
  { step: 2, systemHp: 150 },
  { step: 3, systemHp: 200 },
  { step: 4, systemHp: 250 },
];

export function encounterFor(step: RunStep): RunEncounter {
  return RUN_ENCOUNTERS[step - 1];
}

export function nextStep(step: RunStep): RunStep | null {
  return step < RUN_LENGTH ? ((step + 1) as RunStep) : null;
}

// ---- Session state (runtime) ----

export interface QuickMatchInfo {
  mode: 'QUICK_MATCH';
}

// Run-only identity (§6.2): step plus the configuration snapshot taken at New
// Run. The snapshot is authoritative for the whole Run; the per-battle
// effective config derives from it (System HP overridden per encounter).
export interface RunInfo {
  mode: 'RUN';
  step: RunStep;
  config: BattleConfig;
}

export type SessionInfo = QuickMatchInfo | RunInfo;

// A concluded battle whose result has not been accepted yet (§5.1). This is
// REAL, saveable state — not renderer state. `metricsLogged` guards against
// double-appending the Tier-1 battle record across a save/resume boundary.
// `forcedWin` marks that WIZARD_FORCE_WIN was applied to this result; it never
// overwrites `natural` (§5.4).
export interface PendingResultInfo {
  natural: NaturalOutcome;
  forcedWin?: true;
  metricsLogged: boolean;
}

export function naturalOf(winner: 'player' | 'enemy'): NaturalOutcome {
  return winner === 'player' ? 'NATURAL_VICTORY' : 'NATURAL_DEFEAT';
}

// Run Complete presentation (§4.4/§5.2): the step-4 result presents as Run
// Complete when won naturally OR forced; it never offers Force Win.
export function isRunComplete(info: SessionInfo, pending: PendingResultInfo | null): boolean {
  return (
    info.mode === 'RUN' &&
    info.step === RUN_LENGTH &&
    !!pending &&
    (pending.natural === 'NATURAL_VICTORY' || pending.forcedWin === true)
  );
}

// Whether this pending result progresses as a victory (naturally won or
// wizard-forced). Used by the orchestrator to pick the progression action.
export function progressesAsVictory(pending: PendingResultInfo): boolean {
  return pending.natural === 'NATURAL_VICTORY' || pending.forcedWin === true;
}

// ---- Battle creation (§4.2/§4.3 — merged SENIOR-2 contract) ----
// A fresh `Game` already provides every §4.3 reset (new board, new RNG, zero
// charges, recharged Board-Shake, fresh metrics): nothing carries over unless
// it is in the config. Run battles apply exactly one override: encounter HP.

function cloneConfig(c: BattleConfig): BattleConfig {
  return {
    ...c,
    strongColors: { player: [...c.strongColors.player], enemy: [...c.strongColors.enemy] },
    strongShapes: { player: [...c.strongShapes.player], enemy: [...c.strongShapes.enemy] },
  };
}

// Snapshot the menu configuration at New Run (§3.3): later menu edits must
// never mutate the saved Run.
export function snapshotRunConfig(menuConfig: BattleConfig): BattleConfig {
  return cloneConfig(menuConfig);
}

export function effectiveRunConfig(runConfig: BattleConfig, step: RunStep): BattleConfig {
  return { ...cloneConfig(runConfig), enemyHp: encounterFor(step).systemHp };
}

export function createQuickMatchBattle(config: BattleConfig, seed?: number): Game {
  return new Game(cloneConfig(config), seed);
}

export function createRunBattle(runConfig: BattleConfig, step: RunStep, seed?: number): Game {
  return new Game(effectiveRunConfig(runConfig, step), seed);
}

// ---- Log/record context (§13.2) ----

export interface BattleContext {
  mode: Mode;
  runStep?: RunStep;
  encounterSystemHp?: number;
}

export function battleContext(info: SessionInfo): BattleContext {
  if (info.mode === 'RUN') {
    return { mode: 'RUN', runStep: info.step, encounterSystemHp: encounterFor(info.step).systemHp };
  }
  return { mode: 'QUICK_MATCH' }; // no fake Run values on Quick Match records
}

// ---- Title labels (§3.4) ----

export function continueLabel(info: SessionInfo): string {
  return info.mode === 'RUN' ? `Continue Run — Battle ${info.step} of ${RUN_LENGTH}` : 'Continue Quick Match';
}

export function contextLabel(info: SessionInfo): string {
  return info.mode === 'RUN' ? `Run — Battle ${info.step} of ${RUN_LENGTH}` : 'Quick Match';
}

// ---- Save envelope v2 (§6) ----
// One slot, one mode. Quick Match saves carry NO run field at all (§6.2 —
// no fake Run values to satisfy a broad nullable interface).

interface SavedSession {
  version: string;
  schema: number;
  fp: string;
  mode: Mode;
  hackerOrder: string[]; // stable ordered PRG_IDs (§6.2/§7.2)
  systemOrder: string[];
  run?: { step: RunStep; config: BattleConfig };
  phase: 'ACTIVE_BATTLE' | 'PENDING_RESULT';
  result?: { natural: NaturalOutcome; forcedWin?: true; metricsLogged: boolean };
  state: PlainGameState;
}

export interface RestoredSession {
  info: SessionInfo;
  game: Game;
  pending: PendingResultInfo | null;
}

export function serializeSession(info: SessionInfo, game: Game, pending: PendingResultInfo | null): string {
  const content = getContent();
  const env: SavedSession = {
    version: SAVE_VERSION,
    schema: DATA_SCHEMA_VERSION,
    fp: content.fingerprint,
    mode: info.mode,
    hackerOrder: content.hacker.map((p) => p.id),
    systemOrder: content.system.map((p) => p.id),
    ...(info.mode === 'RUN' ? { run: { step: info.step, config: cloneConfig(info.config) } } : {}),
    phase: pending ? 'PENDING_RESULT' : 'ACTIVE_BATTLE',
    ...(pending
      ? { result: { natural: pending.natural, ...(pending.forcedWin ? { forcedWin: true as const } : {}), metricsLogged: pending.metricsLogged } }
      : {}),
    state: plainGameState(game.state),
  };
  return JSON.stringify(env);
}

// Returns a fully restored session, or null for ANYTHING invalid: wrong or
// pre-Alpha-0.2.0 version (§6.1 — no migration, no partial load), schema or
// content-fingerprint mismatch (§6.5), malformed mode/run/result shape,
// Program-order mismatch, or invalid battle state.
export function deserializeSession(json: string | null): RestoredSession | null {
  if (!json) return null;
  try {
    const env = JSON.parse(json) as Partial<SavedSession>;
    if (env.version !== SAVE_VERSION) return null;
    if (env.schema !== DATA_SCHEMA_VERSION) return null;
    const content = getContent();
    if (env.fp !== content.fingerprint) return null;
    if (env.mode !== 'QUICK_MATCH' && env.mode !== 'RUN') return null;
    // ordered stable Program IDs must match the loaded content exactly
    const ordersOk = (saved: unknown, programs: ReadonlyArray<{ id: string }>): boolean =>
      Array.isArray(saved) && saved.length === programs.length && saved.every((id, i) => id === programs[i].id);
    if (!ordersOk(env.hackerOrder, content.hacker) || !ordersOk(env.systemOrder, content.system)) return null;

    let info: SessionInfo;
    if (env.mode === 'RUN') {
      const run = env.run;
      if (!run || !Number.isInteger(run.step) || run.step < 1 || run.step > RUN_LENGTH) return null;
      if (!isValidConfigShape(run.config)) return null;
      info = { mode: 'RUN', step: run.step as RunStep, config: cloneConfig(run.config) };
    } else {
      if (env.run !== undefined) return null; // Quick Match never carries Run values
      info = { mode: 'QUICK_MATCH' };
    }

    if (env.phase !== 'ACTIVE_BATTLE' && env.phase !== 'PENDING_RESULT') return null;
    let pending: PendingResultInfo | null = null;
    if (env.phase === 'PENDING_RESULT') {
      const r = env.result;
      if (!r || (r.natural !== 'NATURAL_VICTORY' && r.natural !== 'NATURAL_DEFEAT')) return null;
      if (typeof r.metricsLogged !== 'boolean') return null;
      if (r.forcedWin !== undefined && r.forcedWin !== true) return null;
      pending = { natural: r.natural, metricsLogged: r.metricsLogged, ...(r.forcedWin ? { forcedWin: true as const } : {}) };
    } else if (env.result !== undefined) {
      return null; // an active battle cannot carry a result
    }

    const game = restoreGameState(env.state, pending !== null);
    if (!game) return null;
    // concluded-state winner must agree with the recorded natural outcome
    if (pending && naturalOf(game.state.winner as 'player' | 'enemy') !== pending.natural) return null;
    // a Run battle's effective System HP config must match its encounter
    if (info.mode === 'RUN' && game.state.config.enemyHp !== encounterFor(info.step).systemHp) return null;
    return { info, game, pending };
  } catch {
    return null;
  }
}

export type { WizardAction };
