# Breach Alpha 0.4.0 - Coding Agent Handoff

**Build identity:** `alpha-0.4.0`

**Status:** Canonical implementation requirements and coding-agent instructions for Alpha 0.4.0.

**Primary objective:** Turn the Alpha 0.3 Hacker/Deck identity flow into a functional four-Program build system using six-Program Hacker and Deck portfolios; make Program order mechanically meaningful through top-to-bottom charge overflow; add Random and Constructed Quick Match; add the targeted DATACUT and PLINK Functions; and extend save, UI, telemetry, and validation without adding rewards, acquisition, permanent collection progression, or System-side build editing.

---

## 0. Document Authority, Supplied Files, and Working Method

This document is the authoritative Alpha 0.4.0 behavior and implementation-boundary specification.

The coding agent will also receive the current Alpha 0.4 CSV datasheets and two PDF reference sheets. Read this entire document and all supplied data/reference files before proposing or writing code.

Use sources in this order:

1. This Alpha 0.4.0 coding-agent handoff for required behavior, architecture boundaries, and resolved design decisions.
2. The supplied Alpha 0.4 CSV files for exact authored IDs, references, costs, parameters, portfolio order, and other current content values.
3. The supplied dataset-notes and parameter-notes PDFs for field meanings, Effect parameter enumerations, and area-reference context where this document does not narrow or override them.
4. The current Alpha 0.3 repository implementation and tests.
5. The Alpha 0.3, Alpha 0.2, and Alpha 0.1 requirements for unchanged behavior.
6. Older design discussions and backlog material only for context.

If a supplied CSV contradicts an explicit behavior or sanity requirement in this document, do not silently reinterpret either source. Report the exact conflict during Stage 1. Minor spelling, column-order, or implementation differences are not conflicts when the shared loader binds validated fields by header name.

All prior requirements remain in force unless this document explicitly changes them. Preserve current behavior when this document says to preserve it. Do not rebuild established systems in parallel merely because a new screen or content path uses them.

Before beginning this build, use a fresh coding-agent context rather than carrying forward stale implementation assumptions from Alpha 0.3.

### 0.1 Required supplied files

The user intends to provide:

- this handoff document;
- the current Hacker CSV;
- the current Deck CSV;
- the current Hacker Program CSV;
- the current System Program CSV;
- the current Function CSV;
- the current Hacker Skill CSV;
- the dataset-notes PDF;
- the Effect parameter-notes PDF.

The CSVs are runtime content, not illustrative appendices. The PDFs are semantic references, not executable data sources.

### 0.2 Source-control and README boundary

The user controls source control and README maintenance.

The coding agent must not:

- access or interact with a remote repository;
- run remote Git operations;
- create commits, branches, tags, or stashes;
- stage files or modify the Git index;
- run source-control write operations such as `git add`, `git commit`, `git checkout`, `git reset`, or `git rebase`;
- modify `README.md` or any replacement README file.

Read-only local inspection such as `git status`, `git diff`, and `git log` is permitted when useful. The final report may recommend README changes for the user, but must not make them.

---

# Part I - Alpha 0.4.0 Requirements

## 1. Build Objective

Alpha 0.4.0 makes Hacker and Deck selection mechanically meaningful without adding acquisition or permanent inventory progression.

The completed build must:

1. Extend Hacker and Deck definitions with ordered three-Program portfolios.
2. Derive a fixed six-Program Run or Quick Match inventory from the selected Hacker and Deck.
3. Replace Alpha 0.3 Build Review with a functional, always-valid four-slot Build screen.
4. Allow active Programs to be replaced and reordered without creating invalid intermediate states.
5. Show the Build screen before every Run battle.
6. Preserve the Run inventory and current ordered build while the Run is active, then discard Run build changes when the Run ends or is abandoned.
7. Split Quick Match into Random Quick Match and Constructed Quick Match.
8. Remember the last valid Constructed Quick Match build outside the single active-save slot.
9. Route generated color and shape charge top-to-bottom through compatible active Programs, passing overflow downward.
10. Make Program order visible, persistent, logged, and mechanically authoritative.
11. Add `PRG_H_005` NINJA with `FNC_011` DATACUT using `EFFECT_LINESLICE`.
12. Add `PRG_H_006` WEASEL with `FNC_012` PLINK using the parameterized `EFFECT_BOMB` contract.
13. Use the existing single-Packet targeting model for targeted Functions.
14. Extend save, resume, fingerprint, metrics, and logging for portfolio, inventory, build, order, charge routing, targeting, and new Function outcomes.
15. Add spreadsheet-safe leading-apostrophe normalization to the shared dataset parser.
16. Add the required Disabler target telemetry and prevent System Disabler activation when no active Hacker Program has charge.
17. Reject incompatible Alpha 0.3 active saves cleanly.
18. Preserve Alpha 0.3 identity, Skills, SCRAMBLE, B1 line clears, Reinforced Connection, LINK/ICE, combat, Run, and layout behavior except where this document explicitly changes it.

This is not a balance pass. Use the values supplied in the CSVs. Do not retune existing content unless a defect or extreme blocker prevents Alpha 0.4 feature testing.

---

## 2. Resolved Alpha 0.4 Decisions and Overrides

The following decisions have already been resolved and must not be reopened without a concrete repository conflict:

1. **Portfolio ownership:** Each Hacker contributes exactly three ordered Hacker Program IDs through `PRG_SET`. Each Deck contributes exactly three ordered Hacker Program IDs through `PRG_SET`.
2. **No overlap:** The selected Hacker and Deck portfolios must be disjoint. Portfolio overlap is a startup content error; Alpha 0.4 does not create owned Program instances or duplicate copies of one `PRG_ID`.
3. **Inventory:** The combined inventory contains exactly six distinct Programs. Source attribution is Hacker portfolio or Deck portfolio, but every active Program is mechanically Hacker-side in battle.
4. **Active build:** Exactly four distinct inventory Programs are active, in explicit top-to-bottom order.
5. **Default build:** The default is Hacker portfolio entries 1 and 2 followed by Deck portfolio entries 1 and 2.
6. **No source quota:** Any four of the six inventory Programs may be active. There is no required Hacker/Deck ratio.
7. **All Decks compatible:** Do not add Hacker/Deck compatibility fields or filtering.
8. **Quick Match identity:** Both Quick Match modes use the explicit default IDs `HAK_01` and `DEK_01`; they do not add Hacker or Deck selection screens.
9. **Run flow:** Build appears before every Run battle. Retry after defeat returns to Build for the same encounter. Force Win behavior remains as established in Alpha 0.3.
10. **Charge order:** Resolve color charge streams before shape charge streams. Each stream scans active Programs from top to bottom.
11. **Deck Function exclusion:** The Deck Function is not an active Program slot, is not in the Program charge-overflow queue, and remains ineligible for Drain.
12. **DATACUT:** `FNC_011` targets one Packet, slices its row, destroys specials under the current tuple, deals one combined noncritical Function-damage instance, grants no direct-slice charge, and does not contribute to B1 qualification.
13. **PLINK:** The Function datasheet is authoritative. `FNC_012` is an immediate targeted `EFFECT_BOMB` resolution using the cardinal-one area, deals damage, and grants no charge. It has no countdown.
14. **Function description:** Alpha 0.4 Program inspection needs only the Function name. Do not treat `notes` as player-facing copy. A literal temporary placeholder such as `Function description goes here` is allowed if needed for modal layout.
15. **Presentation placeholders:** Hacker `BIO`, Hacker `GRAPHICS`, Deck `DESCRIPT`, and Deck `GRAPHICS` remain unused placeholders.
16. **Save compatibility:** Alpha 0.3 active saves are rejected, not migrated.
17. **Constructed preset:** The remembered Constructed Quick Match build is lightweight preference data outside the single active battle/Run save slot.
18. **Randomness separation:** Random Quick Match build generation must not consume or perturb the battle gameplay RNG stream.
19. **Disabler gating:** The System must not activate Disabler when no active Hacker Program has charge greater than zero.
20. **Spreadsheet-safe values:** Strip exactly one leading apostrophe from dataset cell values before trimming, parsing, resolving, validating, and fingerprinting.
21. **Current core mechanics:** B1 direct-match line clears, owner-scoped charge, `startCharged`, Hacker Skills, Normal LINK, Reinforced Connection, and existing damage-order rules remain in force.

---

## 3. Existing Architecture and Behavior to Preserve

Unless explicitly changed here, preserve:

