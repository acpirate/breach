# Breach — Match-3 Hacking RPG: Requirements Document

**Status:** Proof of Concept (PoC) specification, finalized for handoff to a coding agent.
**Setting:** Cyberpunk "hacking" aesthetic — 80s/90s sci-fi influence (Tron, Neuromancer, Snow Crash, System Shock).
**Document structure:** Section 1 defines the PoC exactly as it must be built. Section 2 is the Roadmap — explicitly OUT OF SCOPE for this build. Do not implement anything from Section 2. Where Section 2 is referenced from Section 1, it is for context only.

---

## Tunable Constants

All gameplay-affecting numbers are isolated here. Implement these as a single named constants module (e.g. `constants.ts`) that all game logic imports from. Nothing below should be hardcoded inline elsewhere in the codebase.

```
BOARD_WIDTH = 8
BOARD_HEIGHT = 8

COLOR_COUNT = 6          // 6 distinct colors
SHAPE_COUNT = 6          // 6 distinct shapes, independent of color
// Total tile types = COLOR_COUNT * SHAPE_COUNT + 1 (neutral) = 37
NEUTRAL_TILE_DROP_RATE = 0.08   // 8% of newly generated tiles (initial board fill,
                                 // refills after clears, and shake/reshuffle output)
                                 // are neutral; the remaining 92% are split evenly
                                 // across the 36 standard color/shape combinations

// Colors are split into two damage tiers. Agent assigns which 3 of the
// 6 colors are LOW and which 3 are HIGH, and documents the assignment
// in code comments and in a README section.
DAMAGE_PER_TILE_LOW_COLOR = 2
DAMAGE_PER_TILE_HIGH_COLOR = 4
DAMAGE_PER_TILE_NEUTRAL = 3

CHARGE_PER_TILE_COLOR_MATCH = 1  // flat, per destroyed tile matching a unit's bound color
CHARGE_PER_TILE_SHAPE_MATCH = 1  // flat, per destroyed tile matching a unit's bound shape
// IMPORTANT: charge does NOT use the damage multiplier table below. Charge is
// always flat 1-per-qualifying-tile regardless of match size or line/non-line
// shape. A tile that satisfies BOTH a unit's color AND its shape contributes
// 1 (color) + 1 (shape) = 2 charge to that unit, naturally, with no special-case
// code required. Neutral tiles do not charge any program; see Neutral Tiles section.

MATCH_3_MULTIPLIER = 1.0
MATCH_4_MULTIPLIER = 1.0        // 4-match clears full row/column; multiplier applies to ALL cleared tiles, for DAMAGE only
MATCH_5_LINE_MULTIPLIER = 1.5   // 5-in-a-line: crit AND clears row/column, for DAMAGE only
MATCH_5_NONLINE_MULTIPLIER = 1.5 // 5 in V/T/other config: crit only, no clear, for DAMAGE only
// These multipliers apply ONLY to damage calculations. Charge is always flat
// per CHARGE_PER_TILE_COLOR_MATCH / CHARGE_PER_TILE_SHAPE_MATCH regardless of
// match size, line-shape, or crit status.

STARTING_HP_PLAYER_NORMAL = 150
STARTING_HP_PLAYER_LOW_SCENARIO = 1   // forced-loss test scenario
STARTING_HP_ENEMY = 350 // 350 = manual balance tuning, intentionally diverges from spec's original 150

BOARD_SHAKE_COST = 3
BOARD_SHAKE_STARTS_CHARGED = true

// Unit/program costs, charge rates, and effect magnitudes.
// These values are IDENTICAL for player programs and enemy minions.
// Enemy minions charge automatically at the listed rate per enemy turn.
// Player programs charge via matching their assigned color/shape (see Programs section).

// SPECIAL TILE PLACEMENT (applies to both Bomber and Buffer): when either
// effect places its tile on the board, it converts one existing, randomly
// chosen NON-NEUTRAL tile (any standard color/shape tile, not already a
// special tile) into the bomb/buff tile, preserving that tile's existing
// color and shape. If no valid target tile exists anywhere on the board
// (e.g. every tile is already neutral or already a special tile — expected
// to be effectively impossible given board size and tile distribution, but
// stated explicitly for completeness), the ability still consumes its
// charge cost but its placement effect is wasted (no tile is converted,
// no error/crash).

BOMBER_COST = 7
BOMBER_ENEMY_CHARGE_RATE = 3     // per enemy turn
BOMBER_COUNTDOWN_TURNS = 3
// Bomber effect: places a countdown bomb tile (see SPECIAL TILE PLACEMENT
// above for targeting). On expiry, destroys itself and its 4 orthogonally
// adjacent tiles. Each destroyed tile deals damage per its own type's normal
// value (color tile = its color's damage value, neutral = neutral's value).
// If a destroyed neighbor is itself a bomb or buff tile, it is destroyed as
// a NORMAL tile only — its special effect does NOT trigger, and it does NOT
// chain into a further detonation (see "Bomb blast interactions" below for
// the buff-tile damage-counting exception). The detonation itself grants NO
// charge. Tiles falling to fill the gap may cause normal cascading matches,
// which deal damage/charge normally (see "Cascade step" rules for how this
// interacts with buffs).

BUFFER_COST = 13
BUFFER_ENEMY_CHARGE_RATE = 3
BUFFER_DAMAGE_BONUS = 5
// Buffer effect: places a damage-buff tile on the board (see SPECIAL TILE
// PLACEMENT above for targeting). While active, adds BUFFER_DAMAGE_BONUS to
// the total damage dealt by ITS OWNER'S side, whether that damage comes from
// a tile match or an ability. Multiple buff tiles stack additively. Matching
// the buff tile, or it being destroyed as a normal tile in a bomb blast,
// removes it (ends the buff) — see "Bomb blast interactions" below for the
// exact sequencing when a blast destroys a same-side buff tile.

ATTACKER_COST = 19
ATTACKER_ENEMY_CHARGE_RATE = 3
ATTACKER_DAMAGE = 15
// Attacker effect: deals ATTACKER_DAMAGE direct damage to the opposing health pool.

DISABLER_COST = 22
DISABLER_ENEMY_CHARGE_RATE = 3
// Disabler effect: fully discharges (resets to 0) the opponent's unit/program
// with the highest current RAW charge at the moment of activation. Tiebreaker:
// if two or more opponent units are tied for the highest raw charge, pick
// randomly among the tied units. (Raw charge is the only sort key — do NOT
// factor in each unit's cost or remaining-charge-to-activation. Exact ties are
// effectively impossible in this PoC given distinct fixed enemy charge rates,
// but the random-among-tied rule is specified for completeness.)

// Charge cap: every unit's (program's and minion's) charge is capped at its
// own activation cost. Charge accumulation beyond the cost is discarded, not
// banked (GoW-style clamp). Apply the cap at the moment charge is added, not
// only after firing.
CHARGE_CAP_EQUALS_COST = true

// Hacker passive: exactly one HIGH-tier color is designated the Hacker's
// bonus color (agent assigns which of the 3 high colors, documents the choice).
// For tiles of that color: when destroyed in a match, deal HACKER_BONUS_DAMAGE
// extra damage per tile (in addition to the normal high-color damage value),
// AND grant HACKER_BONUS_CHARGE extra charge per tile to any unit whose color
// matches (in addition to the normal flat charge-per-tile). Accepted as
// possibly strong for this PoC; not a balance concern to solve yet.
HACKER_BONUS_DAMAGE = 1   // extra damage per tile of the Hacker's bonus color
HACKER_BONUS_CHARGE = 1   // extra charge per tile of the Hacker's bonus color
```

---

# Section 1: Proof of Concept (BUILD THIS)

## 1.1 Goal of This PoC

Prove that the core combat loop — matching, damage, charge, abilities, and win/loss — works end-to-end and is fun. This is the only goal. No map, no build variety, no dev tools, no random enemy generation. One fixed build, one fixed enemy, two starting scenarios.

## 1.2 Platform & Architecture

