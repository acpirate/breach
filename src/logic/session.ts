// Alpha 0.2.0 §§3-7 / Alpha 0.3.0 §§5,10,12,17 — SESSION LAYER: application
// mode, the sequential Run, pending New Run setup, pending-result state, active
// Hacker/Deck identity, effective LINK/ICE resolution, and the versioned save
// envelope. This module owns the state semantics; UI composes screens and wires
// actions through this API but never invents progression, save-clearing,
// identity, or battle-construction logic.
//
// Pure logic: no DOM, no storage APIs. The orchestrator persists the strings
// this module produces and applies the transitions it exposes.

import { Game } from './game';
import {
  DATA_SCHEMA_VERSION,
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  deckById,
  getContent,
  hackerById,
} from './data/content';
import {
  PlainGameState,
  SAVE_VERSION,
  isValidConfigShape,
  isValidIdentity,
  isValidSettingsShape,
  plainGameState,
  restoreGameState,
} from './save';
import {
  BattleConfig,
  BattleIdentity,
  BattleSettings,
  Mode,
  NaturalOutcome,
  RunStep,
  SelectionSource,
  WizardAction,
} from './types';

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

// ---- active identity (§5.1/§5.2) ----

// The chosen identity, before it is expanded into a full BattleIdentity.
export interface SelectedIdentity {
  hackerId: string;
  deckId: string;
  selectionSource: SelectionSource;
}

// §5.2 — Quick Match resolves the explicit default IDs. These are named
// constants, never the first dataset row; a missing/invalid default blocks
// startup in the loader, so reaching here they are known-valid.
export function defaultIdentity(): SelectedIdentity {
  return { hackerId: DEFAULT_HACKER_ID, deckId: DEFAULT_DECK_ID, selectionSource: 'QUICK_MATCH_DEFAULT' };
}

// §5.1/§5.3 — expand a selection into the full explicit battle identity: the
// ordered Skill IDs of the chosen Hacker, the Deck's Function, and the FIXED
// ordered Program rosters from the current content contract. Nothing here is
// inferred from a display name, screen, or row position.
export function buildIdentity(hackerId: string, deckId: string, selectionSource: SelectionSource): BattleIdentity {
  const c = getContent();
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  return {
    hackerId,
    deckId,
    skillIds: [...hacker.skillIds],
    deckFunctionId: deck.fn.id,
    hackerPrograms: c.hacker.map((p) => p.id),
    systemPrograms: c.system.map((p) => p.id),
    selectionSource,
  };
}

// ---- §10.2 Normal LINK resolution ----

// Hacker maximum LINK. Normal LINK ON: BASE_LINK + the Deck's ADD_LINK.
// OFF: the manual Hacker LINK setting.
export function resolveHackerMaxLink(settings: BattleSettings, hackerId: string, deckId: string): number {
  if (!settings.normalLink) return settings.manualHackerLink;
  return hackerById(hackerId).baseLink + deckById(deckId).addLink;
}

// Quick Match System maximum ICE. Normal LINK ON: mirrors the resolved Hacker
// maximum LINK. OFF: the manual System ICE setting.
export function resolveQuickMatchIce(settings: BattleSettings, hackerMaxLink: number): number {
  return settings.normalLink ? hackerMaxLink : settings.manualSystemIce;
}

// Run System maximum ICE per encounter. Normal LINK ON: the 100/150/200/250
// encounter table. OFF: the manual System ICE value for EVERY encounter — the
// manual setting intentionally overrides the Run sequence (§10.2).
export function resolveRunIce(settings: BattleSettings, step: RunStep): number {
  return settings.normalLink ? encounterFor(step).systemHp : settings.manualSystemIce;
}

// §5.4 — assemble the per-battle config: the chosen settings plus the values
// resolved from identity. The selected Hacker's authored strong sets are
// authoritative for the Hacker; the System's are their complements. There is no
// competing hardcoded HIGH/LOW authority anywhere.
export function buildBattleConfig(
  settings: BattleSettings,
  hackerId: string,
  hackerMaxLink: number,
  systemMaxIce: number,
): BattleConfig {
  const h = hackerById(hackerId);
  return {
    ...settings,
    playerHp: hackerMaxLink,
    enemyHp: systemMaxIce,
    strongColors: { player: [...h.strongColors], enemy: [...h.weakColors] },
    strongShapes: { player: [...h.strongShapes], enemy: [...h.weakShapes] },
  };
}

// ---- Session state (runtime) ----

export interface QuickMatchInfo {
  mode: 'QUICK_MATCH';
  identity: SelectedIdentity;
}

// Run-only identity (§6.2/§10.4): step, the settings snapshot taken at the
// final New Run commitment, the selected Hacker/Deck, and the effective Hacker
// maximum LINK resolved at that moment. The snapshot is authoritative for the
// whole Run — changing title Settings afterwards must not alter it.
export interface RunInfo {
  mode: 'RUN';
  step: RunStep;
  settings: BattleSettings;
  identity: SelectedIdentity;
  hackerMaxLink: number;
}

