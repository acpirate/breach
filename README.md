# Breach — Alpha 0.6.0

Breach is a mobile-first match-3 combat game with a cyberpunk hacking theme. Alpha 0.6.0 adds the environment and reward layers around the established combat model: every battle is now fought on a HOST, every Run is a sequence of path choices, and one shared PASSIVE framework replaces the Hacker-only Skill mechanic.

The project remains a whitebox development build rather than a complete game. It supports browser play, deterministic headless simulation, four-battle Runs, Quick Matches, persistent in-progress state, event-sourced metrics, and validated external content.

## Current status

**Build:** `alpha-0.6.0`
**Active save schema:** `5`

Alpha 0.6.0 adds:

- a unified `PSV` PASSIVE framework replacing the retired `SKL` Skill dataset
- PASSIVEs referenced by Hackers, Systems, HOSTs, and UPGRADEs alike, stacking by source
- HOST (`HST`) as a first-class environment source with its own causal attribution
- UPGRADE (`UPG`) as persistent Run-local reward state, always Hacker-owned
- a Path Choice before every Run battle, committing a `SYS + HST + UPG` package
- a fixed DOORMAN + THRESHOLD Battle 1 whose paths differ only by UPGRADE
- randomized System/HOST route offers for Battles 2-4, with an `in_pool` authoring flag
- `START_OF_TURN` carrier PASSIVEs that invoke a Function at no cost
- continual PASSIVEs for match damage, match charge, charge dampening, Function damage, permanent Shield, and Bomb area
- four new named area patterns and the `PSV_BIGGER_BOMB` progression
- a generalized `EFFECT_TRANSFORM` axis grammar with neutral results and a two-tier target rule
- HOST Selection in Constructed Quick Match and automatic HOST selection in Random Quick Match
- System matching ON by default
- a `PENDING_PATH` save phase with exact, never-rerolled offers

The current implementation requirements are documented in:

```text
staging/breach-alpha-0.6.0-coding-agent-handoff.md
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

Alpha 0.6.0 handoff results:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` | 237 passed, 0 failed |
| `npm run smoke` | `SMOKE OK` |
| `npm run batch` | pass across 6 cells |
| `npm run hpladder` | pass — 76/74/85% in timer mode; 39/37/29% with System matching |
| `npm run build` | pass — 170.02 kB, 53.18 kB gzip |

Alpha 0.6 is a framework and content-structure build, not a balance pass. The player-facing default now runs with System matching ON, which is a deliberate difficulty change: the System takes a real turn instead of receiving a flat timer charge. Tuning is deferred to the post-beta content and balance pass. The ladder still reports both modes so the pre-0.6 numbers stay comparable.

Headless simulations pin one System (`SYS_01`) and one HOST (`HST_01` THRESHOLD, which has no PASSIVEs) so their output stays comparable between runs; random selection is gameplay behavior and does not belong in a measurement instrument.

The current content loads with zero errors and five expected warnings:

- duplicate display name `ATTACKER` across Hacker and System Programs
- duplicate display name `DISABLER` across Hacker and System Programs
- unreferenced showcase Functions `FNC_007`, `FNC_008`, and `FNC_009`

These are warnings rather than startup blockers. The Alpha 0.5 warning about `PRG_S_004` DISABLER being unfielded is gone: DOORMAN fields it, so the System now Drains in live play.

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
| `SYS_03` DOORMAN | 100 | Green, Yellow, Blue | Circle, Cross, Star | E-BOMBER, SHIELDER, ATTACKER, DISABLER |

DOORMAN is the fixed Battle 1 opponent and is excluded from the random pool by its `in_pool` flag. It is also the first authored System to field DISABLER, so System Drain now happens in live play rather than only in tests.

`PRG_SET` order is charge-routing priority, display order, and save identity. It is **not** Function-activation priority.

There is no System portfolio, System inventory, System Build screen, or System Program reordering in Alpha 0.6. System PASSIVEs are supported — the `PASSIVES` column resolves through the shared `PSV` dataset exactly as the Hacker's does — but no authored System currently references one. The retired `SKILL` header is not accepted as an alias; a stale export fails the header check.

