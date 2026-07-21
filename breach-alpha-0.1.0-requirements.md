# Breach Alpha 0.1.0 - Data-Driven Program and Function Architecture

**Status:** Canonical Alpha 0.1.0 implementation requirements.

**Authority:** This document supersedes the Proof-of-Concept and MK2-MK9 requirements as the normative specification for the current build. Earlier requirements remain historical references and restore points. They are useful for rationale, but when they conflict with this document or with an explicitly approved pre-build resolution, this document governs.

**Build identity:** `alpha-0.1.0`

**Purpose:** Alpha 0.1.0 marks the transition from refining one hardcoded combat implementation to creating reusable content infrastructure for the final game. The build replaces hardcoded Program and Function definitions with externally loaded, validated data while preserving the established combat engine except for the explicit changes listed here.

---

## 1. Build Objective

Replace the current hardcoded combat Program and Function definitions with externally loaded, validated, modular data.

The completed build must:

1. Load Hacker Program, System Program, and Function datasets automatically at application startup.
2. Validate the complete data set before initializing gameplay.
3. Resolve valid Program and Function records into the runtime combat structures used by the existing engine.
4. Make the resolved runtime model the single source of truth for human battles, automated simulations, UI, metrics, logs, and persistence.
5. Preserve the established combat experience except for the approved Alpha 0.1.0 changes in Section 4.
6. Establish infrastructure that can support later Program breadth, Function reuse, encounter variety, build systems, and run progression without another foundational rewrite.

This is an infrastructure build. Do not add unrelated content systems or redesign the combat model.

---

## 2. Terminology and Naming

Use Breach-specific vocabulary in requirements, data, logs, UI, and code where practical.

- **Hacker:** the player-controlled side.
- **System:** the enemy-controlled side.
- **Program:** a combat unit that owns charge bindings, a charge pool, and one or more Function references.
- **Function:** an active ability with an activation cost and a payload.
- **Effect:** a coded TypeScript game action invoked by a Function.
- **PRG:** preferred Program abbreviation and ID prefix family.
- **FNC:** preferred Function abbreviation and ID prefix.
- **EFFECT:** required coded Effect ID prefix.

Generic terms such as `unit`, `ability`, `player`, and `enemy` remain acceptable for engine abstractions and existing internal APIs when renaming would create unnecessary churn. New Breach-facing structures should prefer Program, Function, Hacker, and System.

### 2.1 Stable ID families

- Hacker Program IDs begin with `PRG_H_`.
- System Program IDs begin with `PRG_S_`.
- Function IDs begin with `FNC_`.
- Effect IDs begin with `EFFECT_`.

IDs are stable machine identifiers. Display names are not identifiers.

---

## 3. Current Combat Baseline to Preserve

The existing Alpha predecessor build is the implementation baseline. Alpha 0.1.0 is not permission to reinterpret combat rules while moving definitions into data.

Unless this document explicitly changes a rule, preserve the current implementation and its established tests for:

- 8x8 shared match-3 board.
- Six colors, six shapes, and neutral tiles.
- Color-axis and shape-axis matching.
- Blob/merge matching and per-tile destruction deduplication.
- Match tiers, line clears, critical multipliers, and cap-0 deterministic settling behavior.
- Flat per-tile charge distribution and charge capped at each Program's active Function cost.
- Player pre-match Function phase followed by one turn-ending match.
- System timer-charge mode and optional System matching mode, including the existing bot behavior for each active configuration.
- Countdown ticking at the start of the owning side's turn, oldest placed countdown first, with each detonation fully resolved before the next countdown ticks.
- Existing special-tile placement rules, ownership, clearing, cascades, and save/restore behavior.
- Current Hacker/System owner-dependent strong damage tiers. The Hacker retains the historical HIGH color and shape partitions; the System uses the complementary LOW partitions. The three HIGH and three LOW values partition the six colors and six shapes exactly.
- Owner-dependent tile strength for match damage and bomb-blast damage.
- Current Buffer, Bomb, E-Bomb, Shield, Attack, and Drain behavior as formalized in Section 9.
- Current damage attribution order and disjoint metrics buckets.
- Existing pause menu, Character Sheet separation, hints, debug controls, aspect-ratio containment, logging paths, metrics, and simulation harness.
- Server-side raw-log and dump storage protection established in MK9.

### 3.1 Damage calculation order

For every discrete incoming damage instance:

1. Calculate causal/base damage.
2. Calculate Buffer-added damage as its own disjoint attribution bucket.
3. Sum causal/base and Buffer-added damage to obtain pre-shield damage.
4. Read the defender's current live shield value.
5. Prevent up to the current shield value, to a minimum final damage of 0.
6. Apply final damage to the opposing HP pool.
7. Record causal/base, Buffer-added, pre-shield, prevented, and final damage without double counting.

Shield prevention is not damage dealt and must not be inserted into damage-source totals.

### 3.2 Special-tile timing