export type SessionInfo = QuickMatchInfo | RunInfo;

// A concluded battle whose result has not been accepted yet (§5.1). This is
// REAL, saveable state — not renderer state. `metricsLogged` guards against
// double-appending the Tier-1 battle record across a save/resume boundary.
// `forcedWin` marks that WIZARD_FORCE_WIN was applied to this result; it never
// overwrites `natural` (§18.2).
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

// §18.1 — the Force Win availability matrix, owned by the session layer so
// rendering code cannot drift from it. Force Win is NEVER available during
// active combat; this answers only "should the control appear on this result
// screen".
export function forceWinAvailable(info: SessionInfo, pending: PendingResultInfo | null): boolean {
  if (!pending || pending.forcedWin) return false;
  if (info.mode === 'QUICK_MATCH') {
    // Quick Match: offered on a natural defeat only.
    return pending.natural === 'NATURAL_DEFEAT';
  }
  if (pending.natural === 'NATURAL_DEFEAT') return true; // Run battles 1-4 defeat
  // Natural victory: offered on battles 1-3 (logs the wizard action without
  // altering progression); never on Battle 4, which presents as Run Complete.
  return info.step < RUN_LENGTH;
}

// ---- §12 pending New Run setup state ----

export type SetupStep = 'HACKER' | 'DECK' | 'REVIEW';

// Ephemeral UI/application state, NOT an active save (§12.2). Entering setup
// does not modify the existing save; only Start Run commits.
export interface PendingSetup {
  step: SetupStep;
  hackerId: string | null;
  deckId: string | null;
}

export function beginSetup(): PendingSetup {
  return { step: 'HACKER', hackerId: null, deckId: null };
}

// Choosing updates pending setup ONLY (§13.2/§14.2).
export function chooseHacker(s: PendingSetup, hackerId: string): PendingSetup {
  return { ...s, hackerId, step: 'DECK' };
}

export function chooseDeck(s: PendingSetup, deckId: string): PendingSetup {
  return { ...s, deckId, step: 'REVIEW' };
}

// Back navigation RETAINS current pending choices (§12.2). Backing out of the
// first screen returns null, meaning "return to Title and discard pending setup
// only" — the resident save is untouched.
export function setupBack(s: PendingSetup): PendingSetup | null {
  if (s.step === 'REVIEW') return { ...s, step: 'DECK' };
  if (s.step === 'DECK') return { ...s, step: 'HACKER' };
  return null;
}

// The setup is committable once both choices exist and Build Review is showing.
export function setupComplete(s: PendingSetup): boolean {
  return s.step === 'REVIEW' && s.hackerId !== null && s.deckId !== null;
}

// ---- Battle creation (§4.2/§4.3/§10.5) ----
// A fresh `Game` already provides every §10.5 reset (new board, new RNG, zero
// Program charge, `startCharged` Deck charge, fresh metrics): nothing carries
// over unless it is in the config. Run battles resolve System ICE per encounter.

export function cloneSettings(s: BattleSettings): BattleSettings {
  return { ...s };
}

function cloneConfig(c: BattleConfig): BattleConfig {
  return {
    ...c,
    strongColors: { player: [...c.strongColors.player], enemy: [...c.strongColors.enemy] },
    strongShapes: { player: [...c.strongShapes.player], enemy: [...c.strongShapes.enemy] },
  };
}

// Snapshot the menu settings at New Run (§10.4): later menu edits must never
// mutate the saved Run.
export function snapshotRunSettings(menuSettings: BattleSettings): BattleSettings {
  return cloneSettings(menuSettings);
}

// The effective per-battle config for a Run step, from the Run's snapshot.
export function effectiveRunConfig(info: RunInfo, step: RunStep): BattleConfig {
  return buildBattleConfig(info.settings, info.identity.hackerId, info.hackerMaxLink, resolveRunIce(info.settings, step));
}

export function createQuickMatchBattle(settings: BattleSettings, ids: SelectedIdentity, seed?: number): Game {
  const hackerMaxLink = resolveHackerMaxLink(settings, ids.hackerId, ids.deckId);
  const config = buildBattleConfig(settings, ids.hackerId, hackerMaxLink, resolveQuickMatchIce(settings, hackerMaxLink));
  return new Game(config, buildIdentity(ids.hackerId, ids.deckId, ids.selectionSource), seed);
}

// Quick Match "Reset" restarts under the concluded battle's OWN config and
// identity (§18.3), not under current menu settings.
export function recreateBattleFromConfig(config: BattleConfig, identity: BattleIdentity, seed?: number): Game {
  return new Game(cloneConfig(config), { ...identity }, seed);
}

export function createRunBattle(info: RunInfo, step: RunStep, seed?: number): Game {
  const config = effectiveRunConfig(info, step);
  return new Game(config, buildIdentity(info.identity.hackerId, info.identity.deckId, info.identity.selectionSource), seed);
}