Each System and HOST also carries an `in_pool` flag. Blank or `y` includes the row in random route generation and Random Quick Match; `n` excludes it. Deliberate selection screens ignore the flag and always list everything.

### Effective ICE

Under Normal LINK, System maximum ICE is:

```text
Quick Match:  BASE_ICE
Run battle N: BASE_ICE + run-step modifier   (+0, +50, +100, +150)
```

A `BASE_ICE = 100` System therefore still produces the established 100 / 150 / 200 / 250 Run ladder, while a future System with different durability escalates correctly without redesigning Run progression. With Normal LINK off, the manual System ICE setting replaces both the base and the step modifier; the values are never combined.

## HOSTs and UPGRADEs

A **HOST** is the battlefield a battle is fought on. It is a first-class causal source alongside the two agents — not a property of either — and it contributes PASSIVEs that affect the encounter. Every battle has exactly one HOST, Quick Match included.

| HOST | PASSIVE |
|---|---|
| `HST_01` THRESHOLD | none — the fixed Battle 1 battlefield |
| `HST_02` BITMIRE | `PSV_003` all Syncs generate 1 fewer charge |
| `HST_03` ARENA | `PSV_004` Function damage +2 |
| `HST_04` VERDUN | `PSV_007` bigger Bombs |
| `HST_05` WEEDS | `PSV_008` carries GREENING at every turn start |

An **UPGRADE** is Run-local reward state, always Hacker-owned. One is acquired at every Path Choice, it applies to that battle and every later battle of the Run, and no UPGRADE is ever acquired twice.

| UPGRADE | PASSIVE |
|---|---|
| `UPG_01` BRACER | `PSV_005` permanent Shield 1 |
| `UPG_02` GRACE | `PSV_006` +1 charge on a Yellow Sync |
| `UPG_03` L33TSK1LL | `PSV_003` the opponent's Syncs generate 1 fewer charge |
| `UPG_04` SNEAKERS | `PSV_009` carries SNEAK at every Hacker turn start |

There are four UPGRADEs and four acquisition decisions, so before Battle 4 exactly one remains and both final path cards legitimately offer it. Choosing either acquires it once; the log records that the duplicate came from pool exhaustion.

## Play modes

### New Run

```text
Title
→ Hacker Selection
→ Deck Selection
→ Path Choice          (commits the Run and replaces the save)
→ Build
→ Battle 1
→ Result
→ Path Choice
→ Build
→ Battle 2
→ ...
```

Every battle is preceded by a Path Choice offering two `SYS + HST + UPG` packages. Selecting one is immediate and final for that battle: it acquires the UPGRADE, commits the System and HOST, and opens the Build screen — so the player always edits the build against a fully known encounter.

Battle 1 is fixed: both paths are DOORMAN on THRESHOLD, and the only difference is the UPGRADE. Battles 2-4 randomize System and HOST independently from the `in_pool` subsets, avoiding two identical `SYS + HST` pairs within one offer when another combination exists. Repeating a previous battle's System or HOST is allowed.

Entering the **initial** Path Choice is the destructive commitment boundary: it creates the Run, replaces the previous save, generates the two offers, and persists them immediately. Reloading on a Path Choice restores exactly the same two cards — offers are never rerolled.

Retrying a lost battle preserves the committed System, HOST, and every acquired UPGRADE, and generates no new path. A full Restart Run clears Run-local progression: the acquired UPGRADEs go with the abandoned Run.

### Quick Match

- **Random Quick Match** generates a random build and order, chooses a System and a HOST automatically, and begins immediately without opening any selection screen.
- **Constructed Quick Match** opens System Selection, then HOST Selection, then the Build screen.

```text
Quick Match
→ Constructed Quick Match
→ System Selection
→ HOST Selection
→ Build
→ Battle
```