- the shared browser/Node CSV acquisition adapters and pure TypeScript parse/validate/resolve pipeline;
- immutable resolved content as the gameplay-content authority;
- Program -> Function -> Effect execution architecture;
- coded Effect and Skill-effect registries with typed parameter contracts;
- stable ID and reference validation;
- the current Function payload chain boundary and anti-recursion validation;
- current Hacker and System strength-set authority;
- data-defined Hacker Skills and their owner-scoped triggering;
- the Deck-owned SCRAMBLE Function and `EFFECT_SHAKE` behavior;
- current Deck neutral-Sync charging;
- current Buff, Shield, Attack, Bomb, E-Bomb, Drain, countdown, targeting, and special-Packet behavior except for the explicit `EFFECT_BOMB` parameterization below;
- current damage order, Shield behavior, Buff attribution, and disjoint damage accounting;
- B1 combined directly matched footprint qualification and non-recursion;
- Reinforced Connection behavior, including suppression of base Sync damage and the Buff bonus attached to that base Sync while preserving Skill- and Function-originated effects;
- Quick Match and four-battle Run lifecycle where not changed by the Build screen;
- the single active save slot;
- deterministic active-battle restoration;
- battle IDs that do not consume gameplay RNG;
- existing battle layout, terminology, and System-turn input-lock presentation;
- current storage-protection and graceful logging failure;
- current test and simulation infrastructure unless inspection reveals a concrete reason to adapt it.

Do not create parallel content loaders, build authorities, charge systems, target selectors, board resolvers, or save paths.

---

## 4. Required Data Contracts

### 4.1 Required dataset set

Alpha 0.4 continues to require all six Alpha 0.3 datasets:

1. Hacker Programs.
2. System Programs.
3. Functions.
4. Hackers.
5. Hacker Skills.
6. Decks.

All six must parse, validate, resolve, and fingerprint successfully before title-screen initialization. A required dataset is accepted or rejected as a whole; do not partially accept valid rows from an invalid file.

### 4.2 Shared spreadsheet-safe parsing rule

Apply this rule to every data-cell value in every dataset before field-specific parsing:

1. If the raw cell begins with exactly one apostrophe character (`'`), remove that one character.
2. Do not remove a second apostrophe.
3. Do not remove embedded or trailing apostrophes.
4. After the one-character normalization, perform the normal trim.
5. Then perform blank handling, integer conversion, enum parsing, ID/reference parsing, list parsing, tuple parsing, validation, resolution, and normalized fingerprint generation.

Examples:

```text
'FNC_011       -> FNC_011
'0:1:0:0:1     -> 0:1:0:0:1
'7              -> 7
''VALUE         -> 'VALUE
VALUE'          -> VALUE'
```

This is a shared parser behavior, not a per-column workaround. Header validation remains unchanged unless the repository already treats headers through the same value-normalization layer.

### 4.3 Common data rules

For all datasets:

- bind fields by validated header name rather than raw column position;
- use `:` as the list and Effect-tuple delimiter;
- reject blank tokens inside a nonblank list or tuple;
- preserve authored order for portfolio, Skill, Function, Program, and payload lists where order is meaningful;
- reject duplicate tokens where no duplicate semantics are defined;
- stable IDs are case-sensitive machine identifiers;
- display names are non-authoritative and need not be unique; duplicate names produce the established startup warning rather than an error;
- `notes` and placeholder presentation fields are non-normative;
- spreadsheets select coded behavior and typed parameters; they are not executable scripts.

### 4.4 Hacker dataset

Required header names include:

```csv
HAK_ID,name,BASE_LINK,STRONG_COLORS,STRONG_SHAPES,PRG_SET,SKILL,BIO,GRAPHICS
```

Alpha 0.4 adds or activates this field contract:

| Field | Contract |
|---|---|
| `PRG_SET` | Required colon-delimited ordered list of exactly three distinct valid `PRG_H_*` IDs. The order is the Hacker portfolio order and is gameplay-significant for default-build derivation. |

All other Hacker fields retain their Alpha 0.3 contracts.

The current supplied content is expected to resolve `HAK_01` with the ordered portfolio:

```text
PRG_H_001 : PRG_H_002 : PRG_H_005
```

The authoritative exact row is the supplied CSV.

### 4.5 Deck dataset

Required header names include:

```csv
DEK_ID,name,ADD_LINK,PRG_SET,FUNCTIONS,DESCRIPT,GRAPHICS
```

Alpha 0.4 adds or activates this field contract:

| Field | Contract |
|---|---|
| `PRG_SET` | Required colon-delimited ordered list of exactly three distinct valid `PRG_H_*` IDs. The order is the Deck portfolio order and is gameplay-significant for default-build derivation. |
| `FUNCTIONS` | Retains the Alpha 0.3 rule: exactly one Deck Function for this build. |

The current supplied content is expected to resolve `DEK_01` with the ordered portfolio:

```text
PRG_H_003 : PRG_H_004 : PRG_H_006
```

The authoritative exact row is the supplied CSV.

### 4.6 Combined inventory validation

For every valid Hacker/Deck pairing under current all-compatible rules:

- concatenate the Hacker portfolio and Deck portfolio in that order;
- require six distinct valid Hacker Program IDs;
- reject any cross-portfolio duplicate as a startup content error;
- retain source attribution for each inventory entry as `HACKER_PORTFOLIO` or `DECK_PORTFOLIO`;
- do not create separate owned Program instances;
- do not duplicate Program runtime definitions.

Because all valid Decks are compatible with all valid Hackers, startup validation should identify any pairing that cannot produce a valid six-Program inventory. With the current one-Hacker/one-Deck content, the single pair must be valid.

### 4.7 Program dataset

Program schema remains:

```csv
PRG_ID,name,colors,shapes,functions,notes
```

Alpha 0.4 retains exactly one active Function per Program. A Program row with zero or more than one Function reference is invalid for the current gameplay contract, even if the list-shaped field remains an extension point.

The current supplied Hacker Program content adds:

- `PRG_H_005` NINJA -> `FNC_011` DATACUT;
- `PRG_H_006` WEASEL -> `FNC_012` PLINK.

Use the exact bindings, names, and IDs from the supplied CSV.

### 4.8 Function dataset

The current Function header names include:

```csv
FNC_ID,name,cost,payload,notes,quantity,countdown,areaPattern,magnitude,damage,startCharged,params
```

Column order is not gameplay authority; validated header names are.

All Alpha 0.3 Function contracts remain in force, including:

- `startCharged` values `Y`, `N`, or blank, with blank equivalent to `N`;
- exact typed `params` tuples for Effects that define a tuple contract;
- one-level Function composition only;
- no self-reference;
- no nested Function payload chain beneath another Function payload chain;
- child Function activation ignores child costs while preserving current payload semantics.

For Alpha 0.4:

- every `EFFECT_BOMB` Function must provide a complete three-value tuple;
- every `EFFECT_LINESLICE` Function must provide a complete five-value tuple;
- trailing defaults are not inferred;
- blank `params` is invalid for either Effect;
- `quantity` and any referenced `areaPattern` must pass Effect-specific sanity checks.

Expected current live values include:

```text
FNC_011 DATACUT  payload=EFFECT_LINESLICE  quantity=1  params=0:1:0:0:1
FNC_012 PLINK    payload=EFFECT_BOMB       quantity=1  countdown=<blank>
                  areaPattern=AREA_CARDINAL_1  params=1:0:1
```

The supplied, edited Function CSV is authoritative. If it still contains a PLINK countdown or an alias such as `AREA_CROSS`, report that mismatch during Stage 1 rather than adding duplicate area identifiers or silently preserving the old row.

### 4.9 Area definitions

Continue using the established area-pattern registry and stable area IDs. Effects resolve coordinate sets through the registry; spreadsheet data does not contain executable geometry.

For current Alpha 0.4 content:

- PLINK uses the existing center-plus-one-cardinal-neighbor pattern `AREA_CARDINAL_1`;
- out-of-bounds coordinates are clipped through the established area resolver;
- do not create a second alias for the same coordinate set;
- unused future area patterns described in the reference PDF do not need gameplay implementation merely because they are documented.

### 4.10 Skill dataset

The Skill dataset and Alpha 0.3 Skill behavior remain unchanged. Portfolio and build changes must not reintroduce hardcoded Red passive behavior or change Skill ownership.

### 4.11 Placeholder and display fields

For Alpha 0.4:

- Hacker `BIO` is retained but not displayed;
- Hacker `GRAPHICS` is retained but does not load assets;
- Deck `DESCRIPT` is retained but not displayed;
- Deck `GRAPHICS` is retained but does not load assets;
- Function `notes` is never displayed as normative Function description;
- Skill `display` retains its Alpha 0.3 presentation-only role.

### 4.12 Gameplay-content fingerprint

Extend the normalized gameplay fingerprint to include, at minimum:

- ordered Hacker `PRG_SET` values;
- ordered Deck `PRG_SET` values;
- all new or changed Program Function references;
- `EFFECT_BOMB` typed parameters;
- `EFFECT_LINESLICE` typed parameters;
- Function quantity, countdown, area pattern, cost, damage, magnitude, and `startCharged` where gameplay-relevant;
- all previously fingerprinted Hacker, Deck, Skill, Program, Function, and Effect-resolved gameplay values.

