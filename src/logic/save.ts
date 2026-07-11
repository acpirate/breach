// MK4.1 — Save serialization for the in-progress battle. Pure logic-layer
// JSON (no storage APIs here; the browser adapter owns localStorage).
//
// The envelope carries a version stamp; a missing/incompatible stamp or any
// structural problem is treated as "no valid save" (never a crash). Saves are
// only written at stable points (player's make-a-match phase), so a restored
// game is always immediately playable.

import { BOARD_HEIGHT, BOARD_WIDTH } from './constants';
import { Game } from './game';
import { makeRNG } from './rng';
import { GameState } from './types';

// Save-format version (designer-set placeholder scheme; bump on state-shape
// changes). MK5 added BattleConfig to the state shape — mk4 saves fail
// gracefully to a fresh start, as designed.
export const SAVE_VERSION = 'mk5';

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
      !(c.maxCascadeSteps === null || (Number.isInteger(c.maxCascadeSteps) && c.maxCascadeSteps >= 0 && c.maxCascadeSteps <= 9))
    ) {
      return null;
    }
    const { rngState, ...rest } = s;
    return Game.restore({ ...rest, rng: makeRNG(rngState) });
  } catch {
    return null;
  }
}