System Selection lists every valid loaded System with its Quick Match ICE, strong and weak axes, and ordered Programs. HOST Selection lists every valid loaded HOST with its resolved PASSIVE text — or, for a carrier with no authored display, its payload Function name. Both ignore `in_pool`: that flag governs random generation only, so a tester can always field a specific encounter deliberately.

There is no UPGRADE selection in Quick Match and no Run UPGRADE state in a Quick Match save.

Constructed Quick Match still remembers the last valid Hacker build and order, independent of Run progression. There is no remembered System or HOST preference.

### Selection randomness

Route and encounter selection use an isolated setup/route random source, never the battle's gameplay stream. Choosing a System or HOST cannot perturb the board, refills, or AI sequence for a given gameplay seed. A Run's route RNG state is persisted with the Run, so a save and resume produces the same route sequence an uninterrupted Run would.

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

Reinforced Connection suppresses base Sync damage for both sides. Match-triggered PASSIVEs and Functions still resolve. This includes Syncs created by `EFFECT_TRANSFORM`, whose base damage is suppressed like any other Sync.

## PASSIVEs

One external `PSV` dataset defines every passive in the game. Hackers, Systems, HOSTs, and UPGRADEs all reference rows from it, and the same row referenced by two different sources is **two instances that both apply** — PASSIVEs stack by source and are never deduplicated by ID.

A PASSIVE instance carries its source kind (`HAK`/`SYS`/`HST`/`UPG`), its source ID, and its PASSIVE ID everywhere it appears: in combat resolution, in logs, and in metrics.

### Scope

`agent_scope` is `OWNER` or `ENEMY` and resolves against the supplying agent. UPGRADEs are always Hacker-owned whichever agent their effect lands on. A HOST is not an agent: HOST instances **ignore** `agent_scope` and apply to both agents symmetrically.

### Continual PASSIVEs

| Effect | Behavior |
|---|---|
| `PSV_EXTRA_MATCH_DAMAGE` | adds raw Sync damage once per qualifying color-axis Sync, before crit, flooring, Buff, and Shield |
| `PSV_EXTRA_MATCH_CHARGE` | inflates the qualifying Sync's charge stream before routing, rather than opening a second pool |
| `PSV_CHARGE_DAMPEN` | reduces qualifying charge streams |
| `PSV_FUNCTION_DAMAGE_INCREASE` | adds to raw Function damage before Buff/Shield handling |
| `PSV_PERM_SHIELD` | non-removable Shield value stacked with Packet Shield |
| `PSV_BIGGER_BOMB` | advances every qualifying Bomb one named area-pattern step |

Charge arithmetic is order-independent:

```text
finalGenerated = max(0, baseGenerated + extra-charge bonuses − dampening)
```

Only the final amount is routed, through the ordinary top-to-bottom queue.

Permanent Shield is not a Packet: it cannot be sliced, blasted, or transformed away, it stacks with Packet Shield, and it is included in the displayed effective total.

`PSV_BIGGER_BOMB` advances the **named** pattern by one step per active instance and saturates at the largest registered pattern. Edge clipping does not change the step. A countdown Bomb is stamped with its upgraded pattern at arming time, so a save, a resume, and a later detonation all agree. It changes area only — never quantity, countdown, damage, targeting, or the charge tuple.

The area registry is cumulative, each entry a strict superset of the one before it:

| Pattern | Cells (unclipped) |
|---|---|
| `AREA_SELF` | 1 |
| `AREA_CARDINAL_1` | 5 |
| `AREA_SQUARE_3X3` | 9 |
| `AREA_SQUARE_3X3_CARDINAL_2` | 13 |
| `AREA_FAT_CROSS_2` | 21 |
| `AREA_SQUARE_5X5` | 25 |
| `AREA_FAT_CROSS_3` | 37 |
| `AREA_SQUARE_7X7_CROSS_4` | 69 |

The last two exceed half the 8×8 Datastream; with one VERDUN as the only BIGGER_BOMB source, a single step is the practical ceiling today.

### START_OF_TURN carriers

