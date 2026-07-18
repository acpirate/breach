// ============================================================================
// Tunable Constants — the single source of every gameplay-affecting number.
// Mirrors the "Tunable Constants" block of breach-poc-requirements.md exactly;
// nothing below may be hardcoded anywhere else in the codebase.
// ============================================================================

import { BattleConfig, Color, Shape, Side, UnitType } from './types';

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

// MK9.1: the player Bomber places this many bombs per activation (one cost,
// one activation). Extra impact / redundancy vs. a single all-or-nothing bomb.
export const PLAYER_BOMBER_BOMBS = 2;

// MK9.2: the enemy Bomber is replaced by "E-Bomb" — one slower, wider bomb.
export const E_BOMB_BOMBS = 1;
export const E_BOMB_COUNTDOWN = 3; // matches the ORIGINAL bomb fuse (player bombs use the MK3.1 shortened 2)
export const E_BOMB_CARDINAL_EXTENSION = 1; // tiles added outward N/S/E/W beyond the base footprint
// The base 3x3 surround PLUS one extra tile in each cardinal direction (a
// plus-extended 3x3 = 13 cells). NO new diagonal reach (MK9.2). Edge-clipped
// at detonation time like the base footprint.
export const E_BOMB_BLAST_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  ...BOMB_BLAST_OFFSETS,
  { x: E_BOMB_CARDINAL_EXTENSION + 1, y: 0 }, { x: -(E_BOMB_CARDINAL_EXTENSION + 1), y: 0 },
  { x: 0, y: E_BOMB_CARDINAL_EXTENSION + 1 }, { x: 0, y: -(E_BOMB_CARDINAL_EXTENSION + 1) },
];

export const BUFFER_COST = 13;
export const BUFFER_ENEMY_CHARGE_RATE = 3;
export const BUFFER_DAMAGE_BONUS = 5;

// MK9.3: the enemy Buffer is replaced by "Shielder" — inverse of the player
// Buffer. It places SHIELDER_TILES shield tiles per activation; each active
// shield tile subtracts SHIELD_POINTS_PER_TILE from EVERY separate incoming
// player->enemy damage instance (summed across active tiles, min 0).
export const SHIELDER_TILES = 2;
export const SHIELD_POINTS_PER_TILE = 2;

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

// ============================================================================
// Agent-discretion axis assignments (approved). Declared above the config so
// the MK9.4 per-side strong defaults can reference them (TDZ-safe).
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
  enemyHp: STARTING_HP_PLAYER_NORMAL, // MK8.3: symmetric 150/150 baseline (was STARTING_HP_ENEMY 350)
  // MK7.1: costs exposed as config; defaults unchanged
  abilityCosts: { bomber: BOMBER_COST, buffer: BUFFER_COST, attacker: ATTACKER_COST, disabler: DISABLER_COST },
  flatAbilityCost: true, // MK8.3: flat-7 is the working diagnostic baseline
  hintEnabled: false, // MK7.7
  hintDelaySeconds: 7,
  nmdChargeAwareBot: true, // MK7.13 addendum: sub-option of noMatchDamage, default on
  // MK9.4 (approved "per-side tier swap"): the player keeps the historical HIGH
  // tiers as its strong bindings; the enemy's strong bindings are the OPPOSITE
  // set (the historical LOW tiers). Distinct per side, stored explicitly.
  strongColors: { player: [...HIGH_COLORS], enemy: [...LOW_COLORS] },
  strongShapes: { player: [...HIGH_SHAPES], enemy: [...LOW_SHAPES] },
};

// MK7.1: the single lookup every cost check goes through — charge caps, fire
// checks, HUD, character sheet, bot.
export function effectiveCost(config: BattleConfig, type: UnitType): number {
  return config.flatAbilityCost ? FLAT_ABILITY_COST_VALUE : config.abilityCosts[type];
}

// Hacker passive bonus color: Red (a HIGH color, the most visually salient).
// Applies to PLAYER-owned match events only.
export const HACKER_BONUS_COLOR = Color.Red;

// PLAYER program color+shape bindings (approved). Non-overlapping colors and
// shapes. Red (the Hacker bonus color) is bound to the cheapest program so the
// bonus-charge interaction fires often in testing. Unused by player abilities:
// Cyan, Magenta, Circle, Diamond (matching them deals damage but charges no
// player unit — intentional).
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

// MK9.2/9.3/9.4: ENEMY units are no longer a mirror of the player's. The enemy
// Bomber is E-Bomb and the enemy Buffer is Shielder; both charge-bind on
// colors/shapes UNUSED by player abilities (approved: E-Bomb Magenta+Diamond,
// Shielder Cyan+Circle) so player and enemy have separate charge-source
// priorities on the shared board. Enemy Attacker/Disabler are retained
// unchanged (MK9.9) and keep their shared bindings. Costs/rates are identical.
export const ENEMY_UNIT_DEFS: Record<UnitType, UnitDef> = {
  bomber: { cost: BOMBER_COST, enemyChargeRate: BOMBER_ENEMY_CHARGE_RATE, color: Color.Magenta, shape: Shape.Diamond, label: 'EBM' },
  buffer: { cost: BUFFER_COST, enemyChargeRate: BUFFER_ENEMY_CHARGE_RATE, color: Color.Cyan, shape: Shape.Circle, label: 'SHLD' },
  attacker: { cost: ATTACKER_COST, enemyChargeRate: ATTACKER_ENEMY_CHARGE_RATE, color: Color.Yellow, shape: Shape.Star, label: 'ATK' },
  disabler: { cost: DISABLER_COST, enemyChargeRate: DISABLER_ENEMY_CHARGE_RATE, color: Color.Blue, shape: Shape.Cross, label: 'DIS' },
};

// The unit-definition table for a side. Bindings now differ per side (MK9), so
// every charge/binding/HUD lookup must go through this rather than UNIT_DEFS.
export function unitDefsFor(side: Side): Record<UnitType, UnitDef> {
  return side === 'enemy' ? ENEMY_UNIT_DEFS : UNIT_DEFS;
}

// MK9.2: the blast footprint depends on the bomb's owner — player bombs use the
// base 3x3, enemy bombs (E-Bomb) use the cardinal-extended footprint.
export function blastOffsetsFor(owner: Side): ReadonlyArray<{ x: number; y: number }> {
  return owner === 'enemy' ? E_BOMB_BLAST_OFFSETS : BOMB_BLAST_OFFSETS;
}

// MK9.4: per-side strong-binding tests. A tile is "strong" for a side when its
// color/shape is in that side's configured strong set → it pays the HIGH
// damage tier for that side; otherwise LOW.
export function isStrongColor(config: BattleConfig, side: Side, color: Color): boolean {
  return config.strongColors[side].includes(color);
}
export function isStrongShape(config: BattleConfig, side: Side, shape: Shape): boolean {
  return config.strongShapes[side].includes(shape);
}

// Player-facing / log identity for a side's unit (E-Bomb, Shielder, …).
const ENEMY_DISPLAY_NAMES: Partial<Record<UnitType, string>> = { bomber: 'E-Bomb', buffer: 'Shielder' };
export function unitDisplayName(side: Side, type: UnitType): string {
  if (side === 'enemy' && ENEMY_DISPLAY_NAMES[type]) return ENEMY_DISPLAY_NAMES[type]!;
  return unitDefsFor(side)[type].label;
}