- A same-side Buffer tile destroyed during a damage step still contributes its bonus to that same step, but not to later steps.
- Shield value is read live when damage is applied. A Shield tile removed earlier in the same step does not protect against damage applied after its removal.
- Bomb blast tile removal occurs before that blast's damage is applied. A Shield tile destroyed by the blast therefore does not protect against that blast.

### 3.3 Default targeted-Function convention

Unless an Effect defines an explicit override:

- Hacker-controlled targeted Effects present a targeting interface and require the player to choose a valid target.
- System-controlled targeted Effects select randomly among all valid targets.

An explicit deterministic, priority-based, global, or otherwise custom targeting rule overrides this default.

---

## 4. Approved Alpha 0.1.0 Changes

The following are intentional changes, not regressions:

1. Program bindings, Function assignments, Function costs, and Function parameters become externally data-driven.
2. The Function costs in the Alpha data are authoritative:
   - Bomb: 7
   - Buff: 8
   - Attack: 10
   - Drain: 9
   - E-Bomb: 7
   - Shield: 8
3. Remove `FLAT_ABILITY_COST` and all flat-cost override behavior.
4. Remove the in-game individual Function/ability cost configuration controls.
5. Ignore or remove obsolete persisted settings for those deleted cost controls without crashing.
6. Hacker and System Program charge bindings in the supplied Program datasets are authoritative, including identical current bindings between corresponding Hacker and System Programs.
7. Charge bindings remain independent from owner-dependent strong damage tiers.
8. Reject pre-Alpha 0.1.0 in-progress saves. Do not migrate them.
9. Update every active build/version tag from stale MK values, including `MK7`, to `alpha-0.1.0`.
10. Program and Function content may no longer fall back to hardcoded definitions.

---

## 5. Data Architecture

### 5.1 Three-layer model

#### Program layer

Program data defines:

- stable Program ID;
- display name;
- one or more charge-color bindings;
- one or more charge-shape bindings;
- assigned Function reference;
- non-normative notes.

Hacker and System Programs remain in separate CSV datasets for human readability and organization.

#### Function layer

Function data defines:

- stable Function ID;
- display name;
- activation cost;
- payload reference or references;
- named Effect parameter columns;
- non-normative notes.

Multiple Programs may reference the same Function when their behavior is genuinely identical.

#### Effect layer

Effects remain coded TypeScript game actions registered under stable `EFFECT_*` IDs.

CSV data selects an Effect and supplies validated data. CSV files must never contain executable code, arbitrary expressions, or a generalized scripting language.

### 5.2 Single source of truth

After startup validation and resolution, the resolved runtime Program and Function model is authoritative for:

- human battle initialization;
- automated battle initialization;
- charge costs and charge caps;
- color and shape bindings;
- Function availability;
- Function execution;
- UI labels and charge displays;
- Character Sheet content;
- battle configuration stamps;
- metrics and logs;
- save serialization and restore validation.

Do not keep parallel hardcoded Program or Function definitions for any of these consumers.

### 5.3 Runtime loading

- Package CSV files as application resources.
- Load them once during application startup.
- Validate and resolve them before title-screen or battle initialization.
- Do not reload or hot-swap data during an active application session or battle.
- Data changes take effect only after a full application reload/restart.
- Browser play and Node/headless tools must consume the same CSV resources and the same parser, validator, reference resolver, and runtime-construction logic.
- Browser and Node may use different file-acquisition adapters, but they must converge on the same raw text and shared pure TypeScript pipeline.
- The editable workbook is an authoring source. Alpha 0.1.0 consumes exported CSV files. Workbook export automation is out of scope.

---

## 6. Required Datasets and Schemas

The initial required datasets are:

1. Hacker Programs.
2. System Programs.
3. Functions.

The loader configuration or manifest identifies each dataset's role. Program ID prefixes independently cross-check that identity. Do not rely only on a filename to determine row meaning.

### 6.1 Program CSV schema

Both Hacker and System Program files use this exact shared header:

```csv
PRG_ID,name,colors,shapes,functions,notes
```

#### Field rules

| Field | Type | Required | Rules |
|---|---|---:|---|
| `PRG_ID` | string | yes | Globally unique; Hacker file requires `PRG_H_` prefix; System file requires `PRG_S_` prefix. |
| `name` | string | yes | Trimmed, nonempty, uppercase display name. Duplicate names are allowed but produce a warning. |
| `colors` | string | yes | One or more existing color enum names separated by `:`. |
| `shapes` | string | yes | One or more existing shape enum names separated by `:`. |
| `functions` | string | yes | Alpha 0.1.0 requires exactly one `FNC_*` reference per Program. |
| `notes` | string | no | Non-normative human notes; never interpreted as behavior. |

#### List parsing

For `colors`, `shapes`, and any future multi-entry field:

- split on `:`;
- trim every token;
- reject blank tokens;
- reject duplicate tokens within one field;
- reject unknown enum values;
- preserve listed order where order could later become meaningful.

The color and shape vocabularies must use the existing engine enums. Before implementation, the agent must report the complete accepted color and shape enum sets and confirm the CSV values map exactly to them.

