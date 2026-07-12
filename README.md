# Breach — Match-3 Hacking RPG (Proof of Concept)

Whitebox PoC of the core combat loop from `breach-poc-requirements.md`: matching, damage, charge, abilities, win/loss. TypeScript + Vite + canvas; mobile-first portrait; no backend, no persistence. Includes the Section 1-MK2 revisions (see below).

## Run

```
npm install
npm run dev        # local dev server (Vite prints the URL; use --host + a tunnel for phone testing)
npm run smoke      # headless logic smoke test: full battles, both scenarios, 10 seeds each
npm run batch      # headless batch: 100 bot-played battles, aggregate metrics report
npm run typecheck  # tsc --noEmit
```

## MK6 revisions (Section 1-MK6 — Shape Damage, No-Match-Damage, Instrumentation & QoL)

- **MK6.1 Shape damage:** shapes get their own damage tiers, symmetric with color (LOW 1 / HIGH 2). **HIGH shapes: Square, Cross, Diamond · LOW: Triangle, Star, Circle** — assigned so every unit binds one HIGH axis + one LOW axis (no unit's tiles are double-weighted). A color-match damages via the tile's color tier, a shape-match via its shape tier; a tile destroyed by both pays once at the higher applicable value. Supersedes the MK5 color-fallback stopgap.
- **MK6.2 `NO_MATCH_DAMAGE` flag** (default OFF): matches deal zero damage; charge is unchanged (the denial contest survives); abilities become the only damage source. **Bomb detonations still deal full damage** — a detonation is an ability effect, not a match.
- **MK6.3 Cap-0 is the default** (`maxCascadeSteps: 0`; the Infinite toggle and 0–9 input are unchanged).
- **MK6.4 HP in config:** `playerHp`/`enemyHp` (1–9999) are menu-settable, persisted, saved, and stamped into logs. The forced-loss scenario and the Scenario concept are **removed** — the menu is config + one Play button (+ Continue when a save exists).
- **MK6.5 Character sheet:** read-only pause-menu panel with damage tiers per axis, charge values, unit costs, and **both sides'** bindings (built to display divergent bindings when that experiment lands).
- **MK6.6 Think-time metrics:** raw per-turn think-times measured strictly from input-available → match-committed (abilities/invalid swaps leave the clock running), logged unaggregated; medians computed at display. Battle wall-clock in the Tier 1 log.
- **MK6.7 Buffer attribution:** per-side `bufferDamageAdded` (= dealt − zero-buff-dealt, stacking-safe) in metrics, game-over display, and batch output.
- **MK6.8 Logging:** `logs:dump` is now lossless (version, config, contention, timing, buffer fields all included) and reads date-stamped files — the sink writes `logs/breach-logs-YYYY-MM-DD.jsonl`, rolling daily.
- **MK6.9 Visuals:** special tiles lose the perimeter outline (the centered white/black badge is the ownership signal); floating damage numbers are large and outlined.
- **New harness:** `npm run hpladder` — symmetric-HP ladder (100/500/2000, both enemy modes, 100 seeds per cell). `npm run batch` runs a 4-mode matrix (enemy matching × no-match-damage) with ability-share and buffer columns.

## MK5 revisions (Section 1-MK5 — Enemy Matching + Configurable Battle Modifiers)

- **MK5.1 Enemy matching:** with the `enemyMatching` flag on, the enemy's fixed charge clock is removed and it becomes a real matching opponent on the shared board — a structurally identical turn (fire charged abilities → make one match via the existing bot heuristic → resolve under all the same rules), charging only from matches on the same bindings as the player. Flag off (default) = the original timer-clock enemy. Both paths work.
- **MK5.2 Config flags** (`BattleConfig`, runtime state on `GameState`, defaults in `constants.ts`):
  - `enemyMatching` (default OFF)
  - `hackerBonusEnabled` (default **OFF** — deliberate: the flat color bonus distorted the economy; off gives a symmetric baseline, so the first MK5 battle plays differently from MK4 even untouched)
  - `singleAxisPayout` (default OFF; on = a match grants **charge** only on its matched axis — damage is unchanged, since damage is color-derived. Per-match ruling: a tile in both a color- and shape-match is destroyed once but pays both axes)
  - `maxCascadeSteps` (default **infinite** via `null` sentinel; 0–9 otherwise). At a cap, refill tiles are rejection-rolled so no refill completes a match; matches from existing tiles falling together still resolve. Cap 0 = the initial match resolves, then the board goes inert.
- **MK5.3/5.4 Config UI & lifecycle:** the scenario menu has checkboxes, an "Infinite cascades" toggle with a 0–9 input, and "Reset to Defaults" (the only reset). Config persists across sessions (`breach:config`), is **serialized into the save** and is authoritative/immutable for that battle. On Continue, if the save's config differs from the menu's, a forced acknowledgment panel auto-opens showing the battle's actual config. Restart (conclusion screen or pause) always reuses the just-played battle's config. The pause menu shows the active config read-only.
- **MK5.5 Logging:** every Tier 1 and Tier 2 log entry stamps the active config alongside the version (now `mk5`). Old-version log entries persist until explicitly cleared.
- **MK5.6 Contention metric:** per side, how many destroyed match-tiles were bound to the *opposing* side's units — surfaced in the batch output and the game-over metrics.

`npm run batch` now runs 100 battles in **both** enemy modes, outcome-split.

## MK4 revisions (Section 1-MK4 — Persistence, Logging & Visual Pass)

No gameplay changes. Additions:

- **MK4.1 Save/restore:** the in-progress battle autosaves to localStorage at every stable point (battle start, after each ability, after each completed turn). `src/logic/save.ts` serializes the full logic-layer state — board, HP, charges, countdowns, metrics, and the RNG's internal state (resumes are deterministic) — in a `{version: "mk4", state}` envelope. Missing/incompatible/corrupt saves fail gracefully to a fresh start. The save is cleared the moment a battle ends. Console logs `[breach] state saved/restored (turn N)`.
- **MK4.2 Continue:** the scenario selector shows a Continue button only when a valid, version-compatible in-progress save exists; starting any new game wipes the resident save (doubles as the corrupt-save escape hatch). Quit mid-battle keeps the save, so Continue reappears.
- **MK4.3 Logging:** `src/logic/logger.ts` consumes the same event stream as the metrics collector (no second pipeline). Tier 1: final metrics per completed battle. Tier 2: one action+outcome entry per turn. All entries tagged `v: "mk4"`. Capped at `MAX_METRIC_LOG_ENTRIES`/`MAX_TURN_LOG_ENTRIES` (oldest evicted). Tier 3 (board snapshots) parked. Access:
  - Browser console: `breachLogs()` to dump, `breachWipe({save: true})` to wipe.
  - Dev-server sink: in dev, entries also POST to a Vite middleware that appends them to `logs/breach-logs.jsonl` on the dev machine — this captures logs from a phone playing over the LAN. `npm run logs:dump` pretty-prints to `logs/breach-logs.txt`; `npm run logs:wipe` deletes the server files.
- **MK4.4 Gems as colored icons:** tiles render as enlarged colored shapes (silhouette near the tile edges, darker-shade outline) instead of glyphs on colored fields, leaving the center free for the special-tile badges. Supersedes MK2.1's white-fill rule. Neutral static tiles unchanged.

## MK3 revisions (Section 1-MK3 — Combat Cohesion Pass)

- **MK3.1 Constants:** match damage halved (low 1 / high 2 / neutral 2; charge unchanged); `ATTACKER_DAMAGE` 30; bomb fuse 2 turns and blast expanded to the full 3×3 (`BOMB_BLAST_OFFSETS` named constant).
- **MK3.2 Disabler:** the player's Disabler is player-targetable — tapping the charged indicator arms a targeting mode (enemy minion boxes highlight; tap one to discharge it, tap anywhere else to cancel free). The enemy Disabler uses a fixed, legible rule: the player's highest-COST program with any charge, tie-break by raw charge then random; fizzles if nothing has charge.
- **MK3.3 Blob/merge matching:** straight-line 3+ runs are detected per axis (color / shape / neutral, tagged with their value) then merged — same-axis same-value matches that share a tile or touch orthogonally union into one blob, repeated until stable. Blob tier = tile count; line 4+ clears its row/column; non-line 5+ crits with no clear. Cross-axis matches never merge. This makes `MATCH_5_NONLINE_MULTIPLIER` reachable (crits went from ~0.2% to ~2-4% of match damage in bot play).
- **MK3.4 Bot:** harness bot (`scripts/bot.ts`) prefers any move producing a 4+ match, else first-found. Still a deliberately weak floor indicator.
- **MK3.5 Metrics:** `npm run batch` splits all aggregates by outcome (player won vs lost) with the bot win rate as the headline calibration number.
- **MK3.6 Visuals:** special-tile badges centered in the shape glyph; white (player) markers get black outlines; fonts sized to fill their allotted areas.

## MK2 revisions (Section 1-MK2)

- **MK2.1 Shape rendering:** standard-tile shapes are a white fill with a 1px outline in a darker shade of the tile's own color; each tile also gets a 1px darker-same-color border. Neutral tiles unchanged.
- **MK2.2 Board-shake is pure anti-lock:** the paid shake is now identical to the automatic deadlock reshuffle — guaranteed ≥1 valid move, no pre-existing match, therefore no damage/charge/cascades. Cost 3, starts charged, neutral-match replenishment unchanged. The old cascade-payoff rule is removed.
- **MK2.3 Per-battle metrics:** collected entirely in the logic layer (`src/logic/metrics.ts`) by consuming the resolver's event stream — the same collector powers the game-over display and headless batch runs (`npm run batch`). Metric definitions:
  - Per-unit "effect": Attacker = direct damage; Bomber = detonation damage from that side's bombs; Buffer = bonus damage its buffs added to damage events; Disabler = charge drained.
  - Crit metric counts only the damage **added** by the 1.5× multiplier (per-tile `base × 0.5`, measured pre-floor).
  - Deepest cascade: steps in one move (1 = no cascading); a detonation counts its blast + subsequent cascade steps. Turn count and match-lock (auto-reshuffle) count are battle-global; everything else is per side.
  - Displayed on the game-over dialog below the win/loss indicator and Reset/Quit, in a scrollable plain-text area, player side first.
- `STARTING_HP_ENEMY` is 350 for this iteration (designer-set).

## Controls

- **Tap** a tile to select it (orange outline); tap an adjacent tile to swap, a non-adjacent tile to move the selection, the same tile to deselect. **Or press-and-drag** a tile toward a neighbor to swap.
- Invalid swaps animate, revert with a "no match" notice, and do **not** consume the turn.
- **Tap a charged program box** (top area) or **SHAKE** to fire it — only before you make your match.
- **≡** opens the pause menu (Reset / Quit) — only available during your make-a-match phase.

## Architecture

- `src/logic/` — pure, framework-agnostic game rules (no DOM, no rendering). Deterministic under a seeded RNG. This is the layer that would port to Godot.
  - `constants.ts` — every gameplay-affecting number (the spec's Tunable Constants block plus the approved additions below). Nothing is hardcoded elsewhere.
  - `types.ts`, `rng.ts`, `board.ts` (generation, deadlock scan, both reshuffle paths), `match.ts` (straight-line run detection), `resolve.ts` (per-destroyed-tile damage/charge, cascade steps, detonations), `game.ts` (turn structure, abilities, enemy phase).
- `src/render/` + `src/main.ts` — canvas renderer/input and DOM dialogs. Logic methods return an ordered `GameEvent[]` which the renderer replays as animations; the renderer contains no game rules.
- `scripts/smoke.ts` — headless battles verifying: both scenarios reach game over, board never deadlocks, charge caps hold, invalid swaps don't consume the turn, abilities can't fire after the match commits.

## Agent-discretion choices (approved)

| Decision | Choice |
|---|---|
| 6 colors | Red, Yellow, Magenta, Green, Cyan, Blue (flat canvas fills) |
| 6 shapes | Circle, Square, Triangle, Diamond, Star, Cross (canvas glyphs drawn dark over the tile color) |
| HIGH colors (4 dmg/tile) | Red, Yellow, Magenta — "warm hits harder" |
| LOW colors (2 dmg/tile) | Green, Cyan, Blue |
| Hacker bonus color | **Red** (+1 dmg and +1 charge per red tile, player match events only) |
| Bomber (cost 7) binding | Red + Triangle (bonus color on the cheapest program so the interaction is exercised often) |
| Buffer (cost 13) binding | Green + Square |
| Attacker (cost 19) binding | Yellow + Star |
| Disabler (cost 22) binding | Blue + Cross |

Enemy minions use the **identical bindings** (approved). Cyan, Magenta, Circle, and Diamond are unbound — matching them deals damage but charges no unit (intentional).

## Clarified rules baked in (from designer Q&A)

- Matches are **owned events**. Enemy bomb detonations trigger enemy-owned cascade matches: they damage the **player** (same formulas, enemy buffs apply per step) and charge **enemy minions**. Blast-destroyed tiles themselves grant no charge to anyone.
- Charge is strictly **owner-scoped**: player matches charge only player units/shake; enemy cascades charge only enemy minions. Neutral tiles in enemy cascades damage the player but charge nothing.
- The Hacker passive (Red +1/+1) applies **only to player-owned match events** — never to blasts or enemy cascades.
- Board-shake is mechanically a unit ability: cost 3, +1 charge per neutral tile destroyed in a player match (including row/column-clear sweeps), capped at 3, starts charged. New constant: `SHAKE_CHARGE_PER_NEUTRAL_TILE = 1`. (Its effect is the MK2.2 pure anti-lock reshuffle — see above.)
- Bombs/buffs swept by a 4/5-match row/column clear are destroyed as **normal tiles** (no detonation); a same-side buff destroyed in a step/blast still counts toward that same step's damage.
- 4/5-tier effects (row/column clears, crits) can occur in any cascade step, from either side's events.

## Implementation notes & assumptions

- **Fractional damage is floored** per step after the 1.5× crit multiplier (e.g. raw 22.5 → 22). Buff bonuses are added after flooring.
- **Runs of 6+** in a line (possible after refills) are treated as the 5-line tier: crit + line clear.
- `MATCH_5_NONLINE_MULTIPLIER` is defined but **unreachable**: with straight-line-only detection and no blob merging (spec 1.4 / rule 9), no single match can be 5 non-linear tiles. Kept for the Section 2 non-linear match roadmap.
- A same-color-AND-same-shape run is detected as two coincident matches; per-destroyed-tile set resolution makes this harmless (each tile counted once, highest multiplier).
- The pause dialog includes a **Resume** button in addition to the spec's Reset/Quit, purely so the menu can be dismissed.
- The enemy Disabler targets the player's 4 **programs** only (the shake meter is not a unit).
- HP display clamps at 0; the game-over dialog states victory/defeat and offers Reset/Quit.

## Out of scope (per spec Section 1.14 / Section 2)

No map, no build selection, no dongles, no dev console, no persistence, no deployment, no art/theming pass.
