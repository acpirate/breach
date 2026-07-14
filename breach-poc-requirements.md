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

# Section 1-MK5: Enemy Matching + Configurable Battle Modifiers (BUILD THIS, ON TOP OF MK4)

Assumes Sections 1, MK2, MK3, MK4 are built and working. Each item is a DELTA against the current build — where MK5 conflicts with an earlier section, MK5 governs; everything not mentioned is unchanged. Section 2 (Roadmap) remains out of scope.

**Intent (context, not a build instruction):** Two things. (1) The headline mechanic: the enemy stops being a passive threat-clock and becomes a real opponent that matches on the shared board — testing whether a matching enemy *feels* like an opponent. (2) A set of defaulted-off, per-battle configuration flags that turn several parked design questions into cheap, flippable experiments, and which double as the skeleton for future run-variety ("battle types" with different rules). No new abilities, no unit HP/KO, no action-point economy — those are separate future work.

## MK5.1 Enemy matching (the headline mechanic)

When enabled (see `ENEMY_MATCHING` flag in MK5.2), the enemy becomes a **pure symmetric mirror** of the player:

- **The enemy's fixed +N/turn charge clock is REMOVED.** All enemy units now charge from MATCHING, exactly as the player's programs do (per-tile, per the existing flat charge rules). The `*_ENEMY_CHARGE_RATE` constants become inert when this flag is on.
- **Same bindings:** enemy units charge off the SAME color+shape pairs as the player's corresponding programs. Both sides therefore compete for the same tiles on the shared board. This is intentional — the tile contention IS the interactivity being tested.
- **Shared board:** unchanged. One grid, both sides match on it.
- **The enemy turn becomes a REAL turn**, structurally identical to the player's: fire any/all charged abilities (pre-match) → make exactly one match → the match and its cascades resolve (damage, charge, detonations) → turn passes. The enemy's match resolves under all the same rules as the player's (per-destroyed-tile dedup, tier/crit multipliers, blob merging, buff bonuses, etc.).
- **Enemy brain = the EXISTING bot** (the MK3.4 "prefer a 4-match if available, else first-found" logic), repointed to play for the enemy side. Do NOT write a new AI. The move-selection heuristic is side-agnostic; parameterize the existing bot by which side it is playing for. The bot's tier is therefore also the enemy's difficulty knob (future work — not a setting in this pass).
- When `ENEMY_MATCHING` is OFF (the default), the enemy behaves exactly as it does today: fixed charge clock, no board matching. Both paths must work.

## MK5.2 Battle configuration flags

Four per-battle flags. **All defaults preserve current behavior EXCEPT `HACKER_BONUS_ENABLED`, which defaults to OFF (a deliberate change — see below).**

| Flag | Default | Effect when set |
|---|---|---|
| `ENEMY_MATCHING` | **OFF** | Enemy matches on the shared board and charges from matches (MK5.1). Off = current timer-clock enemy. |
| `HACKER_BONUS_ENABLED` | **OFF** (changed) | On = the Hacker's +`HACKER_BONUS_DAMAGE`/+`HACKER_BONUS_CHARGE` bonus on its designated high color applies (current behavior). **Off = no Hacker color bonus at all** — every color is symmetric. |
| `SINGLE_AXIS_PAYOUT` | **OFF** | On = a match pays out only on the axis it was matched on: a COLOR-match charges/damages only via color; a SHAPE-match only via shape. Off = current behavior (a match pays out on both axes). |
| `MAX_CASCADE_STEPS` | **Infinite** | An integer cap on cascade depth. When capped at N, tiles still fall and refill after step N, but those falling tiles produce NO new matches (resolution stops). See MK5.3 for the 0 case and the UI. |

**Why `HACKER_BONUS_ENABLED` defaults OFF:** the Hacker's flat color bonus is an arbitrary placeholder that distorts the charge/damage economy (it is a major reason the Bomber over-charges, and it makes one color asymmetric). Defaulting it off gives a clean, symmetric baseline for reading data. It is preserved as a flag so build-identity effects can be revisited later. NOTE: this means the first battle after MK5 ships will play differently from MK4 even before any flag is touched — this is intended, not a bug.

**`SINGLE_AXIS_PAYOUT` — required edge-case ruling (state explicitly, do not guess):** a single destroyed tile may participate in BOTH a color-match and a shape-match in the same resolution (they are separate matches — cross-axis matches never merge — but the tile belongs to both). Under dedup the tile is destroyed once. Under `SINGLE_AXIS_PAYOUT`, that tile **pays out on BOTH axes**, because the flag restricts payout PER MATCH, not per tile: the color-match pays its tiles via color, the shape-match pays its tiles via shape, and a tile in both is paid by both matches. Do not "fix" this into a single payout.

## MK5.3 Config UI

**Menu / scenario scene — configure the battle before starting:**
- All four flags are settable client-side, per battle.
- **Cascade cap control:** an **"Infinite?" toggle**. When ON (default), no cap. When OFF, an **integer input, range 0–9**, becomes active/visible.
  - **0 is explicitly VALID and means ZERO cascades**: the initial match resolves, tiles fall and refill, but no falling tile produces a new match — the board goes inert after the first resolution. This is a real, intended game mode, not an error case.
  - Internally, "infinite" must be a sentinel (null / -1 / Infinity), NOT a large integer.
  - A 0–9 range is sufficient (observed cascades have topped out around 10; 9 vs. infinite is not meaningfully different in practice).
- **"Reset to Defaults" button** — the ONLY thing that resets the config (see persistence below).

**Battle scene — the existing pause/settings menu displays the ACTIVE config, read-only.** The player can always check which rules the current battle is running under. It is not editable mid-battle.

## MK5.4 Config persistence & lifecycle

- **Config persists across sessions** (store it alongside the save, e.g. localStorage). Nothing resets it implicitly.
- **Returning to the menu does NOT reset it.** Navigation is not a reset.
- **"Reset to Defaults" is the only explicit reset.**
- **Restart (from the battle-conclusion screen) ALWAYS reuses the exact config of the battle just played**, unconditionally, regardless of what the menu config currently says. A restart is the same battle; its rules are part of its identity.

**Config is part of the SAVE STATE (critical):**
- The active config is serialized INTO the save at battle start. It is part of that battle's identity, not a global setting.
- On **Continue**, the battle resumes under **the SAVE's config**, not the menu's current config. The save's config is **authoritative and immutable** for that battle's lifetime — do NOT merge, reconcile, or update it from the menu.
- **If the save's config DIFFERS from the current menu config**, then on resuming that battle, **automatically open the existing pause/config panel at battle start**, with an explanatory line at the top — e.g. *"This battle is using the configuration it was started with, not your current settings."* — and the battle's actual active config displayed beneath it. The player must explicitly dismiss it to proceed. This is a forced **acknowledgment**, not a passive notice, so a tester cannot unknowingly play a battle under rules they think they changed.
- This auto-open triggers **only when the configs actually differ**. A resume with a matching config starts normally, with no interruption.
- When the battle ends the save clears (per MK4.1); the next new battle uses the MENU's config as normal.

