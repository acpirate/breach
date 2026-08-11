// MK4.1/Alpha 0.2.0/Alpha 0.3.0 — GAME-STATE (de)serialization primitives. The
// persisted envelope is the SESSION envelope owned by session.ts (mode, Run
// state, pending result, selection identity); this module provides the
// state-level pieces it composes: plain-object serialization of a GameState and
// validated restoration of one, for both ACTIVE battles (in-progress, stable
// phase) and CONCLUDED battles (a saved pending result, §5.1).
//
// Pure logic-layer JSON — no storage APIs here; the browser adapter owns
// localStorage.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, SHAPE_COUNT } from './constants';
import { isAreaPatternId } from './data/areas';
import { GAME_VERSION, getContent, inventoryProgramIds, isValidBuild } from './data/content';
import { Game } from './game';
import { makeRNG } from './rng';
import { BattleIdentity, BattleSettings, GameState, isSystemSelectionSource } from './types';

export const SAVE_VERSION = GAME_VERSION;

// A strong-binding set is an array of valid Color/Shape enum ints.
function isValidEnumArray(a: unknown, max: number): boolean {
  return Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0 && v < max);
}
export function isValidStrongRecord(r: unknown, max: number): boolean {
  const rec = r as { player?: unknown; enemy?: unknown } | undefined;
  return !!rec && isValidEnumArray(rec.player, max) && isValidEnumArray(rec.enemy, max);
}

const isStringArray = (a: unknown): a is string[] => Array.isArray(a) && a.every((v) => typeof v === 'string');

// Alpha 0.3.0 §10.2 — shape check for the player-chosen SETTINGS. Used for the
// Run configuration snapshot and as the base of the per-battle config check.
export function isValidSettingsShape(c: unknown): boolean {
  const cfg = c as BattleSettings | undefined;
  return !!(
    cfg &&
    typeof cfg.enemyMatching === 'boolean' &&
    typeof cfg.singleAxisPayout === 'boolean' &&
    typeof cfg.reinforcedConnection === 'boolean' &&
    typeof cfg.normalLink === 'boolean' &&
    (cfg.maxCascadeSteps === null || (Number.isInteger(cfg.maxCascadeSteps) && cfg.maxCascadeSteps >= 0 && cfg.maxCascadeSteps <= 9)) &&
    Number.isInteger(cfg.manualHackerLink) && cfg.manualHackerLink >= 1 && cfg.manualHackerLink <= 9999 &&
    Number.isInteger(cfg.manualSystemIce) && cfg.manualSystemIce >= 1 && cfg.manualSystemIce <= 9999 &&
    typeof cfg.hintEnabled === 'boolean' &&
    typeof cfg.reinforcedChargeAwareBot === 'boolean' &&
    Number.isInteger(cfg.hintDelaySeconds) && cfg.hintDelaySeconds >= 1 && cfg.hintDelaySeconds <= 60
  );
}

// Shape check for a full per-battle BattleConfig: the settings PLUS the values
// resolved from the active Hacker/Deck identity (effective LINK/ICE maxima and
// the per-side strong sets).
export function isValidConfigShape(c: unknown): boolean {
  const cfg = c as GameState['config'] | undefined;
  return !!(
    isValidSettingsShape(c) &&
    cfg &&
    Number.isInteger(cfg.playerHp) && cfg.playerHp >= 1 && cfg.playerHp <= 9999 &&
    Number.isInteger(cfg.enemyHp) && cfg.enemyHp >= 1 && cfg.enemyHp <= 9999 &&
    isValidStrongRecord(cfg.strongColors, COLOR_COUNT) &&
    isValidStrongRecord(cfg.strongShapes, SHAPE_COUNT)
  );
}

// §17.3 — the saved battle identity must exist in, and AGREE with, the current
// resolved content contract. A mismatch rejects the save rather than
// substituting current defaults.
export function isValidIdentity(raw: unknown): boolean {
  const id = raw as BattleIdentity | undefined;
  if (!id || typeof id !== 'object') return false;
  if (typeof id.hackerId !== 'string' || typeof id.deckId !== 'string') return false;
  if (typeof id.deckFunctionId !== 'string') return false;
  if (!isStringArray(id.passiveIds) || !isStringArray(id.hackerPrograms) || !isStringArray(id.systemPrograms)) return false;
  if (!isStringArray(id.inventory) || !isStringArray(id.upgradeIds)) return false;
  if (id.selectionSource !== 'EXPLICIT_SELECTION' && id.selectionSource !== 'QUICK_MATCH_DEFAULT') return false;
  if (typeof id.buildOrigin !== 'string') return false;
  // Alpha 0.5.0 §32/§41 — an active save MUST name a System that still
  // resolves. A missing or unknown SYS_ID is an incompatible save, never an
  // invitation to substitute a default or reroll the encounter.
  if (typeof id.systemId !== 'string') return false;
  if (!isSystemSelectionSource(id.systemSelectionSource)) return false;
  // Alpha 0.6.0 §7/§40 — the HOST is battle identity on exactly the System's
  // terms: it must name a HST_ID that still resolves. There is no default.
  if (typeof id.hostId !== 'string') return false;
  const c = getContent();
  const hacker = c.hackers.get(id.hackerId);
  const deck = c.decks.get(id.deckId);
  const system = c.systems.get(id.systemId);
  const host = c.hosts.get(id.hostId);
  if (!hacker || !deck || !system || !host) return false;
  // ordered PASSIVE IDs must match the referenced Hacker exactly (§17.3)
  if (id.passiveIds.length !== hacker.passiveIds.length) return false;
  if (id.passiveIds.some((s, i) => s !== hacker.passiveIds[i])) return false;
  if (id.passiveIds.some((s) => !c.passives.has(s))) return false;
  // §43 — acquired UPGRADEs must all resolve and must be unique. A duplicate is
  // a corrupt save, never something to silently deduplicate.
  if (id.upgradeIds.some((u) => !c.upgrades.has(u))) return false;
  if (new Set(id.upgradeIds).size !== id.upgradeIds.length) return false;
  if (id.deckFunctionId !== deck.fn.id) return false;
  // Alpha 0.4.0 §17.2 — the saved inventory must be exactly what this
  // Hacker/Deck pairing derives from CURRENT portfolio content, and the saved
  // build must be a valid ordered four drawn from it. A save whose Program
  // references have drifted is incompatible, never silently defaulted.
  const inventory = inventoryProgramIds(id.hackerId, id.deckId);
  if (id.inventory.length !== inventory.length) return false;
  if (id.inventory.some((pid, i) => pid !== inventory[i])) return false;
  if (!isValidBuild(id.hackerPrograms, id.inventory)) return false;
  // Alpha 0.5.0 §5.4/§32 — the System roster is the SELECTED System's ordered
  // PRG_SET, not the full loaded PRG_S_* catalog as it was through Alpha 0.4.
  // Order is gameplay-significant (charge routing), so it must match exactly.
  return (
    id.systemPrograms.length === system.programIds.length &&
    id.systemPrograms.every((pid, i) => pid === system.programIds[i])
  );
}

