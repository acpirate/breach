// MK4.1/Alpha 0.2.0 — GAME-STATE (de)serialization primitives. As of Alpha
// 0.2.0 the persisted envelope is the SESSION envelope owned by session.ts
// (mode, Run state, pending result); this module provides the state-level
// pieces it composes: plain-object serialization of a GameState and validated
// restoration of one, for both ACTIVE battles (in-progress, stable phase) and
// CONCLUDED battles (a saved pending result, §5.1).
//
// Pure logic-layer JSON — no storage APIs here; the browser adapter owns
// localStorage.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, SHAPE_COUNT } from './constants';
import { isAreaPatternId } from './data/areas';
import { GAME_VERSION, getContent } from './data/content';
import { Game } from './game';
import { makeRNG } from './rng';
import { GameState } from './types';

export const SAVE_VERSION = GAME_VERSION;

// MK9.4: a strong-binding set is an array of valid Color/Shape enum ints.
function isValidEnumArray(a: unknown, max: number): boolean {
  return Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0 && v < max);
}
export function isValidStrongRecord(r: unknown, max: number): boolean {
  const rec = r as { player?: unknown; enemy?: unknown } | undefined;
  return !!rec && isValidEnumArray(rec.player, max) && isValidEnumArray(rec.enemy, max);
}

// Shape check for a BattleConfig — used for the battle's own config AND the
// Run configuration snapshot (§4.2), which must satisfy the same contract.
export function isValidConfigShape(c: unknown): boolean {
  const cfg = c as GameState['config'] | undefined;
  return !!(
    cfg &&
    typeof cfg.enemyMatching === 'boolean' &&
    typeof cfg.hackerBonusEnabled === 'boolean' &&
    typeof cfg.singleAxisPayout === 'boolean' &&
    typeof cfg.noMatchDamage === 'boolean' &&
    (cfg.maxCascadeSteps === null || (Number.isInteger(cfg.maxCascadeSteps) && cfg.maxCascadeSteps >= 0 && cfg.maxCascadeSteps <= 9)) &&
    Number.isInteger(cfg.playerHp) && cfg.playerHp >= 1 && cfg.playerHp <= 9999 &&
    Number.isInteger(cfg.enemyHp) && cfg.enemyHp >= 1 && cfg.enemyHp <= 9999 &&
    typeof cfg.hintEnabled === 'boolean' &&
    typeof cfg.nmdChargeAwareBot === 'boolean' &&
    Number.isInteger(cfg.hintDelaySeconds) && cfg.hintDelaySeconds >= 1 && cfg.hintDelaySeconds <= 60 &&
    isValidStrongRecord(cfg.strongColors, COLOR_COUNT) &&
    isValidStrongRecord(cfg.strongShapes, SHAPE_COUNT)
  );
}

export type PlainGameState = Omit<GameState, 'rng'> & { rngState: number };

export function plainGameState(state: GameState): PlainGameState {
  const { rng, ...plain } = state;
  return { ...plain, rngState: rng.getState() };
}

// Validate and restore one serialized GameState against the CURRENT resolved
// content (§14.4 restore-by-stable-IDs). `concluded` selects the phase
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
    // Restore by stable IDs against current resolved definitions — slot order
    // and IDs must match the loaded content exactly (§7.2 order round-trip).
    const content = getContent();
    const sides = [
      { units: s.units?.player, programs: content.hacker },
      { units: s.units?.enemy, programs: content.system },
    ];
    for (const { units, programs } of sides) {
      if (!Array.isArray(units) || units.length !== programs.length) return null;
      for (let i = 0; i < programs.length; i++) {
        const u = units[i];
        if (!u || u.programId !== programs[i].id) return null;
        if (!(Number.isInteger(u.charge) && u.charge >= 0 && u.charge <= programs[i].chargeCap)) return null;
      }
    }
    if (typeof s.hp?.player !== 'number' || typeof s.hp?.enemy !== 'number') return null;
    if (!s.metrics?.sides?.player || !s.metrics?.sides?.enemy) return null;
    if (!isValidConfigShape(s.config)) return null;
    const { rngState, ...rest } = s;
    return Game.restore({ ...rest, rng: makeRNG(rngState) });
  } catch {
    return null;
  }
}
