# Breach — Alpha 0.4.0

Breach is a mobile-first match-3 combat game with a cyberpunk hacking theme. Alpha 0.4.0 turns the Hacker and Deck identity work from Alpha 0.3 into a functional build-construction system: each identity contributes a Program portfolio, the player selects and orders an active four-Program build, and that order now affects charge routing during combat.

The project remains a whitebox development build rather than a complete game. It supports browser play, deterministic headless simulation, four-battle Runs, Quick Matches, persistent in-progress state, event-sourced metrics, and validated external content.

## Current status

**Build:** `alpha-0.4.0`  
**Active save schema:** `3`

Alpha 0.4.0 adds:

- Hacker and Deck Program portfolios
- a combined six-Program inventory
- a functional four-slot ordered Build screen
- build access before every Run battle
- Random and Constructed Quick Match modes
- a remembered Constructed Quick Match preset
- top-to-bottom charge overflow through the active Program order
- single-Packet targeting for Hacker Functions
- the DATACUT and PLINK targeted Functions
- expanded build, targeting, charge-routing, and Disabler telemetry

The current implementation requirements are documented in:

```text
breach-alpha-0.4.0-coding-agent-handoff.md
```

Earlier Alpha, PoC, and MK requirements remain useful as development history but are not the current implementation specification.

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

The browser build packages the CSV content into the generated application bundle. No production backend is required for the current client.

## Verification

```bash
npm test           # focused logic, data, persistence, targeting, and routing tests
npm run smoke      # complete headless battle and save/restore regression suite
npm run batch      # multi-configuration automated battle metrics
npm run hpladder   # LINK/ICE balance ladder
npm run typecheck  # TypeScript validation
npm run build      # production bundle
```

Alpha 0.4.0 handoff results:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 144 passed, 0 failed |
| `npm run smoke` | `SMOKE OK` |
| `npm run batch` | pass across 6 cells, including 2 Alpha 0.4 build cells |
| `npm run hpladder` | pass — 73/56/46% with System matching off; 78/82/96% with matching on |
| `npm run build` | pass — 128.27 kB, 41.48 kB gzip |

The current content loads with zero errors and five expected warnings:

- duplicate display name `ATTACKER` across Hacker and System Programs
- duplicate display name `DISABLER` across Hacker and System Programs
- unreferenced showcase Functions `FNC_007`, `FNC_008`, and `FNC_009`

These are warnings rather than startup blockers.

## Play modes

### New Run

A Run uses one selected Hacker, one selected Deck, a six-Program inventory, and an ordered four-Program active build.

```text
Title
→ Hacker Selection
→ Deck Selection
→ Build
→ Battle 1
→ Build
→ Battle 2
→ Build
→ Battle 3
→ Build
→ Battle 4
```

The Hacker and Deck portfolios remain fixed for the Run. The active four-Program build may be changed and reordered before each battle. The current Run build carries forward until changed, but it is discarded when the Run ends or is abandoned.

### Quick Match

Quick Match has two paths:

- **Random Quick Match** creates a random valid four-Program build and order, then begins immediately.
- **Constructed Quick Match** opens the Build screen before battle.

Constructed Quick Match remembers the last valid build and order used to begin a battle. This preset is separate from Run state and is not overwritten by Random Quick Match.

## Hacker, Deck, inventory, and build

Each Hacker contributes an authored three-Program portfolio. Each Deck contributes another authored three-Program portfolio. The two portfolios must resolve to six distinct Hacker Programs.

The active build:

- contains exactly four distinct Programs
- is ordered from top to bottom
- may contain any four Programs from the six-Program inventory
- remains valid throughout normal UI interaction
- determines which Programs enter battle
- determines charge-routing priority

The default build uses:

1. Hacker portfolio Program 1
2. Hacker portfolio Program 2
3. Deck portfolio Program 1
4. Deck portfolio Program 2

Replacing a Program swaps it into an occupied slot. Reordering moves Programs within the four occupied slots. The UI does not expose empty or duplicate active slots.

A shared read-only inspection modal is available from Hacker Selection, Deck Selection, and the Build screen. It identifies Program bindings, Function identity and cost, and portfolio source. Authored player-facing Function descriptions remain deferred; the Function name is the current authoritative label.

## Charge routing and overflow

Alpha 0.4 replaces broadcast-style Program charging with ordered routing.

For each generated charge stream:

1. Resolve color streams before shape streams.
2. Resolve tokens in stable enum order.
3. Scan active Programs from top to bottom.
4. Ignore inactive Programs and incompatible bindings.
5. Fill the first compatible non-full Program to its Function cost.
6. Pass excess charge downward to the next compatible non-full Program.
7. Discard remaining charge only when every compatible active Program is full.

Additional rules:

- charge never flows upward
- a compatible non-full Program cannot be skipped
- color and shape streams resolve independently
- a Program compatible with both streams may receive both
- cascades use the same routing rule
- reordering the active build can change where charge lands
- the Deck Function has its own charge pool and is not part of Program overflow
- routing consumes no gameplay RNG

