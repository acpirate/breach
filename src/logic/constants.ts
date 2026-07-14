// ============================================================================
// Tunable Constants — the single source of every gameplay-affecting number.
// Mirrors the "Tunable Constants" block of breach-poc-requirements.md exactly;
// nothing below may be hardcoded anywhere else in the codebase.
// ============================================================================

import { BattleConfig, Color, Shape, UnitType } from './types';

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;

export const COLOR_COUNT = 6;
export const SHAPE_COUNT = 6;
// 8% of newly generated tiles (initial fill, refills, shake/reshuffle output)
// are neutral; the remaining 92% are split evenly across the 36 color/shape combos.
export const NEUTRAL_TILE_DROP_RATE = 0.08;

// MK3.1: match damage halved (was 2/4/3) to give abilities room to matter.
// Charge values are unchanged — this halves damage only.
export const DAMAGE_PER_TILE_LOW_COLOR = 1;
export const DAMAGE_PER_TILE_HIGH_COLOR = 2;
export const DAMAGE_PER_TILE_NEUTRAL = 2;

// MK6.1: SHAPE gets its own damage tiers, symmetric with color (LOW=1,
// HIGH=2). A COLOR-match damages via the tile's color tier; a SHAPE-match
// via its shape tier (supersedes the MK5 stopgap of falling back to color).
export const DAMAGE_PER_TILE_LOW_SHAPE = 1;
export const DAMAGE_PER_TILE_HIGH_SHAPE = 2;

// Charge is ALWAYS flat per qualifying destroyed tile — it never uses the
// damage multiplier table below.
export const CHARGE_PER_TILE_COLOR_MATCH = 1;
export const CHARGE_PER_TILE_SHAPE_MATCH = 1;

// Damage-only multipliers.
export const MATCH_3_MULTIPLIER = 1.0;
export const MATCH_4_MULTIPLIER = 1.0; // 4-line clears full row/column
export const MATCH_5_LINE_MULTIPLIER = 1.5; // 5-line: crit AND clears row/column
// MK3.3 made non-linear 5+ matches real via blob/merge matching: a merged
// same-axis blob of 5+ tiles crits (no line clear). Reachable as of MK3.
export const MATCH_5_NONLINE_MULTIPLIER = 1.5;

export const STARTING_HP_PLAYER_NORMAL = 150;
// Deprecated by MK6.4 (forced-loss scenario removed — playerHp:1 in the
// config is the same test); kept for tunables-block parity.
export const STARTING_HP_PLAYER_LOW_SCENARIO = 1;
export const STARTING_HP_ENEMY = 350; // designer-set for MK2 iteration

export const BOARD_SHAKE_COST = 3;
export const BOARD_SHAKE_STARTS_CHARGED = true;
// Approved addition (clarification): each neutral tile destroyed in a
// player-owned MATCH step grants this much shake charge, capped at
// BOARD_SHAKE_COST exactly like a unit ability. Neutral tiles destroyed
// directly in a bomb blast grant nothing (detonations grant no charge).
export const SHAKE_CHARGE_PER_NEUTRAL_TILE = 1;

export const BOMBER_COST = 7;
export const BOMBER_ENEMY_CHARGE_RATE = 3; // per enemy turn
export const BOMBER_COUNTDOWN_TURNS = 2; // MK3.1: shorter fuse (was 3)

// MK3.1: blast radius expanded from 4-orthogonal to the full 3x3 surround —
// the bomb tile plus all 8 adjacent tiles (orthogonal + diagonal). Diagonal
// destruction intentionally hits tiles that could not be part of any
// orthogonal match. All other blast rules unchanged.
export const BOMB_BLAST_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

export const BUFFER_COST = 13;
export const BUFFER_ENEMY_CHARGE_RATE = 3;
export const BUFFER_DAMAGE_BONUS = 5;

export const ATTACKER_COST = 19;
export const ATTACKER_ENEMY_CHARGE_RATE = 3;
export const ATTACKER_DAMAGE = 30; // MK3.1: doubled (was 15), both sides per mirrored-stats rule

export const DISABLER_COST = 22;
export const DISABLER_ENEMY_CHARGE_RATE = 3;

// Every unit's charge is capped at its own activation cost; overflow is
// discarded at the moment charge is added (GoW-style clamp).
export const CHARGE_CAP_EQUALS_COST = true;