Fingerprint normalized values after leading-apostrophe removal and semantic parsing, not raw spreadsheet strings.

Continue excluding non-gameplay fields such as:

- `notes`;
- Hacker `BIO` and `GRAPHICS`;
- Deck `DESCRIPT` and `GRAPHICS`;
- Skill display templates;
- presentation-only names unless the current normalized contract already includes them for a deliberate reason.

Fingerprinting portfolio order is mandatory because order determines the default build and source display.

### 4.13 Validation and warnings

Startup errors include, at minimum:

- malformed or missing required headers;
- duplicate stable IDs;
- invalid ID prefixes;
- missing references;
- Hacker or Deck `PRG_SET` not containing exactly three entries;
- duplicate Program IDs within one portfolio;
- overlap between a compatible Hacker and Deck portfolio;
- combined inventory not resolving to six distinct valid Hacker Programs;
- Program not resolving to exactly one active Function under the Alpha 0.4 contract;
- malformed or wrong-length Effect tuple;
- unsupported parameter enum value;
- invalid targeted-Effect quantity under the rules below;
- missing required area pattern;
- PLINK configured with a countdown contrary to the current live design;
- invalid area reference;
- content state that cannot produce the required default four-Program build.

Warnings retain their existing role for nonblocking conditions such as duplicate display names and valid but currently unreferenced Functions. Existing unreferenced showcase Functions may continue to produce warnings; do not convert them into errors solely for Alpha 0.4.

---

## 5. Portfolio, Inventory, and Build Runtime Models

### 5.1 Resolved portfolio model

The resolved Hacker and Deck definitions must expose their Program portfolios as ordered resolved references, not repeatedly parsed strings.

A suitable conceptual model is:

```text
ResolvedHacker.portfolioProgramIds: PRG_ID[3]
ResolvedDeck.portfolioProgramIds: PRG_ID[3]
```

The exact TypeScript naming is implementation-owned.

### 5.2 Combined inventory

For a selected Hacker and Deck, derive:

```text
inventory = [
  hackerProgram1,
  hackerProgram2,
  hackerProgram3,
  deckProgram1,
  deckProgram2,
  deckProgram3
]
```

The inventory is fixed for the duration of an active Run. No reward, acquisition, loss, or replacement changes it in Alpha 0.4.

Each inventory entry must allow UI and telemetry to determine its portfolio source. Source attribution has no combat ownership effect: all six are Hacker-side Program choices.

### 5.3 Active build

The active build is an ordered list of exactly four distinct Program IDs drawn from the six-Program inventory.

The list order is authoritative for:

- battle-side vertical Program display;
- charge routing;
- System Disabler target pool and tie evaluation where existing logic uses Program state;
- save and restore;
- battle initialization;
- logs and metrics context;
- future order-sensitive systems.

Do not store the build as an unordered set.

### 5.4 Default build

Derive the default build from portfolio order:

```text
1. Hacker portfolio Program 1
2. Hacker portfolio Program 2
3. Deck portfolio Program 1
4. Deck portfolio Program 2
```

For the current supplied content, this should resolve to:

```text
PRG_H_001
PRG_H_002
PRG_H_003
PRG_H_004
```

Do not hardcode those four IDs as the general default algorithm. Hardcoded default Hacker and Deck IDs are allowed for the current Quick Match identity path, but their build must still derive from portfolio order.

### 5.5 Validity invariant

The Build screen must always hold a valid active build during normal interaction:

- exactly four occupied slots;
- no duplicate Program ID;
- every active Program belongs to the current six-Program inventory;
- every active Program resolves successfully;
- active order is explicit.

Do not make the player assemble a build from empty slots. Do not expose a normal interaction that temporarily creates fewer or more than four active Programs.

### 5.6 Replacement behavior

Replacing an active Program with an inactive inventory Program is a swap:

- selected inactive Program enters the chosen occupied active slot;
- displaced Program returns to the inactive inventory;
- all four slots remain occupied;
- duplicates remain impossible;
- the new order takes effect immediately in Build state.

The exact mobile interaction—tap-then-slot, explicit Replace control, or another clear bounded pattern—is implementation-owned. Drag-and-drop is not required.

### 5.7 Reordering behavior

The player must be able to reorder occupied active slots. Reordering may move or swap Programs but must preserve all four entries and uniqueness.

Top-to-bottom priority must be visually legible. Do not rely on hidden array order.

### 5.8 Battle initialization

When battle begins:

- snapshot the active ordered build into the battle state;
- instantiate only those four Hacker Programs;
- apply each selected Program Function's `startCharged` rule;
- exclude inactive inventory Programs from charge state, targeting, UI, metrics state, and battle actions;
- instantiate the Deck Function separately under the existing Deck-owned rules;
- initialize Hacker LINK, System ICE, Skills, strong sets, and other identity state through the existing Alpha 0.3 battle constructor.

Program charge does not carry between Run battles. Each new battle initializes active Program charge from Function `startCharged`, as established in Alpha 0.3.

---

## 6. Hacker Selection and Deck Selection Enhancements

### 6.1 Hacker Selection

Preserve explicit Hacker selection and the single final Choose/Done action without a secondary confirmation modal.

In addition to Alpha 0.3 identity information, show:

- resolved Hacker LINK contribution under the current selection context;
- strong and weak colors;
- strong and weak shapes;
- Hacker Skills;
- the Hacker's three Programs in authored portfolio order;
- an inspection affordance for each portfolio Program.

The screen remains data-driven and must display every valid Hacker row.

### 6.2 Deck Selection

Preserve explicit Deck selection and Back/forward navigation.

Show:

- Deck identity;
- Deck Function name;
- the Deck's three Programs in authored portfolio order;
- the selected Hacker's strong and weak colors and shapes on the primary screen for comparison;
- an inspection affordance for each portfolio Program.

All valid Decks remain compatible with all valid Hackers. Do not add filters or compatibility messaging.

### 6.3 Pending setup preservation

Before the initial Run is committed:

- Hacker selection, Deck selection, and Build edits remain pending setup state;
- Back navigation retains current pending choices while moving among setup screens;
- returning to Title discards pending setup only;
- an existing active save remains untouched;
- the new Run is committed only when Battle 1 is started from the Build screen.

---

## 7. Shared Program Inspection Modal

Use one shared informational Program inspection component or modal from:

- Hacker Selection;
- Deck Selection;
- Build screen.

Display at minimum:

- Program name;
- stable Program ID where current whitebox conventions permit it;
- color bindings;
- shape bindings;
- Function name;
- Function charge cost;
- portfolio source in the current context: Hacker or Deck.

Alpha 0.4 does not require authored Function-description infrastructure. The modal may:

- display only the Function name and cost; or
- include a literal temporary line such as `Function description goes here` if layout requires a description region.

Do not:

- display Function `notes` as player-facing description;
- synthesize a normative prose description from Effect parameters;
- add a new description dataset or localization system;
- modify the build from inside the inspection modal;
- add Program passive sections when Program passives do not exist.

Before planning the build after Alpha 0.4, the designer must decide how player-facing Function descriptions are authored and stored. That decision is not part of this implementation.

---

## 8. Functional Build Screen

### 8.1 Required display

Replace Alpha 0.3 Build Review with a functional Build screen that shows:

- selected Hacker identity;
- selected Deck identity and Deck Function;
- all six inventory Programs;
- source attribution for each Program;
- four ordered active slots;
- clear distinction between active and inactive Programs;
- inspection access;
- replacement controls;
- reorder controls;
- the final action appropriate to the current flow.

### 8.2 Context-specific final actions

Use context-appropriate wording such as:

- `Start Run` or `Start Battle 1` for initial New Run Build;
- `Start Battle` for later Run battles;
- `Start Quick Match` for Constructed Quick Match.

No secondary confirmation modal is required.

### 8.3 Initial New Run Build

On every newly initiated Run, the Build screen opens with the default build, regardless of any prior completed, abandoned, or remembered Quick Match build.

The existing active save is not replaced until Battle 1 starts.

Back returns to Deck Selection and preserves pending state. Returning to Title preserves the previous active save.

### 8.4 Between-battle Run Build

After a Run battle resolves and the Run will continue:

- proceed to the Build screen before the next battle;
- carry forward the current Run build and order;
- allow no-change continuation;
- allow replacement and reordering;
- apply the final build to the upcoming battle only when battle starts;
- provide `Save and Quit` under the established Run exit model.

### 8.5 Retry after defeat

When the player chooses to retry a lost Run battle:

- return to the Build screen for the same Run step;
- preserve the current build as the starting Build state;
- allow edits and reorder before retry;
- start a fresh battle for the same encounter using the final selected build;
- preserve existing retry and wizard logging semantics as applicable.

Force Win overriding defeat follows Alpha 0.3 progression rules: it converts the defeat to a win and proceeds to the next pre-battle Build screen, or completes the Run after Battle 4.