### 6.2 Function CSV schema

The Function file uses this exact header:

```csv
FNC_ID,name,cost,payload,notes,quantity,countdown,areaPattern,magnitude,damage
```

Column order should be accepted exactly as supplied. Parser logic must bind by header name rather than positional index after headers are validated.

#### Field rules

| Field | Type | Required | Rules |
|---|---|---:|---|
| `FNC_ID` | string | yes | Globally unique `FNC_*` ID. |
| `name` | string | yes | Trimmed, nonempty, uppercase display name. Duplicate names are allowed but produce a warning. |
| `cost` | integer | yes | Positive integer, 1-9999. |
| `payload` | string | yes | Exactly one `EFFECT_*` ID or one or more `FNC_*` IDs separated by `:`. Mixing Effect and Function IDs is invalid. |
| `notes` | string | no | Non-normative human notes; never interpreted as behavior. |
| `quantity` | integer | effect-specific | Number of discrete board-item deployments made by one Effect resolution. It does not repeat the Function. |
| `countdown` | integer | effect-specific | Positive turns remaining before a placed countdown object resolves. |
| `areaPattern` | string enum | effect-specific | Named area-pattern ID from Section 8. |
| `magnitude` | integer | effect-specific | Positive non-damage strength interpreted by the Effect contract. |
| `damage` | integer | effect-specific | Positive HP damage supplied to the Effect contract. |

Numeric parsing rules:

- blank or whitespace-only means absent;
- `0` is populated, not absent;
- decimal, exponential, signed, nonnumeric, `NaN`, or unsafe integer forms are invalid;
- required numeric fields must be positive integers;
- `quantity` must be 1 through board capacity, currently 64;
- `countdown` must be 1-9999;
- `magnitude` and `damage` must be 1-999999.

### 6.3 Expected Alpha 0.1.0 Program records

The supplied Program data is authoritative for this build.

#### Hacker Programs

| PRG_ID | name | colors | shapes | functions |
|---|---|---|---|---|
| `PRG_H_001` | `BOMBER` | `RED` | `TRI` | `FNC_001` |
| `PRG_H_002` | `BUFFER` | `GRE` | `SQU` | `FNC_002` |
| `PRG_H_003` | `ATTACKER` | `YEL` | `STR` | `FNC_003` |
| `PRG_H_004` | `DISABLER` | `BLU` | `CIR` | `FNC_004` |

#### System Programs

| PRG_ID | name | colors | shapes | functions |
|---|---|---|---|---|
| `PRG_S_001` | `E-BOMBER` | `RED` | `TRI` | `FNC_005` |
| `PRG_S_002` | `SHIELDER` | `GRE` | `SQU` | `FNC_006` |
| `PRG_S_003` | `ATTACKER` | `YEL` | `STR` | `FNC_003` |
| `PRG_S_004` | `DISABLER` | `BLU` | `CIR` | `FNC_004` |

### 6.4 Expected Alpha 0.1.0 Function records

| FNC_ID | name | cost | payload | quantity | countdown | areaPattern | magnitude | damage |
|---|---|---:|---|---:|---:|---|---:|---:|
| `FNC_001` | `BOMB` | 7 | `EFFECT_BOMB` | 2 | 2 | `AREA_SQUARE_3X3` | blank | blank |
| `FNC_002` | `BUFF` | 8 | `EFFECT_BUFF` | 1 | blank | blank | 5 | blank |
| `FNC_003` | `ATTACK` | 10 | `EFFECT_ATTACK` | blank | blank | blank | blank | 30 |
| `FNC_004` | `DRAIN` | 9 | `EFFECT_DRAIN` | blank | blank | blank | blank | blank |
| `FNC_005` | `EBOMB` | 7 | `EFFECT_BOMB` | 1 | 3 | `AREA_SQUARE_3X3_CARDINAL_2` | blank | blank |
| `FNC_006` | `SHIELD` | 8 | `EFFECT_SHIELD` | 2 | blank | blank | 2 | blank |
| `FNC_007` | `SHOWCASE` | 9 | `FNC_008:FNC_009` | blank | blank | blank | blank | blank |
| `FNC_008` | `ONEBOMB` | 5 | `EFFECT_BOMB` | 1 | 2 | `AREA_SQUARE_3X3` | blank | blank |
| `FNC_009` | `ONESHIELD` | 5 | `EFFECT_SHIELD` | 1 | blank | blank | 2 | blank |

`FNC_007`-`FNC_009` ship in the production Function dataset as composition examples. They need not be assigned to a Program in normal play, but they must validate and must be exercised by focused automated tests.

---

## 7. Function Payload and Composition Rules

### 7.1 Leaf Functions

A leaf Function has exactly one `EFFECT_*` payload.

Example:

```text
FNC_001 -> EFFECT_BOMB
```

### 7.2 Composite Functions

A composite Function has one or more `FNC_*` payload entries separated by `:`.

Example:

```text
FNC_007 -> FNC_008:FNC_009
```

Rules:

1. Payload entries resolve sequentially from left to right.
2. The parent Function pays its activation cost once.
3. Child Function costs are ignored during parent execution.
4. A composite child must be a leaf Function.
5. A composite Function may not reference another composite Function.
6. A payload may not mix `EFFECT_*` and `FNC_*` entries.
7. Self-reference is invalid.
8. Direct or indirect cycles are invalid.
9. Repeating the same leaf Function ID in a composite payload is allowed and intentionally executes that child again.
10. `quantity` never repeats the Function. Repeated Function execution is represented through repeated child Function IDs.

### 7.3 Targeting constraints after payload expansion

Resolve a composite into its ordered leaf Effect operations for validation.

Across one Hacker or System Function execution:

- no more than one non-random targeted operation may occur;
- when present, the non-random targeted operation must be the first expanded operation;
- random-targeted and untargeted operations may follow;
- two Drain operations in one expanded payload are invalid;
- the same rules apply to Hacker and System Function execution.

A payload that violates these rules is a startup validation error.

### 7.4 Child resolution outcomes

Normal child outcomes are:

- resolved with effect;
- legal fizzle because no valid target or placement exists;
- skipped as defined by the Effect's legal runtime rules.

A legal fizzle does not stop later child payloads from being attempted.

Unexpected exceptions are implementation failures, not legal fizzles. They must be reported through the existing application failure boundary and must not be silently converted into normal gameplay outcomes.

### 7.5 Metrics for composites

Metrics and logs must distinguish:

- parent Function activation;
- child Function resolution attempt;
- Effect execution;
- successful resolution;
- legal fizzle;
- unexpected failure.

A composite must not inflate the parent activation count by counting child Functions as separate player-paid activations.

---

## 8. Area-Pattern Registry

Area patterns are enumerated stable IDs mapped to explicit coordinate sets. Effects reference the ID; they do not calculate a mathematical radius from a number.

Coordinate convention:

- `(0,0)` is the source or detonating tile.
- Positive X is right.
- Negative X is left.
- Positive Y is down.
- Negative Y is up.
- Coordinates outside the board are clipped.
- Coordinates form a set and resolve at most once.
- The set has no inherent execution order.

Alpha 0.1.0 defines only patterns 0-3. Any other value is invalid.

### 8.1 `AREA_SELF` - catalog 0

```text
(0,0)
```

### 8.2 `AREA_CARDINAL_1` - catalog 1

Includes `AREA_SELF` plus the four cardinal neighbors.

```text
(0,0)
(0,-1)
(1,0)
(0,1)
(-1,0)
```

### 8.3 `AREA_SQUARE_3X3` - catalog 2

Includes every coordinate in the centered 3x3 square.

```text
(-1,-1) (0,-1) (1,-1)
(-1, 0) (0, 0) (1, 0)
(-1, 1) (0, 1) (1, 1)
```

### 8.4 `AREA_SQUARE_3X3_CARDINAL_2` - catalog 3

Includes all `AREA_SQUARE_3X3` coordinates plus one tile in each cardinal direction at distance 2.

```text
                  (0,-2)

(-1,-1) (0,-1) (1,-1)
(-2, 0) (-1,0) (0,0) (1,0) (2,0)
(-1, 1) (0, 1) (1, 1)

                  (0,2)
```

The runtime registry should store the exact coordinate arrays directly. Do not derive later patterns from catalog numbers or infer missing patterns 4-7.

---

## 9. Effect Registry and Contracts

The Effect registry maps stable `EFFECT_*` IDs to coded TypeScript behavior and a validation contract.

For every Function row:

- missing required parameters are errors;
- invalid types or ranges are errors;
- populated but unused parameters are warnings;
- blank means unused;
- numeric `0` is populated and therefore produces an unused-field warning when that field is not accepted;
- unknown fields, unknown Effects, and unknown area patterns are errors;
- Effects must not silently repair malformed data.

### 9.1 `EFFECT_BOMB`

**Required:** `quantity`, `countdown`, `areaPattern`

**Unused:** `magnitude`, `damage`

Behavior:

1. One Effect resolution attempts `quantity` separate Bomb deployments.
2. Each deployment uses the existing special-tile placement rule: select a valid random non-neutral tile that is not already a special tile, preserve its color and shape, and add Bomb owner/countdown state.
3. Resolve placement attempts independently. Failure to find a valid tile for one deployment legally fizzles that deployment and does not cancel later attempts.
4. Bomb countdown ticks at the start of its owner's turn under the existing oldest-first countdown order.
5. At zero, destroy the Bomb and every in-bounds coordinate in its `areaPattern`.
6. Destroyed Bombs do not chain-detonate. Destroyed special tiles are removed as normal tiles under existing rules.
7. Bomb damage is calculated from the destroyed tiles using the acting owner's color/shape strength rules and current causal damage attribution.
8. Bomb detonation grants no charge.
9. Resulting falls and deterministic settling use existing cascade rules.
10. A same-side Buffer caught in the blast contributes to that same blast under the current Buffer timing rule.
11. Shield tiles removed by the blast are removed before blast damage is applied and therefore do not protect against that blast.