A carrier PASSIVE invokes its `function_payload` at the start of a turn and **pays no Function cost** — no pool is required and none is debited. The Function otherwise uses the ordinary expansion, targeting, atomic resolution, immediate-Sync, and cascade machinery, and its activation is logged with its PASSIVE source.

At the beginning of every agent turn, in this order:

1. HOST `START_OF_TURN` PASSIVEs
2. the active agent's own identity PASSIVEs
3. the Hacker's UPGRADE PASSIVEs, in acquisition order (Hacker turns only)
4. within one source, in authored reference order

Each triggered Function resolves completely — Effect, immediate Syncs, cascades, damage, charge — before the next begins. Only then do countdowns tick. A battle that reaches its terminal state part-way through stops rather than continuing to mutate.

### HOST causal source vs. Sync owner

A HOST trigger produces two distinct facts and both are preserved. WEEDS firing GREENING at the Hacker's turn start is *caused* by the HOST PASSIVE, but the Hacker is the **resolution owner** of any Sync it creates: damage profile, charge routing, and owner-scoped PASSIVEs all follow the Hacker. The same trigger on the System's turn makes the System the owner. Logs carry both the causal source and the resolution owner; they are never collapsed into one field.

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

## Effects and delayed delivery

### `EFFECT_TRANSFORM` and its axis grammar

A Transform changes the underlying color/shape identity of Packets matching an authored target spec. Alpha 0.6 generalizes both axis columns (director override, 2026-08-11):

```text
axisTarget:  NEU | ALL | <COLOR> | <SHAPE> | <COLOR>:<SHAPE>
axisResult:  NEU | <COLOR> | <SHAPE> | <COLOR>:<SHAPE>
```

The colon is **intersection** in both columns — `GRE:TRI` means "green triangles", never "green or triangular". There is no OR targeting, no multi-value axis, and no negation.

- `NEU` targets neutral Packets; `ALL` targets every Packet including neutrals
- a single axis value targets that value on one axis, any value on the other, and **excludes neutrals** (a neutral has no axis to match)
- a single-axis **result** preserves the other axis — or, when the target was neutral and so has none to preserve, randomizes it per Packet
- a `NEU` result turns the Packet neutral and always destroys any overlay, since a neutral tile cannot carry one
- `quantity` is an ordinary maximum: up to that many valid targets, fewer if fewer exist
- the typed tuple is `targeting:specialPacketTreatment`

**Target exclusion.** A Packet that already matches every result axis is a no-op and is never a valid target. Candidates fall into two tiers: those sharing *no* result axis, and — only for a two-axis result — those sharing exactly one. Tier 1 is drawn first and tier 2 tops up whatever quantity remains, so a Function never converts fewer Packets than it could. A row whose target constraints are identical to its result can never have a valid target and fails validation at startup.

Because axis-specific and `ALL` targeting can now reach standard Packets, `specialPacketTreatment` is live behavior for the first time: an overlay-carrying Packet can be transformed with its bomb, buff, or shield riding along.

Current content: COERCE is `NEU` → `YEL:STR`; GREENING is `ALL` → `GRE`; SNEAK is `ALL` → `MAG`.

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

DOORMAN fields DISABLER, so this path is exercised by live play from Battle 1 of every Run, not only by tests.

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
- HOST Selection: tap a HOST to see its PASSIVEs, then confirm.
- Path Choice: tap a path card to see its full package, then take it. Selection is final for that battle; there is no Back.
- Build screen: inspect, replace, and reorder the four active Programs.
- The Run Build screen shows the committed System and the committed HOST plus acquired UPGRADEs in collapsible panels.

### Functions

- Activate charged Hacker Functions before committing the turn-ending Sync.
- Targeted Functions enter Packet-targeting mode.
- Tap the armed Function again to cancel targeting without spending charge.
- SCRAMBLE remains a Deck-owned Function with its own charge pool.

### Menus and persistence