### 8.6 Run completion or abandonment

When a Run completes or is abandoned:

- discard Run-specific active build changes;
- discard the Run inventory and selected setup state with the Run save;
- do not alter the remembered Constructed Quick Match build;
- do not alter Hacker or Deck content definitions;
- a later new Run starts from the default build.

### 8.7 Save behavior while on Build

An already committed active Run may be saved and resumed while on a between-battle or retry Build screen.

The save must preserve:

- selected Hacker and Deck;
- fixed six-Program inventory;
- current ordered four-Program build;
- Run step to be attempted next;
- the fact that the current state is pre-battle Build rather than active battle;
- any additional deterministic state required by the established Run lifecycle.

Normal Build edits should remain valid at all times. The coding agent may persist each accepted edit immediately or commit them on `Save and Quit`/`Start Battle`, provided suspension and resume cannot restore an invalid or stale build.

---

## 9. Quick Match Expansion

### 9.1 Quick Match menu

Replace the direct Quick Match launch with a bounded choice screen:

```text
Quick Match
  -> Random Quick Match
  -> Constructed Quick Match
  -> Back
```

Both modes use `HAK_01` and `DEK_01` as explicit default identity. Missing or invalid defaults block the mode through established graceful startup/configuration failure; do not fall back to row order.

### 9.2 Random Quick Match

Random Quick Match:

- resolves the six-Program inventory from `HAK_01` and `DEK_01`;
- samples four distinct Programs without replacement;
- produces an explicit random order for those four Programs;
- starts battle without opening Build;
- logs the complete resolved build and order before battle initialization;
- does not overwrite the remembered Constructed Quick Match build;
- replaces the active save only when the battle is created, consistent with current Quick Match behavior.

Random selection must use a setup-specific random source or isolated RNG stream. It must not consume the battle gameplay RNG stream or alter the board/refill/AI sequence for a given gameplay seed after battle initialization.

For deterministic testing, the random-build generator must support an injected or controlled random source. The exact production entropy source is implementation-owned.

### 9.3 Constructed Quick Match

Constructed Quick Match:

- resolves the six-Program inventory from `HAK_01` and `DEK_01`;
- opens the Build screen;
- begins with the last valid remembered Constructed build when available;
- otherwise uses the default build;
- allows replacement and reorder under the same validity rules as Run Build;
- writes the remembered build only when the player starts the battle;
- starts battle with the final four IDs and order;
- leaves a prior active save untouched while Build remains pending;
- replaces the active save when the new Quick Match battle starts.

Backing out before starting battle does not update the remembered preset and does not replace the existing active save.

### 9.4 Remembered Constructed build storage

Store the convenience preset outside the single active battle/Run save slot, in a small versioned preference/profile record.

Persist at minimum:

- preference schema version;
- Hacker ID;
- Deck ID;
- ordered four-Program build IDs.

On load, validate that:

- Hacker and Deck still resolve;
- the current combined inventory resolves;
- all four Program IDs are distinct;
- all four belong to the current inventory.

If invalid:

- do not reject game startup;
- discard or ignore the invalid preference;
- open Constructed Quick Match with the default build;
- log or warn at an appropriate nonfatal level.

A gameplay-content fingerprint mismatch alone need not erase the convenience preset if the IDs still resolve into a valid current inventory. Active saves remain strict; convenience preferences may be revalidated and safely defaulted.

### 9.5 Quick Match save and resume

An active Random or Constructed Quick Match save must preserve:

- default Hacker and Deck identity;
- six-Program inventory or enough strict resolved identity to validate it;
- exact active four-Program build and order;
- battle state;
- build source.

Continue must restore the exact battle build, not regenerate Random Quick Match or reread the remembered Constructed preset.

---

## 10. Charge Overflow and Program Queue Priority

### 10.1 Scope

Program order becomes mechanically meaningful for normal axis-based charge allocation.

The queue contains only the four active Programs for the charge owner. Inactive inventory Programs and the Deck Function are excluded.

Implement the routing in the shared owner-side charge system so the same behavior can apply to System Programs when overlapping System bindings exist. Alpha 0.4 does not require new System content solely to demonstrate overlap.

### 10.2 Preserve charge generation; replace allocation

Preserve existing rules that determine how much charge a qualifying Sync, cascade, Skill, or explicitly charging Effect generates. Alpha 0.4 changes allocation when more than one active Program is compatible.

Do not silently create charge from sources that did not previously or explicitly generate it. Bomb destruction remains no-charge in current live content because its tuple says so.

### 10.3 Independent axis streams

Resolve color and shape charge independently.

For each resolution wave:

1. Resolve all color-axis charge streams before shape-axis charge streams.
2. Preserve a stable deterministic order among multiple streams of the same axis, using the existing resolved match-event order if it is already stable and tested. If it is not stable, establish and test a canonical board order rather than relying on object/hash iteration.
3. For each stream, route only to Programs compatible with that stream's specific color or shape token.
4. A Program compatible with both the color and shape results may receive from both separate streams during the same wave.
5. Cascades use the same rule.

The exact stream-order implementation must be deterministic and must not consume RNG.

### 10.4 Top-to-bottom routing algorithm

For one charge stream with amount `N`:

1. Start at the top active Program slot.
2. Skip Programs that are incompatible with the stream token.
3. Skip compatible Programs whose charge is already at their Function cost.
4. Select the first compatible non-full Program.
5. Assign up to that Program's remaining capacity.
6. Pass any overflow to the next compatible non-full Program below it.
7. Continue until the stream is exhausted or no compatible non-full Program remains.
8. Discard remaining overflow only after all lower compatible Programs are full or absent.

Required invariants:

- charge never flows upward;
- a compatible non-full Program may not be skipped;
- Program charge never exceeds current Function cost;
- inactive Programs never receive charge;
- Deck Function charge is separate;
- changing active order may change where charge lands;
- no RNG is used for routing.

### 10.5 Multiple match events

Constituent color and shape Sync groups remain authoritative for charge generation, Skills, and metrics. B1's union footprint does not merge charge events or create extra charge.

If one move creates distinct compatible Sync blobs, each event generates its normal stream. Route them deterministically under Section 10.3.

### 10.6 Skill-generated charge

`SKL_EXTRA_MATCH_CHARGE` continues to increase the normal qualifying color-axis stream before that stream is routed. It does not create a separate pool that independently charges every compatible Program.

### 10.7 Effect-generated axis charge

A Function or Effect uses this routing system only when its typed contract explicitly says directly sliced Packets grant charge.

For such an Effect:

- each qualifying directly sliced Packet contributes standard owner-scoped color and shape charge based on its Packet attributes;
- route color contributions before shape contributions;
- directly sliced neutral Packets do not charge the Deck Function unless a separate explicit rule says they do;
- refill-created Syncs generate and route their own normal charge separately.

Current DATACUT and PLINK tuples both specify no direct-slice charge.

### 10.8 Battle reset

At each battle start:

- initialize only active Program charge;
- apply Function `startCharged` uniformly;
- do not carry Program charge across Run battles or from Build state;
- build reorder changes priority, not stored charge from a prior battle.

---

## 11. Charge-Routing Telemetry

Logs must make charge allocation analytically reconstructable.

For every routed stream, capture at minimum:

- battle ID;
- turn/resolution context;
- charge owner;
- source category and stable source ID where available;
- axis type: color or shape;
- axis token;
- total charge generated for that stream;
- ordered active Program IDs at routing time;
- ordered compatible/eligible Program IDs;
- each recipient Program ID;
- charge before assignment;
- charge assigned;
- charge after assignment;
- overflow passed onward;
- final overflow discarded;
- whether the stream arose from initial Sync, cascade, Skill-modified Sync, or explicit Effect destruction.

The exact JSON shape is implementation-owned, but do not emit only a final charge total. The analyst must be able to verify priority, skipping, fill, overflow, and discard.

Avoid unnecessary duplicate log volume if the same information is already captured in an existing structured event. Extending an established event is preferable to parallel telemetry.

---

## 12. Single-Packet Targeting Model

### 12.1 Scope

Targeted Alpha 0.4 Functions use the established single-Packet targeting interaction.

A Function requires either:

- zero Packet targets when its typed parameter selects random targeting; or
- exactly one Packet target when its typed parameter selects targeted behavior.

The player selects one Packet. The Effect interprets the coordinate.

Do not add:

- separate row-selection UI;
- multiple accumulated targets;
- target counters;
- duplicate-target prevention UI for player-selected multi-target actions;
- partial multi-target confirmation;
- generalized target lists.

### 12.2 Target activation and cancellation

Preserve current targeted-Function lifecycle unless inspection reveals a conflict:

- entering target mode does not resolve the Function;
- selecting a valid Packet resolves the Function and pays/consumes charge under the existing activation boundary;
- canceling target mode does not consume charge or end the turn;
- invalid target input does not resolve the Function;
- the target coordinate and Packet properties are captured before Effect mutation for logging.