### 9.2 `EFFECT_BUFF`

**Required:** `quantity`, `magnitude`

**Unused:** `countdown`, `areaPattern`, `damage`

Behavior:

1. Attempt `quantity` separate Buffer-tile deployments using the existing special-tile placement rule.
2. Each active Buffer tile contributes its own `magnitude` to its owner's outgoing damage.
3. Multiple same-owner Buffer tiles stack additively.
4. For a match resolution step, apply the total Buffer bonus once to the combined damage for that step, not once per simultaneous match.
5. Apply the total Buffer bonus to each separate ability or Bomb damage instance under the existing attribution model.
6. A same-side Buffer destroyed during a damage step still contributes to that same step, but not later steps.
7. Buffer-added damage remains a disjoint metrics bucket.

### 9.3 `EFFECT_ATTACK`

**Required:** `damage`

**Unused:** `quantity`, `countdown`, `areaPattern`, `magnitude`

Behavior:

1. Create one direct-damage instance against the opposing global HP pool.
2. Add current same-side Buffer damage.
3. Apply the defender's live Shield value.
4. Record causal/base, Buffer-added, pre-shield, prevented, and final damage.
5. This is a global opposing-HP action, not a targeted Program operation.

### 9.4 `EFFECT_DRAIN`

**Required:** none

**Unused:** `quantity`, `countdown`, `areaPattern`, `magnitude`, `damage`

Behavior:

- Remove all current charge from one opposing Program.
- Do not create a generalized targeting-data system in Alpha 0.1.0.

#### Hacker-controlled Drain

- Present the existing targeting interface.
- Require the player to choose a valid opposing Program.
- A Program is a valid Drain target even when its current charge is 0 unless the current interface already excludes it; report this existing behavior during pre-build inspection and preserve it unless explicitly authorized otherwise.

#### System-controlled Drain override

This explicit algorithm overrides the default random System targeting rule:

1. Eligible Hacker Programs have current raw charge greater than 0.
2. Select the eligible Program with the highest current raw charge.
3. Break ties by highest activation cost.
4. Break remaining ties randomly.
5. If no Hacker Program has charge greater than 0, the Function fires and legally fizzles with no target and no effect.

Preserve this complete ordered algorithm. Do not summarize it only as deterministic.

### 9.5 `EFFECT_SHIELD`

**Required:** `quantity`, `magnitude`

**Unused:** `countdown`, `areaPattern`, `damage`

Behavior:

1. Attempt `quantity` separate Shield-tile deployments using the existing special-tile placement rule.
2. Each active Shield tile contributes its own `magnitude` shield points to its owner.
3. Total active shield value equals the sum of all same-owner Shield tiles currently on the board.
4. Every separate incoming damage instance is reduced independently by the live total shield value, to a minimum final damage of 0.
5. Shield applies to match damage, Attack damage, Bomb damage, and any other discrete damage event unless that future Effect explicitly overrides it.
6. Shield tiles are board objects removed by normal matching, cascades, Bombs, and other tile-clearing effects.
7. Shield value is read at damage-application time. A Shield removed earlier in the step no longer protects later damage in that step.

---

## 10. Validation and Startup Failure Behavior

### 10.1 Validation phases

Run validation in ordered phases while collecting all discoverable errors and warnings:

1. Acquire all required files.
2. Validate required headers and reject duplicate or unknown headers.
3. Parse all rows and primitive field types.
4. Validate IDs, prefixes, names, enum values, numeric ranges, and field contracts.
5. Validate global ID uniqueness.
6. Validate Program-to-Function references.
7. Validate Function payload references.
8. Validate leaf/composite grammar, nesting, self-reference, and cycles.
9. Expand composites and validate targeting constraints.
10. Validate that all required Alpha records in Sections 6.3 and 6.4 are present and valid.
11. Construct resolved immutable runtime definitions only when no errors exist.

### 10.2 Strict failure policy

- Collect and log every validation error that can be found safely in one pass.
- If any validation error exists, abort application startup.
- Do not reject individual rows and continue with a partial roster.
- Do not use minimum-valid-row workarounds.
- Do not silently repair or coerce malformed gameplay data.
- Do not fall back to hardcoded Program or Function definitions.
- Warnings do not block startup.

### 10.3 Required diagnostics

Each error or warning must include, where available:

- severity;
- dataset identity;
- source filename or resource identity;
- one-based source row;
- record ID;
- field;
- supplied value;
- expected type, range, enum, reference, or grammar;
- concise reason.

Duplicate display names and populated unused parameters are warnings. Broken references, invalid schema, invalid IDs, wrong side prefixes, missing required fields, invalid numbers, mixed payload types, illegal nesting, cycles, and targeting-order violations are errors.

### 10.4 Environment-specific startup result

#### Browser

- Do not initialize normal title or battle flow.
- Display a blocking developer-facing data-load failure screen.
- Show a concise error count and direct the developer to detailed logs.
- The screen must not expose a button that bypasses validation.