`SKL_EXTRA_MATCH_CHARGE` increases the qualifying charge stream before routing. It does not independently add charge to every compatible Program.

## Core combat

The established battle model includes:

- an 8×8 shared Datastream
- six colors and six shapes
- neutral Packets
- color-axis and shape-axis Sync detection
- deterministic seeded logic
- configurable cascade limits
- owner-scoped charge and triggered effects
- Hacker pre-Sync Function activation followed by one turn-ending swap
- System timer-charge and shared-board matching modes
- bombs, shields, buffs, direct attacks, Drain, and Deck SCRAMBLE
- automatic deadlock protection
- event-sourced metrics and causal damage attribution

### B1 line clears

Line-clear qualification uses the combined directly matched footprint for each resolution wave. Any contiguous row or column run of four or more directly matched Packets triggers the corresponding line slice.

Bombs, Functions, prior line clears, and other collateral destruction do not contribute to B1 qualification. Line-clear destruction does not recursively create further line clears.

### Reinforced Connection

Reinforced Connection suppresses base Sync damage for both Hacker and System matches. Match-triggered Skills and Functions still resolve. Buff amplification attached to base Sync damage is also suppressed, while separately attributed Skill damage remains active.

## Targeted Functions

A charged targeted Function is armed before the turn-ending Sync. While targeting:

- valid Packet targets remain selectable
- non-target areas are visually de-emphasized
- the Datastream receives a targeting frame
- tapping the armed Function control again cancels targeting
- cancellation does not spend charge

The target is passed to the Effect, which determines how it is interpreted.

### DATACUT

DATACUT selects one Packet and slices its entire row.

- special Packets in the row are destroyed
- direct row destruction grants no charge
- direct row destruction does not contribute to B1
- direct row destruction does not trigger match Skills
- one combined noncritical Function-damage instance is calculated for the row
- Buff and Shield are applied once to that combined instance
- the Effect remains active under Reinforced Connection
- refill, resulting Syncs, and cascades resolve normally

### PLINK

PLINK selects one occupied Packet and resolves immediately.

- the footprint is the target plus its cardinal neighbors
- the footprint clips normally at Datastream edges
- it deals Bomb-style collateral damage
- it grants no direct charge
- it creates no countdown overlay
- its damage remains attributable to its own Function ID rather than BOMBER

Countdown Bomb Functions retain their existing placement, quantity, and countdown behavior.

### Bomb and line-slice collateral valuation

`EFFECT_BOMB` and `EFFECT_LINESLICE` value each collateral Packet using both its color and shape tiers and apply the higher valuation. This is a modest increase from the earlier Bomb color-only rule and is intentional for Alpha 0.4.

## Disabler behavior

System Drain considers only charged active Hacker Programs. It does not target inactive inventory Programs or the Deck Function.

Target priority remains deterministic:

1. fully charged Programs first
2. highest charge
3. highest Function cost
4. random tie break only when still tied

If no active Program has charge above zero, the System withholds Drain rather than activating against an empty target.

Every actual Drain activation records:

- target `PRG_ID`
- readiness state
- charge before and after
- Function cost
- amount removed

The same targeting lifecycle is used for player-initiated Drain.

## Controls

### Datastream

- Tap a Packet to select it.
- Tap an adjacent Packet to attempt a swap.
- Tap a non-adjacent Packet to move the selection.
- Tap the selected Packet again to deselect.
- Press and drag toward an adjacent Packet as an alternative swap input.
- Invalid swaps animate, revert, and do not consume the turn.

### Build screen

- Tap or use the inspection control to review a Program.
- Replace an occupied active slot with an inactive inventory Program.
- Use the reorder controls to move active Programs up or down.
- Proceed with the current valid four-Program build.

### Functions

- Activate charged Hacker Functions before committing the turn-ending Sync.
- Targeted Functions enter Packet-targeting mode.
- Tap the armed Function again to cancel targeting without spending charge.
- SCRAMBLE remains a Deck-owned Function with its own charge pool.

### Menus and persistence

- **Continue** appears only for a compatible active save.
- **Save and Quit** is available at supported battle and between-battle boundaries.
- Restarting a Run returns to the default build.
- Settings retain Normal LINK and Reinforced Connection controls.

## Data-driven content

Runtime source files are stored under `data/`.

The six required datasets define:

```text
Hackers
Hacker Skills
Decks
Hacker Programs
System Programs
Functions
```

Stable IDs preserve content identity:

```text
HAK_...      Hacker
SKL_...      Hacker Skill
DEK_...      Deck
PRG_H_...    Hacker Program
PRG_S_...    System Program
FNC_...      Function
EFFECT_...   coded Effect
```

Hackers define LINK, strong color and shape sets, ordered Skills, and an ordered three-Program portfolio. Decks add LINK, an ordered three-Program portfolio, and one Deck Function. Programs define identity, charge bindings, and one active Function. Functions define activation cost, payload, common fields, and typed Effect-specific parameter tuples. Effects remain coded TypeScript actions rather than spreadsheet scripting.