### 12.3 Quantity sanity rule

For Alpha 0.4, a targeted Effect configuration (`targeting=1`) must have `quantity=1`. More than one player-selected deployment would constitute deferred multi-target behavior and is a startup validation error.

Random targeting (`targeting=0`) may use quantity greater than one where established content requires it. Each random deployment must exclude coordinates already directly selected/sliced by the same Function activation where the Effect contract requires that exclusion.

---

## 13. `EFFECT_LINESLICE` Contract

### 13.1 Registration

Add `EFFECT_LINESLICE` to the coded Effect registry using the same typed-contract architecture as `EFFECT_SHAKE`.

It is not a spreadsheet script and does not require an external Effect-definition table.

### 13.2 Parameter tuple

`EFFECT_LINESLICE` requires exactly five colon-delimited integers:

```text
dimension:targeting:specialRetention:dealDamage:gainCharge
```

Resolve the tuple at startup into a typed immutable object. Runtime execution must not parse the raw string.

Supported values:

#### `dimension`

- `0` — row containing the selected/resolved Packet.
- `1` — column containing the selected/resolved Packet.

#### `targeting`

- `0` — choose a random valid Packet coordinate not already directly sliced by the current Function activation.
- `1` — require one player-selected Packet coordinate.

#### `specialRetention`

- `0` — destroy/slice special Packets in the affected line under established special-destruction rules.
- `1` — retain all special Packets.
- `2` — retain only special Packets owned by the activating side; destroy other specials.

A retained special Packet remains a complete tile/special object, is excluded from the direct slice, and participates normally in subsequent gravity/settling. It is not pinned to its old coordinate if empty vertical space exists below it.

#### `dealDamage`

- `0` — directly sliced Packets contribute Function damage according to the activating side's resolved color/shape damage profile.
- `1` — direct line slicing deals no damage.

#### `gainCharge`

- `0` — directly sliced Packets generate owner-scoped axis charge under Section 10.7.
- `1` — directly sliced Packets generate no charge.

### 13.3 Line resolution

For each deployment:

1. Resolve the target coordinate by the typed targeting rule.
2. Derive the entire board row or column from the target; do not create a separate row-target abstraction.
3. Determine retained special Packets before slicing.
4. Slice all other Packets in the line as one direct Effect operation.
5. Calculate direct Function damage and direct charge only from Packets actually sliced by this deployment.
6. Apply gravity/refill through the established board resolver.
7. Resolve resulting Syncs and cascades normally under the activating side's ownership and current cascade rules.

Direct line-slice destruction:

- is not a Sync;
- does not contribute to B1 directly matched footprints;
- does not trigger color/shape match Skills merely because sliced Packets share an attribute;
- may cause refill Syncs that do trigger normal damage, charge, Skills, B1, and cascades.

### 13.4 Damage semantics

When `dealDamage=0`:

- value each directly sliced, non-retained Packet through the activating side's current color/shape profile using the established noncritical collateral valuation;
- sum those contributions into one base Function-damage instance per deployment;
- do not apply a Sync critical multiplier;
- apply Buff and Shield through the existing damage pipeline once to that combined instance;
- attribute base damage to `FNC_011`/`EFFECT_LINESLICE` or an equivalently source-specific metric;
- continue attributing the Buff contribution to the established Buff metric rather than hiding it inside line-slice damage;
- allow the damage under Reinforced Connection because it is Function damage, not base Sync damage.

Retained special Packets and out-of-board cells contribute no damage.

If quantity later exceeds one under random targeting, each deployment creates a separate damage instance for Shield and metrics. Current DATACUT quantity is one.

### 13.5 Charge semantics

When `gainCharge=0`, only directly sliced, non-retained Packets generate direct Effect charge. Resulting Syncs generate their normal separate charge.

When `gainCharge=1`, direct line slicing grants no charge. Resulting Syncs and cascades still charge normally.

### 13.6 Current DATACUT variant

The current supplied content is expected to resolve:

```text
FNC_011 DATACUT
payload: EFFECT_LINESLICE
quantity: 1
params: 0:1:0:0:1
```

Therefore DATACUT:

- requires one Packet target;
- slices the target's full row;
- destroys specials in that row;
- deals one combined Function-damage instance;
- grants no charge from the direct row slice;
- refills and resolves resulting Syncs normally.

Use exact cost and Program bindings from the supplied CSV.

### 13.7 Failure behavior

A targeted DATACUT activation should always have a valid row for any valid board Packet coordinate. If runtime state cannot resolve the coordinate due to a genuine defect, do not mutate the board partially. Use the established safe Effect-failure path and log the defect context.

Random targeting with no valid coordinate is a legal fizzle only if a future valid tuple can produce that state. Current targeted content should not normally fizzle.

---

## 14. Parameterized `EFFECT_BOMB` Contract

### 14.1 Existing Effect extension

Extend the existing coded `EFFECT_BOMB` registration with an exact typed parameter tuple rather than creating a second Bomb Effect for PLINK.

Preserve existing Bomb overlay, countdown, chain interaction, area resolution, settling, causal ownership, and metric behavior except where the new parameters explicitly select damage or charge behavior.

### 14.2 Parameter tuple

`EFFECT_BOMB` requires exactly three colon-delimited integers:

```text
targeting:dealDamage:gainCharge
```

Supported values:

#### `targeting`

- `0` — random valid Packet/placement coordinate, excluding a coordinate already selected by the same Function activation.
- `1` — require one player-selected Packet coordinate.

#### `dealDamage`

- `0` — Packets sliced by the blast deal Bomb/Function damage under existing Bomb valuation.
- `1` — blast slicing deals no direct damage.

#### `gainCharge`

- `0` — Packets directly sliced by the blast generate owner-scoped axis charge under Section 10.7.
- `1` — directly sliced blast Packets generate no charge.

Every live `EFFECT_BOMB` Function row must provide all three values. Do not infer missing values from old hardcoded behavior.

### 14.3 Countdown and immediate resolution

Interpret Function `countdown` as follows:

- positive integer — deploy the established countdown Bomb overlay, resolving the blast when its countdown expires;
- blank or zero — resolve the Bomb blast immediately without placing a countdown overlay;
- negative — invalid.

Current Bomber, E-Bomber, and ONEBOMB content retain their supplied countdown behavior. Current PLINK has no countdown and resolves immediately.

### 14.4 Area and quantity

- `areaPattern` is required and must resolve through the area registry.
- `quantity` must be a positive integer.
- random quantity greater than one resolves distinct placements under existing duplicate-placement exclusion;
- targeted quantity must equal one in Alpha 0.4;
- blast footprints clip through the established board-boundary behavior.

### 14.5 Damage behavior

When `dealDamage=0`:

- preserve existing Bomb per-Packet collateral valuation and no-critical behavior;
- preserve the existing damage-instance boundary per Bomb detonation;
- apply Buff and Shield through the existing damage pipeline;
- preserve causal attribution of Bomb-created settling/cascades under the current metrics architecture unless current code already uses a more granular source model;
- extend detailed attribution so `FNC_012` PLINK can be distinguished from the existing Bomber Function even though both invoke `EFFECT_BOMB`.

When `dealDamage=1`, directly sliced Packets do not deal Bomb damage, but board mutation and resulting refill Syncs still resolve as configured.

Bomb damage remains active under Reinforced Connection.

### 14.6 Charge behavior

When `gainCharge=0`, directly sliced blast Packets generate charge through the active Program queue. When `gainCharge=1`, they do not.

Current live Bomb variants, including PLINK, are expected to use no direct blast charge. This preserves the established rule that current Bomb destruction does not grant charge.

### 14.7 Special interactions

Preserve established Bomb behavior for:

- slicing or triggering other special Packets;
- countdown ownership;
- underlying Packet handling;
- chained explosions;
- causally attributed settling and cascades.

Targeted PLINK does not introduce a new special-retention parameter. Do not invent one.

### 14.8 Current PLINK variant

The current supplied content is expected to resolve:

```text
FNC_012 PLINK
payload: EFFECT_BOMB
quantity: 1
countdown: blank
areaPattern: AREA_CARDINAL_1
params: 1:0:1
```

Therefore PLINK:

- requires one Packet target;
- resolves immediately;
- slices the target Packet and its one-step cardinal neighbors within board bounds;
- deals Bomb/Function damage under existing collateral valuation;
- grants no direct blast charge;
- refills and resolves resulting Syncs normally;
- does not count direct blast destruction toward B1.

Use exact cost and Program binding from the supplied CSV.

---

## 15. B1, Skills, Ownership, and Effect-Caused Syncs

### 15.1 B1 exclusion

Direct Packets sliced by DATACUT or PLINK are Function/Bomb collateral, not directly matched Packets. They do not enter the B1 union footprint.

