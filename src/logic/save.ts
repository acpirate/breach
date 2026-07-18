// MK4.1 — Save serialization for the in-progress battle. Pure logic-layer
// JSON (no storage APIs here; the browser adapter owns localStorage).
//
// The envelope carries a version stamp; a missing/incompatible stamp or any
// structural problem is treated as "no valid save" (never a crash). Saves are
// only written at stable points (player's make-a-match phase), so a restored
// game is always immediately playable.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, SHAPE_COUNT } from './constants';
import { Game } from './game';
import { makeRNG } from './rng';
import { GameState, UNIT_ORDER } from './types';

// Save-format version (designer-set placeholder scheme; bump on state-shape
// changes). MK9 added the 'shield' special tile and per-side strong bindings to
// BattleConfig — older saves (mk7) fail gracefully to a fresh start via the
// version check below, as designed (MK9.9: reject malformed mixed-version state
// rather than silently loading it).
export const SAVE_VERSION = 'mk9';

// MK9.4: a strong-binding set is an array of valid Color/Shape enum ints
// (0..COLOR_COUNT-1 / 0..SHAPE_COUNT-1). Empty is allowed (a side with no
// strong tiles). Used to validate persisted per-side strong bindings.
function isValidEnumArray(a: unknown, max: number): boolean {
  return Array.isArray(a) && a.every((v) => Number.isInteger(v) && v >= 0 && v < max);
}
export function isValidStrongRecord(r: unknown, max: number): boolean {
  const rec = r as { player?: unknown; enemy?: unknown } | undefined;
  return !!rec && isValidEnumArray(rec.player, max) && isValidEnumArray(rec.enemy, max);
}

export function serializeGame(state: GameState): string {
  const { rng, ...plain } = state;
  return JSON.stringify({ version: SAVE_VERSION, state: { ...plain, rngState: rng.getState() } });
}

// Returns a resumable Game, or null for anything invalid (wrong/missing
// version, corrupt JSON, finished battle, mid-resolution phase, bad shape).
export function deserializeGame(json: string | null): Game | null {
  if (!json) return null;
  try {
    const env = JSON.parse(json) as { version?: string; state?: GameState & { rngState: number } };
    if (env.version !== SAVE_VERSION || !env.state) return null;
    const s = env.state;
    if (typeof s.rngState !== 'number') return null;
    if (typeof s.battleId !== 'string' || typeof s.turn !== 'number') return null;
    if (s.winner !== null || s.phase !== 'playerPre') return null; // in-progress, stable saves only
    if (!Array.isArray(s.board) || s.board.length !== BOARD_HEIGHT) return null;
    if (s.board.some((row) => !Array.isArray(row) || row.length !== BOARD_WIDTH || row.some((t) => !t))) return null;
    if (s.units?.player?.length !== 4 || s.units?.enemy?.length !== 4) return null;
    if (typeof s.hp?.player !== 'number' || typeof s.hp?.enemy !== 'number') return null;
    if (!s.metrics?.sides?.player || !s.metrics?.sides?.enemy) return null;
    // MK5.4: the config is part of the battle's identity — validate its shape
    const c = s.config;
    if (
      !c ||
      typeof c.enemyMatching !== 'boolean' ||
      typeof c.hackerBonusEnabled !== 'boolean' ||
      typeof c.singleAxisPayout !== 'boolean' ||
      typeof c.noMatchDamage !== 'boolean' ||
      !(c.maxCascadeSteps === null || (Number.isInteger(c.maxCascadeSteps) && c.maxCascadeSteps >= 0 && c.maxCascadeSteps <= 9)) ||
      !(Number.isInteger(c.playerHp) && c.playerHp >= 1 && c.playerHp <= 9999) ||
      !(Number.isInteger(c.enemyHp) && c.enemyHp >= 1 && c.enemyHp <= 9999) ||
      typeof c.flatAbilityCost !== 'boolean' ||
      typeof c.hintEnabled !== 'boolean' ||
      typeof c.nmdChargeAwareBot !== 'boolean' ||
      !(Number.isInteger(c.hintDelaySeconds) && c.hintDelaySeconds >= 1 && c.hintDelaySeconds <= 60) ||
      !c.abilityCosts ||
      UNIT_ORDER.some((t) => !(Number.isInteger(c.abilityCosts[t]) && c.abilityCosts[t] >= 1 && c.abilityCosts[t] <= 99)) ||
      // MK9.4: per-side strong bindings must be present and well-formed
      !isValidStrongRecord(c.strongColors, COLOR_COUNT) ||
      !isValidStrongRecord(c.strongShapes, SHAPE_COUNT)
    ) {
      return null;
    }
    const { rngState, ...rest } = s;
    return Game.restore({ ...rest, rng: makeRNG(rngState) });
  } catch {
    return null;
  }
}
