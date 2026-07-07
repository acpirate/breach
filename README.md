# Breach — Match-3 Hacking RPG (Proof of Concept)

Whitebox PoC of the core combat loop from `breach-poc-requirements.md`: matching, damage, charge, abilities, win/loss. TypeScript + Vite + canvas; mobile-first portrait; no backend, no persistence.

## Run

```
npm install
npm run dev        # local dev server (Vite prints the URL; use --host + a tunnel for phone testing)
npm run smoke      # headless logic smoke test: full battles, both scenarios, 10 seeds each
npm run typecheck  # tsc --noEmit
```

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
- Board-shake is mechanically a unit ability: cost 3, +1 charge per neutral tile destroyed in a player match (including row/column-clear sweeps), capped at 3, starts charged. New constant: `SHAKE_CHARGE_PER_NEUTRAL_TILE = 1`.
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