Only actual color-axis and shape-axis Sync footprints in a resolution wave qualify for B1.

### 15.2 Refill-created Syncs

After targeted Effect destruction:

- gravity and refill occur normally;
- resulting Syncs belong to the Effect initiator under the existing owner-scoped causal resolution rules;
- those Syncs generate base Sync damage unless Reinforced Connection suppresses it;
- Hacker Skills may trigger when their qualifying axis event is owned by the Hacker;
- normal charge routes through the active Program queue;
- B1 may trigger from the direct matched footprint of those Syncs;
- cascades follow the configured limit.

### 15.3 Metrics attribution

Preserve disjoint damage accounting. Extend it so direct DATACUT and PLINK contributions are analytically distinguishable from:

- base Sync damage;
- existing Bomber damage where current summary fields distinguish abilities;
- Attacker damage;
- Buff contribution;
- Skill damage;
- any other existing source-specific bucket.

The exact summary schema may follow the current metrics architecture, but detailed logs must always include `FNC_ID` and `EFFECT_ID`. Total damage must remain equal to the sum of disjoint attributed contributions.

Do not create a generic catch-all `functionDamage` bucket if the current metrics model is more granular.

---

## 16. Disabler Behavior and Telemetry

### 16.1 Target pool

Drain remains limited to Programs. It never targets:

- the Deck Function;
- inactive inventory Programs;
- absent Programs;
- non-Program charge pools.

For System Disabler, the eligible target pool is the four active Hacker Programs with current charge greater than zero.

### 16.2 System activation gating

The System must not activate Disabler when no active Hacker Program has charge greater than zero.

Therefore:

- there is no normal zero-charge System target;
- there is no normal System activation/fizzle caused solely by all Programs being empty;
- absence of activation is not logged as an activation.

A separate no-activation decision event is optional only if useful within the existing AI-decision telemetry. Do not add noisy parallel logs without analytical need.

### 16.3 Existing System target priority

Preserve the current Alpha 0.3 System Disabler targeting algorithm. Based on the established design, charged Programs are prioritized by current charge, then Function cost, with the existing final tie behavior. Do not rewrite it because the active roster is now configurable.

The algorithm operates on active Program state and therefore naturally reflects the chosen build.

### 16.4 Activation log fields

Every actual Disabler activation log must include:

- activating side;
- activating Program ID;
- Function ID;
- target Program stable `PRG_ID`;
- target readiness state at target resolution;
- target current charge before Drain;
- target Function cost;
- charge removed;
- target charge after Drain;
- battle ID and turn context.

Readiness must be explicit and auditable from charge/cost, such as `READY` when charge meets cost and `CHARGING` when positive but below cost. Preserve any existing canonical labels if already established.

Player-targeted Drain retains its existing target-validity behavior unless inspection reveals a conflict; actual player activations receive the same target telemetry.

---

## 17. Save, Resume, and Persistence

### 17.1 Active save schema

Increment the active save schema from Alpha 0.3. The expected next schema is `3` if the repository currently uses Alpha 0.3 schema `2`.

Reject Alpha 0.3 active saves cleanly. Do not infer missing portfolios, inventory, build, order, or pre-battle Build state.

Rejection must:

- avoid partial restore;
- avoid mutating the old save into a new schema;
- present the established incompatible-save path;
- return the user to a safe title/setup state.

### 17.2 Required Run save state

An active Run save must preserve or strictly revalidate:

- selected Hacker ID;
- selected Deck ID;
- content fingerprint;
- ordered Hacker portfolio IDs;
- ordered Deck portfolio IDs;
- combined six-Program inventory and source attribution, or enough strict resolved identity to reconstruct and compare it;
- exact active four-Program build and order;
- current Run step;
- whether state is pending pre-battle Build, active battle, pending result, or another established Run phase;
- active battle state when inside battle;
- resolved battle identity and settings snapshot;
- any RNG state required for deterministic battle continuation.

An active save with missing or mismatched Program references is incompatible. Do not silently replace an in-progress Run build with the default.

### 17.3 Initial Run commit boundary

Hacker Selection, Deck Selection, and initial Build remain pending until Battle 1 begins.

Starting Battle 1:

- commits the selected Hacker and Deck;
- derives and records the six-Program inventory;
- records the final active build and order;
- replaces the prior active save;
- creates Battle 1.

### 17.4 Between-battle persistence

Once a Run is committed, the pre-battle Build phase is part of active Run state. `Save and Quit` from Build must resume to the same upcoming encounter with the same build.

Starting the next battle snapshots that current build into battle state.

### 17.5 Quick Match save state

An active Quick Match save must preserve the exact resolved build and build source. Continue never rerolls a Random build and never substitutes the current remembered Constructed preset.

### 17.6 Remembered Constructed preference

The remembered Constructed build is not an active save and does not compete for the one save slot. Version and validate it separately as described in Section 9.4.

### 17.7 Run-end cleanup

Natural completion, Force Win completion, or abandonment clears active Run build state under existing save-clearing rules. It does not clear the Constructed Quick Match preference.

---

## 18. Logging and Metrics

### 18.1 Build and version stamps

Update build/version identifiers to `alpha-0.4.0` in all established runtime, log, export, and diagnostic locations. Do not modify README.

### 18.2 Selection and portfolio logging

At Run setup and Quick Match initialization, log at minimum:

- Hacker ID;
- Deck ID;
- ordered Hacker portfolio Program IDs;
- ordered Deck portfolio Program IDs;
- ordered combined inventory IDs;
- source attribution for inventory Programs;
- Deck Function ID;
- Hacker Skill IDs;
- content fingerprint.

### 18.3 Build logging

Log:

- initial Build screen build and order;
- Build context: initial Run, between-battle Run, retry, or Constructed Quick Match;
- build origin: default, remembered Constructed, random, carried Run, or another existing canonical value;
- every accepted replacement;
- every accepted reorder;
- before and after ordered Program IDs;
- final build used to initialize each battle;
- whether the final build was player-modified during the current Build visit;
- Run step or Quick Match mode.

Do not log mere modal opens, preselection, Back navigation, or uncommitted pending clicks unless the current UI telemetry already has a deliberate navigation stream.

### 18.4 Random Quick Match logging

Before battle creation, log:

- default Hacker and Deck IDs;
- six-Program candidate inventory;
- selected four IDs;
- final random order;
- setup random source/seed identifier where reproducibility permits;
- confirmation that gameplay RNG initialization occurs independently.

Do not expose sensitive platform entropy; a reproducible test seed or generated setup token is sufficient.

### 18.5 Targeted Function logging

For every targeted Function activation, log:

- activating side;
- activating Program ID;
- Function ID;
- Effect ID;
- target coordinate;
- target Packet color and shape before mutation;
- target special/overlay state and owner where applicable;
- resolved area or line dimension;
- directly sliced coordinates or count;
- retained special coordinates or count;
- direct damage result;
- direct charge result;
- refill/cascade causal root using the existing attribution model;
- legal fizzle or failure reason if one occurs.

### 18.6 Charge-routing logging

Implement Section 11 through the existing structured telemetry architecture.

### 18.7 Disabler logging

Implement Section 16.4.

### 18.8 Damage metrics

Maintain disjoint source accounting and total reconciliation. Add sufficient granularity to distinguish DATACUT and PLINK behavior. Preserve current source-specific fields when possible rather than collapsing them.

### 18.9 Storage and failure behavior

Preserve current storage-cap protection and graceful logging failure. Gameplay must not fail because telemetry cannot be written.

---

## 19. UI and Interaction Acceptance Requirements

### 19.1 Mobile-first boundary

The new screens must remain usable in the project's current narrow/mobile viewport assumptions. Do not require precision drag input.

### 19.2 Selection screens

Verify that:

- three portfolio Programs fit or scroll without obscuring Choose/Back controls;
- Program inspection is reachable from both Hacker and Deck screens;
- Deck Selection visibly includes selected Hacker strengths;
- one-option selection still requires the explicit final action.

### 19.3 Build screen

Verify that:

- all six inventory Programs are discoverable;
- four active slots and order are unmistakable;
- active versus inactive state is unmistakable;
- replacement cannot create an empty slot or duplicate;
- reorder controls remain reachable on a narrow screen;
- source attribution is visible;
- Start/Continue and Back or Save-and-Quit controls match context;
- Program inspection does not accidentally edit the build;
- no dead end is created when the default build is valid.

### 19.4 Battle screen

Verify that:

- only the four selected active Programs are shown;
- their top-to-bottom battle order matches Build;
- hitboxes and activation controls follow that order;
- Deck SCRAMBLE remains separately available under the current UI model;
- targeted DATACUT and PLINK can enter, cancel, and confirm target mode;
- target highlights and result animations do not obscure side UI;
- the existing System-turn border/dimming and battle layout do not regress.

Visual and hitbox behavior requires manual browser/device checking even if logic tests pass.