// ---- Log/record context (§21.2) ----

export interface BattleContext {
  mode: Mode;
  runStep?: RunStep;
  encounterSystemHp?: number;
}

export function battleContext(info: SessionInfo): BattleContext {
  if (info.mode === 'RUN') {
    return { mode: 'RUN', runStep: info.step, encounterSystemHp: resolveRunIce(info.settings, info.step) };
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

// ---- Save envelope (§17) ----
// One slot, one mode. Quick Match saves carry NO run field at all (§17.2 — no
// fake Run values to satisfy a broad nullable interface). Alpha 0.2 saves are
// rejected by the version/schema check: there is no migration path (§17.1).

interface SavedSession {
  version: string;
  schema: number;
  fp: string;
  mode: Mode;
  identity: BattleIdentity; // §17.2 explicit Hacker/Deck/Skill/Program identity
  run?: { step: RunStep; settings: BattleSettings; hackerMaxLink: number };
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
    identity: { ...game.state.identity },
    ...(info.mode === 'RUN'
      ? { run: { step: info.step, settings: cloneSettings(info.settings), hackerMaxLink: info.hackerMaxLink } }
      : {}),
    phase: pending ? 'PENDING_RESULT' : 'ACTIVE_BATTLE',
    ...(pending
      ? { result: { natural: pending.natural, ...(pending.forcedWin ? { forcedWin: true as const } : {}), metricsLogged: pending.metricsLogged } }
      : {}),
    state: plainGameState(game.state),
  };
  return JSON.stringify(env);
}

// Returns a fully restored session, or null for ANYTHING invalid: wrong or
// pre-Alpha-0.3.0 version (§17.1 — no migration, no partial load), schema or
// content-fingerprint mismatch, malformed mode/run/result shape, identity that
// disagrees with the resolved content contract, or invalid battle state.
export function deserializeSession(json: string | null): RestoredSession | null {
  if (!json) return null;
  try {
    const env = JSON.parse(json) as Partial<SavedSession>;
    if (env.version !== SAVE_VERSION) return null;
    if (env.schema !== DATA_SCHEMA_VERSION) return null;
    const content = getContent();
    if (env.fp !== content.fingerprint) return null;
    if (env.mode !== 'QUICK_MATCH' && env.mode !== 'RUN') return null;
    // §17.3 — the envelope's identity must satisfy the content contract, and
    // the battle state must carry exactly the same identity.
    if (!isValidIdentity(env.identity)) return null;
    const envId = env.identity as BattleIdentity;

    const game = restoreGameState(env.state, env.phase === 'PENDING_RESULT');
    if (!game) return null;
    const stateId = game.state.identity;
    const sameOrder = (a: string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
    if (
      stateId.hackerId !== envId.hackerId ||
      stateId.deckId !== envId.deckId ||
      stateId.deckFunctionId !== envId.deckFunctionId ||
      stateId.selectionSource !== envId.selectionSource ||
      !sameOrder(envId.skillIds, stateId.skillIds) ||
      !sameOrder(envId.hackerPrograms, stateId.hackerPrograms) ||
      !sameOrder(envId.systemPrograms, stateId.systemPrograms)
    ) {
      return null;
    }

    let info: SessionInfo;
    if (env.mode === 'RUN') {
      const run = env.run;
      if (!run || !Number.isInteger(run.step) || run.step < 1 || run.step > RUN_LENGTH) return null;
      if (!isValidSettingsShape(run.settings)) return null;
      if (!Number.isInteger(run.hackerMaxLink) || run.hackerMaxLink < 1 || run.hackerMaxLink > 9999) return null;
      info = {
        mode: 'RUN',
        step: run.step as RunStep,
        settings: cloneSettings(run.settings),
        identity: { hackerId: envId.hackerId, deckId: envId.deckId, selectionSource: envId.selectionSource },
        hackerMaxLink: run.hackerMaxLink,
      };
    } else {
      if (env.run !== undefined) return null; // Quick Match never carries Run values
      info = {
        mode: 'QUICK_MATCH',
        identity: { hackerId: envId.hackerId, deckId: envId.deckId, selectionSource: envId.selectionSource },
      };
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

    if (!isValidConfigShape(game.state.config)) return null;
    // concluded-state winner must agree with the recorded natural outcome
    if (pending && naturalOf(game.state.winner as 'player' | 'enemy') !== pending.natural) return null;
    // §10.4 — the battle's effective LINK/ICE must agree with the saved rule,
    // so a tampered or stale envelope cannot resume under different maxima.
    if (info.mode === 'RUN') {
      if (game.state.config.playerHp !== info.hackerMaxLink) return null;
      if (game.state.config.enemyHp !== resolveRunIce(info.settings, info.step)) return null;
    }
    return { info, game, pending };
  } catch {
    return null;
  }
}

export type { WizardAction };