export const HACKER_BONUS_DAMAGE = 1; // extra damage per bonus-color tile (player match events only)
export const HACKER_BONUS_CHARGE = 1; // extra charge per bonus-color tile to color-matching player units

// MK5.2/MK6 — per-battle config defaults. hackerBonusEnabled defaults OFF
// (MK5: symmetric baseline). maxCascadeSteps defaults 0 as of MK6.3 (cap-0
// tested dramatically better: stable board, specials survive, abilities
// matter more, closer battles). HP defaults are the MK6.4 config exposure of
// the former fixed scenario values.
// MK7.1: the flat-cost diagnostic prices every unit at this value.
export const FLAT_ABILITY_COST_VALUE = 7;

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  enemyMatching: false,
  hackerBonusEnabled: false,
  singleAxisPayout: false,
  maxCascadeSteps: 0, // MK6.3: cap-0 is the new default (null = infinite)
  noMatchDamage: false, // MK6.2
  playerHp: STARTING_HP_PLAYER_NORMAL,
  enemyHp: STARTING_HP_ENEMY,
  // MK7.1: costs exposed as config; defaults unchanged
  abilityCosts: { bomber: BOMBER_COST, buffer: BUFFER_COST, attacker: ATTACKER_COST, disabler: DISABLER_COST },
  flatAbilityCost: false,
  hintEnabled: false, // MK7.7
  hintDelaySeconds: 7,
  nmdChargeAwareBot: true, // MK7.13 addendum: sub-option of noMatchDamage, default on
};

// MK7.1: the single lookup every cost check goes through — charge caps, fire
// checks, HUD, character sheet, bot.
export function effectiveCost(config: BattleConfig, type: UnitType): number {
  return config.flatAbilityCost ? FLAT_ABILITY_COST_VALUE : config.abilityCosts[type];
}

// ============================================================================
// Agent-discretion assignments (approved by the designer)
// ============================================================================

// Color damage tiers: warm colors are HIGH, cool colors are LOW.
// Mnemonic: "warm hits harder."
export const HIGH_COLORS: Color[] = [Color.Red, Color.Yellow, Color.Magenta];
export const LOW_COLORS: Color[] = [Color.Green, Color.Cyan, Color.Blue];

// MK6.1 shape damage tiers (agent-assigned, approved): chosen so every unit's
// binding pairs one HIGH axis with one LOW axis — Bomber Red(H)+Triangle(L),
// Buffer Green(L)+Square(H), Attacker Yellow(H)+Star(L), Disabler
// Blue(L)+Cross(H) — so no unit's bound tiles are double-high or double-low
// and all four carry identical damage weight. Unbound shapes split too
// (Diamond HIGH, Circle LOW).
export const HIGH_SHAPES: Shape[] = [Shape.Square, Shape.Cross, Shape.Diamond];
export const LOW_SHAPES: Shape[] = [Shape.Triangle, Shape.Star, Shape.Circle];

// Hacker passive bonus color: Red (a HIGH color, the most visually salient).
// Applies to PLAYER-owned match events only.
export const HACKER_BONUS_COLOR = Color.Red;

// Program/minion color+shape bindings — identical on both sides (approved).
// Non-overlapping colors and shapes. Red (the Hacker bonus color) is bound to
// the cheapest program so the bonus-charge interaction fires often in testing.
// Unbound: Cyan, Magenta, Circle, Diamond (matching them deals damage but
// charges no unit — intentional).
export interface UnitDef {
  cost: number;
  enemyChargeRate: number;
  color: Color;
  shape: Shape;
  label: string;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  bomber: { cost: BOMBER_COST, enemyChargeRate: BOMBER_ENEMY_CHARGE_RATE, color: Color.Red, shape: Shape.Triangle, label: 'BMB' },
  buffer: { cost: BUFFER_COST, enemyChargeRate: BUFFER_ENEMY_CHARGE_RATE, color: Color.Green, shape: Shape.Square, label: 'BUF' },
  attacker: { cost: ATTACKER_COST, enemyChargeRate: ATTACKER_ENEMY_CHARGE_RATE, color: Color.Yellow, shape: Shape.Star, label: 'ATK' },
  disabler: { cost: DISABLER_COST, enemyChargeRate: DISABLER_ENEMY_CHARGE_RATE, color: Color.Blue, shape: Shape.Cross, label: 'DIS' },
};