---

## 20. Acceptance Scenarios

The coding agent chooses the most efficient mix of existing unit, integration, smoke, batch, or manual checks. These are required observable scenarios, not a mandate to build a new test framework.

### 20.1 Parsing and content

Verify:

1. One leading apostrophe is removed before parsing for IDs, integers, enums, lists, and tuples.
2. A second leading apostrophe remains as data.
3. Embedded and trailing apostrophes remain.
4. Fingerprints are equal for semantically identical quoted and unquoted values.
5. Hacker and Deck portfolios resolve in authored order.
6. A portfolio with fewer or more than three Programs fails.
7. A duplicate inside a portfolio fails.
8. Hacker/Deck overlap fails.
9. Combined inventory contains six distinct Programs.
10. Every Program resolves exactly one active Function.
11. `EFFECT_BOMB` requires exactly three parameters.
12. `EFFECT_LINESLICE` requires exactly five parameters.
13. Invalid parameter enums fail with field/position context.
14. Targeted quantity greater than one fails.
15. PLINK resolves as immediate `AREA_CARDINAL_1` targeted Bomb with no direct charge.
16. Placeholder and notes fields do not affect fingerprint or gameplay.

### 20.2 Default inventory and build

Verify:

1. Current HAK/DEK content produces the expected six Programs.
2. Default build is portfolio entries H1, H2, D1, D2.
3. Default algorithm is not hardcoded to current four Program IDs.
4. Build opens with four occupied unique slots.
5. Replacing a Program swaps it with the inactive choice.
6. Reorder changes explicit top-to-bottom order.
7. Normal interaction never produces invalid slot count or duplicates.
8. Battle initializes only the four active Programs.

### 20.3 Run flow

Verify:

1. New Run follows Hacker Selection -> Deck Selection -> Build -> Battle 1.
2. Existing save remains untouched until Battle 1 starts.
3. Build appears before Battles 2, 3, and 4.
4. Current Run build carries to the next Build screen.
5. Player changes affect the upcoming battle.
6. Retry returns to Build for the same encounter.
7. Save and Quit from committed Run Build resumes to that Build state.
8. Run completion and abandonment discard Run build changes.
9. A new Run starts from default, not the prior Run build.
10. Force Win progression remains consistent with Alpha 0.3.

### 20.4 Quick Match

Verify:

1. Quick Match menu exposes Random and Constructed modes.
2. Both resolve `HAK_01` and `DEK_01` explicitly.
3. Random mode selects four unique inventory Programs and a valid order.
4. Random setup does not consume gameplay RNG.
5. Random mode does not modify the Constructed preference.
6. Constructed mode opens with default when no valid preference exists.
7. Starting Constructed Quick Match writes the ordered preference.
8. Backing out does not write it.
9. A valid remembered build reopens exactly.
10. Invalid remembered references fall back nonfatally to default.
11. Active Quick Match resume restores the saved build rather than rerolling or rereading preference.

### 20.5 Charge routing

Verify focused cases for:

1. first compatible non-full Program receives charge;
2. incompatible Programs are skipped;
3. full compatible Programs are skipped;
4. one Program fills and overflow moves downward;
5. overflow never moves upward;
6. remaining overflow discards only after all lower compatible Programs are full;
7. inactive Programs receive nothing;
8. Deck Function is excluded;
9. changing build order changes allocation where expected;
10. a dual-compatible Program can receive both color and shape streams;
11. color streams resolve before shape streams;
12. multiple same-wave streams use deterministic ordering;
13. cascades use the same routing;
14. `SKL_EXTRA_MATCH_CHARGE` modifies the normal stream before routing;
15. charge never exceeds Function cost;
16. System owner-side routing remains valid with existing roster and supports future overlapping bindings.

### 20.6 DATACUT

Verify:

1. selecting a Packet slices its entire row;
2. only one Packet target is required;
3. specials are destroyed under current tuple;
4. direct row slice produces no direct charge;
5. direct row slice produces one combined noncritical Function-damage instance;
6. Buff and Shield apply once to that instance under existing order;
7. damage remains active under Reinforced Connection;
8. direct slice does not trigger Skills or B1;
9. refill-created Syncs resolve normally and may trigger Skills/B1/charge;
10. target and outcome logs include stable IDs and Packet properties.

Also cover non-live enum branches of `EFFECT_LINESLICE` at the appropriate contract-test level: column, random target, retain all specials, retain owner specials, no damage, and gain charge.

### 20.7 PLINK and Bomb parameters

Verify:

1. PLINK requires one Packet target;
2. it resolves immediately with no countdown overlay;
3. footprint is target plus cardinal-one neighbors, clipped at edges;
4. it deals existing Bomb collateral damage;
5. it grants no direct blast charge;
6. direct blast does not contribute to B1;
7. refill-created Syncs resolve normally;
8. existing Bomber, E-Bomber, and ONEBOMB retain their countdown/quantity behavior under complete tuples;
9. no Bomb tuple relies on missing trailing defaults;
10. detailed metrics distinguish PLINK from existing Bomb sources.

Also cover `dealDamage=1` and `gainCharge=0` at contract-test level even if current live rows do not use them.

### 20.8 Disabler

Verify:

1. System Disabler considers only active Programs with charge greater than zero;
2. it does not activate when all active Programs are empty;
3. inactive inventory Programs are never targets;
4. Deck Function is never a target;
5. existing priority/tie behavior remains intact;
6. every activation log contains target `PRG_ID`, readiness, current charge, cost, and removed charge.

### 20.9 Save and compatibility

Verify:

1. Alpha 0.3 save shape is rejected cleanly.
2. Alpha 0.4 Run save round-trips inventory, build, order, and pre-battle Build phase.
3. Mid-battle save round-trips the selected four Programs and their order.
4. Quick Match save round-trips build source and order.
5. Content fingerprint mismatch rejects active save.
6. Invalid convenience preference falls back rather than rejecting startup.
7. active saves never silently replace invalid build state with default.

### 20.10 Regression

Run the established verification suite appropriate to the repository, including at minimum:

- TypeScript type checking;
- automated tests;
- headless smoke/integration coverage;
- production build;
- existing simulation/balance harnesses when they remain part of the normal build gate.

Automated test organization is a coding-agent decision. Report exact commands and results.

### 20.11 Manual checks

Manually inspect:

- Hacker and Deck portfolio display on a narrow viewport;
- shared Program inspection modal;
- Build replacement and reorder controls;
- Run Build flow before every battle;
- Constructed Quick Match Build;
- active Program battle ordering and hitboxes;
- DATACUT and PLINK target selection/cancellation;
- System-turn red border and Datastream dimming after UI changes;
- no regression to avatar, Program stack, pause, status, or result controls.

If manual checks are not performed, state that plainly in the final report.

---

## 21. Completion Standard

Alpha 0.4.0 is complete when:

- Hacker and Deck datasets each resolve an ordered three-Program portfolio;
- the combined inventory contains six distinct Programs;
- the Build screen always opens with a valid ordered four-Program build;
- the player can replace and reorder active Programs;
- Build appears before every Run battle and on retry;
- Run build changes persist only within the active Run and resume correctly;
- Random Quick Match creates and logs a valid isolated-random build;
- Constructed Quick Match remembers its last valid build outside the active save;
- battles initialize exactly the selected four Programs in the selected order;
- charge overflow routes top-to-bottom through compatible active Programs;
- DATACUT and PLINK operate through the typed targeted Effect contracts;
- PLINK resolves immediately and grants no direct charge;
- save schema rejects Alpha 0.3 and preserves all Alpha 0.4 active state;
- Disabler gating and target telemetry meet Section 16;
- leading-apostrophe normalization works across datasets;
- logs and metrics expose inventory, build, order, routing, targeting, and source-specific damage;
- established Alpha 0.3 behavior remains intact;
- verification passes or any unresolved failure is reported accurately.

---

## 22. Explicitly Out of Scope

Do not implement in Alpha 0.4:

- rewards;
- Program acquisition;
- inventory growth during a Run;
- permanent player collection progression;
- owned Program instances or duplicate copies of one Program ID;
- System-side build selection or editing;
- more than one active Function per Program;
- more than one active Deck Function;
- Program passives;
- multi-Packet or multi-target player selection;
- empty-slot build assembly;
- Hacker/Deck compatibility restrictions;
- neutral wildcard charging;
- charge flow into inactive Programs;
- Drain of the Deck Function;
- unique boss mechanics;
- battlefields;
- external encounter/run-definition redesign;
- broad balance changes;
- generalized spreadsheet scripting;
- generalized Function recursion or arbitrary nesting;
- final Function-description architecture;
- displaying `notes` as player-facing descriptions;
- final art, animation, audio, accessibility, or feature-complete polish;
- README or source-control writes.

---

# Part II - Two-Tier Implementation Workflow

## 23. Workflow Objective