export type PlainGameState = Omit<GameState, 'rng'> & { rngState: number };

export function plainGameState(state: GameState): PlainGameState {
  const { rng, ...plain } = state;
  return { ...plain, rngState: rng.getState() };
}

// Validate and restore one serialized GameState against the CURRENT resolved
// content (§17.3 restore-by-stable-IDs). `concluded` selects the phase
// contract:
//  - active battles: winner null, phase 'playerPre', fully populated board
//    (in-progress stable saves only, deterministic RNG continuation);
//  - concluded battles (saved pending result): winner set, phase 'over';
//    the board may legitimately contain holes (resolution halts at game over).
// Returns a resumable Game, or null for anything invalid.
export function restoreGameState(raw: unknown, concluded: boolean): Game | null {
  try {
    const s = raw as PlainGameState;
    if (!s || typeof s !== 'object') return null;
    if (typeof s.rngState !== 'number') return null;
    if (typeof s.battleId !== 'string' || typeof s.turn !== 'number') return null;
    if (concluded) {
      if (s.winner !== 'player' && s.winner !== 'enemy') return null;
      if (s.phase !== 'over') return null;
    } else {
      if (s.winner !== null || s.phase !== 'playerPre') return null;
    }
    if (!Array.isArray(s.board) || s.board.length !== BOARD_HEIGHT) return null;
    if (s.board.some((row) => !Array.isArray(row) || row.length !== BOARD_WIDTH)) return null;
    if (!concluded && s.board.some((row) => row.some((t) => !t))) return null;
    // Special tiles must carry valid Alpha data (footprints, magnitudes).
    for (const row of s.board) {
      for (const t of row) {
        const sp = t?.special;
        if (!sp) continue;
        if (sp.type === 'bomb') {
          if (!(Number.isInteger(sp.countdown) && sp.countdown! >= 0)) return null;
          if (typeof sp.areaPattern !== 'string' || !isAreaPatternId(sp.areaPattern)) return null;
        } else {
          if (!(Number.isInteger(sp.magnitude) && sp.magnitude! >= 1)) return null;
        }
      }
    }
    // §17.3 — explicit Hacker/Deck/Skill/build identity, verified against the
    // resolved content contract before anything else is trusted.
    if (!isValidIdentity(s.identity)) return null;
    // Restore by stable IDs — Alpha 0.4.0 §17.2 / Alpha 0.5.0 §32: BOTH rosters
    // now come from the battle's own identity — the Hacker's ordered active
    // build, and the selected System's ordered PRG_SET. (Alpha 0.4 could read
    // the System side straight off the content contract because every loaded
    // System Program was in play; with eight loaded and four fielded, that is
    // no longer the same list.) isValidIdentity above has already checked the
    // saved PRG_SET against the named System, so this compares against a
    // verified roster. Slot order and IDs must round-trip exactly, and each
    // charge must sit within its own Program's pool.
    const content = getContent();
    const sides = [
      { units: s.units?.player, programIds: s.identity.hackerPrograms },
      { units: s.units?.enemy, programIds: s.identity.systemPrograms },
    ];
    for (const { units, programIds } of sides) {
      if (!Array.isArray(units) || units.length !== programIds.length) return null;
      for (let i = 0; i < programIds.length; i++) {
        const u = units[i];
        if (!u || u.programId !== programIds[i]) return null;
        const prog = content.programsById.get(programIds[i]);
        if (!prog) return null;
        if (!(Number.isInteger(u.charge) && u.charge >= 0 && u.charge <= prog.chargeCap)) return null;
      }
    }
    // §7.2 — the Deck Function's exact current charge, capped at its cost.
    const deckCap = content.decks.get(s.identity.deckId)!.fn.cost;
    if (!(Number.isInteger(s.deckCharge) && s.deckCharge >= 0 && s.deckCharge <= deckCap)) return null;
    if (typeof s.hp?.player !== 'number' || typeof s.hp?.enemy !== 'number') return null;
    if (!s.metrics?.sides?.player || !s.metrics?.sides?.enemy) return null;
    if (!isValidConfigShape(s.config)) return null;
    const { rngState, ...rest } = s;
    return Game.restore({ ...rest, rng: makeRNG(rngState) });
  } catch {
    return null;
  }
}
