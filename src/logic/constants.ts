// ============================================================================
// Tunable ENGINE Constants — the single source of every gameplay-affecting
// number that is NOT Program/Function content. As of Alpha 0.1.0, Program
// bindings, Function costs, and Function parameters live in the external CSV
// datasets (loaded and validated at startup — see src/logic/data/); nothing
// below duplicates them and no hardcoded Program/Function fallback exists.
// ============================================================================

import { BattleConfig, Color, Shape, Side } from './types';

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
// via its shape tier.
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
export const MATCH_5_NONLINE_MULTIPLIER = 1.5; // merged same-axis blob of 5+: crit, no clear

export const STARTING_HP_PLAYER_NORMAL = 150;

export const BOARD_SHAKE_COST = 3;
export const BOARD_SHAKE_STARTS_CHARGED = true;
// Each neutral tile destroyed in a player-owned MATCH step grants this much
// shake charge, capped at BOARD_SHAKE_COST. Neutral tiles destroyed directly
// in a bomb blast grant nothing (detonations grant no charge).
export const SHAKE_CHARGE_PER_NEUTRAL_TILE = 1;

// Alpha 0.1.0 approved exception (designer 2026-07-21): the System's flat
// per-turn charge rate in timer-charge mode (enemyMatching OFF) remains a
// hardcoded ENGINE value — one flat rate applied uniformly to every System
// Program, NOT a per-Program hardcoded table (which would violate the
// no-hardcoded-Program-content rule). To be revisited in a future data pass.
// This also supersedes the pre-Alpha lookup that read the rate from the
// PLAYER unit table for enemy units.
export const ENEMY_TIMER_CHARGE_RATE = 3;

// Every unit's charge is capped at its Program's charge-pool capacity (the
// assigned Function's cost, §11.1); overflow is discarded at the moment
// charge is added (GoW-style clamp).
export const CHARGE_CAP_EQUALS_COST = true;

export const HACKER_BONUS_DAMAGE = 1; // extra damage per bonus-color tile (player match events only)
export const HACKER_BONUS_CHARGE = 1; // extra charge per bonus-color tile to color-matching player units

// ============================================================================
// Agent-discretion axis assignments (approved).
// ============================================================================

// Color damage tiers: warm colors are HIGH, cool colors are LOW.
// Mnemonic: "warm hits harder."
export const HIGH_COLORS: Color[] = [Color.Red, Color.Yellow, Color.Magenta];
export const LOW_COLORS: Color[] = [Color.Green, Color.Cyan, Color.Blue];

// MK6.1 shape damage tiers (agent-assigned, approved).
export const HIGH_SHAPES: Shape[] = [Shape.Square, Shape.Cross, Shape.Diamond];
export const LOW_SHAPES: Shape[] = [Shape.Triangle, Shape.Star, Shape.Circle];

// MK5.2/MK6 — per-battle config defaults. Alpha 0.1.0 removes the ability-
// cost fields entirely (§4.2-4.4): costs are Function content now.
export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  enemyMatching: false,
  hackerBonusEnabled: false,
  singleAxisPayout: false,
  maxCascadeSteps: 0, // MK6.3: cap-0 is the default (null = infinite)
  noMatchDamage: false, // MK6.2
  playerHp: STARTING_HP_PLAYER_NORMAL,
  enemyHp: STARTING_HP_PLAYER_NORMAL, // MK8.3: symmetric 150/150 baseline
  hintEnabled: false, // MK7.7
  hintDelaySeconds: 7,
  nmdChargeAwareBot: true, // MK7.13 addendum: sub-option of noMatchDamage, default on
  // MK9.4 (approved "per-side tier swap"): the player keeps the historical HIGH
  // tiers as its strong bindings; the enemy's strong bindings are the OPPOSITE
  // set (the historical LOW tiers). Distinct per side, stored explicitly.
  // §4.7: independent from Program charge bindings.
  strongColors: { player: [...HIGH_COLORS], enemy: [...LOW_COLORS] },
  strongShapes: { player: [...HIGH_SHAPES], enemy: [...LOW_SHAPES] },
};

// Hacker passive bonus color: Red (a HIGH color, the most visually salient).
// Applies to PLAYER-owned match events only, and only when the config flag is on.
export const HACKER_BONUS_COLOR = Color.Red;

// MK9.4: per-side strong-binding tests. A tile is "strong" for a side when its
// color/shape is in that side's configured strong set → it pays the HIGH
// damage tier for that side; otherwise LOW.
export function isStrongColor(config: BattleConfig, side: Side, color: Color): boolean {
  return config.strongColors[side].includes(color);
}
export function isStrongShape(config: BattleConfig, side: Side, shape: Shape): boolean {
  return config.strongShapes[side].includes(shape);
}