#### Node/headless tooling

- Print or write the complete structured validation report through the existing diagnostic path.
- Exit with a nonzero status.

Validation diagnostics are startup/tooling records, not battle event-stream metrics.

---

## 11. Runtime Model Requirements

### 11.1 Resolved Program

At minimum, a resolved Program exposes:

- stable ID;
- side identity;
- display name;
- normalized color-binding set/list;
- normalized shape-binding set/list;
- resolved Function reference;
- charge-pool capacity;
- non-normative notes if retained for developer UI.

Alpha 0.1.0 permits exactly one Function per Program. Charge-pool capacity equals at least the highest cost among its assigned Functions; with one Function, it equals that Function's cost unless the existing engine requires a larger compatible representation.

### 11.2 Resolved Function

At minimum, a resolved Function exposes:

- stable ID;
- display name;
- cost;
- immutable ordered payload plan;
- validated Effect-specific parameters;
- leaf/composite classification;
- non-normative notes if retained for developer UI.

Do not repeatedly parse colon-separated strings during combat. Resolve strings to typed IDs and immutable runtime objects at startup.

### 11.3 Effect registry

The Effect registry must:

- provide one authoritative lookup from Effect ID to behavior and validation contract;
- reject duplicate registrations;
- expose enough metadata for startup validation without executing combat behavior;
- keep game rules in pure logic modules rather than rendering code.

### 11.4 Immutability

Resolved definitions are read-only for the application session. Mutable battle state stores charge, placed objects, countdowns, HP, and other per-battle values separately from immutable content definitions.

---

## 12. UI and Settings Integration

1. Program names, Function names, costs, and bindings displayed in battle UI and Character Sheet must come from resolved data.
2. The Character Sheet continues to separate Hacker and System sections.
3. Charge and neutral-tile explanatory lines remain at the bottom of the Character Sheet scroll content.
4. Remove flat-cost controls and individual cost controls from pre-battle settings.
5. Remove dead UI labels, tooltips, and read-only battle-config rows tied only to the deleted cost controls.
6. Preserve all unrelated settings and current defaults.
7. Targeting UI continues to support touch and desktop pointer/mouse input.
8. No Program-management, roster-selection, loadout, Function editor, or user-facing data editor is added.

---

## 13. Metrics, Logs, and Versioning

### 13.1 Version stamp

Update every active browser, server, JSON, JSONL, dump, summary, simulation, and battle record path to use:

```text
alpha-0.1.0
```

No active output path may continue to emit `MK7`, `MK8`, `MK9`, or another stale build tag after this build.

### 13.2 Content identity in records

Battle and simulation records must be attributable to the loaded content. Stamp at least:

- game/build version;
- data-schema version;
- normalized content fingerprint;
- Hacker Program IDs;
- System Program IDs;
- resolved Function IDs and costs;
- active battle configuration.

Avoid duplicating full notes or raw CSV rows into every battle record.

### 13.3 Existing event stream

Continue using the existing event-sourced combat metrics stream for combat events. Do not create a parallel combat telemetry system.

Startup validation and server log-operation diagnostics remain outside the battle event stream.

### 13.4 Function execution metrics

Metrics must use stable IDs and preserve display names as optional human-readable context.

For composite execution, distinguish parent activation, child resolution, Effect execution, legal fizzle, and unexpected failure as described in Section 7.5.

### 13.5 Server logging behavior

Preserve the current server-only filesystem usage guard, raw-log wipe behavior, cumulative readable dump behavior, graceful write-failure isolation, and threshold-derived sentinel wording. This build does not redesign log storage.

---

## 14. Persistence and Compatibility

### 14.1 Pre-Alpha saves

Reject every in-progress save created before Alpha 0.1.0 through the existing invalid/incompatible-save handling. Do not migrate hardcoded Program or Function state.

### 14.2 New save identity

New saves must include:

- `alpha-0.1.0` game version;
- data-schema version;
- normalized gameplay-content fingerprint;
- stable Hacker and System Program IDs;
- stable Function IDs needed to restore state;
- mutable battle state already required by the existing save architecture.

### 14.3 Content fingerprint

Calculate the fingerprint from normalized gameplay-relevant content, including:

- Program IDs and side identity;
- color and shape bindings;
- Function references;
- Function IDs and costs;
- ordered payloads;
- validated Effect parameters;
- area-pattern registry definitions used by the content.

Exclude:

- `notes`;
- CSV whitespace and row formatting;
- display names, unless the implementation requires them to restore UI state.

A fingerprint mismatch rejects the save rather than loading a battle under changed Function behavior.

### 14.4 Restore behavior

Restore by stable IDs against the current resolved definitions. Do not serialize executable behavior or create a second embedded copy of Function definitions in the save.

---

## 15. Required Tests and Verification

Use the repository's existing build, unit-test, smoke-test, and simulation commands. Add focused tests for the new architecture.

### 15.1 Loader and schema tests

Verify:

1. Hacker and System files accept the shared `PRG_ID` header.
2. Wrong Program side prefixes fail.
3. Missing, duplicate, and unknown headers fail.
4. Duplicate IDs across all datasets fail.
5. Duplicate display names warn but load.
6. Unknown color/shape values fail.
7. Empty and duplicate colon-list tokens fail.
8. Broken Program-to-Function and Function-to-payload references fail.
9. Missing required Effect parameters fail.
10. Invalid numeric syntax, zero required values, negative values, decimals, and out-of-range values fail.
11. Populated unused fields warn, including numeric `0`.
12. Unknown Effect IDs and area patterns fail.
13. Validation reports contain required source context.
14. Any error prevents startup; warnings alone permit startup.
15. No hardcoded fallback initializes after a validation failure.

### 15.2 Composition tests

Verify:

1. Leaf Functions resolve directly to their Effect.
2. `FNC_007` resolves `FNC_008` then `FNC_009` in order.
3. `FNC_007` pays cost 9 once; child costs 5 and 5 are ignored.
4. A legal fizzle in the first child still allows the second child to attempt resolution.
5. Repeated leaf IDs in a composite execute repeatedly.
6. Mixed Effect/Function payloads fail.
7. Self-reference fails.
8. Direct and indirect cycles fail.
9. Composite-to-composite nesting fails.
10. More than one non-random targeted operation fails.
11. A non-random targeted operation after position one fails.
12. Composite metrics do not count child Functions as separately paid parent activations.

### 15.3 Area-pattern tests

Verify exact coordinate sets, deduplication, and board-edge clipping for all four patterns. Specifically verify:

- `AREA_SQUARE_3X3` has at most 9 in-bounds cells.
- `AREA_SQUARE_3X3_CARDINAL_2` has 13 cells at board center.
- E-Bomb reaches distance 2 cardinal cells and gains no unintended distance-2 diagonal cells.

### 15.4 Effect regression tests

Using data-loaded Functions, verify:

1. `FNC_001` costs 7 and attempts two 2-turn `AREA_SQUARE_3X3` Bomb deployments.
2. `FNC_002` costs 8 and attempts one magnitude-5 Buffer deployment.
3. `FNC_003` costs 10 and creates 30 base direct damage before Buffer and Shield processing.
4. Hacker Drain costs 9 and uses the player targeting interface.
5. System Drain uses highest raw charge, then highest cost, then random among remaining ties, and fizzles when nothing is charged.
6. `FNC_005` costs 7 and attempts one 3-turn `AREA_SQUARE_3X3_CARDINAL_2` E-Bomb deployment.
7. `FNC_006` costs 8 and attempts two magnitude-2 Shield deployments.
8. Bomb and E-Bomb damage use owner-dependent tile strength.
9. Buffer and Shield timing and damage attribution match Section 3.
10. Human play and headless simulation resolve the same loaded definitions.

### 15.5 Settings and persistence tests

Verify:

1. Flat-cost and individual-cost controls are absent.
2. Obsolete persisted cost settings do not break startup.
3. Pre-Alpha saves are rejected cleanly.
4. Alpha saves restore when version, schema, and fingerprint match.
5. A content-fingerprint mismatch rejects the save.
6. Save/reload does not duplicate charges, special tiles, countdowns, activations, or payload children.
7. Data is not reloaded mid-run.

### 15.6 Version and reporting tests

Search all active output paths and verify no stale MK tag remains. Generate at least one:

- browser battle log;
- server JSON/JSONL entry;
- readable dump;
- automated simulation summary.

Each must report `alpha-0.1.0` and the content identity fields from Section 13.2.

### 15.7 Manual verification

Perform at least:

1. One Hacker-controlled battle using all four baseline Functions.
2. One battle in System-matching mode to confirm both sides charge from the same loaded bindings.
3. One System timer-charge battle.
4. One desktop Drain targeting interaction.
5. One mobile/touch Drain targeting interaction.
6. One showcase Function test through a focused harness or test fixture.
7. One forced validation failure in browser and Node/headless environments.

---

## 16. Completion Standard

Alpha 0.1.0 is complete when:

- all required datasets load from packaged external CSV resources;
- the complete dataset validates before gameplay initialization;
- the runtime Program and Function model is constructed from data;
- no active Program or Function definition depends on hardcoded content;
- all human, simulation, UI, metrics, logs, and persistence consumers use the resolved model;
- approved Function costs and bindings are active;
- obsolete cost configuration is removed;
- current combat behavior passes regression tests;
- pre-Alpha saves are rejected and Alpha saves use version/schema/fingerprint compatibility;
- every active log path reports `alpha-0.1.0`;
- validation failures stop startup cleanly and diagnostically;
- final verification passes and the coding agent creates the source commit automatically.

---

## 17. Explicitly Out of Scope

Do not implement:

- sequential multi-battle run progression;
- map or room progression;
- Hacker, Deck, Program, or Build selection interfaces;
- inventory, rewards, or equipment;
- boss mechanics;
- battlefields or map effects;
- sandbox battle setup;
- additional Program breadth beyond the supplied datasets;
- multi-Function gameplay per Program;
- a generalized targeting-rule data system;
- a generalized scripting language;
- arbitrary or recursive Function nesting;
- runtime data hot reload;
- player-facing mod support or data editors;
- workbook export automation;
- procedural Function generation;
- Function-set organization tooling;
- new area patterns beyond catalog 0-3;
- unrelated balance changes, AI changes, visual polish, or architecture refactors.

---

# Coding Agent Prompt - Alpha 0.1.0

You are implementing **Breach Alpha 0.1.0**, the transition from the hardcoded Proof-of-Concept combat roster to a validated data-driven Program and Function architecture.

Read the entire attached `breach-alpha-0.1.0-requirements.md` before changing code. The document is canonical for this build. Earlier PoC and MK requirements are historical references only, except where this document explicitly tells you to preserve existing behavior.

This requirements document was produced through a rebased architecture process rather than the prior additive MK-delta process. Compare it carefully with the current repository, prior requirements, supplied datasets, and established implementation conventions. Report every meaningful deviation, contradiction, missing convention, or architectural issue to the user rather than silently reconciling it.

## Stage 1 - Required inspection and authorization stop

Before writing implementation code, inspect and report:

1. Every current hardcoded Program/unit definition and Function/ability definition.
2. Every consumer of those definitions in human play, simulation, UI, metrics, logs, settings, and persistence.
3. Current Program and Function runtime types and where mutable battle state is mixed with immutable content definition state.
4. Current Hacker and System color/shape enum vocabularies and all active baseline bindings.
5. Current effective Function costs, flat-cost override precedence, individual-cost config controls, and persisted setting keys that must be removed or ignored.
6. Current Effect implementations for Bomb, Buffer, Attack, Drain, and Shield.
7. Current owner-dependent strength behavior for matches and Bomb damage.
8. Current Buffer/Shield timing and damage-attribution order.
9. Current Hacker and System Drain targeting behavior.
10. Current browser and Node/headless startup paths and the proposed shared CSV parser/validator/resolver architecture.
11. Proposed packaged resource paths or manifest entries for the three CSV datasets.
12. Proposed Program, Function, Effect-contract, area-pattern, validation-report, and resolved-runtime types.
13. Current save format/version handling and the proposed pre-Alpha rejection plus Alpha version/schema/content-fingerprint design.
14. Every active output path still emitting a stale MK build tag.
15. Any discrepancy between the supplied CSV files and the canonical schemas/values in Sections 6.1-6.4. Do not silently rename columns, translate numeric area values, or rewrite data files.
16. Whether the repository already has suitable CSV parsing or validation dependencies. Prefer the existing dependency pattern; do not add a large framework for three small CSV files.
17. Proposed test plan mapped to Section 15.
18. Any requirement that would force an unrelated refactor or cannot be implemented honestly in the current architecture.

**Stop after this report and wait for user authorization. Do not begin implementation until the user approves the proposed mapping and resolutions.**

## Stage 2 - Implementation rules after authorization

After authorization:

1. Implement only the Alpha 0.1.0 scope.
2. Build shared pure TypeScript parsing, validation, resolution, and runtime-construction logic.
3. Use thin browser and Node/headless acquisition adapters.
4. Validate the complete dataset before gameplay startup.
5. Abort startup on any validation error; warnings alone may continue.
6. Do not use partial-row fallback or hardcoded Program/Function fallback.
7. Keep Effects coded and registered by stable IDs.
8. Make all gameplay consumers use the same resolved definitions.
9. Remove flat-cost and individual-cost configuration behavior and UI.
10. Reject pre-Alpha saves and add Alpha version/schema/content-fingerprint compatibility.
11. Preserve established combat behavior except for the explicitly approved Alpha changes.
12. Update all active build tags to `alpha-0.1.0`.
13. Add focused validation, composition, area-pattern, Effect-regression, persistence, and version tests.
14. Do not add roadmap features, speculative abstraction, or user-facing data tooling.

## Final verification and automatic source commit

Run the repository's full existing verification commands plus the focused checks required by Section 15.

Do not create a commit if verification fails or unresolved blocking issues remain. Report the failure instead.

When implementation is complete, all required checks pass, and no blocking issue remains, automatically create one Git source commit containing the completed Alpha 0.1.0 build changes. This commit is pre-authorized and does not require additional user approval.

Use a concise commit subject that summarizes the data-driven architecture and the most important compatibility changes. Include a useful body when the repository's commit style supports one.

## Post-build report

After the commit, report:

- commit hash and message;
- files changed;
- architecture implemented;
- exact datasets and resource paths loaded;
- schemas and validation rules implemented;
- Effect registry and area patterns implemented;
- approved costs and bindings active;
- settings removed;
- save compatibility behavior;
- build/version tag updates;
- tests and verification commands run with results;
- manual checks performed;
- validation failure examples tested;
- known limitations;
- every deviation from this document;
- every meaningful issue or divergence discovered relative to previous requirements or established repository conventions.
