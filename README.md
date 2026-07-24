# Breach — Alpha 0.1.0

Breach is a mobile-first match-3 combat game with a cyberpunk hacking theme. The project is now in its Alpha phase: the proof of concept established the combat model, and Alpha 0.1.0 replaces hardcoded Programs and Functions with validated external data intended to support the final game's content architecture.

The current build is a whitebox combat sandbox, not a complete run-based game. It supports human play, deterministic headless simulation, persistent in-progress battles, event-sourced metrics, and developer logging.

## Current status

**Build:** `alpha-0.1.0`

Alpha 0.1.0 introduces a shared data pipeline for:

- Hacker/player Programs
- System/enemy Programs
- Functions
- coded Effects and their parameter contracts

The browser and Node-based tools load the same CSV datasets, validate them through the same pure TypeScript pipeline, and resolve them into one immutable runtime content model. Human battles, automated battles, UI, saves, logs, and metrics all consume that resolved model. There is no hardcoded Program or Function fallback.

The current authoritative requirements are in:

```text
breach-alpha-0.1.0-requirements.md
```

Earlier PoC and MK requirements remain useful as development history, but they are no longer the canonical current specification.

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local development URL. Use `--host` when testing from another device on the same network.

Production build:

```bash
npm run build
```

The browser build packages the CSV resources into the generated application bundle. No production backend is required for the current game client.

## Verification commands

```bash
npm test           # focused data, composition, effect, persistence, and version tests
npm run smoke      # headless battle and save/restore regression suite
npm run batch      # multi-configuration automated battle metrics
npm run hpladder   # symmetric-HP balance ladder
npm run typecheck  # TypeScript validation
npm run build      # production bundle
```

At the Alpha 0.1.0 handoff, the focused suite passed 43 tests, the smoke suite completed all 48 configured battles, and both batch harnesses completed successfully.

Some interaction and rendering behavior still requires manual browser testing, particularly mouse/touch targeting, representative battles in each System mode, and the blocking data-validation failure screen.

## Core combat

The established combat model includes:

- 8×8 shared board
- six colors and six shapes
- neutral tiles
- color-axis or shape-axis matching
- blob/merge match detection
- per-tile charge
- charge caps based on Function cost
- deterministic seeded logic
- configurable cascade limits
- player pre-match Function activation followed by one turn-ending match
- System timer-charge and shared-board matching modes
- player and System owner-dependent strong color and shape partitions
- bombs, buffs, direct attacks, charge drain, and shield objects
- automatic deadlock protection and the player Board-Shake Function
- event-sourced metrics and causal damage attribution

The player Bomber deploys two bombs for redundancy. The System E-Bomb deploys one slower bomb with a larger cardinally extended footprint. The System Shielder deploys removable shield tiles that reduce each incoming damage instance using the defender's live shield total.

Program bindings, Function costs, Function assignments, countdowns, footprints, magnitudes, and damage values come from the external datasets. The current Function-cost curve is:

| Function | Cost |
|---|---:|
| Bomb | 7 |
| Buff | 8 |
| Attack | 10 |
| Drain | 9 |
| E-Bomb | 7 |
| Shield | 8 |

The former flat-cost override and in-game ability-cost editors were removed. Edit the source datasets and restart the application to change content values.

## Controls

### Board

- Tap a tile to select it.
- Tap an adjacent tile to attempt a swap.
- Tap a non-adjacent tile to move the selection.
- Tap the selected tile again to deselect.
- Press and drag toward an adjacent tile as an alternative swap input.
- Invalid swaps animate, revert, and do not consume the turn.

### Functions

- Activate charged Hacker Functions before committing the turn-ending match.
- Targeted Hacker Effects enter a targeting interface.
- Canceling a target selection does not spend charge.
- Board-Shake remains a separate pre-match control.

### Menus

- **New Game** starts a new battle and replaces any resident in-progress save.
- **Continue** appears only when a compatible save is available.
- **Settings** contains supported battle configuration.
- The battle menu supports Resume, Reset, Quit, and the Character Sheet.

## Data-driven content

Runtime source files are stored under `data/`.

The three required datasets are:

```text
Hacker Programs
System Programs
Functions
```

Both Program datasets use the same schema. Stable IDs preserve side identity in their values:

```text
PRG_H_...   Hacker Program
PRG_S_...   System Program
FNC_...     Function
EFFECT_...  coded Effect
```

Programs define identity, display name, charge bindings, and Function references. Functions define cost, payload, and named Effect parameters. Effects remain coded TypeScript actions.

### Function composition

A Function may be:

