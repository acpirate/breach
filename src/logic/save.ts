// MK4.1 — Save serialization for the in-progress battle. Pure logic-layer
// JSON (no storage APIs here; the browser adapter owns localStorage).
//
// Alpha 0.1.0 (§14): the envelope carries the game version, the data-schema
// version, and the normalized gameplay-content fingerprint. Pre-Alpha saves
// (any other version stamp) are rejected through the same no-valid-save path
// — never migrated. A fingerprint mismatch rejects the save rather than
// loading a battle under changed Function behavior. Restore resolves stable
// Program IDs against the CURRENT resolved definitions; no Function content
// is embedded in the save.

import { BOARD_HEIGHT, BOARD_WIDTH, COLOR_COUNT, SHAPE_COUNT } from './constants';
import { isAreaPatternId } from './data/areas';
import { DATA_SCHEMA_VERSION, GAME_VERSION, getContent } from './data/content';
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

export function serializeGame(state: GameState): string {
  const { rng, ...plain } = state;
  const content = getContent();
  return JSON.stringify({
    version: SAVE_VERSION,
    schema: DATA_SCHEMA_VERSION,
    fp: content.fingerprint,
    state: { ...plain, rngState: rng.getState() },
  });
}

// Returns a resumable Game, or null for anything invalid (wrong/missing
// version or schema, fingerprint mismatch, corrupt JSON, finished battle,
// mid-resolution phase, bad shape, unknown Program IDs).
export function deserializeGame(json: string | null): Game | null {
  if (!json) return null;
  try {
    const env = JSON.parse(json) as {
      version?: string;
      schema?: number;
      fp?: string;
      state?: GameState & { rngState: number };
    };
    // §14.1/14.2: pre-Alpha saves (mk* stamps) and other-version saves reject here
    if (env.version !== SAVE_VERSION || !env.state) return null;
    if (env.schema !== DATA_SCHEMA_VERSION) return null;
    const content = getContent();
    // §14.3: content fingerprint must match the currently loaded definitions
    if (env.fp !== content.fingerprint) return null;
    const s = env.state;
    if (typeof s.rngState !== 'number') return null;
    if (typeof s.battleId !== 'string' || typeof s.turn !== 'number') return null;
    if (s.winner !== null || s.phase !== 'playerPre') return null; // in-progress, stable saves only
    if (!Array.isArray(s.board) || s.board.length !== BOARD_HEIGHT) return null;
    if (s.board.some((row) => !Array.isArray(row) || row.length !== BOARD_WIDTH || row.some((t) => !t))) return null;
    // Special tiles must carry valid Alpha data (footprints, magnitudes).
    for (const row of s.board) {
      for (const t of row) {
        const sp = t!.special;
        if (!sp) continue;
        if (sp.type === 'bomb') {
          if (!(Number.isInteger(sp.countdown) && sp.countdown! >= 0)) return null;
          if (typeof sp.areaPattern !== 'string' || !isAreaPatternId(sp.areaPattern)) return null;
        } else {
          if (!(Number.isInteger(sp.magnitude) && sp.magnitude! >= 1)) return null;
        }
      }
    }
    // §14.4: restore by stable IDs against current resolved definitions —
    // slot order and IDs must match the loaded content exactly.
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
    // MK5.4: the config is part of the battle's identity — validate its shape
    // (Alpha: the removed cost fields are NOT expected; their presence is
    // impossible here since any pre-Alpha save already failed the version gate)
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
      typeof c.hintEnabled !== 'boolean' ||
      typeof c.nmdChargeAwareBot !== 'boolean' ||
      !(Number.isInteger(c.hintDelaySeconds) && c.hintDelaySeconds >= 1 && c.hintDelaySeconds <= 60) ||
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
