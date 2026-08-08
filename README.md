# Breach — Alpha 0.5.0

Breach is a mobile-first match-3 combat game with a cyberpunk hacking theme. Alpha 0.5.0 gives the opposing System a real identity: Systems are authored external content with their own durability, strength profile, and ordered Program build, and the System you face is chosen before you build against it.

The project remains a whitebox development build rather than a complete game. It supports browser play, deterministic headless simulation, four-battle Runs, Quick Matches, persistent in-progress state, event-sourced metrics, and validated external content.

## Current status

**Build:** `alpha-0.5.0`
**Active save schema:** `4`

Alpha 0.5.0 adds:

- a seventh required dataset (`SYS`) defining authored Systems
- two authored Systems, BOUNCER and MIDNIGHT
- System-specific base ICE and independent strong/weak axes
- ordered four-Program System builds drawn from eight System Programs
- explicit System Selection before Constructed Quick Match Build
- random System selection before every Run battle, persisted and never rerolled
- automatic System selection for Random Quick Match
- `EFFECT_TRANSFORM` and the COERCE Function
- delayed Buff delivery through the existing countdown architecture (EBUFF)
- a charge-granting Bomb variant (SPAM) and three new System Programs
- dynamic System Function readiness within a single System turn
- a universal "valid target or don't fire" activation rule for the System
- one canonical side-level charge-waste metric
- compact-log classification and rendering fixes

The current implementation requirements are documented in:

```text
breach-alpha-0.5.0-coding-agent-handoff.md
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

Alpha 0.5.0 handoff results:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 200 passed, 0 failed |
| `npm run smoke` | `SMOKE OK` |
| `npm run batch` | pass across 6 cells |
| `npm run hpladder` | pass — 76/74/85% with System matching off; 39/37/29% with matching on |
| `npm run build` | pass — 145.32 kB, 46.34 kB gzip |

Balance figures moved from Alpha 0.4.1 because Alpha 0.5 deliberately changes System identity and content. Two changes account for most of it: Quick Match System ICE is now the System's own `BASE_ICE` (100) instead of a mirror of the Hacker's maximum LINK (150), and the authored Systems field new Functions.

Headless simulations pin one System (`SYS_01`) so their output stays comparable between runs; random selection is gameplay behavior and does not belong in a measurement instrument.

The current content loads with zero errors and six expected warnings:

- duplicate display name `ATTACKER` across Hacker and System Programs
- duplicate display name `DISABLER` across Hacker and System Programs
- unreferenced showcase Functions `FNC_007`, `FNC_008`, and `FNC_009`
- `PRG_S_004` DISABLER is not fielded by any authored System

These are warnings rather than startup blockers. The last one is a deliberate content consequence: neither authored System currently fields DISABLER, so the System does not Drain in Alpha 0.5.

## Systems

A System is authored content, exactly as a Hacker is. Each System defines:

- a display name
- `BASE_ICE`, its base maximum ICE
- a strong color set and a strong shape set
- an ordered four-Program build drawn from the loaded System Programs

Weak sets are the complements of the authored strong sets over the recognized six-color and six-shape vocabularies. Systems no longer derive their strengths from the selected Hacker; each System has an independent profile, and two Systems produce genuinely different battles.

The authored Systems are:

| System | ICE | Strong colors | Strong shapes | Build (top to bottom) |
|---|---|---|---|---|
| `SYS_01` BOUNCER | 100 | Red, Green, Yellow | Triangle, Square, Star | ATTACKER, MUSCLE, ENHANCE, E-BOMBER |
| `SYS_02` MIDNIGHT | 100 | Red, Magenta, Blue | Triangle, Square, Star | SPAMBOT, THROWER, E-BOMBER, SHIELDER |

`PRG_SET` order is charge-routing priority, display order, and save identity. It is **not** Function-activation priority.

There is no System portfolio, System inventory, System Build screen, or System Program reordering in Alpha 0.5. System passive Skills are deferred; the `SKILL` column must be blank, and a populated value is a startup error rather than silently ignored content.

### Effective ICE

Under Normal LINK, System maximum ICE is:

```text
Quick Match:  BASE_ICE
Run battle N: BASE_ICE + run-step modifier   (+0, +50, +100, +150)
```

A `BASE_ICE = 100` System therefore still produces the established 100 / 150 / 200 / 250 Run ladder, while a future System with different durability escalates correctly without redesigning Run progression. With Normal LINK off, the manual System ICE setting replaces both the base and the step modifier; the values are never combined.

## Play modes

### New Run

```text
Title
→ Hacker Selection
→ Deck Selection
→ resolve Battle 1 System
→ Build
→ Battle 1
→ resolve Battle 2 System
→ Build
→ Battle 2
→ ...
```

Each Run battle draws one valid System at random, with replacement — repeats are allowed and there is no shuffle bag or anti-repeat rule. The opponent is resolved **before** the Build screen so the player can build against it, and the Build screen shows the upcoming System's ICE, strong and weak axes, and ordered Programs.

Once resolved, that choice is persisted. Reopening Build, Save and Quit followed by Continue, and retrying after a defeat all face the same System. Only successful progression to a new Run step draws a new one.

### Quick Match

- **Random Quick Match** generates a random build and order, chooses a System automatically, and begins immediately without opening any selection screen.
- **Constructed Quick Match** opens System Selection first, then the Build screen.

```text
Quick Match
→ Constructed Quick Match
→ System Selection
→ Build
→ Battle
```

System Selection lists every valid loaded System with its Quick Match ICE, strong and weak axes, and ordered Programs, and offers the shared Program inspection modal. Selection is explicit and there is no confirmation modal. Back from Build returns to System Selection; Back from System Selection returns to the Quick Match submenu.

Constructed Quick Match still remembers the last valid Hacker build and order. Alpha 0.5 adds no remembered System preference — the opponent is chosen each time.

### Selection randomness

Encounter selection uses an isolated setup random source, never the battle's gameplay stream. Choosing a System cannot perturb the board, refills, or AI sequence for a given gameplay seed, and neither can the number of setup selections that preceded a battle.

## Hacker, Deck, inventory, and build

Each Hacker contributes an authored three-Program portfolio. Each Deck contributes another authored three-Program portfolio. The two portfolios must resolve to six distinct Hacker Programs.

The active build:

- contains exactly four distinct Programs
- is ordered from top to bottom
- may contain any four Programs from the six-Program inventory
- remains valid throughout normal UI interaction
- determines which Programs enter battle
- determines charge-routing priority

The default build uses Hacker portfolio Programs 1 and 2, then Deck portfolio Programs 1 and 2.

Replacing a Program swaps it into an occupied slot. Reordering moves Programs within the four occupied slots. The UI does not expose empty or duplicate active slots.

A shared read-only inspection modal is available from Hacker Selection, Deck Selection, System Selection, the Build screen, and both character sheets. Authored player-facing Function descriptions remain deferred; the Function name is the current authoritative label.

## Charge routing and overflow

For each generated charge stream:

1. Resolve color streams before shape streams.
2. Resolve tokens in stable enum order.
3. Scan the owner's active Programs from top to bottom.
4. Ignore inactive Programs and incompatible bindings.
5. Fill the first compatible non-full Program to its Function cost.
6. Pass excess charge downward to the next compatible non-full Program.
7. Discard remaining charge only when every compatible active Program is full.

Additional rules:

- charge never flows upward
- a compatible non-full Program cannot be skipped
- color and shape streams resolve independently
- cascades use the same routing rule
- reordering the active build can change where charge lands
- the Deck Function has its own charge pool and is not part of Program overflow
- routing consumes no gameplay RNG

The same routing applies to the System, through its authored `PRG_SET` order. BOUNCER's COERCE/ATTACKER synergy is emergent rather than special-cased: COERCE converts Packets to Yellow Stars, ATTACKER is bound to Yellow and Star and sits first in the queue, and ordinary routing does the rest.

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
- bombs, shields, buffs, direct attacks, Drain, transforms, and Deck SCRAMBLE
- automatic deadlock protection
- event-sourced metrics and causal damage attribution

### B1 line clears

Line-clear qualification uses the combined directly matched footprint for each resolution wave. Any contiguous row or column run of four or more directly matched Packets triggers the corresponding line slice. Collateral destruction does not contribute to qualification, and line-clear destruction does not recursively create further line clears.

### Reinforced Connection

Reinforced Connection suppresses base Sync damage for both sides. Match-triggered Skills and Functions still resolve. This includes Syncs created by `EFFECT_TRANSFORM`, whose base damage is suppressed like any other Sync.

## The System turn

The outer System turn order is unchanged:

1. tick the System's own countdowns
2. the System Function phase
3. the System's normal match, or the flat timer charge

### Dynamic Function phase

Function readiness is recomputed after every fully resolved Function, not snapshotted once at phase start. Charge a Function creates — through an Effect-made Sync, a detonation, or a cascade — can make another Program ready and let it act in the same phase.

Each active System Program may activate **at most once per Function phase**. A Program that fires, is recharged, and fills again waits for the next System turn. That cap, not an iteration budget, is what guarantees the phase terminates.

Charge produced by the turn-ending match or the flat timer arrives after the phase has ended and is available on the next System turn.

### Activation eligibility

A ready System Function that has nothing valid to act on is not selected and does not spend its charge. The check is re-evaluated for every still-unfired charged Program after each activation, because a previous Function may have changed the answer:

- Drain with no charged Hacker Program
- COERCE with no neutral Packets
- a placement Function with no legal deployment Packet

If another Function later creates a valid target, a previously blocked Program may fire in that same phase. Withheld activations are recorded as a compact battle-level count rather than a per-turn log entry.

This is a deliberate change from Alpha 0.4.1, where placement Functions fired into a full board and legally fizzled with the charge already spent.

## New Alpha 0.5 content

### COERCE (`EFFECT_TRANSFORM`)

COERCE changes the underlying color/shape identity of Packets matching an authored source axis.

- `axisTarget` selects the eligible pool; Alpha 0.5 supports `NEU` (neutral Packets)
- `axisResult` is exactly one color and one shape — `YEL:STR` for current content
- `quantity` is an ordinary maximum: up to that many valid targets, fewer if fewer exist
- the typed tuple is `targeting:specialPacketTreatment`

All selected Packets change **before** any Sync detection runs, so target iteration order is never mechanically significant. Any Sync created belongs to the activating side and resolves through the ordinary pipeline: normal strong/weak damage from that side's profile, normal crit tiers, normal B1 qualification, normal charge routing, normal cascades.

The Transform itself deals no damage and grants no charge of its own. Everything that follows comes from the board state it created.

Damage from those Syncs is credited to the Transform in its own metrics bucket so the Effect can be balanced. That is attribution only — the damage is mechanically an ordinary Sync in every other respect.

When no valid Packet exists, COERCE is withheld, keeps its charge, and mutates nothing.

### EBUFF — delayed delivery

The countdown architecture is one mechanism with a named payload:

```text
activation now → countdown persists → payload delivered later
```

An armed overlay carries both its remaining countdown and the Effect it will deliver, plus the parameters resolved when it was armed. EBUFF arms up to three countdown overlays that contribute **zero** Buff magnitude while pending, then become live Buffs of the authored magnitude on the *same* Packets at expiry.

Slicing a pending overlay prevents delivery entirely — there is no ghost Buff elsewhere. Pending overlays display their remaining countdown and survive save and resume. Bomb countdown timing is unchanged, and both payloads share one tick and one delivery switch rather than separate schedulers.

### SPAM and the Bomb tuple

The Bomb tuple remains `targeting:dealDamage:gainCharge`, with each Function's `quantity`, `countdown`, and `areaPattern` selecting its variant. SPAM deliberately enables the charge branch: Packets sliced by its detonations generate System charge, which routes through the ordinary ordered queue. Every other Bomb row keeps the established no-charge behavior.

## Disabler behavior

System Drain considers only charged active Hacker Programs. It does not target inactive inventory Programs or the Deck Function. Target priority is fully charged Programs first, then highest charge, then highest Function cost, then a random tie break.

Neither authored System currently fields DISABLER, so this path is exercised by tests rather than by live Alpha 0.5 play. The behavior and its telemetry are retained for a future Disabler-using System.

## Controls

### Datastream

- Tap a Packet to select it.
- Tap an adjacent Packet to attempt a swap.
- Tap a non-adjacent Packet to move the selection.
- Tap the selected Packet again to deselect.
- Press and drag toward an adjacent Packet as an alternative swap input.
- Invalid swaps animate, revert, and do not consume the turn.

### Setup screens

- System Selection: tap a System to select it, inspect its Programs, then confirm.
- Build screen: inspect, replace, and reorder the four active Programs.
- The Run Build screen shows the upcoming opponent in a collapsible panel.

### Functions

- Activate charged Hacker Functions before committing the turn-ending Sync.
- Targeted Functions enter Packet-targeting mode.
- Tap the armed Function again to cancel targeting without spending charge.
- SCRAMBLE remains a Deck-owned Function with its own charge pool.

### Menus and persistence

- **Continue** appears only for a compatible active save.
- **Save and Quit** is available at supported battle and between-battle boundaries.
- Restarting a Run returns to the default build and draws a new Battle 1 System.
- Settings retain Normal LINK and Reinforced Connection controls.

## Data-driven content

Runtime source files are stored under `data/`.

The seven required datasets define:

```text
Hackers
Hacker Skills
Decks
Hacker Programs
System Programs
Systems
Functions
```

Stable IDs preserve content identity:

```text
HAK_...      Hacker
SKL_...      Hacker Skill
DEK_...      Deck
SYS_...      System
PRG_H_...    Hacker Program
PRG_S_...    System Program
FNC_...      Function
EFFECT_...   coded Effect
```

Hackers define LINK, strong color and shape sets, ordered Skills, and an ordered three-Program portfolio. Decks add LINK, an ordered three-Program portfolio, and one Deck Function. Systems define base ICE, strong color and shape sets, and an ordered four-Program build. Programs define identity, charge bindings, and one active Function. Functions define activation cost, payload, common fields, transform axes, and typed Effect-specific parameter tuples. Effects remain coded TypeScript actions rather than spreadsheet scripting.

A single leading apostrophe in any dataset cell is treated as spreadsheet-protection syntax and removed before trimming, parsing, reference resolution, validation, and fingerprinting. Apostrophes elsewhere in a value are preserved.

### Function composition

A Function may be a leaf that invokes one coded Effect, or a one-level composite that invokes one or more leaf Functions sequentially. Composites pay the parent cost once, ignore child costs, execute children in order, allow a legal child fizzle without stopping later children, and cannot self-reference, form cycles, nest another composite, or mix Effect and Function payload entries.

Only one non-random targeted operation may occur in an expanded Function plan, and it must execute first.

## Startup validation

The application validates all external content before constructing the title screen or battle state.

Validation includes:

- required datasets and columns
- stable ID formats and uniqueness
- side-specific Program prefixes
- data types and numeric ranges
- enum and area-pattern values
- typed Effect parameter tuples and transform axes
- positive integer `BASE_ICE`
- exactly four distinct System Programs in each `PRG_SET`
- blank System `SKILL` (passive Skills are unsupported in Alpha 0.5)
- broken references
- invalid Function composition
- targeting-order and targeted-quantity restrictions
- exactly three distinct Programs in each Hacker and Deck portfolio
- cross-portfolio overlap and inability to derive six distinct Programs
- required baseline records

Validation collects all errors and warnings with dataset, row, record ID, field, supplied value, expected form, and reason.

- any error blocks startup
- browser startup shows a blocking failure screen
- Node tools report the complete validation result and exit nonzero
- warnings do not block startup
- invalid data is never silently repaired
- there is no hardcoded gameplay-content fallback, and no default System

Data loads once at application startup and is not reloaded during an active session.

## Persistence

Alpha 0.5 uses save schema `4`.

Supported active-save phases are:

- `ACTIVE_BATTLE`
- `PENDING_RESULT`
- `PENDING_BUILD` for Run state between battles

Saves include the selected Hacker, Deck, and System, how the System was chosen, the six-Program inventory, the ordered four-Program active build, the System's ordered build, battle identity, board and special state (including armed countdowns), LINK/ICE, Program and Deck charge, configuration, metrics, content fingerprint, and deterministic RNG state where applicable.

System identity is stored as a stable ID plus its selection source. Immutable System definitions are not copied into the save; they resolve through the matching content fingerprint.

Alpha 0.4.x saves are rejected cleanly. There is no migration and no partial restore: an old save has no authoritative System identity, and restoring one would mean inventing an encounter. Saves with stale inventory, an unknown `SYS_ID`, a System build that no longer matches, or a mismatched gameplay-content fingerprint are rejected rather than silently defaulted.

The remembered Constructed Quick Match preset is stored separately under its own versioned preference key and survives the schema bump. It holds a Hacker build only.

## Metrics and logging

Human play and automated simulations consume the same logic-layer events.

Current instrumentation includes:

- battle outcomes and turn counts
- source-specific damage attribution across disjoint buckets: Sync, Bomb, Attack, line-slice, Transform, Buffer, and Skill
- Function activation, Effect operation, and fizzle counts
- Hacker, Deck, inventory, active build, and Program order
- System identity, selection source, strong axes, and ordered build
- Transform activations with converted count, eligible count, and result axes
- countdown deliveries
- withheld System activations, as a battle-level count
- charge-stream generation and top-to-bottom routing
- Disabler target ID and readiness data
- cascade behavior, think time, save schema, and content fingerprint

System identity is battle-static: it lives once on the battle-level record and joins to turn and event records by `battleId` rather than being repeated per turn.

Charge waste is one canonical side-level total per battle, covering every source of Program-pool charge that could not be stored — end-of-stream routing discard and flat/timer overflow alike. Per-Program charge waste has been removed as an analytical authority; the Deck Function keeps its own separate bucket. Axis-specific waste remains deferred.

`BASIC`, `VERBOSE`, and `COMPLETE` logging levels, the storage budget, pre-write trimming, priority-ordered sacrifice, and content-stamp deduplication all behave as in Alpha 0.4.1.

Developer commands:

```bash
npm run logs:dump
npm run logs:wipe
```

The compact exporter classifies every record it reads as rendered, summarized, intentionally omitted, or unsupported. Only malformed JSON is reported as unparsable. Compact turn records intentionally omit repeated configuration and join it from the battle record instead.

## Architecture

```text
data/
  Authoritative Hacker, Skill, Deck, System, Program, and Function CSV resources

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
  Browser startup, menus, input, targeting, setup UI, and screen flow