- **Stack:** Web. TypeScript for all game logic. Canvas-based rendering.
- **Target form factor:** Mobile-first, portrait orientation, touch input. (Will be played in a phone browser.)
- **Critical architectural requirement:** Game logic (board state, matching, damage, charge, turn resolution, ability effects) MUST be implemented as pure, framework-agnostic TypeScript modules, fully separated from rendering code. Rendering should only read state and translate input — it must contain no game rules. This separation is required so the validated logic can later be ported to a different engine (e.g. Godot) without a rewrite. See Section 2 for why this matters long-term.
- **Dev workflow:** Local dev server (e.g. Vite). No deployment to a hosted URL is required for this PoC — running locally and accessing via a tunnel (e.g. ngrok/Cloudflare Tunnel) for phone testing is sufficient.
- **No persistence required.** No save/load, no accounts, no backend.
- **Visual scope: whitebox/greybox only.** All graphics for this PoC must be simple gray/white/primitive-color boxes, circles, or other basic geometric shapes, rendered with default system/canvas fonts. Do NOT undertake any aesthetic, thematic, or "skin" work (no cyberpunk styling, no custom art, no custom fonts, no polish pass) beyond the minimum needed to display a clear, readable, functional UI. Where this document specifies a visual rule (e.g. the neutral tile's static-noise appearance in 1.8, or the white/black ownership markers in 1.11), implement that rule using the simplest possible primitive shapes/colors that satisfy it — the RULE is required for clarity, but no artistic execution of it is in scope. This applies to tiles, UI panels, health bars, charge meters, buttons, and every other visual element in this PoC.

## 1.3 Board & Tiles

- Grid: `BOARD_WIDTH` × `BOARD_HEIGHT` (8×8).
- Every tile has exactly one of two forms:
  - **Standard tile:** one color (of `COLOR_COUNT`) + one shape (of `SHAPE_COUNT`), chosen independently. 36 possible color/shape combinations.
  - **Neutral tile:** no color, no shape. Treated as its own distinct category for matching purposes (see below).
- **Initial board generation:** no pre-existing matches may exist on the board when a battle starts. Standard match-3 generation rule.
- **Tile refill/cascade:** when tiles are cleared, tiles above fall to fill gaps, and new tiles generate to fill the top. Falling tiles that create new matches resolve automatically as cascades, each cascade match dealing damage/charge per the normal rules below. Cascades chain until no new matches result.

## 1.4 Matching Rules

A valid match is 3 or more adjacent tiles (standard line/grid adjacency, not diagonal) sharing:
- the same **color** (regardless of shape), OR
- the same **shape** (regardless of color), OR
- **both being neutral** (neutral tiles only match other neutral tiles — they have no color/shape value to share with standard tiles).

Matches are produced by the player swapping two orthogonally ADJACENT tiles (up/down/left/right only — never diagonal, never non-adjacent; see 1.12 for the full input model). A swap is only kept if it produces at least one valid match; otherwise it reverts.

### Match size & shape effects

| Match | Shape required | Effect | Damage/Charge formula |
|---|---|---|---|
| 3 tiles | any valid match | normal clear | `sum(per-tile base value) × MATCH_3_MULTIPLIER` |
| 4 tiles | straight line ONLY | clears the entire row/column the match occurred in (all tiles in that row/column, not just the 4 matched) | `sum(per-tile base value for all cleared tiles) × MATCH_4_MULTIPLIER` |
| 5 tiles, straight line | straight line | clears entire row/column AND crit | `sum(per-tile base value for all cleared tiles) × MATCH_5_LINE_MULTIPLIER` |
| 5 tiles, non-linear (V, T, L, etc.) | non-linear | crit only, no row/column clear | `sum(per-tile base value for the 5 matched tiles) × MATCH_5_NONLINE_MULTIPLIER` |

For alpha, 4-matches and the line case of 5-matches are always straight lines (no L/T-shaped 4-tile matches need to be detected or supported).

**Important: tier is determined per individual match, never by combining adjacent matches.** If two separate 3-matches happen to be adjacent to or touching one another (e.g. forming an L or T shape, or simply sitting next to each other from a single move/cascade), they remain two independent 3-match events for tier purposes — the 4-match and 5-match row/column-clear and crit effects do NOT trigger just because the combined tile count across multiple adjacent matches reaches 4 or 5. Each match's tier is evaluated strictly on its own tile count and its own shape (line vs. non-line), in isolation. (The deduplication rule above still applies for damage/charge if the two matches happen to share a tile — that tile is still destroyed and counted once, at whichever single match's multiplier is highest — but sharing a tile does not retroactively upgrade either match's tier.)

### Per-tile base value resolution (DAMAGE)

**Damage is calculated per DESTROYED TILE, not per match.** If a single tile is part of more than one simultaneous match (e.g. it sits at the intersection of a color-match and a shape-match, or — in principle, since a tile could satisfy multiple match conditions at once — even more than two), that tile is destroyed exactly once and counted exactly once in the damage total. It is never counted multiple times because it happened to qualify under multiple matches.

When a tile qualifies under multiple simultaneous matches that have different size/crit multipliers (e.g. the tile is part of both a 3-match and a 5-match at the same time, via different match conditions), apply the HIGHEST applicable multiplier to that tile once. Do not stack multipliers, and do not apply the multiplier more than once even if the tile qualifies for the same top multiplier via two different matches (e.g. a tile in two simultaneous 5-matches still only gets the 1.5x crit applied once, not twice).

To compute total damage for a resolving move: build the set of all tiles destroyed in that move (a set, not a list — each tile appears once), determine the highest multiplier each tile qualifies for, sum `(per-tile base value × that tile's resolved multiplier)` across the set.

Per-tile base value:
- Standard tile: use its color's value (`DAMAGE_PER_TILE_LOW_COLOR` or `DAMAGE_PER_TILE_HIGH_COLOR` per the color tier assignment).
- Neutral tile: `DAMAGE_PER_TILE_NEUTRAL`.
- If the tile's color is the Hacker's designated bonus color, add `HACKER_BONUS_DAMAGE` per tile.

This means color-matches (all tiles share one color) are simply the special case where every tile contributes the same value. Shape-matches may span multiple colors — sum each tile's own color value individually. This is one unified formula, not two separate systems.

### Charge distribution from a match (separate from damage — flat, no multiplier)

Charge does NOT use the damage multiplier table, and like damage, it is calculated per DESTROYED TILE (each tile contributes exactly once, even if it belongs to multiple simultaneous matches):
- For each player program (or enemy minion) whose bound **color** matches that tile's color: that unit gains `CHARGE_PER_TILE_COLOR_MATCH` (1).
- For each player program (or enemy minion) whose bound **shape** matches that tile's shape: that unit gains `CHARGE_PER_TILE_SHAPE_MATCH` (1).
- A single tile can therefore contribute to multiple units, and can contribute both color-charge and shape-charge to the same unit if that tile happens to be both that unit's bound color and bound shape (no special-case code needed — the two checks are independent and simply both pass). This is about a tile contributing to multiple different UNITS' charge, which is intentional and distinct from the damage rule above (which prevents one tile from being counted multiple times toward the SAME damage total just because it's in multiple matches).
- If the tile's color is the Hacker's designated bonus color, add `HACKER_BONUS_CHARGE` to the relevant unit's gain.
- Neutral tiles never contribute charge to any unit (they have no color or shape).
- Charge is capped at the receiving unit's activation cost; any amount that would push charge above the cap is discarded at the moment it's added (not banked for later).

## 1.5 Damage & Health

- `STARTING_HP_ENEMY` and `STARTING_HP_PLAYER_NORMAL`/`STARTING_HP_PLAYER_LOW_SCENARIO` per constants.
- Damage from matches and abilities is additive: total damage dealt by a single match or ability = base formula result + any active buff bonuses affecting that side (see Buffer effect).
- **Win/loss:** reducing the opponent's HP to 0 or below ends the battle in that side's favor. If both sides would reach 0 in the same resolution step, treat strictly in resolution order (player's match and any triggered effects resolve fully first, including checking for player win, before the enemy turn begins; the enemy turn then resolves fully, including checking for enemy win). Do not special-case simultaneous death further for the PoC — full turn-phase rigor is a roadmap item (see Section 2).
- Player HP reaching 0 is a loss. This is expected/intended to occur in the forced 1-HP scenario and should be tested to confirm the loss state triggers correctly (game-over screen or equivalent, no crash, no negative-HP display).

### Cascade steps and buff application timing

A single player match (or a bomb detonation, per 1.6/Bomber effect) can trigger a chain of cascades as cleared tiles cause others to fall and create new matches. Define a **"step"** as one discrete resolution event: the player's initial match is step 1; each subsequent wave of tile-falls that produces one or more new matches is its own following step (step 2, step 3, etc.), continuing until a fall produces no new matches.

- **Buff damage bonus is applied per STEP, not once for the whole cascade chain, and not once per individual match within a step.** Concretely:
  - If a step contains exactly one match, the active buff bonus (sum of all stacked same-side buff tiles, per the Buffer effect in Tunable Constants) is added once to that step's damage total.
  - If a step contains MULTIPLE independent matches happening simultaneously (e.g. a single wave of falling tiles completes two separate matches in two different columns at once), the buff bonus is still added only ONCE to that step's combined damage total — not once per match within the step.
  - The next step (if the falls from this step produce further matches) gets its own separate buff application, calculated fresh (using whatever buff tiles are still active at that point — a buff tile destroyed during an earlier step no longer applies to later steps).
- This is the same step-by-step logic that governs how a same-side buff tile being destroyed in a bomb blast still counts toward that SAME blast's own damage (since the blast and its destruction of the buff happen in the same step) but not toward any later step (see Bomber/Buffer constants notes for the exact sequencing).

## 1.6 Turn Structure

1. **Player phase:**
   a. **Tick:** if the player has multiple active countdown tiles, process them ONE AT A TIME, in the order they were originally placed (oldest first). For each countdown tile in that order: decrement it by 1; if it reaches 0, it detonates immediately per the Bomber effect — including any tile destruction, damage, and any resulting tile-fall/cascade replacement — and that detonation's full resolution (including all its cascade steps) completes BEFORE moving on to tick the next countdown tile in the order. This matters because an earlier bomb's detonation can alter the board (or destroy a later bomb tile outright as a normal tile, per the Bomber effect's blast rules) before the next countdown is even checked.
   b. Player may fire any number of charged programs/abilities, in any order, as long as sufficient charge exists for each. Firing an ability does not end the turn. If an ability affects the board (e.g., board-shake) and that causes new matches/cascades, those resolve normally and may grant charge usable for further abilities this same phase.
   c. Player makes exactly one match. This match is the turn-ending action — once committed, no further abilities may be fired this turn.
   d. The match (and any resulting cascades) resolves: damage and charge applied per the matching rules above.
2. **Enemy phase** (enemy does not match tiles — see 1.7):
   a. **Tick:** same ordered, one-at-a-time, fully-resolve-before-next process as 1.6.1.a, applied to the enemy's own countdown tiles, in their placement order.
   b. **Cast:** any enemy minion at or above its activation cost fires its effect. If MORE THAN ONE enemy minion is charged and ready to fire simultaneously, the order in which they fire is randomized each time this step occurs (not a fixed priority order) — each charged minion still fires exactly once per Cast step, only the ORDER among them is randomized.
   c. **Gain charge:** every enemy minion gains charge per its fixed rate (capped at its cost, per Tunable Constants).
   d. Turn passes back to the player.

Note: countdown tiles tick at the START of their OWNER's turn (not the end of the player's turn as a single global event) — a player-owned bomb ticks when the player's turn begins, an enemy-owned bomb ticks when the enemy's turn begins. This means a detonation can occur and affect the board/charge state before that turn's actions (player abilities/match, or enemy cast/charge-gain) take place.

Note: abilities can ONLY be fired before the player's match, never after. This is a deliberate design choice (matches the reference game this is modeled on) and allows pre-match alpha-strike chains via board-affecting abilities, while keeping any charge gained FROM the match itself unspendable until the following turn.

## 1.7 Board-Shake Ability

- Cost: `BOARD_SHAKE_COST`.
- Starts the battle already charged (usable turn 1).
- Effect: fully randomizes the board (new random color/shape/neutral assignment to every tile). ALL special tiles (buff tiles AND countdown/bomb tiles, owned by either side) persist into the new board, retaining their same color, shape, owner, and (for countdowns) remaining duration. Persisting means the tile itself survives the shake with these properties unchanged — it does NOT mean the tile stays at its current grid position. Special tiles are repositioned to new (randomly chosen) grid locations along with every other tile during the shake; only their color/shape/owner/duration data carries over unchanged, not their location.
- Does not end the player's turn (it is fired during the pre-match ability phase, per 1.6).
- Unlike the automatic deadlock-safety reshuffle (below), the player-triggered board-shake is explicitly ALLOWED to land on a board state that already contains valid matches — this is an intentional possible payoff (an immediate cascade) for spending charge on the ability, not a bug to prevent.
- Replenished by matching neutral tiles (player matches restore the player's board-shake meter; enemy-side equivalent is not applicable since enemies don't match — see open item below).
- This ability's reshuffle logic is also reused as the system's general deadlock-prevention mechanism: if the board has no valid moves at all, the same reshuffle logic triggers automatically regardless of player action, to guarantee the game is never unwinnable due to a dead board. UNLIKE the player-paid version, this automatic deadlock reshuffle MUST produce a board with at least one valid move available, but with NO match already present at the moment of generation (same "no free auto-clear" rule that governs the initial board state in 1.3). The two reshuffle paths share their core randomization logic but differ in this one validity guarantee.

### Deadlock detection algorithm (reference implementation)

Use a brute-force exhaustive scan, proven workable in an earlier prototype of this concept: for every tile on the board, tentatively swap it with its neighbor to the east and to the south (checking both directions from every tile covers every adjacent pair exactly once), check whether that hypothetical swap would produce a valid match, then immediately revert the swap regardless of the result. If this scan completes having found zero matches anywhere on the board, the board is in deadlock and the auto-reshuffle must trigger. This is computationally cheap at 8×8 (at most ~120 tentative swap-check-revert cycles) and does not require any cleverer algorithm. Run this same scan after every cascade settles, not just on a player's failed move, since cascades can also produce a dead board.

## 1.8 Neutral Tiles

- No color, no shape. Match only with other neutral tiles.
- **Visual treatment:** since neutral tiles have neither a color nor a shape value, they should NOT be rendered as a blank/empty space (which would be ambiguous with an actual empty board gap) or as an arbitrary placeholder color (which an agent might otherwise guess at, e.g. defaulting to gray-only or to one of the 6 existing colors). Instead, render neutral tiles as a "static"/glitch texture: a tile-sized fill of randomly placed black, white, and gray pixels/noise, suggesting visual static rather than any specific color or shape. This should be a single shared static appearance (the same noise pattern style for every neutral tile), not randomized per-instance in a way that risks being mistaken for a unique tile type.
- On match: deals `DAMAGE_PER_TILE_NEUTRAL` damage per tile (same summation rules as any other match), and replenishes the board-shake meter.
- Does not charge any program (programs are bound to a color and a shape; neutral has neither).
- Enemy-side interaction with neutral tiles is not defined for this PoC beyond the cascade case: if a neutral-tile cascade occurs as a result of enemy-originated board effects (e.g., tiles falling after a Bomber detonation), it deals damage identically to a player-triggered neutral match (i.e., neutral tile resolution is symmetric/owner-agnostic). Neutral tiles have no minion/program bound to them on either side; there is no enemy-specific neutral mechanic in this PoC.

## 1.9 Build Layers (Fixed, Hardcoded — No Selection UI)

The PoC uses exactly ONE build. There is no UI for choosing or equipping any layer. All layers are hardcoded constants/data at this stage:

- **Hacker** (Race equivalent): cosmetic portrait + backstory text; grants a passive bonus on one designated HIGH-tier color (agent chooses which of the 3 high colors). On that color: +`HACKER_BONUS_DAMAGE` damage per tile destroyed, AND +`HACKER_BONUS_CHARGE` charge per tile matched (added to whichever unit(s) the tile's color/shape would normally charge). This is acknowledged as potentially strong relative to other colors for this PoC; not a balance concern to resolve now.
- **Deck** (Class equivalent): defines the Board-Shake ability (Section 1.7). No other Deck-level ability for this PoC.
- **Programs** (Gear equivalent): exactly 4 programs, mirroring the 4 enemy minion types (Bomber, Buffer, Attacker, Disabler) in cost and effect — see 1.10.
- **Dongle** (Attachment equivalent): NOT included in this PoC. No Dongle/Attachment layer exists for this build — this is a full cut, not a placeholder. See Section 2 for when this layer is introduced.

### Special tile data & UI note

Bomb tiles and buff tiles each retain a full color AND shape (per 1.7, they persist through board-shake with these intact), in addition to their owner (player/enemy) and, for bombs, remaining countdown. This means a single special tile's on-screen representation may need to simultaneously convey: color, shape, ownership (white/black per 1.11), and a countdown number. This is a real visual-density challenge — flagged here explicitly so the agent designs the tile rendering with all four attributes in mind from the start (e.g., color as fill, shape as an icon/outline, countdown as an overlaid number, ownership as a border/glow), rather than discovering the conflict after building a simpler tile renderer first.

## 1.10 Programs (Player) and Minions (Enemy)

Both sides use the identical 4 unit types, identical costs, identical effects (see Tunable Constants for exact values: Bomber 7/Buffer 13/Attacker 19/Disabler 22, and their respective effects).

**Player programs:**
- Each program is bound to exactly one color AND one shape (agent assigns the specific color+shape binding for each of the 4 programs and documents the assignment).
- A program charges per the flat per-tile model in section 1.4 (charge distribution): every destroyed tile matching its bound color contributes `CHARGE_PER_TILE_COLOR_MATCH`, every destroyed tile matching its bound shape contributes `CHARGE_PER_TILE_SHAPE_MATCH`, additively, capped at the program's cost (`CHARGE_CAP_EQUALS_COST`).
- Once a program's accumulated charge ≥ its cost, the player may fire it during the pre-match ability phase (1.6.b). Firing consumes the cost in charge (simple subtraction; since charge is capped at cost, firing a fully-charged unit resets it to 0).

**Enemy minions:**
- Same 4 types, same costs, same effects.
- Each charges automatically at its fixed rate every enemy turn (no matching involved on the enemy side — enemies never match tiles), capped at its cost.
- Fires automatically the moment its charge ≥ its cost, during the enemy's Cast step (1.6.2.b).
- All 4 enemy charge meters are visible to the player at all times (full information, no hidden timers for this PoC).

**Targeting for Disabler:** when either side's Disabler fires, it targets whichever of the OPPONENT's 4 units (programs or minions) currently has the highest raw charge, and resets that unit's charge to 0. If multiple opponent units are tied for the highest raw charge, one is chosen at random among the tied units (raw charge is the only sort key; cost and remaining-to-activation are not considered). Exact ties are effectively impossible in this PoC given distinct fixed enemy charge rates, but the rule is stated for completeness.

**Charge model:** each of the 4 programs/minions on a given side has its own independent charge pool. There is no shared/pooled charge and no random-fire resolution for this PoC (that model exists in other games and is a documented option for later — see Section 2 — but at 4 units with non-overlapping color/shape bindings, independent and pooled charge are behaviorally identical at this scale, so independent is implemented as the simpler option).

## 1.11 Ownership / Visual Indication

Any tile placed on the board by an ability (buff tiles, bomb tiles) must be visually marked with its owning side, using the following convention: **white icon/marker = player-owned, black icon/marker = enemy-owned.** This applies regardless of tile type (a player-placed bomb and an enemy-placed bomb must be visually distinguishable at a glance).

## 1.12 Screen Layout, Input Model & UI Flow

### Layout (MTGPQ-style, portrait)

- The gem/tile board occupies the BOTTOM portion of the screen (the primary touch/interaction zone, within easy thumb reach on a phone).
- Unit/status information occupies the TOP portion: both sides' health pools, the 4 player program indicators (with charge state), the 4 enemy minion indicators (with their always-visible charge meters, per 1.10), and any active-buff/global-state readouts.
- All whitebox/greybox per 1.2 — this describes information placement and hierarchy, not visual styling.

### Board input model (gem selection & swapping)

Swaps are only ever between two ORTHOGONALLY ADJACENT tiles (up/down/left/right — never diagonal, never non-adjacent). The player may initiate a swap two ways:

**Tap/click model:**
- Tapping a tile SELECTS it; the selection must be clearly indicated in the UI (e.g. a highlight/outline on the selected tile).
- If a tile is already selected and the player taps a NON-adjacent tile, the selection MOVES to the newly tapped tile (no swap attempted).
- If a tile is already selected and the player taps an ADJACENT tile, a swap between the two is attempted.

**Press-and-drag model:**
- The player may press/click a tile and drag toward an adjacent tile to attempt a swap with it.
- Dragging toward a non-adjacent tile (or releasing on empty space / the origin tile) does nothing — no swap attempted, no error.

**Swap resolution (both models):**
- Every attempted swap must VISUALLY show the attempt (the two tiles animate swapping positions) — the player always sees that their input registered.
- If the swap produces at least one valid match, it stands and resolves normally (match → damage/charge → cascades → etc., per the turn structure).
- If the swap produces NO valid match, it is reverted (the tiles animate back to their original positions) AND a brief UI notification indicates "no match" (or equivalent), so the player understands why the board returned to its prior state. A reverted swap does NOT consume the player's turn — they remain in the make-a-match phase and may try again.

### Ability input (separate channel)

Firing programs/abilities is a SEPARATE interaction from board gem-selection. Abilities are triggered by tapping the relevant charged program/unit indicator (in the top info area), NOT through the gem tap/drag system. The two input channels must not be conflated — tapping a gem never fires an ability, and tapping a program indicator never selects a gem. (Recall from 1.6 that abilities may only be fired during the pre-match phase of the player's turn.)

### Pause / battle menu

- A menu button is available on the battle screen that opens a dialog with two options:
  - **Reset** — restarts the current match from its initial scenario state.
  - **Quit** — returns to the title/scenario-selection screen.
- The pause menu is ONLY available during the player's turn while they are in the "make a match" phase (i.e. not mid-cascade-resolution, not during ability-effect resolution, and not during the enemy phase). This restriction avoids opening the menu while the game state is mid-transition.

### Game-over dialog

- When a match ends (either side reaches 0 HP), display a game-over dialog that clearly indicates WHO WON (player victory or player defeat).
- The dialog then offers the same two options as the pause menu: **Reset** (restart the current match) and **Quit** (return to title/scenario-selection screen).

## 1.13 Test Scenarios

Two fixed scenarios must be playable, selectable at battle start (a simple menu/selector is sufficient — no broader scenario-editing tooling required):

1. **Normal scenario:** Player starts at `STARTING_HP_PLAYER_NORMAL` (150). Enemy at `STARTING_HP_ENEMY` (150). Validates the win path and general feel of the loop.
2. **Forced-loss scenario:** Player starts at `STARTING_HP_PLAYER_LOW_SCENARIO` (1). Enemy at `STARTING_HP_ENEMY` (150). Player will almost certainly lose on the enemy's first damaging action. Validates that the loss state, game-over handling, and any related UI/edge cases work correctly without requiring a long normal playthrough to reach that state.

## 1.14 Explicitly Out of Scope for This PoC

(Cross-reference to Section 2 — listed here as a hard boundary, not for elaboration)

- No node-based map or run structure of any kind.
- No build selection UI — nothing to choose, only the one hardcoded build exists.
- No memory/capacity limits on programs.
- No 2D shape-fitting/memory-grid system for programs.
- No random enemy or random build generation ("random play" mode).
- No dev/edit tools for scenario scripting beyond the two fixed scenarios in 1.13.
- No save/load, no persistence, no accounts.
- No sub-node/sub-system health pools (single health pool per side only).
- No pooled/shared charge with random-fire resolution.
- No second damage-resolution system (e.g., a MTGPQ-style summon/resolution-phase model) — single direct-damage model only.

---

# Section 1-MK2: Post-PoC Revisions (BUILD THIS, ON TOP OF SECTION 1)

This section defines a second iteration on the working PoC. It assumes Section 1 is already built and functioning. Each item here is a DELTA against Section 1 — where an MK2 item conflicts with Section 1, MK2 governs; everything in Section 1 not mentioned here is unchanged. No new gameplay mechanics are introduced in MK2; this is refinement, one simplification, and metrics tooling. Section 2 (Roadmap) remains out of scope.

## MK2.1 Shape rendering (visual)

- Standard-tile shapes are now rendered as a WHITE fill, with a 1px outline in that tile's own darker gem color (the same darker shade used elsewhere for that color), so the shape stays legible on light-colored tiles (e.g. a white star on a yellow or cyan tile would otherwise wash out). The 1px same-color-darker outline restores the edge.
- Additionally, each jewel/tile itself gets a 1px darker outline (a slightly darker shade of its own fill color) around its border, purely for visual separation and interest. No mechanical effect.
- This remains within whitebox scope (Section 1.2): these are minimal primitive-rendering rules for clarity/legibility, not an art pass. Neutral tiles are UNCHANGED (still the black/white/gray static texture from 1.8).

## MK2.2 Board-shake becomes pure anti-lock (simplification)

Supersedes the relevant parts of Section 1.7. The player-triggered board-shake ability now behaves IDENTICALLY to the automatic deadlock reshuffle:

- It reshuffles the board (repositioning all tiles; special tiles retain color/shape/owner/duration data per the existing rule).
- It produces a board with at least one valid move available and NO match already present at the moment of generation — the SAME validity guarantee as the automatic deadlock reshuffle.
- It therefore deals NO damage, grants NO charge, and triggers NO cascades. The previous "player shake is allowed to land on existing matches as a cascade payoff" rule from Section 1.7 is REMOVED — there is no longer any mechanical difference between the paid shake and the auto-reshuffle except what triggers them (player spending charge vs. automatic on deadlock).
- Cost (`BOARD_SHAKE_COST`), starts-charged behavior, and neutral-match replenishment are all UNCHANGED. Shake is now purely a utility/anti-lock tool: spend charge to force a fresh, guaranteed-playable board, with no offensive upside.
- Rationale: the cascade/damage payoff made shake overwhelming in MK1. Reducing it to a pure reshuffle removes that swing while keeping its anti-softlock purpose.

## MK2.3 Per-battle metrics (new tooling — additive)

Add per-battle metrics collection and an end-of-battle display. This introduces NO gameplay change — it only observes and reports.

**Architecture (required):** metrics MUST be collected in the pure logic layer, not the render layer. The turn-resolver (and ability/detonation resolution) already produces discrete resolution events; a metrics collector subscribes to those events and accumulates counters in logic-layer state. This keeps metrics portable to a future engine (e.g. Godot) and, critically, means the headless logic can be run in batches (many simulated battles) to read aggregate stats WITHOUT rendering — seeding the Section 2 "random play / autobattle balance-testing" roadmap item. Do NOT scrape metrics from UI state.

**Metrics to collect this pass** (tracked for BOTH sides — player and enemy — since both have the same 4 units and both deal damage via abilities/bombs):

- Turn count to resolution (battle length).
- Total damage dealt, split by source: match damage vs. ability (Attacker) damage vs. bomb-detonation damage.
- Critical (1.5× tier) damage total, and as a percentage of total match damage.
- Per-ability fire count and total damage/effect per ability, for all 4 unit types on each side.
- Charge wasted to the cap, per unit (charge that was generated/granted but discarded because the unit was already at its cost cap).
- Match-lock count: how many times the automatic deadlock reshuffle fired during the battle.
- Largest single-hit damage (biggest damage from one match or one ability in the battle).
- Deepest cascade: the maximum number of cascade steps reached in a single move/detonation.

**Display (game-over screen):** show the metrics on the existing game-over scene, laid out BELOW the existing win/loss indicator and the Reset/Quit controls. The area must be scrollable for mobile (portrait) since the metric list is long. Player-side metrics are shown FIRST (above, or on the left, or at the top of the scroll order); enemy-side metrics follow. Whitebox styling only — plain text rows and default fonts are fine; no charts or visual polish required for this pass.

---

# Section 1-MK3: Combat Cohesion Pass (BUILD THIS, ON TOP OF MK2)

This section defines a third iteration. It assumes Section 1 and Section 1-MK2 are built and working. Each item is a DELTA against the current build — where MK3 conflicts with an earlier section, MK3 governs; everything not mentioned here is unchanged. Section 2 (Roadmap) remains out of scope.

**Intent of this pass (context, not a build instruction):** The goal is combat-system COHESION, not balance. These are deliberately rough, only-slightly-more-informed replacements for the previous arbitrary values, plus one new matching behavior (blob matching) and better instrumentation (outcome-split metrics). The purpose is to (a) make the battle system feel more intuitively cohesive and (b) generate a second dataset to inform future ability numbers. Do not chase perfect balance. Do not add mechanics beyond what is listed here.

## MK3.1 Combat value changes (constants)

All of these are edits to the single constants module. Do not hardcode elsewhere.

- **Match damage halved.** Halve the per-tile match damage values: `DAMAGE_PER_TILE_LOW_COLOR` 2 → 1, `DAMAGE_PER_TILE_HIGH_COLOR` 4 → 2, `DAMAGE_PER_TILE_NEUTRAL` 3 → 2 (round as written). This is a first-pass tune to give abilities room to matter relative to match damage. Charge values are UNCHANGED — this halves damage only, not charge.
- **Attacker damage doubled.** `ATTACKER_DAMAGE` 15 → 30. (Applies to both the player's Attacker program and the enemy Attacker minion, per the mirrored-stats rule.)
- **Bomb buffed on two axes.** `BOMBER_COUNTDOWN_TURNS` 3 → 2 (shorter fuse), and the detonation radius expands from the 4 orthogonal neighbors to the full 3×3 surround — all 8 adjacent tiles (orthogonal + diagonal) around the bomb tile, plus the bomb tile itself. Add a named constant for the blast pattern rather than hardcoding it. All existing blast rules are unchanged (destroyed tiles deal their own type's damage; bombs/buffs caught in the blast are destroyed as normal tiles with no chain; a same-side buff destroyed still counts toward that blast's damage; detonation grants no charge; resulting falls cascade normally). NOTE: diagonal destruction now destroys tiles that could not have been part of any orthogonal match — this is intended.

## MK3.2 Disabler → player-targetable (the one non-trivial change)

Supersedes the Disabler targeting rule in Section 1.10 / constants.

- **Player's Disabler program is now player-TARGETABLE.** When the player fires it, the player chooses WHICH of the 4 enemy minions to fully discharge, rather than it auto-selecting the highest-charge unit. The targeting UI/interaction is left to the implementer's discretion (follow the existing ability-input conventions from Section 1.12 — abilities fire via the top info-area indicators, distinct from gem selection). [DESIGNER NOTE: targeting UX delegated to agent for this pass; flagged for possible future clarification.]
- **Enemy's Disabler minion uses a fixed, predictable target rule** (not random, not highest-charge): it targets the player's HIGHEST-COST program that currently has any charge (i.e. it prioritizes shutting down the player's most expensive/threatening program), breaking ties by highest current raw charge, then randomly. The point is that the enemy Disabler is legible — the player can anticipate what it will hit and play around it. Document the exact rule chosen in code comments.
- Rationale: auto-highest-charge made the player's expensive Disabler feel not worth its cost; targetability makes it a tactical tool. The enemy staying predictable supports the low-variance / telegraphed-threat design goal.

## MK3.3 Blob / merge matching (new matching behavior — code-light)

Adds non-linear (L/T/plus/blob) match detection, so that 4- and 5-tile matches can form in non-straight configurations. This finally lets the existing 1.5× crit tier fire in practice (straight-line-5 alone was ~0.2% of damage). A proven algorithm exists from an earlier prototype (Match3Single) — port it rather than deriving new logic.

- **Algorithm:** first detect all straight-line 3+ runs (base matches), then iteratively MERGE any two base matches OF THE SAME MATCH-TYPE whose tiles or adjacent-neighbor tiles overlap, into a single combined match, until no further merges occur. The combined match's tile count determines its tier (4-tier, 5-tier, etc.) and its shape (line vs. non-line) determines clear/crit per the existing 1.4 table.
- **REQUIRED ADAPTATION for this game's two-axis tiles:** the reference algorithm assumed one type per tile. Here tiles have INDEPENDENT color and shape, and matches form on either axis. So base-match detection must run PER AXIS — scan for color-runs and shape-runs separately — producing matches tagged by their axis+value (e.g. "color:red", "shape:triangle"). The merge step must be axis-aware: a color-match and a shape-match are DIFFERENT match-types and must NOT merge into each other. Only same-axis, same-value matches merge. (The reference code already guards merges by matchType; this just requires color and shape values to be distinct matchType identities.)
- **RECOMMENDED hardening (cheap, ~3 lines):** wrap the merge pass in a repeat-until-no-merges-occurred loop, to correctly handle 3+-way merge chains where a linking overlap only appears after an earlier merge. Without it, a rare multi-blob case could be under-merged (scored as separate matches). Not a crash either way, but the loop makes it airtight.
- **DO NOT micro-optimize.** The merge is O(n²) over simultaneous matches with nested coord checks; at 8×8 with a handful of matches this is negligible (microseconds). Keep it naive and correct. Do not replace it with a cleverer algorithm.
- **Interaction with existing rules (unchanged, but confirm they still hold):** per-destroyed-tile dedup and highest-multiplier-wins (1.4) still apply to blob results; charge is still flat per-tile with no multiplier; the "no tier promotion from mere adjacency" rule is now SUPERSEDED for genuine merges — a merged blob of 4+ same-axis tiles IS a real 4/5-tier match (that was the whole point). Two DIFFERENT-axis matches that merely touch still do not combine.
- After building, re-read the crit metric — the point of this change is to make crits actually occur, so the crit share of match damage should rise meaningfully above MK2's ~0.2%.

## MK3.4 Bot AI upgrade — prefer 4-matches (floor indicator, one notch up)

Supersedes the bot's move-selection in the smoke/batch harness only (not player-facing).

- The automated bot currently plays the first-found valid move. Upgrade it to: if any available move would produce a 4-match (or larger / a row-column-clear), prefer that move; otherwise fall back to first-found. This mirrors MPQ's enemy-AI tier and is a slightly higher, still-dumb floor.
- Do NOT go further for this pass: no cascade look-ahead, no 5-match prioritization, no board evaluation. The bot must remain a deliberately weak FLOOR indicator — its job is to lose most games so that human win-rate can be read as a delta above a known-weak baseline. [DESIGNER NOTE: "AI tiers" as a difficulty lever / enemy power-scaling axis is a future roadmap idea, not part of this pass.]

## MK3.5 Metrics — split by outcome (instrumentation upgrade)

Extends MK2.3. Still logic-layer, still event-sourced.

- **Split all batch-aggregated metrics by battle OUTCOME:** report the metric set separately for battles the player WON vs. battles the player LOST (and, where meaningful, player-metrics-in-wins vs player-metrics-in-losses). The averaged-across-all-battles blend hides the most useful information — the losing battles are the more informative half for understanding which enemy abilities actually close out games.
- This applies to the BATCH/headless harness output (the 100-battle run), which is where outcome-splitting pays off. The single-battle game-over screen from MK2.3 is unchanged (a single battle has a single outcome).
- Also surface, in the batch output, the overall bot win/loss rate prominently — it is the primary calibration number (design target: a dumb bot should lose the large majority of games; see intent note).
- Rationale / forward note: outcome-split metrics become increasingly load-bearing as later builds add asynchronous units, more abilities, and environment effects — those create more distinct win/loss paths that a blended average would smear together.

## MK3.6 Visual / UX increments (limited, intentional)

Small, deliberate polish — kept minimal on purpose so a future real "visual pass" is informed by accumulated real-play experience rather than done all at once. Still whitebox scope.

- **Special-tile indicators centered in the shape:** move the countdown number / special-tile indicator to the CENTER of the tile's shape glyph (rather than a corner/overlay position), for better legibility.
- **Black outline on white (player-owned) special items:** player-owned special tiles use white markers (per 1.11); add a black outline around those white markers so they read clearly against light tile fills. Expanding the glyph a few px or allowing minor overlap to fit the outline is acceptable.
- **Font sizing paradigm flip:** change the text-sizing approach throughout from "as small as we can get away with" to "as large as possible without overflowing the designated area." Fonts should fill their allotted space. This applies to all UI text (HP, charge meters, labels, metrics rows, dialogs).
- **Explicitly deferred:** the larger layout overhaul (moving the board to the TOP, stacking the 4+4 units vertically along the screen edges) is NOT part of MK3 — it is a bigger re-architecture best done once mechanics stabilize. Do not attempt it this pass.

## MK3 — Out of scope (parked, unchanged from prior roadmap intent)

Not in MK3; listed so the boundary is explicit. Combat-identity pivots (matches-deal-no-damage-without-Buffer; Buffer-as-permanent-buff); the charging-model exploration (cap-and-discard vs carryover vs bigger pools) and overcharge-to-effect-tiers (which would reopen the charge cap); wildcard/critical-TILE spawning (the MPQ persistent-object mechanic, distinct from blob matching); the utility-only hero-ability redesign and neutral-as-control-rods identity; board-alteration abilities; AI difficulty tiers; and all superstructure (map, build selection, progression, dongles). See Section 2.

---

# Section 1-MK4: Persistence, Logging & Visual Pass (BUILD THIS, ON TOP OF MK3)

Assumes Section 1, MK2, and MK3 are built and working. Each item is a DELTA against the current build — where MK4 conflicts with an earlier section, MK4 governs; everything not mentioned is unchanged. Section 2 (Roadmap) remains out of scope.

**Intent (context, not a build instruction):** Add battle persistence (so a phone backgrounding the game doesn't lose the in-progress battle), lightweight logging (to accumulate real-play data and per-turn debugging records for the more complex mechanics coming next), and one visual fix. No gameplay/combat changes in MK4.

## MK4.1 Save / restore (continuous autosave of in-progress battle)

- Continuously autosave the in-progress battle to browser storage after each state change (or at minimum each turn). On load, the game can restore that exact state. This is invisible/automatic — no save menu.
- Serialize the LOGIC-LAYER game state to JSON. The renderer rebuilds from restored state. (This works only because logic/render are separated — keep it that way. If any state lives in the renderer, move it into the logic layer.)
- **Storage:** agent's choice by data size; default to localStorage. Save state (one in-progress battle) is small; if logs grow large they may use IndexedDB — the save and the logs may live in different stores.
- **Clear on battle-over:** the save is cleared at the MOMENT a win/loss state is reached (not on next load), so returning after a finished battle never resumes a completed battle.
- **Save-format version stamp:** write a version identifier into the saved state. On attempting to resume, if the stamp is missing or from an incompatible version, treat it as no-valid-save (do not crash) — fail gracefully to a fresh start. (MK5 will change the state shape, so this matters immediately.)

## MK4.2 Continue option (minimal front-end delta)

- Add a **Continue** affordance to the EXISTING scenario-selector screen (do NOT build a separate title/main-menu screen this pass).
- Continue is shown ONLY when a valid, version-compatible, in-progress save exists; it resumes that battle. Otherwise it is hidden/disabled.
- Picking a scenario / starting a New Game WIPES any resident save and starts fresh — this doubles as the escape hatch for a wedged or corrupt save (no separate clear-save button needed).

## MK4.3 Logging (logic-layer, event-sourced)

Reuse the SAME logic-layer event stream the metrics collector already consumes (MK2.3) — do not build a parallel event pipeline.

- **Tier 1 — final-metrics log:** on each completed battle, append its final metrics to a persisted, append-only log for later analysis.
- **Tier 2 — per-turn action+outcome log:** record one entry per turn capturing the action(s) taken and their outcome (damage, charge changes, HP after, abilities fired, detonations, etc.), sufficient to reconstruct what happened that turn without a full board snapshot.
- **Tier 3 — full board-state-per-turn snapshots: PARKED.** Do not build. Noted only because the MK4.1 serializer makes it cheap to add later when interaction complexity demands it.
- **Log presentation is OUT OF SCOPE:** no in-app log viewer, charts, or export UI. Record to storage only; logs are read via devtools or a simple console-dump. Do not build log-viewing UI.

## MK4.4 Visual — gems as colored icons

- Change tile rendering from "a shape glyph on a colored field" to "a colored ICON" per the reference-game convention: enlarge the shape so it fills as much of the tile as possible, pushing the shape's defining silhouette toward the tile's edges. This leaves the tile CENTER visually free so the centered special-tile/countdown indicators (from MK3.6) no longer overlap and obscure the shape.
- Still whitebox scope — this is a legibility change using primitive shapes, not an art pass. Neutral tiles unchanged (static texture).

## MK4 — Out of scope (parked)

Not in MK4: Tier 3 board snapshots; any log-viewing UI; a full title/main-menu screen; and everything from the MK5+ roadmap (enemy matching, special-tile hardening, cascade-depth-as-ability, combat-model experiments, superstructure). See Section 2.

---

# Section 2: Roadmap (DO NOT BUILD — CONTEXT ONLY)

This section exists so future work has a documented home and so deferred ideas aren't lost. Nothing in this section should be implemented as part of the PoC. If anything here appears to conflict with Section 1, Section 1 governs for this build.

### Run structure & map
- Slay the Spire-style branching node map between battles (not Gems of War's open conquest-map style — that was explicitly considered and rejected as a model).
- Map nodes affecting the run itself (terrain buffs, branching difficulty).
- Node sub-systems: health pools split across multiple disableable nodes per side, rather than one pool — including a target-routing rule for which node a given color/match damages (several candidate rules were discussed: fixed core-only, color-assigned nodes with overflow, player-chosen exposed node).

### Build variety & progression
- Build selection UI: choosing among multiple Hackers, Decks, Programs, and Dongles.
- Target: 3 distinct, viable builds for the next milestone after this PoC (more thereafter).
- Memory/capacity system limiting how many or how powerful programs a Deck can carry.
- 2D shape-fitting: programs occupy a 2D footprint that must physically fit on a limited memory grid (Tetris-style inventory). Explicitly deferred — adds real complexity, not needed to validate the core loop.
- Hacker passives that scale with or synergize with the equipped Program's color.

### Combat system extensions
- Pooled charge per color/shape with random-fire resolution when two units share a charge condition (the MPQ model) — becomes relevant once unit count or color/shape overlap increases beyond the PoC's 4-and-4, non-overlapping setup.
- Unit knockout mechanics and rules for what happens to a knocked-out unit's leftover charge (relevant once node sub-systems exist).
- 2-action-point hybrid turn model: instead of unlimited pre-match ability casting, the player has 2 AP per turn, spendable on EITHER making a match OR firing an ability. This is a structurally different alternative to the current MPQ-style model, intended to:
  - reduce alpha-strike swinginess,
  - let the player act first after a board-shake/reshuffle (addressing a gap the current model and Gems of War's model both have),
  - open design space for abilities that cost 2 AP (more powerful) or that interact with AP directly.
  - This is a serious candidate for a future iteration if the current MPQ-style cascade model proves too swingy/unfair in practice. Both models should be considered documented alternatives, not a strict linear roadmap — the PoC's job is partly to determine whether this hybrid is even necessary.
- Second damage-resolution model(s) as alternates to direct-match-damage, evaluated only if direct-match-damage doesn't feel satisfying after PoC testing:
  - Gems of War-style: matches only charge, a dedicated "attack" tile/trigger (skull-equivalent) deals all direct damage.
  - MTGPQ-style: matches are pure resource generation; summoned units/effects resolve in a separate post-match phase.
- Explicit, formalized turn-phase resolution (precise simultaneous-death handling, etc.) once the game moves beyond PoC informality.

### Enemy design space
- This PoC's 4 minion types (Bomber, Buffer, Attacker, Disabler) are a deliberate starting subset. The broader genre design space (countdown/enchantment tiles with varied effects, environment tiles, player-mirrored "clone" enemies that actually match tiles themselves, special board-converting effects) is large and intentionally not explored yet. Puzzle Quest 1, MPQ, Gems of War, and MTGPQ each demonstrate different, viable points in this space and can be revisited for inspiration.

### Non-linear match support (L/T/blob shapes)
- The PoC deliberately restricts 4-matches to straight lines only (1.4). Supporting non-linear 4+ tile matches (L, T, plus-shapes, or larger merged "blobs") is a real future enhancement, not a research problem — a working algorithm already exists from an earlier prototype: find all straight-line 3+ matches first, then iteratively merge any two matches of the same type whose tiles (or whose adjacent neighbor tiles) overlap into a single combined match, repeating until no further merges occur. This correctly handles cases like two separate 3-matches that share a corner tile, treating them as one larger match rather than two independent ones. Revisit this when expanding match-shape variety beyond the PoC's straight-line-only rule.

### Tooling
- Dev/edit tools for scenario testing: custom HP values, custom enemy compositions, board-state injection, step-through/debug controls.
- Recommended pattern (proven in an earlier prototype): a toggleable in-game console/terminal overlay (e.g. shown/hidden via a key press) backed by a delegate/event-based command registry — each debug command is a self-contained handler that checks whether it's the matching command, validates and parses its own arguments, prints a usage string on bad input, and is added/removed from a shared command-dispatch event. This keeps the command set easy to extend (adding a new debug command is one new handler plus one subscription, no central dispatch table to maintain) and is a good fit for exactly the kind of scenario-injection and state-inspection tools this milestone will need (e.g. SETTILE, RESETBOARD, LISTMATCHES-style commands, extended with combat-specific equivalents like SETHP, SETCHARGE, SPAWNBOMB).
- "Random play" mode: randomized enemy compositions and/or randomized player builds, for variety and stress-testing balance.

### Platform
- The PoC is web/TypeScript, run locally, for fast iteration on mechanics. The likely target for an eventual real Android release is **Godot 4.x** (free, MIT-licensed, no royalties, strong fit for a 2D mobile game with no monetization/live-ops needs). The PoC's strict logic/rendering separation is intended to make this port straightforward: the validated TypeScript game-logic modules define the rules precisely enough to reimplement in GDScript without re-deriving the design.
- Deployment to a stable hosted URL (Vercel/Netlify/GitHub Pages or similar) is a trivial future step once the design stabilizes; not needed for the PoC.

---

# Coding Agent Prompt (Ready to Paste)

```
You are building a proof-of-concept web game called "Breach" — a match-3
combat game with a cyberpunk hacking theme. The full requirements are in the
attached requirements document (breach-poc-requirements.md). Read the ENTIRE
document — the Tunable Constants block and all of Section 1 — BEFORE writing
any code. Section 2 (Roadmap) is context only; do not build from it.

=== CRITICAL RULES ===

1. SCOPE: Build ONLY what is in "Section 1: Proof of Concept" and the "Tunable
   Constants" block. Section 2 is future work — implement none of it. If unsure
   whether something is PoC or roadmap, treat it as out of scope and ASK rather
   than building toward more scope. Smaller and exactly-to-spec is correct. Do
   not add features, systems, or polish "to make it more complete."

2. CONSTANTS: Put every gameplay-affecting number in a single constants module
   (e.g. constants.ts), exactly as listed under "Tunable Constants." Do not
   hardcode any gameplay number anywhere else — these must be adjustable in one
   place for post-build tuning.

3. LOGIC / RENDER SEPARATION: All game logic (board state, match detection,
   damage, charge, turn resolution, ability/effect resolution, deadlock
   detection) MUST be pure, framework-agnostic TypeScript with zero rendering
   or DOM dependencies. The rendering layer only reads state and forwards input;
   it contains no game rules. This is required so the logic can later port to
   another engine (e.g. Godot) without a rewrite.

4. STACK: TypeScript, HTML5 canvas rendering, Vite (or equivalent) for a local
   dev server. Mobile-first PORTRAIT layout, touch input. No backend, no
   persistence, no accounts, no deployment — a local dev server reachable via a
   tunnel (ngrok/Cloudflare Tunnel) for phone testing is sufficient.

5. VISUAL SCOPE — WHITEBOX/GREYBOX ONLY (Section 1.2): Simple gray/white/
   primitive-color geometric shapes and default system fonts. No art, theming,
   cyberpunk styling, custom fonts, or polish. Where the doc specifies a visual
   RULE — neutral tiles as black/white/gray static; white=player / black=enemy
   ownership markers; a special tile legibly showing color + shape + countdown
   + owner at once — implement it with the simplest primitives that satisfy the
   rule. The rule is required for clarity; artistic execution is not in scope.

6. TEST SCENARIOS (Section 1.13): Implement the two fixed, selectable scenarios
   exactly — (a) normal: both sides 150 HP; (b) forced-loss: player 1 HP, enemy
   150 HP. A minimal selector screen to choose between them is sufficient.

7. AGENT-DISCRETION VALUES — choose reasonably, then DOCUMENT each in code
   comments AND a short README section for review/adjustment:
   - which 3 of the 6 colors are LOW-damage (2) vs. which 3 are HIGH (4)
   - each of the 4 programs' specific color+shape binding
   - which single HIGH color carries the Hacker's passive bonus
   - the 6 colors' and 6 shapes' concrete (whitebox-simple) identities

=== RULES THAT ARE EASY TO GET WRONG — IMPLEMENT DELIBERATELY ===

8. DAMAGE/CHARGE IS PER DESTROYED TILE, NOT PER MATCH (Section 1.4). Build the
   SET of tiles destroyed in a resolving event (each tile once), then sum
   per-tile values over that set. A tile shared by two simultaneous matches is
   destroyed and counted exactly once, using the HIGHEST multiplier it
   qualifies for (never stacked, never applied twice). Design damage resolution
   around an explicit per-step destroyed-tile-SET from the start — do not
   accumulate damage match-by-match, or intersections will double-count.

9. NO TIER PROMOTION FROM ADJACENCY (Section 1.4). Each match's tier (3 vs.
   4-line vs. 5) is evaluated on its OWN tile count and shape in isolation. Two
   adjacent/touching 3-matches do NOT combine into a 4- or 5-match even though
   their combined tile count is >=4. No blob-merging in the PoC; 4- and 5-matches
   are straight lines only.

10. CHARGE != DAMAGE FORMULA (Section 1.4). Damage uses the 3/4/5 multiplier
    table; charge does NOT — charge is always flat: +1 per destroyed tile
    matching a unit's bound color, +1 per destroyed tile matching its bound
    shape, additively, capped at the unit's cost (overflow discarded on add).

11. CASCADE "STEPS" (Section 1.5). A move/detonation resolves in discrete steps
    (initial match = step 1; each subsequent wave of falls producing new matches
    = the next step). Buff bonus is added ONCE PER STEP — not once per whole
    cascade, and not once per match within a step (multiple simultaneous matches
    in one step still get a single buff application). Each step recomputes using
    buff tiles still active at that step.

12. COUNTDOWN/BOMB RESOLUTION (Section 1.6). Countdowns tick at the START of
    their OWNER's turn, processed one at a time in PLACEMENT ORDER (oldest
    first); each detonation fully resolves — including its cascades and any tiles
    it destroys — BEFORE the next countdown ticks. A blast destroys bombs/buffs
    caught in it as NORMAL tiles (no chain detonation, no re-trigger). A same-side
    buff destroyed by a blast still counts toward THAT blast's damage, then is
    gone for later steps.

13. DISABLER TARGETING (Sections 1.10 + constants). Disabler drains the opponent
    unit with the highest RAW charge; raw charge is the only sort key (ignore
    cost and remaining-to-activation). Exact ties (effectively impossible in the
    PoC) are broken randomly among the tied units.

14. DEADLOCK HANDLING (Section 1.7). After every settle (initial board, each
    cascade resolution, each shake), run the brute-force deadlock scan: for every
    tile, tentatively swap with its east and south neighbor, test for a resulting
    match, revert. If zero possible matches exist board-wide, auto-reshuffle. The
    AUTOMATIC deadlock reshuffle must yield a board with >=1 valid move and NO
    pre-existing match. The PLAYER-TRIGGERED board-shake ability (cost 3, starts
    charged) IS allowed to land on a board that already has matches (intentional
    cascade payoff). Both reshuffles reposition all tiles including special tiles,
    but special tiles retain their color/shape/owner/duration data.

=== INPUT, LAYOUT & UI FLOW (Section 1.12) ===

15. Layout: MTGPQ-style — gem board on the BOTTOM, unit/status info (both HP
    pools, 4 player program indicators with charge, 4 enemy minion indicators
    with always-visible charge meters) on TOP.

16. Board input: swaps are ORTHOGONALLY ADJACENT only (never diagonal, never
    non-adjacent). Support BOTH:
    - Tap/click: tap selects a tile (clearly highlighted); tapping a non-adjacent
      tile moves the selection; tapping an adjacent tile attempts a swap.
    - Press-and-drag: drag a tile toward an adjacent tile to attempt a swap; drag
      toward a non-adjacent tile / release on empty or origin does nothing.
    Every attempted swap ANIMATES as attempted. If it makes >=1 valid match it
    resolves; if not, it reverts (animate back) WITH a brief "no match" notice,
    and does NOT consume the turn (player stays in the make-a-match phase).

17. Abilities fire via a SEPARATE UI channel — tapping a charged program
    indicator in the top info area, never through gem selection. The two input
    channels must not be conflated. (Abilities may only fire in the pre-match
    phase of the player's turn, per 1.6.)

18. Pause menu: a battle-screen menu button opens a dialog with Reset (restart
    the match from its scenario) and Quit (return to title/scenario select).
    Available ONLY during the player's make-a-match phase (not mid-cascade, not
    mid-ability-resolution, not during the enemy phase).

19. Game-over dialog: on match end, show who won (player victory / defeat), then
    offer the same Reset / Quit options as the pause menu.

=== AFTER BUILDING ===

Verify: both scenarios run to a win and a loss respectively without crashing; no
negative-HP display; the board never sits in a no-valid-move state without
auto-reshuffling (use the Section 1.7 deadlock scan as your test); invalid swaps
revert without consuming the turn; abilities cannot be fired after the match is
committed. Then report the agent-discretion choices you made (rule 7) for review.

Ask clarifying questions before coding if anything in Section 1 is ambiguous. Do
not silently expand scope — smaller and exactly-to-spec is correct.
```

# Coding Agent Prompt — MK2 Iteration (Ready to Paste)

```
This is a second iteration on the existing, working "Breach" PoC. The build
from Section 1 of breach-poc-requirements.md is already complete and running.
Now implement "Section 1-MK2: Post-PoC Revisions" from that same document.

Read Section 1-MK2 in full before making changes. It has four parts:

1. MK2.1 — Shape rendering: standard-tile shapes become a WHITE fill with a
   1px outline in that tile's own darker gem color; ALSO add a 1px darker
   outline around each tile itself. Neutral tiles are unchanged. Whitebox
   scope still applies — this is minimal primitive rendering, not an art pass.

2. MK2.2 — Board-shake becomes a pure anti-lock reshuffle: no damage, no
   charge, no cascades. It now behaves identically to the automatic deadlock
   reshuffle (guaranteed >=1 valid move, NO pre-existing match). REMOVE the old
   "player shake may land on existing matches for a cascade payoff" behavior.
   Cost, starts-charged, and neutral-match replenishment are unchanged.

3. MK2.3 — Per-battle metrics. Collect them in the PURE LOGIC LAYER via events
   emitted by the turn/ability/detonation resolver — NOT scraped from the UI —
   so they stay portable and can later run headless in batches. Track the
   metric list in MK2.3 for BOTH sides. Display them on the game-over screen,
   below the existing win/loss indicator and Reset/Quit controls, in a
   scrollable area (mobile portrait), player-side metrics first, enemy second.
   Plain text rows, default fonts, no charts.

CRITICAL:
- These are DELTAS on top of Section 1. Do not rebuild working systems. Where
  MK2 conflicts with Section 1, MK2 wins; everything else in Section 1 stays.
- NO new gameplay mechanics. MK2 is refinement + one simplification + metrics
  tooling only. Do not add anything not written in Section 1-MK2.
- Keep the logic/render separation intact — metrics especially must live in
  the logic layer.
- Constants stay in the single constants module.

Before coding, tell me: any clarifying questions, and a one-line plan for where
the metrics collector will hook into the existing resolver. Then wait for my
go-ahead. After building, confirm the shake no longer deals damage/charge and
that metrics display correctly on both a win and a loss.
```

# Coding Agent Prompt — MK3 Iteration (Ready to Paste)

```
This is a third iteration on the existing, working "Breach" build in this repo.
Section 1 (PoC) and Section 1-MK2 are already complete, verified, and committed.
Now implement "Section 1-MK3: Combat Cohesion Pass" from breach-poc-requirements.md.

Read Section 1-MK3 in full before making any changes, including its intent note
(the goal is combat COHESION and a second tuning dataset — NOT perfect balance;
do not chase balance, do not add mechanics beyond what is listed).

The changes, by area:

1. MK3.1 CONSTANTS — halve match damage (low 2->1, high 4->2, neutral 3->2;
   charge values unchanged); Attacker damage 15->30; bomb countdown 3->2 and
   blast radius from 4-orthogonal to the full 3x3 (8 surrounding tiles + the
   bomb tile). Add a named constant for the blast pattern. All existing blast
   rules unchanged.

2. MK3.2 DISABLER — the PLAYER's Disabler is now player-TARGETABLE (player picks
   which enemy minion to discharge; use existing ability-input conventions from
   1.12; targeting UX is yours to design well). The ENEMY's Disabler uses a
   fixed PREDICTABLE rule: hit the player's highest-COST program that has any
   charge, tie-break by highest raw charge then random. Document the rule in
   comments. This is the only non-trivial code change in the pass.

3. MK3.3 BLOB/MERGE MATCHING — port the proven straight-line-detect ->
   merge-adjacent-same-type-matches algorithm (from the Match3Single reference
   already discussed). REQUIRED ADAPTATION: tiles here have INDEPENDENT color
   and shape and match on either axis, so base-match detection runs PER AXIS
   (color-runs and shape-runs separately), and the merge step is AXIS-AWARE —
   color-matches and shape-matches are different match-types and must NOT merge
   into each other; only same-axis same-value matches merge. RECOMMENDED: wrap
   the merge in a repeat-until-no-merges loop (~3 lines) to handle multi-way
   merge chains. DO NOT micro-optimize the O(n^2) merge — it is correct and
   negligible at 8x8; keep it naive. This makes non-linear 4/5 matches exist so
   the existing 1.5x crit finally fires. Confirm per-tile dedup + highest-
   multiplier-wins still hold on blob results.

4. MK3.4 BOT AI — in the smoke/batch harness only, upgrade the bot from
   first-found-move to: prefer any move that makes a 4-match (or larger / a
   line clear), else fall back to first-found. NO cascade look-ahead, NO
   5-prioritization, NO board evaluation. The bot must stay a deliberately weak
   floor indicator.

5. MK3.5 METRICS — extend the batch/headless harness to SPLIT all aggregated
   metrics by battle OUTCOME (won vs lost), and surface the overall bot
   win/loss rate prominently as the primary calibration number. Still
   logic-layer / event-sourced. The single-battle game-over screen is unchanged.

6. MK3.6 VISUALS (whitebox, minimal) — center the special-tile indicator/
   countdown in the shape glyph; add a black outline around white player-owned
   markers (minor glyph expansion/overlap OK); flip font sizing everywhere to
   "as large as fits the designated area" rather than as small as possible. DO
   NOT do the board-to-top / units-on-edges layout overhaul — that is deferred.

CRITICAL:
- These are DELTAS on top of the existing build. Do not rebuild working systems.
  Where MK3 conflicts with an earlier section, MK3 wins; everything else stays.
- NO new mechanics beyond those listed. No combat-identity pivots, no charging-
  model changes, no overcharge, no wildcard tiles, no hero-ability redesign —
  all explicitly parked (see MK3 "Out of scope").
- Keep logic/render separation intact. Blob matching and metrics live in the
  logic layer. Constants stay in the single constants module.
- Keep MK2 as a clean restore point (it is committed) — these changes should be
  reviewable as their own diff.

Before writing code, tell me: (1) any clarifying questions; (2) your one-line
plan for the two-axis base-match detection (how color-runs and shape-runs are
scanned and tagged so the merge stays axis-aware); and (3) your one-line plan
for the player Disabler targeting UX. Then wait for my go-ahead. After building,
report: crit share of match damage (should rise well above ~0.2%), the bot
win/loss rate, and confirm the outcome-split metrics render in the batch output.
```

# Coding Agent Prompt — MK4 Iteration (Ready to Paste)

```
This is a fourth iteration on the existing, working "Breach" build in this repo.
Sections 1, MK2, and MK3 are complete, verified, and committed. Now implement
"Section 1-MK4: Persistence, Logging & Visual Pass" from breach-poc-requirements.md.

Read Section 1-MK4 in full first. No gameplay/combat changes in this pass — it is
persistence, logging, and one visual fix only.

1. MK4.1 SAVE/RESTORE — continuously autosave the in-progress battle (serialize
   the LOGIC-LAYER state to JSON; renderer rebuilds on restore). Default storage
   localStorage; your choice if size warrants IndexedDB (save and logs may split
   stores). CLEAR the save the moment a win/loss is reached (not on next load).
   Write a save-format VERSION STAMP into the state; on resume, an incompatible/
   missing version is treated as no-valid-save and fails gracefully (never crash).

2. MK4.2 CONTINUE — add a Continue affordance to the EXISTING scenario selector
   (do NOT build a separate title screen). Show Continue only when a valid,
   version-compatible in-progress save exists; it resumes that battle. Starting a
   New Game / picking a scenario WIPES any resident save (this is also the
   escape hatch for a corrupt save — no separate clear button).

3. MK4.3 LOGGING — reuse the SAME logic-layer event stream the metrics collector
   already uses (do not build a parallel pipeline). Tier 1: append each completed
   battle's final metrics to a persisted append-only log. Tier 2: record one
   action+outcome entry per turn, enough to reconstruct the turn without a full
   board snapshot. Tier 3 (full board snapshots): DO NOT BUILD, parked. Log
   PRESENTATION (viewers/charts/export UI): OUT OF SCOPE — record only, read via
   devtools/console.

4. MK4.4 VISUAL — render tiles as colored ICONS: enlarge the shape to fill the
   tile so its silhouette sits near the edges, freeing the tile CENTER so the
   centered special/countdown indicators (MK3.6) no longer overlap the shape.
   Whitebox scope; neutral tiles unchanged.

CRITICAL:
- DELTAS on top of the existing build. Do not rebuild working systems. Where MK4
  conflicts with an earlier section, MK4 wins; everything else stays.
- NO combat/gameplay changes. Persistence + logging + one visual fix only.
- Keep logic/render separation intact — save serialization and logging live in
  the logic layer. Constants stay in the constants module.
- Reuse the existing metrics event stream for logging; do not create a second one.
- Keep MK3 as a clean committed restore point.
- NOTE: enemy starting HP is manually set to 350 in constants — leave it as-is.

Before coding, tell me: (1) any clarifying questions; (2) a one-line plan for
what the serialized save state includes and where the version stamp lives; and
(3) confirmation that Tier 1/Tier 2 logging will hook the existing metrics event
stream, not a new one. Then wait for my go-ahead. After building, verify: a
mid-battle reload resumes exactly (board, HP, charges, countdowns, buffs); a
finished battle clears the save so Continue is absent; an incompatible-version
save fails gracefully; and both log tiers are written and readable via console.
```