- a leaf that invokes one coded Effect; or
- a one-level composite that invokes one or more leaf Functions sequentially.

Composite Functions:

- pay the parent cost once
- ignore child costs
- execute children in listed order
- allow a legal child fizzle without stopping later children
- cannot self-reference, form cycles, or nest another composite
- cannot mix direct Effect and child-Function payload entries

Only one non-random targeted operation may occur in an expanded Function plan, and it must execute first. This rule applies to both Hacker and System Functions.

### Targeting

Unless an Effect defines a specific override:

- Hacker-targeted Effects present a player targeting interface.
- System-targeted Effects choose randomly among valid targets.

System Drain uses a specific priority rule:

1. Consider opposing Programs with charge above zero.
2. Prefer fully charged Programs.
3. Among fully charged Programs, prefer highest raw charge.
4. If none are fully charged, prefer highest partial charge.
5. Break remaining ties by highest activation cost, then randomly.
6. A drain-only System Function with no valid target withholds activation and preserves its charge.

## Startup validation

The application validates all external content before constructing the title screen or battle state.

Validation covers:

- required datasets and columns
- stable ID formats and global uniqueness
- side-specific Program prefixes
- data types and numeric ranges
- color, shape, area-pattern, Function, and Effect enums
- required and unused Effect parameters
- broken references
- duplicate registrations
- invalid composition
- targeting-order restrictions
- required baseline records

Validation collects all errors and warnings with dataset, file, row, record ID, field, supplied value, expected form, and reason.

- Any validation error blocks startup.
- The browser displays a blocking failure screen with no gameplay bypass.
- Node tools log the complete report and exit nonzero.
- Warnings do not block startup.
- Invalid data is never silently repaired.
- There is no fallback to hardcoded content.

Data is loaded once at application startup. It is not reloaded during an active session or battle.

## Architecture

```text
data/
  Authoritative Program and Function CSV resources

src/logic/data/
  Shared CSV parser, phased validator, resolver, and immutable content model

src/dataBrowser.ts
  Browser/Vite resource-loading adapter

scripts/dataNode.ts
  Node filesystem resource-loading adapter

src/logic/
  Pure deterministic combat rules, state, saves, metrics, and events

src/render/
  Canvas rendering and animation playback

src/main.ts
  Browser startup, input, and UI integration

scripts/
  Headless tests, smoke battles, batch analysis, HP ladder, and log tooling
```

The renderer contains no combat rules. Logic produces ordered events that the renderer displays. Seeded logic can be run without a browser.

Effect validation is centralized in the Effect registry. Runtime Effect dispatch remains exhaustive TypeScript code rather than a scripting language.

## Persistence

The current battle autosaves at stable state boundaries. Saves include:

- game/build version
- data-schema version
- gameplay-content fingerprint
- stable Program and Function IDs
- board and special-object state
- HP and charge
- configuration
- metrics
- deterministic RNG state

Pre-Alpha saves are rejected. A save whose content fingerprint no longer matches the loaded datasets is also rejected rather than resumed with changed Function behavior.

The content fingerprint is based on normalized gameplay-relevant data; notes and formatting-only changes should not invalidate a save.

## Metrics and logging

Combat metrics consume the same logic-layer event stream as human play and automated simulations.

Current instrumentation includes:

- battle outcomes and turn counts
- causal damage buckets
- match, bomb, attack, and Buffer attribution
- shield creation, removal, hits, and prevented damage
- Function activation versus Effect-operation and fizzle counts
- charge usage and waste
- cascade behavior
- think time
- Program-ID keyed metrics
- active build, schema, content fingerprint, Program IDs, and costs

Browser logging remains separate from server-side development log operations.

Developer commands:

```bash
npm run logs:dump
npm run logs:wipe
```

The raw development log uses JSONL. Readable dumps append session blocks rather than replacing prior dumps. Raw-log wiping preserves the readable dump. Server-side writes are guarded by a configurable filesystem-usage threshold and are isolated so logging failures cannot interrupt gameplay.

Browser console helpers remain available for inspecting or clearing browser-side logs where supported by the current build.

## Current scope

Alpha 0.1.0 establishes reusable combat-content infrastructure while preserving the tested battle model.

Not included yet:

- sequential multi-battle runs
- map progression
- Hacker or Deck selection
- build and inventory interfaces
- rewards
- bosses
- battlefields or map effects
- procedural Program or Function generation
- multiple active Functions per Program
- arbitrary nested Function composition
- a generalized targeting-rule data system
- a generalized scripting language
- production art or final visual theming

The next development phase can add content and game structure on top of the current Program/Function/Effect architecture without returning to hardcoded combat definitions.