## MK5.5 Logging — stamp the config

- **Every battle record — Tier 1 (final metrics) AND Tier 2 (per-turn) — must stamp the ACTIVE config** alongside the existing version stamp.
- Rationale: once flags exist, a log entry is uninterpretable without knowing which rules were active. "Abilities were 60% of damage" means nothing if you don't know whether `SINGLE_AXIS_PAYOUT` was on. The config stamp is what makes cross-config comparison possible weeks later.

## MK5.6 New metric — charge-source contention

- Track, per side: **how often that side's matches/cascades destroyed tiles bound to the OTHER side's units** (i.e. tiles whose color or shape matches an opposing unit's binding).
- Purpose: with `ENEMY_MATCHING` on and same bindings on a shared board, both sides fish the same tiles. If play feels swingy, this metric distinguishes *contention-driven* swing (each side strip-mining the other's charge sources, esp. via cascades) from mere *cascade-variance* swing. That distinction determines whether "different bindings" becomes the next experiment.
- Logic-layer / event-sourced, same as all other metrics. Include it in the batch output and the game-over metrics display.

## MK5 — Out of scope (parked)

Not in MK5: action-point turn economy; no-match-damage mode; unit HP / knockout / debuffs; additional abilities per unit (deliberately deferred — until match/ability weight is settled, more abilities are "dangling keys"); a battle-type *authoring* system (the flags exist and are settable; battle-types-as-run-content comes later); AI difficulty tiers as a setting; per-side or ability-driven cascade rules; special-tile hardening; overcharge. See Section 2 and the design backlog.

---

# Section 1-MK6: Shape Damage, No-Match-Damage, Instrumentation & QoL (BUILD THIS, ON TOP OF MK5)

Assumes Sections 1, MK2–MK5 are built and working. Each item is a DELTA against the current build — where MK6 conflicts with an earlier section, MK6 governs; everything not mentioned is unchanged. Section 2 (Roadmap) remains out of scope.

**Intent (context, not a build instruction):** MK5's enemy-matching change was the project's biggest success — the matching-denial contest is now the game's engine. Two things follow. (1) The logs show the ABILITY layer is not carrying weight (abilities are 16–33% of damage; the enemy often deals 100% of its damage via matches alone). MK6 adds the tools to fix that: a `NO_MATCH_DAMAGE` experiment, shape damage (so the two axes are real), and buffer-damage attribution so ability contribution is finally measurable. (2) Cap-0 cascades tested dramatically better than uncapped, so cap-0 becomes the new default. Plus a batch of instrumentation and QoL fixes. No new abilities, no unit HP/KO, no escalating cascade cap (that's a future headline mechanic).

## MK6.1 Shape damage — make the axes symmetric

Currently COLOR carries two payloads (damage + charge) while SHAPE carries only one (charge). The axes were never symmetric; `SINGLE_AXIS_PAYOUT` exposed this (a shape-match had no damage value of its own, and the MK5 stopgap fell back to the tile's color for damage).

- **Give SHAPE its own damage tiers, mirroring color's structure.** Add `DAMAGE_PER_TILE_LOW_SHAPE` and `DAMAGE_PER_TILE_HIGH_SHAPE`, with 3 of the 6 shapes designated LOW and 3 designated HIGH (agent assigns and documents, same as the color tiers).
- **Values: symmetric with the current (MK3-halved) color values — LOW = 1, HIGH = 2.** Neutral stays as-is.
- **Damage resolution:** a COLOR-match resolves damage per tile via that tile's COLOR tier. A SHAPE-match resolves damage per tile via that tile's SHAPE tier. (This supersedes the MK5 stopgap where shape-matches used the tile's color for damage.)
- **Blob matches** are already tagged by axis (color-blob vs shape-blob), so they resolve on their own axis. Unchanged.
- **Charge is unchanged** (still flat 1 per qualifying tile per axis).
- **DESIGN NOTE (do not implement):** a deliberately ASYMMETRIC version (shape = economy axis, low/no damage; color = aggression axis) is an attractive future direction tied to faction identity — but MK6 uses the SYMMETRIC version deliberately, so `SINGLE_AXIS_PAYOUT` can be read without a "color is obviously better" confound.

## MK6.2 `NO_MATCH_DAMAGE` flag (new config flag, default OFF)

The top experiment. Tests whether the ability layer can carry the game while PRESERVING the matching-denial contest that makes the game good.

- When ON: **matches deal ZERO damage** (color-matches and shape-matches alike).
- **Match CHARGE is UNCHANGED** — still flat per-tile, both axes. This is the whole point: the denial contest survives because both sides are still fighting over the same tiles, just for charge instead of damage.
- **Abilities become the only damage source.**
- **CRITICAL CARVE-OUT — bomb detonations STILL deal their normal per-destroyed-tile damage.** A detonation is an ABILITY effect, not a match. Do NOT implement this as "destroyed tiles deal no damage" — that would silently gut bombs, which are the best-performing ability in the game. The rule is specifically: *matches* deal no damage; *detonations* are unaffected.
- **Buffer's damage bonus applies to ABILITY damage only** when this flag is on (its match-damage half is inert, since match damage is zero).
- Crit multipliers become moot for damage (nothing to multiply). No special handling needed — just confirm nothing divides-by-zero or crashes on a zero base.

## MK6.3 Cap-0 cascades become the DEFAULT

- **`MAX_CASCADE_STEPS` now DEFAULTS TO 0** (was: infinite/sentinel). The "Infinite?" toggle and the 0–9 integer input remain exactly as built in MK5.3 — only the DEFAULT changes.
- Rationale (context): cap-0 tested dramatically better — the board stays stable, so deliberate board manipulation (denying the opponent a 4-match, reading post-match position) is far more tactically satisfying; special tiles SURVIVE instead of being cascaded away; ability share of damage rose from 16–20% to 21–33%; battles got longer and much closer (variance moved from "who got the lucky cascade" to "who played better"). Dual-axis matching still prevents deadlock, so stability costs nothing in playability.

## MK6.4 Expose HP as config parameters, and collapse the scenario selector

- **Add `PLAYER_STARTING_HP` and `ENEMY_STARTING_HP` to the per-battle config** (settable on the menu screen, alongside the existing flags; persisted and stamped into the save and logs like every other config value).
- Rationale: with the sides now symmetric (MK5), **HP is the dominant balance lever** — but it currently requires an edit-and-rebuild to change. Exposing it allows dialing 150v350 → 200v200 → 250v250 between battles to find where the fight actually lives.
- **REMOVE the forced-loss scenario.** It existed only because there was no other way to force-test the loss path — it was a workaround for a missing knob. With HP exposed, "player starts at 1 HP" is simply a config you set.
- **Collapse the scenario selector to a single "Play" button.** The menu screen is now: the config controls (flags + HP) and a Play button (plus Continue when a valid in-progress save exists, per MK4.2, and Reset to Defaults per MK5.3).
- Current defaults remain player 150 / enemy 350 unless changed in the menu.

## MK6.5 Character sheet (new pause-menu panel)

A reference panel in the existing pause menu, alongside the config display. It is read-only.

Contents:
- **Damage values:** per color (LOW/HIGH tiers), per shape (LOW/HIGH tiers, new in MK6.1), and neutral.
- **Charge values:** per color and per shape.
- **Unit bindings — which color + shape charges each of the 4 units — FOR BOTH SIDES.**
- **Unit costs** (7 / 13 / 19 / 22).

Rationale: (a) with two damage axes there is currently NOWHERE in the game to see what any of the numbers are — it's only playable by the person who designed them; (b) it doubles as pseudo-HELP for any player who isn't the designer; (c) it is **strategically load-bearing** — with same bindings on a shared board, reading the opponent's bindings is what tells you which tiles are contested; (d) it doubles as a debugging aid — when a flag changes payout rules, the sheet is where you SEE the rules changed rather than inferring from behavior.

**Build the display assuming the two sides' bindings MAY DIVERGE.** Different-bindings is a live future experiment and faction axis-identity would make them differ by design — do NOT hardcode a single shared table. Unit descriptions/lore can come later; values + bindings are enough.

## MK6.6 Timing metrics — think-time as an engagement proxy

- Track and log **per-turn real-time deltas** and **total battle wall-clock**.
- **What to measure (this determines whether the metric works at all):** the clock runs from **player-input-available → player-committed-a-move**. Do NOT measure turn-start to turn-start. Turn wall-clock includes cascade animations, ability resolution, and the enemy's turn — none of which is the player thinking. If you measure turn-to-turn, **cap-0 would show SHORTER think-times purely because there is less animation, inverting the signal.**
- **Log RAW per-turn timestamps. Do NOT pre-aggregate into an average.** Analysis reads the MEDIAN and spread downstream; a few 300-second outliers (player walked away, phone locked) would poison a mean but will not move a median.
- Rationale: per-turn think-time is a proxy for **how often the board is actually making the player think** — a 2-second turn was obvious; a 25-second turn was real scanning. No current metric touches this, and it is the closest thing to a fun-meter available from a log. It also lets configs be compared on the axis that matters: win rate and damage cannot tell you which mode is more engrossing, but a median think-time shift can.
- **Save/background edge cases: agent's discretion.** Either pause the clock or accept the gap — since analysis reads medians, outliers wash out either way. Do not over-engineer this.

## MK6.7 Buffer damage attribution

- Currently the Buffer's +5 is folded into whatever it amplified (match / attacker / bomb damage), so **the Buffer's entire damage contribution is invisible** — it could be contributing nothing or 60/battle and the logs would read identically.
- **Add a single per-side total: "buffer damage added."** Defined as: for each damage event, `(damage_dealt − damage_that_would_have_been_dealt_with_zero_active_buff_stacks)`, summed across the battle. This is unambiguous and correctly handles stacking (multiple buff tiles) without double-counting.
- **Do NOT add a per-source split** (buffer-on-match vs buffer-on-ability) this pass. The one scenario where the split would matter is `NO_MATCH_DAMAGE`, and there it can be inferred by comparing buffer-total with the flag off vs on.
- Include it in the batch output and the game-over metrics display, like all other metrics.

## MK6.8 Logging fixes

- **`logs:dump` pretty-printer is LOSSY — fix the formatter.** The raw JSONL is CORRECT and COMPLETE (config, version, and contention fields are all present per battle, exactly as MK5.5 specced). But the human-readable dump **strips `entry.config`, `entry.v`, and the contention fields**. The data was never lost — the view is. Fix the dump to include them. (MK6's new timing and buffer metrics must also appear in the dump.)
- **Date-stamped log files.** Roll a new log file when the dev server starts on a new day (e.g. `logs/breach-logs-2026-07-11.jsonl`). A day/session tends to be one experiment, so this makes it the natural unit of analysis instead of one growing pile needing date-filtering.

## MK6.9 Visual / UX fixes

- **Remove the tile-perimeter ownership outline on special tiles.** With MK4.4's enlarged icons, the outline around the TILE now visibly distorts the shape (squaring off corners, fighting the silhouette that was enlarged for legibility), and it is redundant — the centered badge already conveys ownership unambiguously via its own white/black fill.
  - **GUARD: keep the badge's white=player / black=enemy fill convention.** That IS the ownership signal now. Remove only the tile-perimeter outline; do not strip ownership indication entirely.
- **Make the floating damage/charge popup numbers MUCH bigger.** The current popups are tiny and dark. **Transient UI can afford to be loud precisely because it is transient** — a number that lives for a few hundred milliseconds and vanishes should be impossible to miss. Briefly occluding part of the board is acceptable and costs nothing (the player is reading the outcome of their move at that instant, not the board), whereas a number too small to read costs the feedback entirely. This is the same principle as MK3.6's font-size flip, applied to a component added afterwards.

## MK6 — Out of scope (parked)

Not in MK6: the **escalating cascade cap** (cap starts at 0 and climbs over the battle as an organic timer — a future headline mechanic, needs its own design pass); cascade-manipulation abilities; action-point turn economy; unit HP / knockout / debuffs; additional abilities per unit (still deliberately deferred — abilities must be made to MATTER before more are added); axis-identity factions (gated on the superstructure/loadout layer); overcharge and the charging-model exploration; special-tile hardening (largely superseded by cap-0); different-bindings; AI difficulty tiers. See Section 2 and the design backlog.

**Note on `SINGLE_AXIS_PAYOUT`:** already built (MK5) and tested — it produced a negative result (fewer abilities charged, so abilities mattered LESS) because it forced a choice between axes before the axes differed in kind. **Leave the flag in, defaulted OFF.** MK6.1's shape damage is what makes it potentially meaningful; retest it after this build.

---

# Section 1-MK7: Attribution, Cost Curve & Instrumentation (BUILD THIS, ON TOP OF MK6)

Assumes Sections 1, MK2–MK6 are built and working. Each item is a DELTA against the current build — where MK7 conflicts with an earlier section, MK7 governs; everything not mentioned is unchanged. Section 2 (Roadmap) remains out of scope.

**Intent (context, not a build instruction):** MK7's theme is **fix the instruments before running the experiment.** Sixteen logged human battles revealed that the metrics have been lying in several specific, identified ways — bomb cascade damage is miscredited to matches, buffer damage is double-represented, and deterministic tile-settling is being counted as "cascades" alongside genuine RNG payouts. Separately, the ability cost curve (7/13/19/22) was priced for a 350-HP game and never re-priced: at the current 100–150 HP, **the 19-cost Attacker fired in 2 of 16 battles and the 22-cost Disabler fired ZERO times, ever.** Expensive abilities aren't underpowered — they're *unreachable*. MK7 fixes the attribution, exposes cost as config, and adds a flat-cost diagnostic mode so ability EFFECTS can finally be evaluated independently of their FIRING RATE. No new abilities, no new units, no loadout screen — those come next, on corrected numbers.

## MK7.1 Ability cost as config + `FLAT_ABILITY_COST` diagnostic (TOP PRIORITY)

- **Expose the four ability costs as per-battle config values** (settable on the Settings screen, persisted, stamped into save and logs like every other config value). Current defaults remain 7 / 13 / 19 / 22 (Bomber / Buffer / Attacker / Disabler).
- **Add a `FLAT_ABILITY_COST` diagnostic flag (default OFF). When ON, ALL FOUR units cost 7.**
- **Why:** the four abilities currently differ on TWO dimensions at once — what they DO (effect) and how often they FIRE (cost). So "is Disabler good?" is unanswerable: you cannot separate "weak effect" from "never fires." Flattening cost collapses the confound — every unit fires at the same rate, so any difference in contribution is purely a difference in EFFECT.
- **Secondary benefit:** it also rescues the `SINGLE_AXIS_PAYOUT` experiment. Feeding shape-over-color is currently not a strategic tradeoff but a SCALING problem — trading "1/7th of a bomb" against "1/22nd of a disable" is a choice between RATES, not EFFECTS. Equal costs make it a genuine choice about what you get.
- **NOTE (context, not an instruction):** flat-7 will likely produce unbalanced, swingy, or very short battles. **That is expected and fine.** It is a diagnostic config, not a shipping one. Its purpose is to reveal RELATIVE ability contributions, not to play well.

## MK7.2 Redefine "cascade" — deterministic settling is NOT a cascade (metric fix, NO gameplay change)

Two mechanically different things are currently both counted as "cascades":

- **Existing tiles falling into gaps and forming matches = DETERMINISTIC.** Fully determined by the board state plus the player's swap. A skilled player can see it coming. It is part of the move they chose. **This is NOT a cascade.**
- **Newly-generated RANDOM tiles falling in from the top and forming matches = STOCHASTIC.** Unpredictable. **This is the ONLY thing that should count as a "cascade."**

- **This is a NAMING/METRIC correction only — do NOT change any gameplay behavior.** `MAX_CASCADE_STEPS` already gates only the stochastic refill rounds (deterministic settling already resolves regardless of the cap); that behavior is correct and stays exactly as-is. Only the *counter* and the *damage attribution* change.
- The cascade-depth metric must now count only stochastic-refill rounds. (Expect reported cascade depths to drop — that is the fix working.)

## MK7.3 Damage attribution model (settled — implement exactly this)

**Governing principle: damage rolls up to the ACTION THAT INITIATED THE CHAIN. The mechanism does not determine the bucket; the CAUSE does.**

**Four DISJOINT causal buckets, which must sum exactly to total damage:**

| Bucket | Contents |
|---|---|
| **`match`** | The swap-initiated match + its deterministic settling + its stochastic refill-cascades. (All of it was caused by the player's swap.) |
| **`bomb`** | The explosion + its deterministic settling + its stochastic refill-cascades. (All of it was caused by the bomb.) **Roll bomb-cascades INTO bomb damage — do NOT split them into a separate column.** |
| **`atk`** | Direct Attacker damage. |
| **`buffer`** | The Buffer's damage contribution — see MK7.4. |

- **This corrects a real error:** bomb-caused cascade damage is currently miscredited to the `match` column, which inflates match damage and understates bomb damage. The misattribution scales with how board-disruptive an ability is, so it will only get worse as more board-altering abilities are added.
- Implementation: tag the resolution chain with its initiating cause. Whatever *initiates* a resolution (player swap / bomb detonation / any future board-altering ability) stamps its cause, and every settling and cascade step descended from it **inherits** that cause. Damage then rolls up by cause.
- **Do NOT build separate per-source cascade columns** (e.g. "bomb-cascade damage"). There is no live tuning question that such a column would answer. The causal tagging makes it trivial to add later if that changes.

**Plus ONE cross-cutting measure (overlaps the causal buckets; does NOT sum with them):**

- **`cascadeDamage`** = ALL damage from STOCHASTIC REFILL matches, **regardless of what caused them**. This overlaps `match` and `bomb` rather than being disjoint from them — the same reporting shape as `bufferAdded`.
- **Why:** it is the one number needed to answer *"how much damage is coming from unearned RNG refills?"* (MPQ precedent: cascade matches deal diminishing damage, precisely because they're unearned.) Having this single line makes "should cascades pay less?" a tunable question instead of an invisible one — without proliferating per-source columns.

## MK7.4 Buffer damage as a disjoint column

- `bufferAdded` is currently reported separately **but its contribution is ALSO baked into the `match`/`atk`/`bomb` totals** — so it is double-represented and the columns do not decompose cleanly.
- **Make Buffer a genuine disjoint bucket**, so that `match + bomb + atk + buffer = total`, with every column a non-overlapping contribution.
- Definition is unchanged from MK6.7: buffer damage = for each damage event, `(damage_dealt − damage_that_would_have_been_dealt_with_zero_active_buff_stacks)`, summed. It is now *subtracted out* of the other buckets rather than left inside them.

## MK7.5 Log the match AXIS (color vs shape)

- Record, per match, **which axis it resolved on** (color-match vs shape-match), and split match damage accordingly: **`matchDamage_color` vs `matchDamage_shape`**.
- **This is primarily a BEHAVIORAL question, not a correctness check.** Color is pre-attentively salient; shape requires serial visual search. **The player may be an unconscious color-matcher.** If matches run 85/15 in favour of color, then the shape axis is functionally decorative for the player regardless of what the code does — and the entire dual-axis premise is not delivering the strategic value it was designed for. **This is arguably THE open question about whether the dual-axis board is doing anything.**
- Secondary benefit: because MK6 made the tiers symmetric (both 1/2), a regression in the shape-damage path would currently be **invisible** in the totals. This makes it detectable.

## MK7.6 New damage metrics — biggest ROUND and average round (nonzero)

- **Biggest ROUND damage** — the largest total damage dealt in a single round (ability + match + cascade stacked), as distinct from the existing biggest-HIT. This is the real **swinginess** indicator.
- **Average round damage where > 0** — the general **effectiveness** indicator. Explicitly exclude zero-damage rounds; including them would drag a naive mean toward zero and obscure the signal.
- Together these give ceiling AND baseline, which is what's needed to reason about pacing and swing. Both per side, in the batch output and the game-over display.

## MK7.7 Hint system (configurable, DEFAULT OFF)

- After a configurable delay (**default 7 seconds**) with no player input, highlight an available 4-match if one exists. Standard genre feature.
- **Default OFF.** Settable (on/off + delay) in Settings.
- **Log whether a hint fired on each turn.** This is required: a 7-second hint compresses the think-time distribution and would destroy its value as an engagement proxy (MK6.6). Hint-assisted turns must be **excludable** from think-time analysis.

## MK7.8 Debug-only "find match" button

- A debug-build-only button that finds and highlights an available match, so the human tester can move through games faster while still directly observing them.
- Debug builds only — must not appear in a normal build.

## MK7.9 Shake becomes a PERMUTATION, not a re-randomization

Supersedes the shake behavior from MK2.2 / MK5.

- **The shake now REARRANGES the existing tiles on the board rather than generating new ones.** The board's *composition* (which tiles exist) is preserved exactly; only their *positions* change.
- **The validity contract is UNCHANGED:** the resulting board must still have at least one valid move and NO pre-existing match. A permutation of a bad board could land in a deadlock, so the re-permute-until-valid loop must remain.
- Special tiles continue to persist through the shake (retaining color / shape / owner / duration), as before.
- **Rationale:** (a) it makes shake a **positional** tool rather than an **economic** one — you can no longer shake your way to *more* of a colour you need, only to a better arrangement of what you have; (b) it removes a hidden reroll-the-economy exploit (a bad-composition board currently gets rerolled; now you must play through it); (c) **critically, it is the right behaviour BEFORE board-tuning abilities exist** — a future ability that converts tiles toward your colour would be *undone* by a re-randomizing shake, which would punish exactly the play it should reward. A permuting shake preserves that investment.

## MK7.10 Menu / Settings UI restructure

- **Rename the "Play" button to "New Game."** Clearer, and it names the consequence (starting a new game wipes any resident save, per MK4.2). **No confirmation dialog** — see the design note below.
- **Move the battle config out of the title screen and into its own "Settings" modal**, reached by a new **Settings** button. The title screen currently carries Continue, Play, four flags, two HP fields, a cascade toggle and Reset — a settings panel that ate a menu, and it will only get worse (MK7 alone adds cost config, a hint toggle and a hint delay).
- **Title screen becomes: New Game / Continue (when a valid save exists) / Settings.** Actions only.
- **Settings modal contains:** all battle config (flags, HP, ability costs, hint on/off + delay, cascade cap) plus **Reset to Defaults**.
- **The battle pause menu keeps its read-only config review and the character sheet as reference panels BELOW the action buttons.** Same principle: actions first, reference below.
- **Settings is NOT reachable mid-battle.** Config is immutable for a battle in progress (it is baked into the save; changing rules mid-fight is incoherent). Offering an editable control that cannot do anything would be worse than not offering it. The pause menu's read-only config review already covers "what am I playing under?"

**Design note — confirmation dialogs (standing principle, applies here and in future):** confirmations are reserved for actions with meaningful real-world consequences. Every trivial confirm acclimates the user toward dismissing dialogs unthinkingly, which degrades the *important* ones. Losing an in-progress PoC battle is annoying, not consequential. **Do not add a confirm to New Game.**

## MK7.11 Bug — board stays rendered behind the title screen after Quit

- On Quit, the render layer is not torn down or reset, so the board's last frame remains visible behind the title menu.
- Cosmetic, but it reads as unfinished and sends an ambiguous signal (the visible board implies the battle is still running — which, since Continue still holds it, is *semi*-true).
- **Fix:** clear the board render on quit. (Optionally, dimming/blurring it instead would be *more* truthful, since Continue is right there offering to resume — but clearing is the cheaper fix and is sufficient.)

## MK7.12 Constrain the desktop/web view to the phone's aspect ratio

- The game is a mobile-first portrait experience, but it is currently also being viewed and tested at desktop aspect ratios. **Letterbox the game into a fixed-aspect container matching the target phone's vertical aspect ratio, centered in the viewport** (dead space either side on wide screens).
- Rationale: right now UI is effectively being tested at two different aspect ratios and only one of them is the real target — a layout that looks fine on a wide desktop viewport could be broken on the phone and go unnoticed. Constraining the desktop view means **every test is a phone test, regardless of the device being used.**
- This is a CSS containment change, not a layout rework.
- **Explicitly deferred:** a proper wide/tablet/landscape layout that takes advantage of desktop aspect ratios. That is a release-time content decision (it would mean redesigning the HUD for landscape), and building it now would mean maintaining two layouts through every subsequent UI change.

## MK7.13 Bot heuristic — add a charge-aware tier for `NO_MATCH_DAMAGE`

- **The bot's `prefer-4` heuristic is a DAMAGE heuristic.** Under `NO_MATCH_DAMAGE`, matches deal no damage — so the bot is optimizing for something that no longer exists. Observed: in an NMD battle the enemy bot fired 6 bombs for **zero total damage** (a churning board destroyed them all before they could detonate) and never adapted; it lost 126–30 to a human who had adapted to the mode.
- **Consequence: NMD win rates are currently meaningless as balance data** — the human is playing a different game from the bot.
- **Fix: add one more heuristic tier for use when `NO_MATCH_DAMAGE` is on — "prefer matches that feed my units' bindings" (i.e. match for CHARGE, not damage).** This is not a full AI upgrade; it is one additional selection rule, chosen when the flag is set.
- Keep the existing tiers intact for non-NMD play. The bot must remain a deliberately weak floor indicator; this only stops it from optimizing for a quantity that does not exist.

## MK7 — Out of scope (parked)

Not in MK7: **new units** and the **loadout screen** (deliberately deferred — design them against CORRECTED numbers, after MK7's attribution fixes and the flat-cost experiment reveal what the existing abilities are actually worth); unit variants; enemy loadout sandbox; the escalating cascade cap; cascade-manipulation abilities; the "sensory corruption" axis-blind debuff; action-point economy; unit HP / knockout; axis-identity factions; overcharge; different-bindings; AI difficulty tiers. See Section 2 and the design backlog.

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

# Coding Agent Prompt — MK5 Iteration (Ready to Paste)

```
This is a fifth iteration on the existing, working "Breach" build in this repo.
Sections 1, MK2, MK3, and MK4 are complete, verified, and committed. Now implement
"Section 1-MK5: Enemy Matching + Configurable Battle Modifiers" from
breach-poc-requirements.md.

Read Section 1-MK5 in full before making changes, including its intent note. This
is the biggest build since the PoC. Two parts: (1) the enemy becomes a real
matching opponent, and (2) four per-battle config flags that make several design
questions cheaply testable.

1. MK5.1 ENEMY MATCHING — when the ENEMY_MATCHING flag is on: remove the enemy's
   fixed +N/turn charge clock; ALL enemy units charge from MATCHING, exactly like
   the player's programs (same per-tile flat charge rules). Enemy units use the
   SAME color+shape bindings as the player's corresponding programs (both sides
   compete for the same tiles on the shared board — this contention is intentional).
   The enemy turn becomes a REAL turn, structurally identical to the player's:
   fire charged abilities pre-match -> make exactly one match -> resolve the match
   and its cascades under all the same rules (dedup, tiers/crits, blob merging,
   buffs). REUSE THE EXISTING BOT (the MK3.4 prefer-4-else-first-found logic) as
   the enemy's brain — do NOT write a new AI; the heuristic is side-agnostic, so
   parameterize the existing bot by which side it plays for. When the flag is OFF
   (the default) the enemy behaves exactly as it does today. BOTH paths must work.

2. MK5.2 CONFIG FLAGS — four per-battle flags:
   - ENEMY_MATCHING (default OFF)
   - HACKER_BONUS_ENABLED (default OFF — a DELIBERATE change; off means no Hacker
     color bonus at all, giving a clean symmetric baseline. The first battle after
     MK5 will therefore play differently than MK4 even with no flags touched. This
     is intended.)
   - SINGLE_AXIS_PAYOUT (default OFF; on = a color-match pays out only via color,
     a shape-match only via shape)
   - MAX_CASCADE_STEPS (default INFINITE, via a sentinel — null/-1/Infinity, NOT a
     large integer)
   REQUIRED EDGE-CASE RULING, do not guess: under SINGLE_AXIS_PAYOUT, a tile that
   is in BOTH a color-match and a shape-match in the same resolution is destroyed
   once (dedup) but PAYS OUT ON BOTH AXES — the flag restricts payout per MATCH,
   not per tile. Do not collapse this to a single payout.

3. MK5.3 CONFIG UI — on the menu/scenario scene, all four flags are settable per
   battle. Cascade cap uses an "Infinite?" toggle; when OFF, an integer input of
   range 0-9 becomes active. ZERO IS VALID AND MEANS ZERO CASCADES (the initial
   match resolves, tiles fall/refill, but nothing that falls can match — the board
   goes inert). Add a "Reset to Defaults" button. On the BATTLE scene, the existing
   pause/settings menu displays the ACTIVE config, read-only (not editable in-battle).

4. MK5.4 CONFIG PERSISTENCE — config persists across sessions and across returns to
   the menu; NOTHING resets it implicitly. "Reset to Defaults" is the only explicit
   reset. RESTART from the battle-conclusion screen ALWAYS reuses the exact config of
   the battle just played, unconditionally.
   CRITICAL — CONFIG IS PART OF THE SAVE STATE: serialize the active config into the
   save at battle start. On Continue, the battle resumes under THE SAVE'S config, not
   the menu's — the save's config is authoritative and immutable for that battle's
   lifetime (never merge/reconcile from the menu). If the save's config DIFFERS from
   the current menu config, then on resume AUTOMATICALLY OPEN the existing pause/config
   panel at battle start, with an explanatory line at top ("This battle is using the
   configuration it was started with, not your current settings.") and the battle's
   actual config shown beneath. The player must dismiss it to proceed — a forced
   acknowledgment, not a passive notice. Only trigger this when the configs actually
   differ.

5. MK5.5 LOGGING — stamp the ACTIVE CONFIG into every battle record, Tier 1 and Tier 2,
   alongside the existing version stamp. Without it, flagged battles produce data that
   cannot be attributed later.

6. MK5.6 NEW METRIC — charge-source contention: per side, how often that side's
   matches/cascades destroyed tiles bound to the OTHER side's units. Logic-layer /
   event-sourced like all other metrics; include in the batch output and the game-over
   metrics display.

CRITICAL:
- DELTAS on top of the existing build. Do not rebuild working systems. Where MK5
  conflicts with an earlier section, MK5 wins; everything else stays.
- NO new abilities, NO unit HP/knockout, NO action-point economy, NO no-match-damage
  mode, NO battle-type authoring system — all explicitly parked (see MK5 "Out of scope").
- Reuse the existing bot for the enemy brain. Reuse the existing pause panel for the
  config display. Reuse the existing metrics event stream for the new metric and the
  config stamping. Do not build parallel systems.
- Keep logic/render separation intact. Constants/flags in the constants module; the
  per-battle config is runtime state passed at battle start (and serialized into the save).
- Keep MK4 as a clean committed restore point.
- NOTE: enemy starting HP is manually set to 350 in constants — leave it as-is.

Before writing code, tell me: (1) any clarifying questions; (2) your one-line plan for
parameterizing the existing bot to play either side; and (3) your one-line plan for where
the per-battle config lives at runtime and how it gets into the save envelope. Then wait
for my go-ahead.

After building, report: the bot win/loss rate with ENEMY_MATCHING on vs off (both should
run); the charge-source contention numbers with enemy matching on; and confirm (a) a
resumed battle with a divergent config force-opens the config panel, (b) restart reuses
the prior battle's config, (c) cascade cap 0 behaves as specified, and (d) the config is
stamped in both log tiers.
```

# Coding Agent Prompt — MK6 Iteration (Ready to Paste)

```
This is a sixth iteration on the existing, working "Breach" build in this repo.
Sections 1 and MK2-MK5 are complete, verified, and committed. Now implement
"Section 1-MK6: Shape Damage, No-Match-Damage, Instrumentation & QoL" from
breach-poc-requirements.md.

Read Section 1-MK6 in full first, including its intent note. Context for why:
MK5's enemy-matching change made the matching-denial contest the game's engine —
that part works. But the logs show the ABILITY layer is NOT carrying weight
(abilities are 16-33% of damage; the enemy often deals 100% of its damage through
matches alone). MK6 adds the tools to address that, makes cap-0 the default, and
clears a batch of instrumentation/QoL debt. NO new abilities and NO new combat
mechanics beyond the NO_MATCH_DAMAGE flag.

1. MK6.1 SHAPE DAMAGE (make the axes symmetric) — currently COLOR carries damage +
   charge while SHAPE carries only charge. Add DAMAGE_PER_TILE_LOW_SHAPE and
   DAMAGE_PER_TILE_HIGH_SHAPE (LOW=1, HIGH=2, symmetric with the current halved
   color values); assign 3 of the 6 shapes LOW and 3 HIGH and DOCUMENT the split.
   A COLOR-match now resolves damage via each tile's COLOR tier; a SHAPE-match
   resolves damage via each tile's SHAPE tier. This SUPERSEDES the MK5 stopgap
   where shape-matches fell back to the tile's color for damage. Blob matches are
   already axis-tagged, so they resolve on their own axis. Charge is unchanged.

2. MK6.2 NO_MATCH_DAMAGE (new config flag, default OFF) — when ON, matches deal
   ZERO damage (both axes). Match CHARGE is UNCHANGED (this is the point — the
   denial contest survives; both sides still fight over the same tiles, for charge
   instead of damage). Abilities become the only damage source.
   *** CRITICAL CARVE-OUT: bomb detonations STILL deal their normal per-destroyed-
   tile damage. A detonation is an ABILITY effect, not a match. Do NOT implement
   this as "destroyed tiles deal no damage" — that would silently gut bombs, the
   best-performing ability in the game. The rule is: MATCHES deal no damage;
   DETONATIONS are unaffected. ***
   Buffer's bonus applies to ABILITY damage only when this flag is on. Confirm
   nothing crashes/divides-by-zero with a zero damage base.

3. MK6.3 CAP-0 IS THE NEW DEFAULT — MAX_CASCADE_STEPS now defaults to 0 (was
   infinite). The "Infinite?" toggle and 0-9 input from MK5.3 are unchanged; only
   the DEFAULT changes. (Cap-0 tested dramatically better: stable board, special
   tiles survive, ability share rose, battles longer and closer.)

4. MK6.4 EXPOSE HP AS CONFIG + COLLAPSE THE SCENARIO SELECTOR — add
   PLAYER_STARTING_HP and ENEMY_STARTING_HP to the per-battle config (menu-settable,
   persisted, stamped into save and logs like every other config value). HP is now
   the dominant balance lever and currently needs a rebuild to change.
   THEN: REMOVE the forced-loss scenario entirely (it was only a workaround for the
   missing HP knob — "player starts at 1 HP" is now just a config) and COLLAPSE the
   scenario selector to a single "Play" button. The menu becomes: config controls
   (flags + HP) + Play + Continue (when a valid save exists) + Reset to Defaults.
   Defaults stay player 150 / enemy 350.

5. MK6.5 CHARACTER SHEET — a read-only reference panel in the existing pause menu,
   beside the config display. Shows: damage values per color (LOW/HIGH) and per
   shape (LOW/HIGH) and neutral; charge values per axis; UNIT BINDINGS (which color
   + shape charges each of the 4 units) FOR BOTH SIDES; and unit costs (7/13/19/22).
   BUILD IT ASSUMING THE TWO SIDES' BINDINGS MAY DIVERGE — do not hardcode a single
   shared table (different-bindings is a live future experiment).

6. MK6.6 TIMING METRICS — track per-turn real-time deltas and total battle wall-clock.
   *** Measure from PLAYER-INPUT-AVAILABLE -> PLAYER-COMMITTED-A-MOVE. Do NOT measure
   turn-start to turn-start: turn wall-clock includes animations, ability resolution,
   and the enemy's turn, none of which is the player thinking — and measuring
   turn-to-turn would make cap-0 show SHORTER think-times purely from less
   animation, INVERTING the signal. ***
   LOG RAW TIMESTAMPS; do NOT pre-aggregate into an average (analysis reads medians;
   a few AFK outliers would poison a mean). Save/background edge cases: your
   discretion — don't over-engineer.

7. MK6.7 BUFFER DAMAGE ATTRIBUTION — the Buffer's +5 is currently folded into whatever
   it amplified, so its entire contribution is invisible. Add ONE per-side total:
   "buffer damage added" = for each damage event, (damage_dealt − damage_that_would_
   have_been_dealt_with_zero_active_buff_stacks), summed. Handles stacking without
   double-counting. Do NOT add a per-source split this pass. Include in batch output
   and the game-over metrics display.

8. MK6.8 LOGGING FIXES — (a) the logs:dump pretty-printer is LOSSY: the raw JSONL is
   correct and complete, but the dump STRIPS entry.config, entry.v, and the contention
   fields. Fix the FORMATTER (the logging is fine) and make sure MK6's new timing and
   buffer metrics appear in the dump too. (b) Roll a NEW date-stamped log file when the
   dev server starts on a new day (e.g. logs/breach-logs-2026-07-11.jsonl).

9. MK6.9 VISUAL/UX — (a) REMOVE the tile-perimeter ownership outline on special tiles:
   with the enlarged icons it now distorts the shape and is redundant. *** GUARD: KEEP
   the badge's white=player / black=enemy fill — that IS the ownership signal now.
   Remove only the tile outline; do not strip ownership indication. *** (b) Make the
   floating damage/charge popup numbers MUCH BIGGER — they're currently tiny and dark.
   Transient UI can afford to be loud BECAUSE it's transient; briefly occluding part of
   the board is fine (the player is reading their move's outcome, not the board), while
   a number too small to read costs the feedback entirely.

CRITICAL:
- DELTAS on top of the existing build. Do not rebuild working systems. Where MK6
  conflicts with an earlier section, MK6 wins; everything else stays.
- NO new abilities. NO unit HP/knockout. NO escalating cascade cap. NO action-point
  economy. All parked (see MK6 "Out of scope").
- SINGLE_AXIS_PAYOUT already exists (MK5) and tested negative. LEAVE IT IN, defaulted
  OFF. MK6.1's shape damage is what may make it meaningful — do not remove it.
- Keep logic/render separation. New metrics go in the logic layer on the EXISTING event
  stream — do not create a parallel pipeline. Constants in the constants module.
- Keep MK5 as a clean committed restore point.

Before writing code, tell me: (1) any clarifying questions; (2) your LOW/HIGH split for
the 6 shapes; and (3) your one-line plan for where the think-time clock starts and stops
(this is the part most likely to be implemented backwards — see the warning in item 6).
Then wait for my go-ahead.

After building, report: (a) ability share of damage with NO_MATCH_DAMAGE off vs on;
(b) buffer damage added, per side; (c) median per-turn think-time; and confirm (d) bombs
STILL deal detonation damage under NO_MATCH_DAMAGE, (e) the dump now includes config,
version, contention, timing, and buffer fields, and (f) HP is settable from the menu and
the forced-loss scenario is gone.
```

# Coding Agent Prompt — MK7 Iteration (Ready to Paste)

```
This is a seventh iteration on the existing, working "Breach" build in this repo.
Sections 1 and MK2-MK6 are complete, verified, and committed. Now implement
"Section 1-MK7: Attribution, Cost Curve & Instrumentation" from
breach-poc-requirements.md.

Read Section 1-MK7 in full first, including its intent note. THE THEME OF THIS
BUILD IS: FIX THE INSTRUMENTS BEFORE RUNNING THE EXPERIMENT. Sixteen logged human
battles revealed the metrics have been lying in several specific ways (bomb cascade
damage miscredited to matches; buffer damage double-represented; deterministic
tile-settling counted as "cascades"). Separately, the ability cost curve was priced
for a 350-HP game and never re-priced: at 100-150 HP the 19-cost Attacker fired in
2 of 16 battles and the 22-cost Disabler fired ZERO times, ever. NO new abilities,
NO new units, NO loadout screen this pass.

1. MK7.1 ABILITY COST AS CONFIG + FLAT_ABILITY_COST (TOP PRIORITY) — expose the four
   ability costs as per-battle config (Settings screen, persisted, stamped into save
   and logs). Defaults stay 7/13/19/22. ADD a FLAT_ABILITY_COST flag (default OFF);
   when ON, all four units cost 7. Rationale: cost and effect are currently
   CONFOUNDED — "is Disabler good?" is unanswerable because you can't separate "weak
   effect" from "never fires." Flat cost collapses the confound. NOTE: flat-7 will
   probably produce unbalanced/swingy/short battles. THAT IS EXPECTED AND FINE — it
   is a diagnostic config, not a shipping one.

2. MK7.2 REDEFINE "CASCADE" (metric fix ONLY — NO gameplay change) — deterministic
   settling (existing tiles falling into gaps) is NOT a cascade; it's part of the move
   the player chose and they can see it coming. ONLY matches formed by NEWLY-GENERATED
   RANDOM tiles falling in from the top count as cascades. *** DO NOT CHANGE ANY
   GAMEPLAY BEHAVIOR. MAX_CASCADE_STEPS already gates only the stochastic refill rounds
   and that is correct — leave it exactly as-is. Only the COUNTER and the DAMAGE
   ATTRIBUTION change. *** Expect reported cascade depths to drop; that's the fix
   working.

3. MK7.3 DAMAGE ATTRIBUTION MODEL — implement exactly as specced. GOVERNING PRINCIPLE:
   damage rolls up to the ACTION THAT INITIATED THE CHAIN; the mechanism doesn't
   determine the bucket, the CAUSE does.
   FOUR DISJOINT buckets that must sum EXACTLY to total damage:
     match  = swap-initiated match + its settling + its stochastic cascades
     bomb   = explosion + its settling + its stochastic cascades  <-- ROLL BOMB
              CASCADES INTO BOMB DAMAGE. Do NOT split them out. (Currently they are
              miscredited to `match`, inflating match damage and understating bombs.)
     atk    = direct Attacker damage
     buffer = the Buffer's contribution (see item 4)
   Implementation: tag each resolution chain with its INITIATING cause; every settling
   and cascade step DESCENDED from it INHERITS that cause; damage rolls up by cause.
   PLUS ONE CROSS-CUTTING measure (overlaps the buckets, does NOT sum with them):
     cascadeDamage = ALL damage from stochastic-refill matches regardless of cause
   (same reporting shape as bufferAdded). This is the one number that answers "should
   cascades pay less?" (MPQ discounts cascade damage because it's unearned).
   Do NOT build per-source cascade columns (e.g. bomb-cascade) — no live tuning
   question needs them, and the causal tagging makes it trivial to add later.

4. MK7.4 BUFFER AS A DISJOINT COLUMN — bufferAdded is currently reported separately
   but ALSO baked into match/atk/bomb, so it's double-represented and the columns don't
   decompose. Make it a genuine disjoint bucket: match + bomb + atk + buffer = total.
   Definition unchanged from MK6.7; it is now SUBTRACTED OUT of the other buckets.

5. MK7.5 LOG THE MATCH AXIS — record whether each match resolved on the COLOR axis or
   the SHAPE axis; split match damage into matchDamage_color vs matchDamage_shape.
   This is mainly a BEHAVIORAL question: color is pre-attentively salient, shape needs
   serial visual search, so the player may be an unconscious COLOR-MATCHER. If matches
   run ~85/15 color, the shape axis is functionally decorative and the dual-axis premise
   isn't delivering. (Also: because MK6's tiers are symmetric (1/2 both), a regression
   in the shape-damage path would otherwise be INVISIBLE in the totals.)

6. MK7.6 NEW DAMAGE METRICS — (a) biggest ROUND damage (largest total in one round:
   ability + match + cascade stacked) — distinct from the existing biggest-HIT; this is
   the SWINGINESS indicator. (b) average round damage WHERE > 0 — the EFFECTIVENESS
   indicator; explicitly EXCLUDE zero-damage rounds (including them would drag the mean
   toward zero and obscure the signal). Both per side, in batch output and game-over
   display.

7. MK7.7 HINT SYSTEM (configurable, DEFAULT OFF) — after a configurable delay (default
   7s) with no player input, highlight an available 4-match if one exists. Settable
   (on/off + delay) in Settings. *** LOG WHETHER A HINT FIRED EACH TURN — required, so
   hint-assisted turns can be EXCLUDED from think-time analysis; otherwise a 7s hint
   compresses the think-time distribution and destroys its value as an engagement
   proxy (MK6.6). ***

8. MK7.8 DEBUG-ONLY "FIND MATCH" BUTTON — debug builds only; must not appear in a
   normal build. Lets the human tester move through games faster while still directly
   observing them.

9. MK7.9 SHAKE BECOMES A PERMUTATION — the shake now REARRANGES the existing tiles
   rather than generating new ones. Board COMPOSITION is preserved exactly; only
   POSITIONS change. *** The validity contract is UNCHANGED: the result must still have
   >=1 valid move and NO pre-existing match, so the re-permute-until-valid loop must
   remain. *** Special tiles still persist (color/shape/owner/duration). Rationale:
   makes shake a POSITIONAL tool not an ECONOMIC one (you can no longer shake for MORE
   of a color you need); removes a hidden reroll-the-economy exploit; and is the right
   behavior BEFORE board-tuning abilities exist (a future ability that converts tiles
   toward your color would be UNDONE by a re-randomizing shake).

10. MK7.10 MENU / SETTINGS RESTRUCTURE — rename "Play" to "New Game". Move ALL battle
    config off the title screen into a new SETTINGS MODAL (reached by a Settings button).
    Title screen becomes: New Game / Continue (when a valid save exists) / Settings —
    ACTIONS ONLY. Settings modal holds all config (flags, HP, ability costs, hint on/off
    + delay, cascade cap) plus Reset to Defaults. The battle PAUSE menu keeps its
    read-only config review and character sheet as reference panels BELOW the action
    buttons. *** SETTINGS IS NOT REACHABLE MID-BATTLE — config is immutable for a battle
    in progress (it's baked into the save). *** NO CONFIRMATION DIALOG on New Game:
    standing principle is that confirms are reserved for actions with meaningful
    real-world consequences; trivial confirms train users to dismiss dialogs unthinkingly.

11. MK7.11 BUG — after Quit, the board stays rendered behind the title screen (the
    render layer isn't torn down/reset, so it holds the last frame). Fix: clear the
    board render on quit.

12. MK7.12 ASPECT RATIO — letterbox the game into a fixed container matching the target
    PHONE'S VERTICAL ASPECT RATIO, centered in the viewport (dead space either side on
    wide screens), so desktop testing IS phone testing. CSS containment change, not a
    layout rework. Do NOT build a wide/tablet/landscape layout — explicitly deferred.

13. MK7.13 BOT HEURISTIC FOR NMD — the bot's prefer-4 rule is a DAMAGE heuristic, but
    under NO_MATCH_DAMAGE matches deal no damage, so it optimizes for a quantity that no
    longer exists (observed: the bot fired 6 bombs for ZERO damage into a churning board
    and never adapted). Add ONE more heuristic tier, used only when NO_MATCH_DAMAGE is
    on: "prefer matches that feed my units' bindings" (match for CHARGE, not damage).
    Not a full AI upgrade — one selection rule. Keep the existing tiers for non-NMD play;
    the bot must remain a deliberately weak floor indicator.

CRITICAL:
- DELTAS on top of the existing build. Do not rebuild working systems. Where MK7
  conflicts with an earlier section, MK7 wins; everything else stays.
- NO new abilities, NO new units, NO loadout screen, NO unit variants — all
  deliberately parked so they can be designed against CORRECTED numbers.
- Keep logic/render separation. Attribution and all metrics live in the logic layer on
  the EXISTING event stream — do not create a parallel pipeline. Constants/config in the
  constants module.
- Keep MK6 as a clean committed restore point.

Before writing code, tell me: (1) any clarifying questions; (2) your one-line plan for
how the causal tag is attached to a resolution chain and inherited by descendant
settling/cascade steps; and (3) confirmation that you will NOT change any gameplay
behavior in MK7.2 (it is a counter/attribution fix only). Then wait for my go-ahead.

After building, report: (a) that the four causal buckets sum exactly to total damage;
(b) bomb damage before vs after the attribution fix (it should RISE, and match damage
should FALL correspondingly); (c) matchDamage_color vs matchDamage_shape from a sample
battle; (d) ability fires per unit with FLAT_ABILITY_COST off vs on — specifically
whether Disabler fires AT ALL under flat-7 (it has never fired in any logged battle);
and (e) confirm the shake now preserves board composition.
```