Use the Senior Developer only where Alpha 0.4 introduces shared architecture, persistence contracts, Effect semantics, or cross-cutting combat ownership. Delegate bounded implementation in established frameworks to the Junior Developer.

Optimize total implementation and review cost, not the percentage of tasks assigned to the Junior. A task is not economical to delegate if defining and supervising it costs more than implementing it safely at the Senior level.

The Senior Developer must first inspect the repository and may revise the provisional division below before implementation.

## 24. Classification Rules

Assign work to the Senior Developer when it materially affects:

- resolved content models or shared validation;
- save schema, phase ownership, or preference persistence;
- battle construction and active roster authority;
- charge generation/allocation semantics;
- target lifecycle or Effect execution semantics;
- damage attribution and event causality;
- RNG ownership or deterministic restore;
- shared architecture used by browser and headless consumers;
- cross-interface state ownership;
- ambiguous behavior that could create competing authorities.

Assign work to the Junior Developer when it is bounded within an established interface, including:

- authored content and fixtures;
- screen construction against Senior-defined state/actions;
- modal presentation;
- bounded menu and label changes;
- telemetry-field plumbing after event ownership is defined;
- focused tests for specified behavior;
- version stamps and non-README documentation comments.

## 25. Required Junior Escalation Triggers

The Junior Developer must stop and escalate if implementation appears to require:

- a new shared abstraction not supplied by Senior work;
- a change to save schema or lifecycle phase ownership;
- a second content or build authority;
- different browser and Node behavior;
- changes to event order, causal ownership, or RNG ownership;
- generalized multi-target behavior;
- parallel charge-routing logic;
- weakening or deleting a test to make implementation pass;
- interpretation of a player-visible ambiguity not resolved here;
- Git/README writes;
- scope beyond Alpha 0.4.

## 26. Provisional Division of Labor

### SENIOR-0 - Architecture inventory and assignment refinement

Inspect before coding:

- current resolved Hacker/Deck/Program/Function models;
- Alpha 0.3 save schema and Run phase machine;
- title/Quick Match routing;
- Build Review implementation and screen controller;
- battle Program construction and vertical order;
- charge generation/allocation paths for both sides;
- Skill charge integration;
- System Disabler gating/targeting;
- target-mode lifecycle;
- Effect registry and current Bomb implementation;
- metrics attribution/event model;
- preference/settings persistence options;
- browser and headless content loading;
- current tests and simulations.

Then refine Senior/Junior task boundaries and stop for authorization under Stage 1.

### SENIOR-1 - Content, portfolio, and parser foundation

Own:

- leading-apostrophe normalization in the shared pipeline;
- Hacker/Deck `PRG_SET` parse, validation, and resolution;
- cross-portfolio validation;
- resolved inventory/source model;
- fingerprint extension;
- `EFFECT_BOMB` and `EFFECT_LINESLICE` typed contracts;
- area/countdown sanity validation;
- save-schema model changes required by new identity.

Deliver stable interfaces for UI and combat work.

### SENIOR-2 - Build state, lifecycle, and persistence

Own:

- valid Build-state model and actions;
- default-build derivation;
- Run pre-battle Build phase integration;
- retry-to-Build behavior;
- initial Run commit boundary;
- active save schema 3 and strict restore;
- Constructed Quick Match preference boundary;
- Random Quick Match isolated RNG ownership;
- battle initialization from ordered build.

### SENIOR-3 - Charge routing, targeting, and Effect integration

Own:

- shared top-to-bottom charge routing;
- color-before-shape ordering;
- Skill/Effect integration with routing;
- active-roster targeting boundaries;
- `EFFECT_LINESLICE` execution;
- parameterized immediate/countdown `EFFECT_BOMB` execution;
- damage attribution and Reinforced Connection interaction;
- Disabler activation gating and target telemetry semantics;
- causal event/log boundaries.

### JUNIOR-1 - Content fixtures and validation cases

After Senior contracts are fixed:

- install/use the supplied CSV content without redesigning it;
- update parser/validation fixtures;
- add focused invalid-portfolio, overlap, tuple, apostrophe, and preference fixtures;
- preserve unreferenced-Function warning expectations.

### JUNIOR-2 - Selection-screen portfolio presentation and inspection modal

Against Senior-defined resolved interfaces:

- add Hacker portfolio display;
- add Deck portfolio display and selected Hacker strengths;
- implement shared informational Program inspection;
- show Function name/cost/source;
- use optional literal description placeholder only if needed;
- preserve narrow-screen navigation.

### JUNIOR-3 - Functional Build screen

Against Senior-defined Build actions/state:

- replace fixed Build Review;
- display six inventory Programs and four ordered slots;
- implement bounded swap replacement;
- implement bounded reorder controls;
- display source and inspection affordances;
- add context-specific Start/Back/Save-and-Quit controls;
- avoid UI-owned build validation rules.

### JUNIOR-4 - Quick Match menu and presentation flow

Against Senior-defined mode/state APIs:

- add Random/Constructed Quick Match menu;
- wire Constructed Build entry/back/start;
- display build source where useful for whitebox verification;
- preserve existing title/Continue behavior.

### JUNIOR-5 - Telemetry fields, versioning, and focused tests

After Senior event ownership is defined:

- plumb portfolio/build/order fields;
- plumb target and Disabler fields;
- update build/version stamps;
- add focused tests for UI reducers/actions, logs, and resolved scenarios;
- do not create parallel event types when an existing one should be extended.

### SENIOR-4 - Integration review and final verification

Review:

- one authority for inventory/build/order;
- one charge-routing implementation;
- no gameplay RNG contamination;
- save and preference boundaries;
- target lifecycle and Effect semantics;
- damage and charge attribution;
- browser/headless parity;
- Alpha 0.3 regressions;
- Junior changes for architecture leakage.

Run final verification and produce the report required in Section 30.

---

# Part III - Coding Agent Execution Instructions

## 27. Stage 1 - Required Inspection and Authorization Stop

Before writing implementation code:

1. Read this entire document.
2. Read every supplied CSV and both supplied PDF reference sheets.
3. Inspect the current repository architecture identified in `SENIOR-0`.
4. Run the current baseline verification suite appropriate to the repository.
5. Confirm the actual Alpha 0.3 save schema and phase model.
6. Confirm the current Function CSV values after the user's edits, especially:
   - complete Bomb tuples;
   - DATACUT tuple;
   - PLINK blank countdown;
   - PLINK `AREA_CARDINAL_1`;
   - PLINK `1:0:1` tuple.
7. Identify exact files/modules affected.
8. Identify reusable existing paths and any risk of parallel logic.
9. Review the provisional Senior/Junior assignments and revise them if needed.
10. Produce a concise implementation plan containing:
    - current architecture findings;
    - conflicts or deviations, if any;
    - final task division;
    - dependency order;
    - save migration/rejection plan;
    - test strategy using existing infrastructure;
    - manual-check plan;
    - estimated high-risk areas.
11. Stop and request authorization before implementation.

### Stage 1 decision rule

Do not stop for minor implementation choices that the current architecture clearly resolves. Stop for authorization after the inspection plan, and separately escalate only if a genuine unresolved conflict affects gameplay, persistence, event semantics, RNG, or scope.

Do not implement speculative abstractions for Alpha 0.5.

## 28. Stage 2 - Implementation After Authorization

After authorization:

1. Complete Senior foundation work before dependent Junior tasks.
2. Keep all gameplay-affecting values in the supplied datasets or established constants, not duplicated in UI code.
3. Preserve one shared browser/headless content and combat path.
4. Add tests as behavior is implemented rather than deferring all verification.
5. Maintain valid Build state through actions, not through post-hoc UI warnings.
6. Preserve deterministic gameplay RNG.
7. Do not broaden scope to rewards, acquisition, collection, or System build editing.
8. Do not modify README or source control.
9. Record any necessary deviation in code comments only where the reason is not otherwise evident.
10. Escalate under Section 25 when required.

## 29. Final Verification

Run the repository's complete established build gate. At minimum, where those scripts exist:

```text
npm run typecheck
npm test
npm run smoke
npm run batch
npm run hpladder
npm run build
```

The coding agent may add or use other focused commands. Do not claim manual visual verification unless it was actually performed.

## 30. Final Report

The final report must include:

1. concise implementation summary;
2. exact verification commands and exit results;
3. test counts where reported by the tools;
4. save schema and preference-storage summary;
5. content/validation warnings and whether expected;
6. charge-routing behavior and focused verification summary;
7. DATACUT and PLINK behavior summary;
8. Disabler telemetry/gating summary;
9. any deviations from this handoff and why;
10. any manual checks performed;
11. any manual checks still required;
12. recommended README changes for the user, without editing README;
13. confirmation that no source-control write or remote operation occurred.

Be explicit about uncertainty. A passing automated suite does not substitute for unperformed narrow-screen, Canvas, targeting, or hitbox checks.