scripts/
  Focused tests, smoke battles, batch analysis, HP ladder, and log tooling
```

The renderer contains no authoritative combat rules. Logic emits ordered events that the browser renders. Seeded combat can run without a browser.

Effect validation is centralized in the Effect registry. Runtime Effect dispatch remains exhaustive TypeScript code rather than a generalized scripting language.

## Manual verification still recommended

The automated suite and desktop-browser checks pass, but the following should still be checked manually:

- a real phone or tablet, especially Build-screen reorder and System Selection controls
- a complete four-battle Run through every Build and result transition
- Save and Quit from a between-battle Build, followed by resume
- retry-after-defeat retaining the same System
- EBUFF countdown overlays becoming live Buffs in the browser
- SPAM detonations and their charge generation in the browser
- a same-phase second System activation driven by Function-created charge

The development-only Find Sync control may overlap status text on a narrow viewport. This is pre-existing and does not affect production controls.

## Current scope

Alpha 0.5 establishes System identity as a data-driven encounter layer while preserving the Alpha 0.4 Hacker build system.

Not included yet:

- System passive Skills
- System build editing, System portfolios, or System Program acquisition
- rewards, Program acquisition, or permanent progression
- Run path choice, curated introductory encounters, or anti-repeat selection
- boss mechanics and battlefields
- multiple active Functions per Program, or Program passives
- multi-Packet targeting
- transform sources beyond `NEU`, or arbitrary transform scripting
- a generalized delayed-Function graph
- broad balance changes
- axis-specific charge-waste metrics
- final art, animation, audio, accessibility, or production polish

The next build can expand System content, passives, rewards, or encounter curation without replacing the Alpha 0.5 System identity, selection, transform, or countdown-delivery foundations.