- **Continue** appears only for a compatible active save.
- **Save and Quit** is available at supported battle and between-battle boundaries.
- Restarting a Run clears acquired UPGRADEs and returns to the initial Path Choice.
- Settings retain Normal LINK and Reinforced Connection controls.

## Data-driven content

Runtime source files are stored under `data/`.

The nine required datasets define:

```text
Hackers
PASSIVEs
Decks
Hacker Programs
System Programs
Systems
HOSTs
UPGRADEs
Functions
```

Stable IDs preserve content identity:

```text
HAK_...      Hacker
PSV_...      PASSIVE
DEK_...      Deck
SYS_...      System
HST_...      HOST
UPG_...      UPGRADE
PRG_H_...    Hacker Program
PRG_S_...    System Program
FNC_...      Function
EFFECT_...   coded Effect
```

Hackers define LINK, strong color and shape sets, ordered PASSIVEs, and an ordered three-Program portfolio. Decks add LINK, an ordered three-Program portfolio, and one Deck Function. Systems define base ICE, strong color and shape sets, an ordered four-Program build, ordered PASSIVEs, and a pool flag. HOSTs define ordered PASSIVEs and a pool flag. UPGRADEs define ordered PASSIVEs. PASSIVEs define a coded effect, typed parameters, an activation, an agent scope, and an optional Function payload. Programs define identity, charge bindings, and one active Function. Functions define activation cost, payload, common fields, transform axes, and typed Effect-specific parameter tuples. Effects remain coded TypeScript actions rather than spreadsheet scripting.

A Function cost of `0` is legal so a PASSIVE carrier payload can state its true cost, but a zero-cost Function may **not** be assigned to a Program or Deck: a charge pool's capacity is its Function's cost, so such a Program would hold no pool and fire free every turn. That assignment is a blocking startup error.

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
- typed Effect parameter tuples and the transform axis grammar
- positive integer `BASE_ICE`
- exactly four distinct System Programs in each `PRG_SET`
- PASSIVE activation, agent scope, typed params, and required/forbidden Function payloads
- `START_OF_TURN` payloads that are executable without player targeting
- PASSIVE references from every source kind
- at least four valid UPGRADE rows
- a nonempty random pool for both Systems and HOSTs
- zero-cost Functions not assigned to a Program or Deck
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

Alpha 0.6 uses save schema `5`.

Supported active-save phases are:

- `ACTIVE_BATTLE`
- `PENDING_RESULT`
- `PENDING_BUILD` for Run state between battles
- `PENDING_PATH` for a committed Run sitting on a Path Choice

Saves include the selected Hacker, Deck, System, and HOST, how the System was chosen, the acquired UPGRADEs in acquisition order, the six-Program inventory, the ordered four-Program active build, the System's ordered build, battle identity, board and special state (including armed countdowns and their stamped area patterns), LINK/ICE, Program and Deck charge, configuration, metrics, content fingerprint, the isolated route RNG state, and deterministic gameplay RNG state where applicable.

A `PENDING_PATH` save carries no battle and holds the two exact offers, which restore verbatim — a reload never rerolls them.

System, HOST, and UPGRADE identity are stored as stable IDs. Immutable definitions are not copied into the save; they resolve through the matching content fingerprint.

Alpha 0.5 saves are rejected cleanly. There is no migration and no partial restore: an old save cannot represent PASSIVE authority, HOST identity, acquired UPGRADEs, pending offers, or a committed path package, and restoring one would mean inventing them. Saves with stale inventory, an unknown `SYS_ID`/`HST_ID`/`UPG_ID`, a duplicate acquired UPGRADE, structurally incomplete offers, an exhaustion flag that disagrees with the offers, a System build that no longer matches, or a mismatched gameplay-content fingerprint are rejected rather than silently defaulted.

The remembered Constructed Quick Match preset is stored separately under its own versioned preference key and survives the schema bump. It holds a Hacker build only.

## Metrics and logging

Human play and automated simulations consume the same logic-layer events.

Current instrumentation includes:

- battle outcomes and turn counts
- source-specific damage attribution across disjoint buckets: Sync, Bomb, Attack, line-slice, Transform, Buffer, and PASSIVE
- Function activation, Effect operation, and fizzle counts
- Hacker, Deck, inventory, active build, and Program order
- System identity, selection source, strong axes, and ordered build
- HOST identity and selection source; acquired UPGRADEs in acquisition order
- route offers and commitments: target battle, both offered `SYS`/`HST`/`UPG` packages, the pool-exhaustion flag, the selected path, and the acquired list afterwards
- PASSIVE contributions keyed by INSTANCE — source kind, source ID, and PASSIVE ID — so several PASSIVEs modifying one calculation stay individually attributable
- HOST causal source alongside the agent that owned the resulting Sync
- Transform activations with converted count, eligible count, fallback-tier usage, and both axis tokens
- countdown deliveries
- withheld System activations, as a battle-level count
- charge-stream generation and top-to-bottom routing
- Disabler target ID and readiness data
- cascade behavior, think time, save schema, and content fingerprint

System, HOST, and UPGRADE identity are battle-static: they live once on the battle-level record and join to turn and event records by `battleId` rather than being repeated per turn.

The base event always keeps its own mechanism attribution and a PASSIVE's increment is recorded separately, so metric totals still reconcile exactly after PASSIVE modifiers.

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
  Authoritative Hacker, PASSIVE, Deck, System, HOST, UPGRADE, Program, and
  Function CSV resources — the nine required runtime datasets

staging/
  Handoff specifications and the authoring workbook they were exported from

src/logic/data/
  Shared CSV parsing, normalization, validation, resolution, and fingerprinting

src/dataBrowser.ts
  Browser/Vite content-loading adapter

scripts/dataNode.ts
  Node filesystem content-loading adapter

src/logic/
  Pure deterministic combat, build state, PASSIVE runtime, route/Run state,
  saves, metrics, and events

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

- a real phone or tablet, and any narrow viewport, especially the path cards, HOST Selection, the Build context panels, and the Settings accordion
- a complete four-battle Run through every Path Choice, Build, and result transition
- the final Path Choice showing the one remaining UPGRADE on both cards
- Save and Quit from a between-battle Build, followed by resume
- retry-after-defeat retaining the same encounter package and UPGRADE list
- VERDUN/`PSV_BIGGER_BOMB` visibly enlarging a detonation
- SNEAKERS/SNEAK firing at Hacker turn start
- a START_OF_TURN carrier resolving before a countdown ticks, in a setup that shows it
- EBUFF countdown overlays becoming live Buffs in the browser
- SPAM detonations and their charge generation in the browser
- a same-phase second System activation driven by Function-created charge

The development-only Find Sync control may overlap status text on a narrow viewport. This is pre-existing and does not affect production controls.

## Current scope

Alpha 0.6 establishes the environment, reward, and passive layers around the Alpha 0.5 encounter model.

Not included yet:

- boss mechanics, boss-specific route rules, or boss battlefields
- permanent account progression, or rewards outside the Run-local UPGRADE layer
- reward rarity or economy
- a procedural map beyond the two-option path screen
- System build editing, System portfolios, or System Program acquisition
- HOST active abilities outside PASSIVEs
- UPGRADE selection in Quick Match
- PASSIVE anti-stacking rules, passive cooldowns, or generalized trigger/rule scripting
- multiple active Functions per Program, or Program passives
- multi-Packet targeting
- a generalized delayed-Function graph
- broad balance changes — Alpha 0.6 is a framework build and tuning is deferred to the post-beta content and balance pass
- runtime-editable content in a production bundle: `data/*.csv` are read from disk by the headless tools and re-read on reload in `npm run dev`, but `npm run build` still inlines them
- axis-specific charge-waste metrics
- final art, animation, audio, accessibility, or production polish

The next build can add boss rules, more PASSIVE content, or encounter curation without replacing the Alpha 0.6 PASSIVE framework, HOST/UPGRADE layers, or route state.
