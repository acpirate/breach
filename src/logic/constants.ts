// ============================================================================
// Tunable ENGINE Constants — the single source of every gameplay-affecting
// number that is NOT Program/Function/Hacker/Deck/Skill content. As of Alpha
// 0.1.0, Program bindings, Function costs, and Function parameters live in the
// external CSV datasets; as of Alpha 0.3.0 so do Hacker LINK and strength,
// Hacker Skills, and the Deck's added LINK and Function (loaded and validated
// at startup — see src/logic/data/). Nothing below duplicates them and no
// hardcoded content fallback exists.
// ============================================================================

import { BattleSettings, Color, Shape, Side } from './types';

export const BOARD_WIDTH = 8;
export const BOARD_HEIGHT = 8;

export const COLOR_COUNT = 6;
export const SHAPE_COUNT = 6;
// 8% of newly generated Packets (initial fill, refills, shake/reshuffle output)
// are neutral; the remaining 92% split evenly across the 36 color/shape combos.
export const NEUTRAL_TILE_DROP_RATE = 0.08;

// MK3.1: Sync damage halved (was 2/4/3) to give Functions room to matter.
// Charge values are unchanged — this halves damage only.
export const DAMAGE_PER_TILE_LOW_COLOR = 1;
export const DAMAGE_PER_TILE_HIGH_COLOR = 2;
export const DAMAGE_PER_TILE_NEUTRAL = 2;

// MK6.1: SHAPE gets its own damage tiers, symmetric with color (LOW=1,
// HIGH=2). A COLOR Sync damages via the tile's color tier; a SHAPE Sync via
// its shape tier.
export const DAMAGE_PER_TILE_LOW_SHAPE = 1;
export const DAMAGE_PER_TILE_HIGH_SHAPE = 2;

// Charge is ALWAYS flat per qualifying sliced Packet — it never uses the
// damage multiplier table below.
export const CHARGE_PER_TILE_COLOR_MATCH = 1;
export const CHARGE_PER_TILE_SHAPE_MATCH = 1;

// Damage-only multipliers.
export const MATCH_3_MULTIPLIER = 1.0;
export const MATCH_4_MULTIPLIER = 1.0; // 4-line clears full row/column
export const MATCH_5_LINE_MULTIPLIER = 1.5; // 5-line: crit AND clears row/column
export const MATCH_5_NONLINE_MULTIPLIER = 1.5; // merged same-axis blob of 5+: crit, no clear

// Alpha 0.3.0 §9.1 — a contiguous run of this many directly matched cells in a
// resolution wave's combined footprint triggers its row/column clear.
export const LINE_CLEAR_RUN_LENGTH = 4;

// Alpha 0.3.0 §7.3 — the active Deck Function gains this much charge per
// NEUTRAL Packet sliced during its owner's qualifying Sync resolution (direct
// footprint, qualifying line clears, and same-side cascades all count). Bomb
// destruction explicitly grants none.
export const DECK_CHARGE_PER_NEUTRAL_TILE = 1;

// Fallback maximum LINK/ICE used only for the manual settings' defaults when
// Normal LINK is switched OFF (§10.2). Under Normal LINK ON — the default —
// effective LINK/ICE come from the selected Hacker, Deck, and encounter table,
// never from this value.
export const MANUAL_LINK_DEFAULT = 150;

// Alpha 0.1.0 approved exception (designer 2026-07-21): the System's flat
// per-turn charge rate in timer-charge mode (enemyMatching OFF) remains a
// hardcoded ENGINE value — one flat rate applied uniformly to every System
// Program, NOT a per-Program hardcoded table (which would violate the
// no-hardcoded-Program-content rule). To be revisited in a future data pass.
export const ENEMY_TIMER_CHARGE_RATE = 3;

// Every Program's charge is capped at its charge-pool capacity (the assigned
// Function's cost, §11.1); overflow is discarded at the moment charge is added
// (GoW-style clamp). The Deck Function's pool follows the same rule (§7.2).
export const CHARGE_CAP_EQUALS_COST = true;

// ============================================================================
// Per-battle SETTINGS defaults (§10.2). Alpha 0.3.0 removes the hardcoded
// Hacker color-bonus toggle entirely: that passive is now the externally
// defined Skill records referenced by the selected Hacker (§6.1), and there is
// exactly one authority for it. Strong/weak sets and effective LINK/ICE are
// resolved per battle from the selected Hacker and Deck, so they are NOT
// settings and deliberately absent here (§5.4).
// ============================================================================

export const DEFAULT_BATTLE_SETTINGS: BattleSettings = {
  // Alpha 0.6.0 (director ruling, 2026-08-11) — System matching is ON by
  // default. The System now takes a REAL turn: it ticks countdowns, runs its
  // Function phase, and makes one Sync, instead of receiving the flat
  // ENEMY_TIMER_CHARGE_RATE. Timer mode remains fully supported and is still
  // measured explicitly by the headless instruments; it is simply no longer the
  // default. This is a deliberate difficulty change, deferred for tuning to the
  // post-beta content/balance pass.
  enemyMatching: true,
  singleAxisPayout: false,
  maxCascadeSteps: 0, // MK6.3: cap-0 is the default (null = infinite)
  reinforcedConnection: false, // §11 (formerly No Match Damage)
  normalLink: true, // §10.2 default ON
  manualHackerLink: MANUAL_LINK_DEFAULT,
  manualSystemIce: MANUAL_LINK_DEFAULT,
  hintEnabled: false, // MK7.7
  hintDelaySeconds: 7,
  reinforcedChargeAwareBot: true, // sub-option of reinforcedConnection, default on
};

// MK9.4 → §5.4: per-side strong-binding tests. A tile is "strong" for a side
// when its color/shape is in that side's RESOLVED strong set (from the selected
// Hacker, complemented for the System) → it pays the HIGH damage tier for that
// side; otherwise LOW.
export function isStrongColor(config: { strongColors: Record<Side, Color[]> }, side: Side, color: Color): boolean {
  return config.strongColors[side].includes(color);
}
export function isStrongShape(config: { strongShapes: Record<Side, Shape[]> }, side: Side, shape: Shape): boolean {
  return config.strongShapes[side].includes(shape);
}