A single leading apostrophe in any dataset cell is treated as spreadsheet-protection syntax and removed before trimming, parsing, reference resolution, validation, and fingerprinting. Apostrophes elsewhere in a value are preserved.

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

Only one non-random targeted operation may occur in an expanded Function plan, and it must execute first. Targeting is resolved from the authored Effect tuple during data loading.

## Startup validation

The application validates all external content before constructing the title screen or battle state.

Validation includes:

- required datasets and columns
- stable ID formats and uniqueness
- side-specific Program prefixes
- data types and numeric ranges
- enum and area-pattern values
- typed Effect parameter tuples
- broken references
- invalid Function composition
- targeting-order restrictions
- exactly three distinct Programs in each Hacker and Deck portfolio
- cross-portfolio overlap and inability to derive six distinct Programs
- Function quantity and targeting sanity rules
- required baseline records

Validation collects all errors and warnings with dataset, row, record ID, field, supplied value, expected form, and reason.

- any error blocks startup
- browser startup shows a blocking failure screen
- Node tools report the complete validation result and exit nonzero
- warnings do not block startup
- invalid data is never silently repaired
- there is no hardcoded gameplay-content fallback

Data loads once at application startup and is not reloaded during an active session.

## Persistence

Alpha 0.4 uses save schema `3`.

Supported active-save phases are:

- `ACTIVE_BATTLE`
- `PENDING_RESULT`
- `PENDING_BUILD` for Run state between battles

Saves include the selected Hacker and Deck, six-Program inventory, ordered four-Program active build, battle identity, board and special state, LINK/ICE, Program and Deck charge, configuration, metrics, content fingerprint, and deterministic RNG state where applicable.

Alpha 0.3 saves are rejected cleanly. There is no migration or partial restore. Active saves with stale inventory, duplicate Programs, out-of-inventory Programs, or a mismatched gameplay-content fingerprint are rejected rather than silently defaulted.

The remembered Constructed Quick Match preset is stored separately under its own versioned preference key. Unlike an active save, an invalid remembered preset is revalidated and falls back to the default build.

## Metrics and logging

Human play and automated simulations consume the same logic-layer events.

Current instrumentation includes:

- battle outcomes and turn counts
- source-specific damage attribution
- Sync, Bomb, Attack, Buffer, Shield, and Skill metrics
- Function activation, Effect operation, and fizzle counts
- Hacker, Deck, inventory, active build, and Program order
- build source and build changes
- charge-stream generation and top-to-bottom routing
- eligible Program order, assignments, overflow, and discard
- target coordinates and Packet properties
- Disabler target ID and readiness data
- cascade behavior
- think time
- save schema and gameplay-content fingerprint

For routed charge, stream generation and placement are intentionally separate: the Skill charge metric records what was added to the stream, while routing events record where that charge landed.

Developer commands:

```bash
npm run logs:dump
npm run logs:wipe
```

Development builds also expose browser-console helpers for log inspection and targeted testing. The charge helper is guarded by `import.meta.env.DEV` and is not part of production gameplay.

## Architecture

```text
data/
  Authoritative Hacker, Skill, Deck, Program, and Function CSV resources

src/logic/data/
  Shared CSV parsing, normalization, validation, resolution, and fingerprinting

src/dataBrowser.ts
  Browser/Vite content-loading adapter

scripts/dataNode.ts
  Node filesystem content-loading adapter

src/logic/
  Pure deterministic combat, build state, saves, metrics, and events

src/render/
  Canvas rendering and animation playback

src/main.ts
  Browser startup, menus, input, targeting, Build UI, and screen flow

scripts/
  Focused tests, smoke battles, batch analysis, HP ladder, and log tooling
```

The renderer contains no authoritative combat rules. Logic emits ordered events that the browser renders. Seeded combat can run without a browser.

Effect validation is centralized in the Effect registry. Runtime Effect dispatch remains exhaustive TypeScript code rather than a generalized scripting language.

## Manual verification still recommended

The automated suite and desktop-browser checks pass, but the following should still be checked manually:

- a real phone or tablet, especially Build-screen reorder and inspection controls
- a complete four-battle Run through every Build/result transition
- Save and Quit from a between-battle Build, followed by resume
- retry-after-defeat behavior
- PLINK activation and targeting in the browser
- Random Quick Match presentation
- System-turn red border and Datastream dimming after the targeting-render changes

The development-only Find Sync control may overlap status text on a narrow viewport. This is pre-existing and does not affect production controls.

## Current scope

Alpha 0.4 establishes functional Hacker-side build construction and order-dependent charge routing while preserving the existing combat and Run architecture.

Not included yet:

- rewards or Program acquisition
- inventory growth during a Run
- permanent collection progression
- System-side build construction
- multiple active Functions per Program
- Program passives
- multi-Packet targeting
- neutral wildcard charging
- boss mechanics
- battlefields
- broad encounter-definition restructuring
- broad balance changes
- final art, animation, audio, accessibility, or production polish
- a generalized spreadsheet scripting language

The next build can expand player-facing descriptions, content breadth, rewards, or encounter structure without replacing the Alpha 0.4 inventory, build-order, targeting, and charge-routing foundations.
