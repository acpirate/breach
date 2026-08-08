# Breach Alpha 0.5.0 — Coding Agent Handoff

**Build identity:** `alpha-0.5.0`

**Status:** Canonical implementation requirements and coding-agent instructions for Alpha 0.5.0.

**Primary objective:** Add authored System identity as a first-class external content layer; use that identity to drive System ICE, strong/weak axes, ordered System Program builds, Run/Quick Match opponent selection, and the System character sheet; add the BOUNCER and MIDNIGHT authored Systems and their new Program/Function content; add `EFFECT_TRANSFORM`; support immediate Sync resolution caused by COERCE; support delayed EBUFF delivery through the existing countdown architecture; make System Function readiness dynamic within the Function phase while limiting each Program to one activation per phase; and remediate the known compact-log/charge-waste reporting issues without adding System passives, System build editing, rewards, path choice, bosses, or a broad balance pass.

---

## 0. Document Authority, Supplied Files, and Working Method

This document is the authoritative Alpha 0.5.0 behavior and implementation-boundary specification.

The coding agent will also receive the current Alpha 0.5 datasheets as CSV files and the current dataset-notes and parameter-notes PDFs. Read this entire document and all supplied data/reference files before proposing or writing implementation code.

Use sources in this order:

1. **This Alpha 0.5.0 coding-agent handoff** for required behavior, resolved design decisions, architecture boundaries, lifecycle rules, and acceptance criteria.
2. **The supplied Alpha 0.5 CSV datasheets** for exact authored IDs, names, costs, bindings, ordered Program sets, Effect parameters, `startCharged`, quantities, countdowns, area patterns, and other content values.
3. **The supplied dataset-notes and parameter-notes PDFs** for general field meanings, area-pattern context, and Effect parameter enumerations where this document does not narrow or override them.
4. **Any supplied `gameplay conventions` sheet/export** as non-normative design context only. It does not override this document or the authored runtime CSV values.
5. **The current Alpha 0.4.1 repository implementation and tests.**
6. Earlier Alpha requirements only for behavior that remains unchanged.
7. Older design discussion and backlog material only for historical context.

### 0.1 Datasheet authority over the designer handoff

The Alpha 0.5 datasheets are authoritative for exact authored content when they conflict with the earlier designer handoff narrative.

Examples already resolved:

- The current authored System builds are the builds in `SYS.PRG_SET`, even where they differ from an earlier prose example.
- The number of new System Programs is whatever the current `PRG_S` datasheet contains; do not force the older prose count.
- Bomb quantities, countdowns, area patterns, and charge behavior come from the current Function rows and typed Effect parameters.
- `SPAM` intentionally grants charge because its Bomb tuple says so.
- System passive Skills are **deferred** even though the earlier designer handoff proposed them.

Do not “correct” the CSV content back toward older prose.

If a supplied CSV contradicts an explicit semantic or safety requirement in this document, report the exact conflict during Stage 1 rather than silently choosing one interpretation.

### 0.2 Expected supplied runtime datasets

Alpha 0.5 runtime content consists of seven required datasets:

1. Hacker Programs (`PRG_H`).
2. System Programs (`PRG_S`).
3. Functions (`FNC`).
4. Hackers (`HAK`).
5. Systems (`SYS`).
6. Skills (`SKL`).
7. Decks (`DEK`).

The PDFs and any gameplay-conventions export are reference material, not runtime executable data.

### 0.3 Fresh-context rule

Begin this build with a fresh coding-agent context. Do not carry stale assumptions from the Alpha 0.4 implementation session when repository inspection can establish the current architecture directly.

### 0.4 One-agent execution model

There is **no Senior Developer / Junior Developer split** for this build.

One coding agent owns:

- repository inspection;
- architecture decisions within this specification;
- implementation;
- integration;
- test additions;
- manual verification where practical;
- README update;
- final diff review;
- commit;
- push;
- final report.

Do not introduce role-based task delegation or role-specific escalation language.

### 0.5 Source control and README — changed from prior builds

The previous instruction prohibiting repository writes is rescinded.

For Alpha 0.5 the coding agent **must update the README, commit the completed build, and push it** after implementation and the full verification gate are complete.

Rules:

- Do not commit a knowingly failing or partially verified build.
- Inspect `git status` and `git diff` before staging.
- Update `README.md` to describe what actually shipped, not merely what was planned.
- Prefer one final build commit unless repository circumstances clearly justify otherwise.
- Push the current branch through its configured upstream after the commit.
- Do not force-push, rewrite history, rebase published work, reset unrelated user work, or discard unrelated changes.
- If push cannot be completed safely because of authentication, remote divergence, missing upstream configuration, or an ambiguous remote/branch state, stop and report the exact condition rather than forcing a destructive resolution.

---

# Part I — Alpha 0.5.0 Requirements

## 1. Build Objective

Alpha 0.5 establishes System identity as a data-driven encounter layer while preserving the Alpha 0.4 Hacker build system.

The completed build must:

1. Add the required external `SYS` dataset to the shared browser/Node content pipeline.
2. Resolve System identity from stable `SYS_ID` records rather than hardcoded/complementary System settings.
3. Make selected System identity authoritative for:
   - base ICE;
   - System strong colors;
   - System strong shapes;
   - derived weak colors;
   - derived weak shapes;
   - ordered active System Program build.
4. Add the two authored Systems from the supplied datasheet.
5. Make Run opponent selection random and persistent per battle, selected **before** the pre-battle Build screen.
6. Add explicit System Selection to Constructed Quick Match **before** the Build screen.
7. Make Random Quick Match choose a valid System automatically.
8. Preserve selected System identity through save/resume without rerolling.
9. Update the System character sheet and relevant setup UI from resolved System identity.
10. Add the new System Programs and Functions from the supplied data.
11. Add typed `EFFECT_TRANSFORM` support.
12. Implement COERCE as an atomic neutral-Packet transformation followed by immediate normal System-owned Sync resolution.
13. Support EBUFF’s delayed conversion into live Buff specials using the established countdown execution model.
14. Preserve existing parameterized Bomb behavior and intentionally allow SPAM to grant charge.
15. Make System Function readiness dynamic inside the System Function phase so a Function may charge another Program that then activates in the same phase.
16. Limit each System Program to at most one activation per System Function phase.
17. Preserve Program order as charge-routing priority, **not** implicit Function-activation priority.
18. Extend save identity, content fingerprinting, logs, metrics, compact export, and browser/headless parity for System identity and new content.
19. Fix compact exporter classification of valid structured events.
20. Remove misleading `cfg[missing]` output from normalized Verbose turn rendering.
21. Replace legacy per-Program charge-waste reporting with one total charge-waste metric per side/battle; axis-specific waste remains deferred.
22. Preserve Alpha 0.4.1 BASIC / VERBOSE / COMPLETE logging behavior and storage safeguards.
23. Reject incompatible Alpha 0.4.x active saves cleanly rather than synthesizing System identity into old battles.
24. Preserve current Hacker/Deck build construction, charge overflow, targeting, B1, Reinforced Connection, Skills, logging levels, and other combat behavior unless this document explicitly changes it.

This is not a broad balance pass. Use the supplied authored values as provisional content values.

---

## 2. Resolved Decisions and Overrides

The following have already been decided and must not be reopened without a concrete repository conflict.

### 2.1 Content authority

- Exact authored System, Program, Function, area, cost, quantity, countdown, and tuple values come from the supplied Alpha 0.5 CSVs.
- Datasheets override conflicting older designer-handoff prose.

### 2.2 System passives are deferred

- Alpha 0.5 does **not** implement System passive Skills.
- The `SYS.SKILL` column is reserved for later content and is expected to be blank in Alpha 0.5 authored rows.
- Do not add new System Skill rows merely to satisfy the older designer handoff.
- Do not invent numeric System passives.
- Do not reuse Hacker Skills on Systems unless a later requirement explicitly enables System Skill execution.

For Alpha 0.5, a nonblank `SYS.SKILL` value should be treated as unsupported content and rejected at startup rather than silently parsed and ignored.

System passives are a future backlog item.

### 2.3 System durability field

The canonical System durability field is:

```text
BASE_ICE
```

not `BASE_LINK`.

The intended `SYS` header therefore uses `BASE_ICE`.

If the actual supplied CSV still contains `BASE_LINK`, treat that as a stale/export mismatch and report it during Stage 1 rather than creating a compatibility alias without authorization.

### 2.4 System weak axes

System data stores strong sets only.

- `STRONG_COLORS` is authoritative.
- `STRONG_SHAPES` is authoritative.
- Weak colors are the complement of `STRONG_COLORS` within the recognized six-color enum.
- Weak shapes are the complement of `STRONG_SHAPES` within the recognized six-shape enum.
- Strong-set counts are not restricted to exactly three.

The prior Alpha behavior where System strengths were simply complementary to the Hacker is removed. Each selected System now has its own independent profile.

### 2.5 Quantity semantics

For Effects that use `quantity`, the general Alpha 0.5 interpretation is:

> `quantity` is the maximum number of valid targets/deployments the Effect may act on during one Effect resolution.

Therefore:

- “up to this many valid targets” is normative;
- fewer targets may be affected if fewer valid targets exist;
- `99` is an ordinary numeric maximum, not a magic `ALL` sentinel;
- if a board contains fewer than 99 eligible Packets, `quantity=99` naturally affects all of them.

Do not create special-case semantics for the literal value 99.

### 2.6 COERCE-generated Syncs resolve immediately

After COERCE transforms its selected neutral Packets:

- run normal Sync detection immediately;
- any resulting Syncs slice immediately;
- resulting damage is normal **System-owned Sync damage**;
- resulting charge is normal **System-owned match charge** routed through the ordered System Program build;
- cascades resolve under the active battle cascade rules;
- B1 line-clear qualification uses the normal direct-match footprint rules;
- the conversion itself contributes no separate direct damage and no separate direct charge.

Do not leave stable pre-existing Sync patterns on the Datastream merely because they were created by an Effect. That would be counterintuitive to the player and is not the intended Alpha 0.5 behavior.

### 2.7 EBUFF interpretation

The supplied EBUFF row is intentionally delayed.

- It places countdown objects on up to the authored quantity of valid Packets.
- Those countdown objects do not contribute Buff magnitude while pending.
- At expiry, each surviving countdown becomes the Buff on that **same Packet** using the authored magnitude.
- If the Packet/countdown is sliced or otherwise removed before expiry, no Buff is delivered from that object.

Do not create a separate new external “place countdown” Effect solely for EBUFF. Preserve/reuse the established countdown architecture where practical.

### 2.8 SPAM grants charge deliberately

SPAM’s authored `EFFECT_BOMB` tuple grants charge from sliced Packets.

This is intentional experimental content.

Do not normalize SPAM back to the no-charge behavior of other Bomb Functions.

### 2.9 Function descriptions remain deferred

Alpha 0.5 may display the Function name as the player-facing Function identifier.

- Do not treat `notes` as player-facing copy.
- Do not add a new Function-description field merely for this build.
- Do not generate prose descriptions from Effect parameters as a normative UI contract.
- Existing literal temporary description placeholders may remain if already harmless, but they are not required.

Final Function-description authoring/storage is deferred to a future UX pass.

### 2.10 System selection precedes Build

The upcoming System must be known before the player edits the upcoming Hacker build.

- **Constructed Quick Match:** System Selection occurs before Build.
- **Run:** the game randomly resolves the upcoming System before opening that battle’s Build screen.

The future plan to use a fixed introductory System or one of several deliberately easy “romp” Systems for early Run encounters is deferred. Alpha 0.5 uses the simple random valid-System rule for all Run battles.

### 2.11 System Function activation

Within the System Function phase:

- readiness is recomputed after every fully resolved Function;
- charge created by one Function may make another Program ready in the same phase;
- each System Program may activate at most once during that Function phase;
- a Program recharged after it already activated cannot fire a second time that phase;
- Program order remains charge-routing priority only and must not acquire implicit activation-priority semantics.

### 2.12 Countdown architecture

The required behavior is schedule-now / deliver-later, but this document does **not** require a new countdown framework if the repository already represents that distinction correctly.

Preserve the existing Function-chain architecture for content that explicitly chains Functions. Do not invent a second generalized delayed-function composition system for EBUFF.

---

## 3. Existing Architecture and Behavior to Preserve

Unless explicitly changed here, preserve Alpha 0.4.1 behavior including:

- one shared browser/Node CSV parse/validate/resolve pipeline;
- leading-apostrophe normalization of dataset values;
- immutable resolved content authority;
- stable ID/reference validation;
- Program → Function → Effect execution architecture;
- typed Effect parameter contracts;
- Skill-effect registry and current Hacker Skills;
- Function composition depth/anti-recursion rules;
- Hacker/Deck portfolio and six-Program inventory derivation;
- four active Hacker Program slots;
- always-valid Build-state actions;
- Build before every Run battle;
- Random and Constructed Quick Match;
- remembered Constructed Quick Match Hacker build preference;
- current target-mode lifecycle and cancel behavior;
- Deck-owned SCRAMBLE;
- B1 combined-direct-footprint line clears and no recursive line-clear generation;
- top-to-bottom Program charge overflow;
- color-stream-before-shape-stream routing;
- owner-scoped match/Effect charge;
- Hacker Skill semantics and damage ordering;
- Reinforced Connection semantics;
- Bomb, Shield, Buff, Attack, Drain, DATACUT, PLINK, countdown, and special-Packet behavior except where new authored Function rows explicitly choose different parameters;
- System Drain eligibility and target telemetry;
- BASIC / VERBOSE / COMPLETE logging levels;
- Alpha 0.4.1 storage budget, pre-write trimming, bounded quota retry, event-stream promotion, and content-stamp deduplication;
- battle-ID generation that does not consume gameplay RNG;
- current battle layout, terminology, and System-turn input-lock presentation;
- the single active save slot.

Do not create parallel loaders, parallel battle-identity models, a second charge router, a second target lifecycle, a second countdown scheduler, or a second logging system.

---

# Part II — Data Contracts

## 4. Shared Dataset Rules

### 4.1 Leading-apostrophe normalization remains global

For every dataset cell:

1. If the raw value begins with one apostrophe (`'`), remove exactly that one leading character.
2. Do not remove a second apostrophe.
3. Do not remove embedded or trailing apostrophes.
4. Then trim.
5. Then perform blank handling, numeric conversion, enum parsing, list parsing, reference resolution, tuple parsing, validation, and fingerprint normalization.

This remains one shared parser behavior, not per-column handling.

### 4.2 Common list rules

- `:` is the authored list/tuple delimiter.
- Preserve authored order where order is meaningful.
- Reject blank tokens inside nonblank lists.
- Reject duplicate stable IDs where duplicate semantics are undefined.
- Names are presentation values and may duplicate with warnings as currently established.
- `notes`, `BIO`, `GRAPHICS`, and other identified placeholders are non-normative.

---

## 5. System Dataset (`SYS`)

### 5.1 Required header

The intended Alpha 0.5 System schema is:

```csv
SYS_ID,name,BASE_ICE,STRONG_COLORS,STRONG_SHAPES,PRG_SET,SKILL,BIO,GRAPHICS
```

### 5.2 Field contracts

| Field | Contract |
|---|---|
| `SYS_ID` | Required stable ID with `SYS_` prefix; globally unique within System records. |
| `name` | Required player-facing display name; duplicate names warn rather than fail unless existing shared policy differs. |
| `BASE_ICE` | Required positive integer base maximum ICE used by identity-derived battle configuration. |
| `STRONG_COLORS` | Required colon-delimited set/list of recognized color tokens; duplicates invalid. Authored count may vary. |
| `STRONG_SHAPES` | Required colon-delimited set/list of recognized shape tokens; duplicates invalid. Authored count may vary. |
| `PRG_SET` | Required ordered list of exactly four distinct valid `PRG_S_*` IDs. This is the complete authored System battle build and order. |
| `SKILL` | Reserved for future System passives. Must be blank in Alpha 0.5; nonblank is unsupported content and a startup error. |
| `BIO` | Presentation placeholder only; no display implementation required. Excluded from gameplay fingerprint. |
| `GRAPHICS` | Presentation placeholder only; no asset loading/display implementation required. Excluded from gameplay fingerprint. |

### 5.3 System weak sets

At resolution time derive:

```text
weakColors = ALL_COLORS - STRONG_COLORS
weakShapes = ALL_SHAPES - STRONG_SHAPES
```

Do not add redundant weak-set columns for Alpha 0.5.

### 5.4 System Program build

`SYS.PRG_SET` is authoritative for:

- battle initialization;
- top-to-bottom charge routing;
- Program display order;
- System character-sheet order;
- logs/metrics identity;
- save identity;
- fingerprinting.

It does **not** define Function activation priority.

There is no System portfolio, inventory, Build screen, Program replacement, or reorder interaction in Alpha 0.5.

---

## 6. Expected Authored Alpha 0.5 System Content

The supplied CSV is the exact content authority. The current design intent is expected to resolve approximately as follows; if exact values differ in the final supplied CSV, use the CSV unless that creates a semantic conflict with this handoff.

### 6.1 `SYS_01` — BOUNCER

Expected identity:

```text
SYS_ID:         SYS_01
name:           BOUNCER
BASE_ICE:       100
STRONG_COLORS:  RED:GRE:YEL
STRONG_SHAPES:  TRI:SQU:STR
PRG_SET:        PRG_S_003:PRG_S_005:PRG_S_006:PRG_S_001
SKILL:          blank
```

Intended archetype:

- setup-and-burst;
- COERCE converts neutrals to `YEL:STR`;
- `YEL` and `STR` are strong for BOUNCER;
- ATTACKER is first in the authored Program queue and shares those charge bindings;
- COERCE may therefore create immediate System-owned Syncs that preferentially charge ATTACKER through the normal queue;
- ENHANCE/EBUFF and E-BOMBER add pressure/support.

### 6.2 `SYS_02` — MIDNIGHT

Expected identity:

```text
SYS_ID:         SYS_02
name:           MIDNIGHT
BASE_ICE:       100
STRONG_COLORS:  RED:MAG:BLU
STRONG_SHAPES:  TRI:SQU:STR
PRG_SET:        PRG_S_007:PRG_S_008:PRG_S_001:PRG_S_002
SKILL:          blank
```

Intended archetype:

- Bomb saturation plus Shield support;
- three distinct Bomb-producing Program/Function configurations;
- authored top-to-bottom order controls charge competition;
- no requirement to include Disabler merely because an older narrative described one.

---

## 7. System Program and Function Content

The supplied `PRG_S` and `FNC` CSVs are authoritative for exact values.

Current expected new/changed authored content includes:

### 7.1 New System Programs

Expected rows include:

```text
PRG_S_005  MUSCLE   BLU  CRO  FNC_013
PRG_S_006  ENHANCE  MAG  TRI  FNC_014
PRG_S_007  SPAMBOT  YEL  CIR  FNC_015
PRG_S_008  THROWER  BLU  STR  FNC_001
```

Do not constrain Alpha 0.5 to the older prose statement that only two System Programs were being added.

### 7.2 `FNC_013` — COERCE

Expected authored intent:

```text
payload:       EFFECT_TRANSFORM
cost:          7
quantity:      99
startCharged:  Y
axisTarget:    NEU
axisResult:    YEL:STR
params:        0:1
```

Use the supplied row as exact authority.

### 7.3 `FNC_014` — EBUFF

Expected authored intent:

```text
payload:      EFFECT_BUFF
cost:         9
quantity:     3
countdown:    2
magnitude:    5
```

Use the supplied row as exact authority.

### 7.4 `FNC_015` — SPAM

Expected authored intent:

```text
payload:      EFFECT_BOMB
cost:         7
quantity:     3
countdown:    1
areaPattern:  AREA_CARDINAL_1
params:       0:0:0
```

The third Bomb parameter explicitly enables charge generation.

### 7.5 THROWER

`PRG_S_008` currently references the existing `FNC_001 BOMB` rather than requiring a new Effect or Function family. Preserve that reuse.

---

## 8. Gameplay Content Fingerprint

Extend the normalized gameplay-content fingerprint to include System gameplay identity and all new gameplay-affecting content.

At minimum include normalized values for:

- `SYS_ID`;
- `BASE_ICE`;
- ordered `STRONG_COLORS` content as represented by the existing identity convention;
- ordered `STRONG_SHAPES` content as represented by the existing identity convention;
- ordered `PRG_SET`;
- `SKILL` content if/when later enabled; Alpha 0.5 requires blank;
- new/changed `PRG_S` rows through the established Program fingerprint contribution;
- new/changed Function values through the established Function fingerprint contribution;
- `EFFECT_TRANSFORM`-relevant fields including `quantity`, `axisTarget`, `axisResult`, and typed `params`;
- EBUFF countdown/magnitude/quantity through the established Function contribution;
- SPAM Bomb tuple/quantity/countdown/area through the established Function contribution.

Exclude presentation-only/non-normative fields such as:

- `BIO`;
- `GRAPHICS`;
- `notes`;
- display-only labels already excluded by current fingerprint policy.

Do not duplicate the same content into multiple independent fingerprint authorities.

---

# Part III — System Identity and Battle Configuration

## 9. System Identity Is the System-Side Authority

Alpha 0.5 removes hardcoded System identity assumptions from battle construction.

For every battle, resolve one `SYS_ID` before constructing System combat state.

The selected System supplies:

- System name;
- base ICE;
- strong colors;
- weak colors derived as complement;
- strong shapes;
- weak shapes derived as complement;
- ordered active System Program IDs.

The selected System profile becomes the single authority for System-side color/shape strength calculations used by normal Sync damage and any Effect damage path that intentionally evaluates the activating side’s color/shape profile.

Do not continue deriving System strengths from the selected Hacker.

---

## 10. Normal LINK / ICE Configuration

Preserve the established Normal LINK setting and manual override behavior, with System identity inserted as the new source of normal ICE.

### 10.1 Normal LINK enabled

For Quick Match:

```text
Hacker max LINK = Hacker BASE_LINK + Deck ADD_LINK
System max ICE   = selected System BASE_ICE
```

For Run battle steps 1–4:

```text
System max ICE = selected System BASE_ICE + run-step modifier
```

Use the existing Run progression as additive modifiers:

```text
Battle 1: +0
Battle 2: +50
Battle 3: +100
Battle 4: +150
```

Therefore a System with `BASE_ICE=100` still produces the current 100 / 150 / 200 / 250 progression.

This architecture allows later Systems to have genuinely different base ICE without redesigning Run escalation.

### 10.2 Normal LINK disabled

When the existing normal-identity-stat toggle is disabled:

- manual Hacker LINK continues to override identity-derived Hacker LINK;
- manual System ICE/health setting continues to override selected System `BASE_ICE` and Run-step modifiers;
- the manual value applies in Quick Match and all Run steps according to current testing behavior.

Do not silently combine manual System ICE with `BASE_ICE` or the Run modifier.

### 10.3 Snapshot stability

Use the existing saved battle/Run configuration ownership so an active or pending battle does not silently change because Settings are edited later.

A resumed battle must restore the same effective System ICE and identity rather than rereading current Settings and rerolling/rederiving different values.

---

# Part IV — System Selection and Setup Flow

## 11. Run System Selection

### 11.1 Alpha 0.5 rule

For Alpha 0.5, each Run battle selects one valid loaded System randomly with replacement.

- Repeats are allowed.
- No shuffle bag is required.
- No anti-repeat rule is required.
- The future intro/“romp” encounter policy is out of scope.

### 11.2 Selection timing

Resolve the upcoming System **before** opening the Build screen for that battle.

Required Run flow:

```text
New Run
→ Hacker Selection
→ Deck Selection
→ resolve Battle 1 System
→ Build (shows upcoming System)
→ Battle 1
→ result
→ resolve Battle 2 System
→ Build
→ Battle 2
→ result
→ resolve Battle 3 System
→ Build
→ Battle 3
→ result
→ resolve Battle 4 System
→ Build
→ Battle 4
```

### 11.3 Pending initial Run setup

For a brand-new Run:

- System selection belongs to pending Run setup until the player starts Battle 1.
- Do not overwrite an existing active save merely by entering Hacker Selection, Deck Selection, or Build.
- Select the pending Battle 1 System once when the setup reaches the pre-battle state.
- Back/forward navigation within the same pending New Run setup must not reroll the opponent repeatedly.
- Abandoning pending setup back to Title may discard that pending System selection along with the rest of pending setup.

### 11.4 Between-battle persistence

For an already committed Run:

- when progression creates the next pre-battle Build state, select the next System exactly once;
- persist that `SYS_ID` in the Run’s `PENDING_BUILD` state;
- Save and Quit from Build must preserve it;
- Continue must restore the same upcoming System;
- reopening or refreshing the Build screen must not reroll it.

### 11.5 Retry after defeat

Retrying the same Run battle must preserve the same System identity.

- Defeat → Build for the same Run step retains the same `SYS_ID`.
- The player may alter the Hacker build/order before retrying.
- Do not reroll the opponent merely because the player lost.

### 11.6 Force Win

Preserve established Force Win behavior.

If Force Win converts a defeat into a victory and advances the Run, the next Run step receives a newly selected System before its Build screen like any other successful progression.

---

## 12. Constructed Quick Match System Selection

Quick Match continues to use the established default Hacker/Deck identity context (`HAK_01` and `DEK_01`) unless the repository has already generalized that behavior under an approved requirement.

Do **not** add Hacker Selection or Deck Selection to Quick Match in Alpha 0.5.

### 12.1 Flow

Use:

```text
Quick Match
→ Constructed Quick Match
→ System Selection
→ Build
→ Battle
```

### 12.2 System Selection behavior

- Display every valid loaded System.
- Selection is explicit.
- Use one final action such as `Choose`, `Done`, or `Continue`.
- Do not use a secondary confirmation modal.
- The chosen System becomes pending Quick Match identity.
- Back from Build returns to System Selection.
- Back from System Selection returns to the Quick Match submenu.

### 12.3 Existing active save boundary

Pending Constructed Quick Match setup must not overwrite an existing active save until the player actually starts the new battle, preserving the current Alpha 0.4 setup-commit boundary.

### 12.4 Remembered Constructed Hacker build

Preserve the existing remembered Constructed Quick Match Hacker build preference.

- It remains separate from active save state.
- System selection is not part of that remembered Hacker build preference.
- Selecting a different System does not overwrite the remembered build merely by viewing/editing setup.
- Continue to persist the remembered build/order when the Constructed Quick Match battle begins, under the existing rules.

Do not add a remembered System preference in Alpha 0.5.

---

## 13. Random Quick Match System Selection

Random Quick Match:

- continues using default `HAK_01` and `DEK_01` context;
- generates its valid random Hacker build/order under the existing Alpha 0.4 rules;
- also chooses one valid System randomly;
- starts battle without opening System Selection or Build;
- does not overwrite the remembered Constructed Quick Match build;
- stores/logs the selected `SYS_ID` in the created battle identity.

---

## 14. Selection RNG Ownership

Random System selection is setup/encounter-selection randomness, not combat-board randomness.

Requirements:

- selecting a System must not consume or perturb the battle gameplay RNG stream;
- Random Quick Match build generation and System selection must remain isolated from gameplay RNG;
- Run System selection must not alter board/refill/targeting RNG merely because a different number of setup selections occurred;
- once selected and persisted, save/resume never rerolls the System.

Reuse the existing isolated setup/random-selection mechanism where practical rather than creating a second combat RNG stream.

---

# Part V — Setup and Character UI

## 15. System Selection Screen

The Constructed Quick Match System Selection screen must be mobile-first and whitebox-functional rather than polished.

For each System expose enough resolved data to make the choice meaningful:

- System name;
- base/max ICE appropriate to Quick Match;
- strong colors;
- weak colors;
- strong shapes;
- weak shapes;
- ordered four-Program build;
- Program inspection access using the existing shared Program inspection UI where practical.

System passive Skills are deferred; do not fabricate an empty “passive” mechanic solely because the older designer handoff mentioned it.

`BIO` and `GRAPHICS` remain unused placeholders.

---

## 16. Run Build Screen Opponent Context

Because the upcoming System is selected before Build specifically so the player can react to it, the pre-battle Run Build screen must expose the upcoming opponent clearly enough to support build decisions.

At minimum show:

- System name;
- effective upcoming ICE;
- strong/weak colors and shapes;
- ordered System Programs;
- Program inspection access.

Use a compact/expandable presentation if necessary to preserve narrow-screen usability. Do not create a second full System-selection interaction during a Run.

The System is informational in Run setup; the player cannot reroll or replace it.

---

## 17. System Character Sheet

Update the existing battle System character sheet to resolve from selected System identity.

Show:

- System name;
- current/max ICE;
- strong colors;
- weak colors;
- strong shapes;
- weak shapes;
- ordered System Programs;
- Function names for those Programs;
- shared Program inspection access where practical.

Do not display `BIO` or `GRAPHICS` in Alpha 0.5.

Do not implement System passive-Skill presentation beyond an innocuous empty/none state if the existing character-sheet component structurally requires a field.

---

# Part VI — System Turn and Function Activation Semantics

## 18. Preserve the Existing Outer System Turn Order

Repository inspection must identify the current Alpha 0.4.1 order of:

- countdown advancement/resolution;
- timer-based System charge, if enabled;
- System Function activation phase;
- System normal matching action, if enabled;
- turn completion.

Preserve that established outer order unless this document explicitly changes it.

The new requirement changes **readiness handling inside the Function phase**, not the entire System turn lifecycle.

---

## 19. Dynamic System Function Phase

### 19.1 Core rule

System Program readiness is dynamic during the Function phase.

A Function may alter the Datastream, resolve Syncs/cascades, or otherwise create charge that makes another System Program ready. That newly ready Program may activate in the **same System Function phase**.

### 19.2 At-most-once activation

Maintain an `activatedThisPhase` concept or equivalent invariant:

- each active System Program may activate at most once during one System Function phase;
- a Program that fires, is later recharged, and becomes full again cannot fire a second time that phase;
- child Functions inside an existing composed Function are part of the parent Program activation and do not count as separate Program activations.

This guarantees the Function phase terminates even if future Effects generate charge recursively.

### 19.3 Recompute after full resolution

After each selected Function:

1. resolve the Function completely;
2. resolve all immediate Effect consequences;
3. resolve Effect-created Syncs;
4. resolve B1 line clears and cascades under current rules;
5. finish resulting damage and charge routing;
6. then recompute currently ready, valid, unfired Programs.

Do not snapshot Function readiness only once at phase start.

### 19.4 Target availability is part of activation eligibility

A ready Function that currently has no valid target/result must not be selected/spend charge merely to fizzle in normal System AI play.

Examples:

- Drain with no charged Hacker Program is ineligible.
- COERCE with zero valid neutral Packets is ineligible.
- A placement Function with zero valid deployment locations is ineligible if the existing Effect contract supports target preflight.

If another Function changes the board and creates a valid target later in the same phase, the previously blocked ready Program may become eligible and fire, provided it has not already activated.

If no ready **and valid** unfired Program exists, the Function phase ends.

### 19.5 Activation choice policy

Do not reinterpret `SYS.PRG_SET` order as Function activation priority.

When multiple ready, valid, unfired Programs are available:

- preserve the current Alpha 0.4.1 System activation-choice policy;
- if the current policy is random, keep it random;
- do not introduce a new authored priority field in Alpha 0.5.

### 19.6 Charge created after the Function phase

Charge generated by the System’s normal turn-ending Sync/match after the Function phase does **not** reopen the Function phase.

That charge is available on the next System turn according to current rules.

This mirrors the Hacker-side lifecycle where Functions are used before the turn-ending match.

### 19.7 Countdown-created charge

Any countdown/Effect resolution that occurs before the Function phase and legitimately generates charge completes under normal ownership/routing rules. Resulting readiness is available when the Function phase begins.

---

# Part VII — `EFFECT_TRANSFORM`

## 20. Effect Registration

Add one coded Effect ID:

```text
EFFECT_TRANSFORM
```

Register it through the existing Effect registry and typed parameter-contract mechanism.

Do not implement spreadsheet scripting or a generic arbitrary transformation language.

---

## 21. Required Function Fields for `EFFECT_TRANSFORM`

For Alpha 0.5, a Function using `EFFECT_TRANSFORM` requires:

- positive integer `quantity`;
- nonblank `axisTarget`;
- nonblank `axisResult`;
- exact typed `params` tuple defined below.

`damage`, `magnitude`, `countdown`, and `areaPattern` are not part of the current Transform contract unless repository inspection shows an established generic field is harmlessly present and explicitly unused.

Reject unsupported/nonblank fields when the current Effect-registry policy already rejects unused Effect fields.

---

## 22. Transform Axis Contract

### 22.1 `axisTarget`

For Alpha 0.5 current content, support:

```text
NEU
```

meaning Packets whose underlying board identity is neutral.

Do not broaden Alpha 0.5 into arbitrary color-to-color or shape-to-shape transform syntax without a concrete current row requiring it.

A future build may generalize this field.

### 22.2 `axisResult`

`axisResult` must contain exactly:

```text
<COLOR>:<SHAPE>
```

where:

- `<COLOR>` is one recognized non-neutral color token;
- `<SHAPE>` is one recognized shape token.

For current COERCE content:

```text
YEL:STR
```

### 22.3 Underlying Packet versus special overlay

Transform changes the underlying Packet’s color/shape identity. Special overlays are handled separately by the typed `specialPacketTreatment` parameter.

---

## 23. `EFFECT_TRANSFORM` Parameter Tuple

Use the exact tuple:

```text
targeting:specialPacketTreatment
```

Both positions are required.

### 23.1 `targeting`

```text
0 = random eligible Packet selection
1 = targeted Packet selection
```

#### `targeting=0`

- collect all valid candidates from `axisTarget`;
- choose up to `quantity` distinct targets without replacement;
- if eligible count is less than or equal to `quantity`, transform all eligible Packets;
- when all eligible Packets will be transformed, do not consume gameplay RNG merely to permute an otherwise identical complete set;
- if fewer than all candidates are selected, selection randomness is gameplay-affecting and must use the established gameplay RNG path.

#### `targeting=1`

Alpha 0.5 has only the existing single-Packet targeting UI model.

Therefore:

- `targeting=1` is valid only when `quantity=1`;
- a targeted Transform receives one selected Packet through the existing target lifecycle;
- `quantity>1` with `targeting=1` is a startup validation error in Alpha 0.5 rather than an invitation to implement multi-target selection.

No current authored Alpha 0.5 Function is required to use `targeting=1`.

### 23.2 `specialPacketTreatment`

Use the supplied parameter-note enum:

```text
0 = destroy special overlay on transformed Packet
1 = retain all special overlays
2 = retain only specials owned by the activating side; destroy others
```

Retaining a special preserves its existing ownership and Effect-specific state while the underlying Packet changes color/shape.

For current COERCE:

```text
0:1
```

meaning random eligible selection and retain all special overlays.

---

## 24. Atomic Transform Resolution

Transform all selected Packets as one atomic Effect result before running Sync detection.

Required order:

1. Resolve the complete valid target set for this Effect activation.
2. Apply required special-overlay removal/retention behavior.
3. Change all selected underlying Packets to `axisResult`.
4. Only after all selected transformations are applied, scan the Datastream for resulting Syncs.
5. Resolve those Syncs through the normal owner-scoped match-resolution pipeline.

Do **not** transform one Packet, resolve matches, refill, then transform the next Packet. That would make arbitrary target iteration order mechanically significant and would not match the intended player model.

---

## 25. Transform-Created Sync Ownership and Consequences

Any Syncs created by `EFFECT_TRANSFORM` are owned by the side that activated the Transform.

For COERCE this is normally the System.

Resulting Syncs use all normal rules:

- normal color/shape Sync detection;
- normal same-axis blob merging;
- current cross-axis deduplication;
- B1 combined direct-match footprint line-clear qualification;
- normal strong/weak damage using the selected System’s profile;
- normal critical rules where applicable to ordinary Sync damage;
- normal Buff/Shield interaction;
- normal owner-scoped color and shape charge generation;
- current color-before-shape charge routing;
- cascades under the active cascade limit;
- current event and metrics attribution.

The Transform Effect itself does **not** add a separate Function-damage instance and does **not** add separate direct charge.

This distinction must remain visible in metrics: damage and charge caused by the resulting Syncs remain Sync/match-originated, while the Transform activation is logged as the causal Effect that changed the board.

---

## 26. COERCE No-Target Behavior

For normal System AI activation:

- if no valid neutral Packets exist, COERCE is not a valid activation choice;
- the Program retains its charge;
- no activation cost is spent;
- no board mutation occurs.

Do not create repeated BASIC log spam merely because a charged COERCE is blocked for several turns.

If a lower-level Effect invocation somehow reaches runtime with zero candidates after activation has already been committed, follow the repository’s established legal-fizzle/error semantics rather than inventing a second rollback model. Normal synchronous System preflight should prevent this in ordinary play.

---

# Part VIII — Countdown Delivery and EBUFF

## 27. Countdown Behavioral Model

Alpha 0.5 formalizes the behavioral distinction:

```text
activation/deployment now
→ countdown persists
→ payload/effect result delivered later
```

This is a behavioral contract, not a mandate to replace existing internal code if Alpha 0.4.1 already models countdown objects correctly.

### 27.1 Preserve existing composition

The repository already supports chained Function composition for cases where one Function explicitly calls other Functions.

Do not create a new generalized delayed-Function graph or arbitrary nested composition system for Alpha 0.5.

### 27.2 Delayed object state

A countdown object must preserve enough resolved information to deliver the same intended behavior later, including where relevant:

- owner/side;
- source Program ID;
- source Function ID;
- countdown remaining;
- Effect/payload identity;
- resolved parameters that must not silently change while the object is armed;
- magnitude/area/charge behavior required by that delayed payload.

Reuse existing stamped-overlay behavior where already established for Bombs.

---

## 28. EBUFF Behavior

For the current `FNC_014 EBUFF` row:

### 28.1 Activation

- Select/place countdown objects on up to `quantity` valid Packets using the existing Effect’s placement rules.
- With current authored quantity 3, place up to three.
- A pending EBUFF countdown is a special overlay and can be sliced/removed under existing special-Packet rules.
- It contributes **zero** Buff magnitude while countdown is still positive.

### 28.2 Countdown

Use the established owner-turn countdown semantics.

Do not change Bomb countdown timing merely to implement EBUFF.

### 28.3 Expiry

When a surviving EBUFF countdown reaches zero:

- the countdown object is replaced/transformed into a normal live Buff special on the same Packet;
- use the authored `magnitude` from the Function/armed resolved contract;
- ownership remains the System;
- the newly live Buff immediately contributes to subsequent damage instances according to existing Buff rules.

### 28.4 Removed countdown

If the Packet/special is sliced or otherwise removed before expiry:

- there is no later ghost delivery;
- no Buff appears elsewhere;
- no delayed effect remains queued independently of the removed special unless the current established countdown architecture already defines a board-independent object, in which case Stage 1 must flag the semantic conflict before implementation.

### 28.5 No new external Effect required

Do not add `EFFECT_PLACE_COUNTDOWN`, `EFFECT_DELAY`, or another external Effect ID solely to represent EBUFF if the current countdown system can schedule the existing `EFFECT_BUFF` behavior cleanly.

---

# Part IX — Bomb Saturation Content

## 29. Preserve Parameterized `EFFECT_BOMB`

Do not create another Bomb Effect for MIDNIGHT.

The existing typed Bomb tuple remains authoritative:

```text
targeting:dealDamage:gainCharge
```

with each Function’s authored `quantity`, `countdown`, and `areaPattern` determining its variant.

### 29.1 SPAM

Current SPAM behavior intentionally differs from the existing no-charge Bomb variants.

If the supplied row remains:

```text
params = 0:0:0
```

then sliced Packets from its detonations generate charge under the existing Bomb charge rules.

That generated charge routes to the owning System’s active Programs using the normal ordered queue.

### 29.2 Existing Bomb valuation

Preserve the shipped Alpha 0.4 collateral-damage valuation behavior unless a supplied Function parameter explicitly selects a different existing branch.

Do not use Alpha 0.5 as an opportunity to revert or rebalance Bomb damage globally.

### 29.3 Countdown interactions

Countdown Bomb resolution may generate charge before the System Function phase. If so, that charge may make Programs ready for the upcoming dynamic Function phase under Section 19.

---

# Part X — System Charge Routing and Synergy

## 30. Ordered System Queue

System-owned axis charge routes through `SYS.PRG_SET` top-to-bottom using the established Alpha 0.4 queue rules.

For every stream:

1. scan the selected System’s active Program order from top to bottom;
2. skip Programs that do not match the stream token/axis;
3. skip compatible Programs that are already full;
4. fill the first compatible non-full Program up to its Function cost;
5. pass overflow downward;
6. continue until assigned or no compatible non-full Program remains;
7. aggregate any remaining waste under the new side-level total-waste metric.

Color streams resolve before shape streams as already established.

### 30.1 BOUNCER synergy

COERCE-created `YEL` and `STR` Sync charge must route through BOUNCER’s authored Program order exactly like any other System-owned Sync charge.

Do not hardcode special COERCE → ATTACKER charging. The intended synergy must emerge from:

- transformed axes;
- Program bindings;
- Program order;
- normal routing rules.

### 30.2 Function-generated charge and dynamic activation

If SPAM, another Effect, or an Effect-created Sync generates charge during the System Function phase, the resulting newly ready Program may activate later in the same Function phase if it has not already fired.

---

# Part XI — Save, Resume, and Versioning

## 31. Active Save Schema

Bump active game save compatibility for Alpha 0.5.0.

Expected next schema:

```text
build/version: alpha-0.5.0
save schema:   4
```

If repository inspection shows schema numbering has already advanced for another reason, preserve monotonic versioning and report the actual chosen value in Stage 1/final report.

### 31.1 Alpha 0.4.x compatibility

Do not migrate Alpha 0.4 or Alpha 0.4.1 active saves.

Those saves lack authoritative System identity and would require synthetic encounter decisions.

Reject them cleanly as incompatible and preserve the established graceful title/setup recovery behavior.

Do not partially restore an old battle and inject a random/default System.

---

## 32. Required System Save State

An active battle identity/save must preserve enough information to restore exactly the same opponent under the current content fingerprint, including at minimum:

- selected `SYS_ID`;
- System selection source where useful (`RUN_RANDOM`, `QUICK_RANDOM`, `QUICK_CONSTRUCTED` or equivalent);
- effective System max ICE/config state according to the existing battle config model;
- ordered active System Program IDs or an authoritative stable identity reference that resolves exactly through the matching fingerprint;
- current System Program charge/state as part of battle state;
- current System ICE;
- countdown/special state created by COERCE/EBUFF/Bombs where applicable;
- deterministic gameplay RNG state as already required.

Do not redundantly serialize complete immutable System definitions when stable IDs plus a matching gameplay fingerprint are sufficient.

---

## 33. Run `PENDING_BUILD` State

For a committed Run awaiting its next battle, persist:

- Run step;
- selected Hacker/Deck/inventory/current Hacker build as already required;
- the already selected upcoming `SYS_ID`;
- the saved Run/battle settings necessary to derive effective ICE consistently;
- any other existing pending-build fields.

Continue must reopen Build against the same System.

Retry of the same encounter uses the same `SYS_ID`.

---

## 34. Preferences

Preserve independent preferences where valid:

- Constructed Quick Match Hacker build preference;
- logging-level preference;
- existing game settings.

Do not clear or invalidate the Constructed build preference merely because active-save schema changes, unless its own referenced Hacker/Deck/Program content no longer validates.

No remembered System preference is introduced.

---

# Part XII — Logging, Metrics, and Compact Export

## 35. Preserve Alpha 0.4.1 Logging Architecture

Do not regress the Alpha 0.4.1 logging compaction work.

Preserve:

- `BASIC`, `VERBOSE`, `COMPLETE`;
- production BASIC default;
- development VERBOSE default;
- versioned logging-level preference;
- no ordinary turn stream in BASIC;
- compact Verbose turns;
- full-detail Complete routing;
- battle-static join model by `battleId`;
- fingerprint-keyed ContentStamp deduplication;
- promoted structured event stream;
- interesting-route filtering below Complete;
- 3 MiB logging budget or the current centralized value if Alpha 0.4.1 implementation differs only nominally;
- pre-write trimming;
- priority-ordered sacrifice;
- one emergency quota retry followed by disabling low-priority logging for the session;
- gameplay independence from logging failures.

System identity is battle-static. Do not copy the full System definition into every turn/event record.

---

## 36. System Identity Logging

Battle-level metrics/context must include enough stable System identity to analyze the encounter:

- `SYS_ID`;
- System selection source;
- base/effective ICE as represented by the current identity/config split;
- strong colors;
- strong shapes;
- derived weak sets only if already useful in exported battle context; they need not be redundantly stored if safely derivable;
- ordered System Program IDs;
- content fingerprint.

The System selection event should be logged once when committed/resolved, not repeated every turn.

---

## 37. New Effect Telemetry

### 37.1 COERCE / Transform

When `EFFECT_TRANSFORM` activates, log structured data sufficient to verify the action without storing the whole board snapshot:

- `battleId`;
- side/owner;
- `SYS_ID` where available through join rather than repetition;
- source Program ID;
- Function ID;
- Effect ID;
- quantity requested;
- number of Packets actually transformed;
- `axisTarget`;
- `axisResult` color/shape;
- typed Transform params;
- whether valid targets existed;
- resulting Sync/cascade damage and charge remain in their normal event/metrics streams rather than duplicated into the Transform record.

### 37.2 No-valid-target COERCE

Normal System AI preflight withholds COERCE when there are no neutrals.

Do not emit repetitive BASIC events every turn for the same blocked state.

If analytical visibility is required:

- track a compact battle-level count of no-valid-target withholds, or
- expose individual consideration events only in COMPLETE.

Do not reintroduce high-volume per-turn decision logging into BASIC/VERBOSE.

### 37.3 EBUFF

Preserve enough telemetry to distinguish:

- EBUFF activation / countdown placement;
- number of countdown objects actually placed;
- countdown expiry delivering Buff;
- countdown removal before delivery where current special events already expose it.

Reuse existing Effect/special/countdown event structures where possible.

### 37.4 SPAM

Use existing Bomb detonation/charge telemetry. Ensure the authored gain-charge branch is visible through normal routing and aggregate metrics rather than a separate SPAM-only charge system.

---

## 38. Compact Export Remediation

### 38.1 Structured event classification

The compact exporter must recognize valid structured event records from the Alpha 0.4.1 `breach:log:events` stream.

Every valid event should be handled as one of:

```text
rendered
summarized
intentionally omitted
unsupported
```

Do not label valid JSON/event-schema records as `unparsable` merely because the compact formatter lacks a rendering branch.

Malformed JSON may still be reported as unparsable.

### 38.2 Verbose `cfg[missing]`

Verbose turn records intentionally omit repeated config.

When rendering compact turn output:

- either join config from battle-level context using `battleId`, or
- omit the config marker from turn lines.

Do not display `cfg[missing]` for intentionally normalized records.

### 38.3 Backward/version-aware formatting

If retained Alpha 0.4.1 logs use an older but valid event/metrics schema, the exporter should classify/version-handle them cleanly rather than destructively clearing them solely for formatting convenience.

---

## 39. Charge-Waste Metric Cleanup

The Alpha 0.4.1 patch removed false routing-discard attribution to the bottom-most compatible Program but retained some genuine per-Program waste for the System flat timer path.

Alpha 0.5 completes the cleanup.

### 39.1 Canonical metric

Use one side-level/battle-level total charge-waste metric per side, conceptually:

```text
chargeWastedTotal
```

The exact field name may follow current repository conventions, but there must be one canonical total.

It includes charge generated for that side that cannot be stored because of charge-pool caps/routing, regardless of source, including:

- end-of-stream routing discard after all compatible active Programs are full;
- genuine timer/flat-charge overflow that previously appeared as per-Program `chargeWasted`.

### 39.2 Remove per-Program waste as current authority

- Do not present per-Program `chargeWasted` in Alpha 0.5 compact output.
- Do not use bottom-most Program attribution for queue discard.
- Remove/deprecate the current per-Program metric from new Alpha 0.5 battle metrics where safe.
- If an old field must remain internally for backward log-schema parsing, it must not remain the current analytical authority.

### 39.3 Auditability

Keep source-level discarded/overflow amounts in the appropriate routing/timer structured events so the total can be verified.

Tests must establish:

```text
side chargeWastedTotal
=
sum of all charge discarded/overflowed for that side across all charge-generation sources
```

### 39.4 Axis-specific waste deferred

Do not add color-versus-shape waste totals in Alpha 0.5.

Axis-specific waste may be added later only if metrics analysis shows it is useful.

---

# Part XIII — Validation and Failure Behavior

## 40. Startup Validation

Extend the existing collect-all-errors validation model.

At minimum validate:

### System dataset

- required `SYS` dataset exists;
- required headers including `BASE_ICE`;
- `SYS_ID` format and uniqueness;
- positive integer `BASE_ICE`;
- valid nonduplicate strong color/shape tokens;
- exactly four distinct valid `PRG_S_*` IDs in `PRG_SET`;
- broken Program references;
- unsupported nonblank System `SKILL` in Alpha 0.5;
- existing duplicate display-name warning policy;
- placeholder fields accepted without semantic use.

### Transform

- registered `EFFECT_TRANSFORM`;
- exact two-value tuple;
- supported tuple enum values;
- positive `quantity`;
- valid `axisTarget` (`NEU` for current Alpha 0.5 contract);
- exactly one result color and one result shape in `axisResult`;
- non-neutral result color;
- targeted Transform quantity restriction (`targeting=1` requires `quantity=1`);
- unused/required Function fields according to the existing Effect-registry validation policy.

### EBUFF/countdown

- valid positive countdown where required;
- valid magnitude;
- valid quantity;
- any existing target/deployment sanity rules.

### Cross-content

- selected System PRG_SET references only System Programs;
- Function/Effect references resolve;
- fingerprint includes System gameplay fields;
- authored rows such as BOUNCER COERCE result axes do not require semantic “synergy validation”; synergy is design content, not a startup rule.

Warnings remain nonblocking. Errors block startup through the existing browser/Node graceful-failure path.

---

## 41. No Hardcoded Fallbacks

Do not silently substitute:

- a default System when a required `SYS_ID` is missing from an active save;
- hardcoded old System strong sets;
- the Hacker’s complementary axes;
- the first System row when a referenced ID is invalid;
- hardcoded Program rosters when `SYS.PRG_SET` is invalid;
- old save behavior when fingerprint/schema mismatch occurs.

Random selection from the complete valid System catalog is an explicit gameplay/setup behavior, not a fallback for broken references.

---

# Part XIV — Acceptance Scenarios

## 42. Data and Fingerprint Tests

Automated tests should cover at minimum:

1. Valid `SYS` CSV parses/resolves with two authored Systems.
2. Missing `SYS` dataset blocks startup.
3. Missing/incorrect `BASE_ICE` header blocks startup.
4. Bad `SYS_ID` prefix fails.
5. Nonpositive `BASE_ICE` fails.
6. Invalid/duplicate strong-axis tokens fail according to shared rules.
7. `PRG_SET` with fewer/more than four Programs fails.
8. Duplicate System Program IDs within `PRG_SET` fail.
9. `PRG_H_*` inside System `PRG_SET` fails.
10. Broken Program reference fails.
11. Nonblank `SYS.SKILL` fails as unsupported Alpha 0.5 content.
12. Weak sets derive as complement.
13. Changes to `BASE_ICE`, strong sets, or PRG_SET/order change the gameplay fingerprint.
14. `BIO`, `GRAPHICS`, and notes do not change the gameplay fingerprint.
15. Leading-apostrophe normalization still works in SYS and new Transform fields.
16. Exact Transform tuple/axis validation works.

---

## 43. System Identity / Damage Tests

Verify:

1. Selected System strong/weak sets replace the old Hacker-complement System profile.
2. System Sync damage uses selected System profile.
3. System profile-based Effect collateral uses selected System profile through the established shared calculation.
4. Different System strong sets produce expected different damage on the same packet axes where applicable.
5. Quick Match normal ICE uses `BASE_ICE`.
6. Run normal ICE uses `BASE_ICE + step modifier`.
7. Manual System ICE override bypasses base/modifier under the existing Normal LINK-off mode.

---

## 44. System Selection Tests

### Run

- each pending battle receives exactly one valid selected System;
- selection occurs before Build;
- Build state exposes the selected System;
- Save and Quit from `PENDING_BUILD` resumes the same System;
- screen reopen does not reroll;
- retry after defeat uses the same System;
- successful progression chooses the next battle’s System once;
- repeated Systems across different battles are allowed;
- selection does not consume gameplay RNG.

### Constructed Quick Match

- System Selection lists all valid Systems;
- explicit selection is required;
- selected System reaches Build and battle initialization;
- pending setup does not overwrite an existing save until battle start;
- Back navigation works;
- remembered Hacker build behavior remains intact.

### Random Quick Match

- a valid System is selected automatically;
- no System Selection screen opens;
- selected System is persisted/logged;
- remembered Constructed build is unchanged;
- gameplay RNG stream is unchanged by setup selection.

---

## 45. COERCE / Transform Tests

At minimum verify:

1. `quantity` means up to the maximum number of valid targets.
2. `quantity=99` with fewer than 99 neutrals converts all neutrals.
3. No magic special handling exists for literal 99 beyond the ordinary maximum rule.
4. COERCE retains specials under current `0:1` tuple.
5. Transform is atomic before match detection.
6. COERCE produces the authored result color/shape.
7. If transformation creates a System-owned Sync, it resolves immediately.
8. Resulting Sync damage uses selected System strengths.
9. Resulting color/shape charge routes through ordered System Programs.
10. Resulting cascades resolve normally.
11. Resulting direct-match union participates in B1.
12. Transform itself contributes no direct Function damage and no direct Function charge.
13. If every eligible Packet is transformed, no meaningless RNG is consumed just to permute target order.
14. No-neutral COERCE is withheld by System AI without spending charge.
15. Targeting=1 / quantity>1 validation fails.
16. All three special-retention enum branches are contract-tested even if current live content uses only retain-all, if existing test style expects every typed branch to be exercised.

---

## 46. Dynamic System Function Tests

Create focused scenarios proving:

1. A Program not ready at Function-phase start can become ready from an earlier Function’s resolution and activate in the same phase.
2. COERCE can create Sync charge that makes ATTACKER ready and eligible later in the same Function phase.
3. A Program can activate at most once per Function phase.
4. A Program that activates, is recharged, and becomes full again does not activate twice.
5. A ready-but-currently-invalid Function is skipped/withheld without spending charge.
6. If another Function changes state and makes that Function valid, it may be reconsidered later in the same phase.
7. Program order controls charge routing but does not become activation priority.
8. Function phase terminates when no valid ready unfired Program remains.
9. Charge created by the later normal System match does not reopen the Function phase.
10. Countdown-created charge available before the Function phase can enable activation.
11. No new behavior consumes unexpected gameplay RNG beyond established activation/Effect randomness.

---

## 47. EBUFF Tests

Verify:

1. Activation places up to authored quantity of countdown objects.
2. Pending EBUFF objects provide zero live Buff magnitude.
3. Countdown timing follows established owner-turn semantics.
4. At expiry, surviving object becomes a Buff on the same Packet.
5. Authored magnitude is applied.
6. Newly live Buff contributes to later damage under existing Buff rules.
7. Slicing/removing the pending countdown prevents later Buff delivery.
8. Save/resume preserves pending countdown state and later delivery correctly.
9. Existing Bomb countdown behavior is unchanged.
10. No second countdown framework is introduced if current infrastructure is reusable.

---

## 48. SPAM / Bomb Tests

Verify:

1. SPAM uses its authored quantity/countdown/area.
2. SPAM grants charge because its tuple enables the branch.
3. That charge routes through the selected System Program order.
4. Existing BOMB/E-BOMB/PLINK variants retain their own authored charge behavior.
5. Current Bomb damage accounting remains source-specific and does not merge SPAM into another Function’s metric identity.

---

## 49. Save/Resume Tests

Verify:

- Alpha 0.4.x active save is rejected cleanly;
- Alpha 0.5 save round-trip preserves `SYS_ID`;
- active battle restores exact System Program order and state;
- `PENDING_BUILD` restores the upcoming System without rerolling;
- retry preserves the same System;
- current content fingerprint mismatch rejects instead of mutating identity;
- Constructed Hacker build preference survives the Alpha 0.5 active-save bump when still valid;
- logging preference remains independent.

---

## 50. Logging and Metrics Tests

Verify:

1. System identity is present in battle-level context and not redundantly copied into every Verbose turn.
2. System selection source is logged.
3. COERCE activation records converted count and result axes.
4. EBUFF placement/delivery is auditable.
5. Valid `breach:log:events` records are no longer reported as `unparsable`.
6. Unknown-but-valid event types are classified as unsupported/intentionally omitted rather than parse failures.
7. Verbose turn compact output no longer shows misleading `cfg[missing]`.
8. BASIC/VERBOSE/COMPLETE filtering and storage budget behavior remain intact.
9. New Alpha 0.5 content does not materially re-bloat turn records with repeated System identity.
10. New current metrics contain one canonical side-level total charge-waste value.
11. Per-Program `chargeWasted` is absent from current compact output/current authoritative metric shape.
12. Total charge waste equals routing discard plus other genuine overflow sources for that side.
13. Axis-specific charge-waste fields are not added.

---

## 51. Regression Gate

Preserve focused coverage for:

- Hacker Skills;
- Hacker/Deck portfolios;
- Build validity and reorder;
- Hacker charge routing;
- DATACUT;
- PLINK;
- SCRAMBLE;
- B1;
- Reinforced Connection;
- Drain gating/telemetry;
- Bombs/Buffs/Shields;
- save/preferences;
- Alpha 0.4.1 logging levels/storage behavior.

Alpha 0.5 intentionally changes System identity/content, so HP-ladder or batch output is not expected to remain byte-identical to Alpha 0.4.1. Treat changes as data/content consequences unless tests identify a regression.

Do not “fix” changed balance statistics merely to make them resemble Alpha 0.4.

---

## 52. Manual Verification

Perform real-browser checks where practical and report exactly what was/was not performed.

Priority manual checks:

1. Constructed Quick Match → System Selection → Build → Battle.
2. Both BOUNCER and MIDNIGHT appear with correct ICE/strength/build information.
3. Program inspection works from System Selection and pre-battle context.
4. Run selects an opponent before Build and displays enough opponent context to influence the Hacker build.
5. Save and Quit from between-battle Build; Continue restores the same upcoming System.
6. Retry after defeat retains the same System.
7. COERCE visibly transforms neutral Packets to the authored axes.
8. COERCE-created Syncs visibly resolve immediately.
9. Observe at least one case where Function-created charge enables another System Function in the same phase if feasible using dev tooling.
10. EBUFF countdown objects appear and later become live Buffs on the same Packets.
11. SPAM behaves as the authored small rapid Bomb variant and can generate charge.
12. System character sheet reflects selected System identity.
13. Random Quick Match chooses a valid System without opening selection.
14. Existing System-turn border/dimming and targeting UI still render correctly.
15. Narrow/touch-oriented layout remains usable.
16. Development logging controls and compact log export remain usable after Alpha 0.5 event additions.

Do not claim a manual check that was not actually performed.

---

# Part XV — Explicitly Out of Scope

## 53. Do Not Implement in Alpha 0.5

- System passive Skills or numeric System passives.
- New System Skill rows solely for this build.
- System build editing.
- System portfolio/inventory architecture.
- System Program acquisition.
- Hacker rewards or Program acquisition.
- Permanent progression.
- Run path choice.
- fixed introductory/romp-System encounter curation;
- anti-repeat/shuffle-bag System selection;
- boss mechanics or boss selection;
- battlefields/environmental passives;
- multiple active Functions per Program;
- Program passives;
- generalized multi-target UI;
- arbitrary Transform scripting beyond the current typed contract;
- arbitrary color/shape transform source language beyond current `NEU` requirement;
- generalized delayed Function graph or second countdown scheduler;
- broad balance changes;
- final Function-description architecture;
- final biography/graphics presentation;
- final art, animation, audio, accessibility, or feature-complete polish;
- axis-specific charge-waste metrics.

---

## 54. Alpha 0.5 Completion Standard

Alpha 0.5 is complete when all of the following are true:

1. `SYS` is a required validated external dataset.
2. `SYS_01` BOUNCER and `SYS_02` MIDNIGHT load from authored data.
3. Selected System identity controls ICE, strength profile, and ordered System Programs.
4. System weak sets are derived from each System’s own strong sets.
5. System Program order controls charge routing.
6. Run selects/persists one System per battle before Build.
7. Retry preserves that System.
8. Constructed Quick Match provides explicit System Selection before Build.
9. Random Quick Match chooses/persists a System automatically.
10. System selection does not perturb gameplay RNG.
11. System character/setup UI displays selected identity and ordered Programs.
12. COERCE transforms neutrals atomically and immediate resulting Syncs resolve normally.
13. COERCE itself deals/grants no separate direct damage/charge.
14. Dynamic System Function readiness works and each Program fires at most once per phase.
15. EBUFF countdowns become live Buffs on the same surviving Packets.
16. SPAM retains its intentionally charge-generating Bomb behavior.
17. Save/resume preserves System identity and pending opponent selection.
18. Alpha 0.4.x active saves reject cleanly.
19. Compact logs classify valid event records correctly.
20. `cfg[missing]` is removed from normalized Verbose rendering.
21. Current metrics use total side-level charge waste rather than per-Program waste.
22. Alpha 0.4.1 logging levels/storage safeguards remain intact.
23. Full automated verification passes.
24. README is updated to Alpha 0.5 actual shipped behavior.
25. Final repository diff is reviewed.
26. The completed build is committed and pushed successfully, or an external push blocker is explicitly reported without destructive workaround.

---

# Part XVI — Single-Agent Implementation Workflow

## 55. Workflow Principle

One coding agent owns the entire build.

Prefer extension of established Alpha 0.4.1 abstractions over speculative generalization.

The main high-risk boundaries are:

- introducing a seventh runtime dataset without parallel loader behavior;
- replacing old System strength/roster authority cleanly;
- Run/Quick Match System-selection lifecycle and save ownership;
- Transform-created immediate Sync ownership;
- dynamic same-phase System Function activation without loops;
- generic delayed EBUFF behavior without creating a second countdown architecture;
- logging/metric schema cleanup without undoing Alpha 0.4.1 compaction;
- RNG separation;
- save-schema rejection and pending-build restoration.

---

## 56. Stage 1 — Required Inspection and Authorization Stop

Before writing implementation code:

1. Read this entire handoff.
2. Read every supplied CSV and both PDF reference files.
3. Inspect the current Alpha 0.4.1 repository.
4. Run the current baseline verification suite appropriate to the repository.
5. Confirm the current runtime dataset-loading path and how required datasets are enumerated.
6. Confirm the actual Alpha 0.4.1 resolved Hacker/Deck/System-side battle config types.
7. Confirm where the old System strong/weak values and Program roster are currently sourced.
8. Confirm the current active save schema and `PENDING_BUILD` state.
9. Confirm current Quick Match setup/pending-save commit boundaries.
10. Confirm current isolated RNG handling for Random Quick Match build selection.
11. Confirm current outer System turn order and current Function activation-choice policy.
12. Confirm current countdown object representation and whether delayed Bomb contracts are stamped on the overlay.
13. Confirm whether `EFFECT_BUFF` already supports countdown scheduling internally or what minimal extension is required for EBUFF.
14. Confirm current `EFFECT_BOMB` charge-generation implementation for SPAM reuse.
15. Confirm current Alpha 0.4.1 logging schemas, compact exporter, event classification, content-stamp table, and charge-waste fields.
16. Confirm exact supplied Alpha 0.5 CSV values, especially:
    - `SYS` header uses `BASE_ICE`;
    - BOUNCER/MIDNIGHT Program order;
    - blank `SYS.SKILL`;
    - COERCE quantity/startCharged/axis fields/`0:1` tuple;
    - EBUFF countdown/magnitude/quantity;
    - SPAM quantity/countdown/area/`0:0:0` tuple.
17. Identify exact modules/files affected.
18. Identify any place where implementing this document would create a second authority or duplicate system.
19. Produce a concise implementation plan containing:
    - architecture findings;
    - exact conflicts/deviations, if any;
    - planned data-model changes;
    - save/version plan;
    - System selection/RNG plan;
    - Transform and countdown plan;
    - dynamic Function-phase plan;
    - logging/metrics remediation plan;
    - test plan;
    - manual-check plan;
    - README/update plan;
    - source-control completion plan.
20. **Stop and request authorization before implementation.**

### 56.1 Stage 1 escalation rule

Do not stop for minor implementation details that the existing architecture clearly resolves.

Do stop/escalate if inspection reveals a genuine conflict affecting:

- player-visible gameplay semantics;
- System selection persistence;
- RNG ownership;
- save compatibility;
- Effect ownership/order;
- countdown timing;
- Function activation order/termination;
- data authority;
- logging schema/storage safety;
- required scope.

Do not invent new Alpha 0.6 architecture to solve an Alpha 0.5 problem.

---

## 57. Stage 2 — Implementation After Authorization

After authorization, implement in dependency order.

Recommended phases:

### Phase A — Content pipeline and System identity

- add SYS loading/schema/validation/resolution;
- remove old hardcoded/complement System profile authority;
- resolve weak complements;
- add System fingerprint contribution;
- resolve fixed System Program build;
- add exact supplied content/fixtures.

### Phase B — Battle config, selection, and persistence

- integrate selected System into BattleConfig/BattleIdentity as appropriate;
- implement Run random opponent selection before Build;
- implement Constructed System Selection before Build;
- implement Random Quick Match System selection;
- preserve RNG separation;
- update save schema/pending-build state;
- reject Alpha 0.4.x active saves.

### Phase C — New Effects/content behavior

- register/validate/execute `EFFECT_TRANSFORM`;
- implement atomic transform and immediate Sync resolution;
- extend/reuse countdown delivery for EBUFF;
- verify SPAM gain-charge branch using existing Bomb Effect;
- preserve existing Effect ownership/metrics.

### Phase D — Dynamic System Function phase

- add per-phase activation cap;
- recompute readiness after full Function resolution;
- include target availability in activation eligibility;
- preserve current activation-choice policy;
- ensure turn-ending System match does not reopen Function phase.

### Phase E — UI

- Constructed System Selection;
- Run Build opponent context;
- System character sheet;
- Program inspection reuse;
- narrow-screen/hitbox preservation.

### Phase F — Logging/metrics remediation

- System identity/select/effect telemetry;
- compact event classification;
- remove `cfg[missing]` false signal;
- canonical total charge-waste metric;
- preserve Alpha 0.4.1 storage budget/filtering.

### Phase G — Integration and documentation

- focused regression fixes only;
- full automated gate;
- manual browser verification;
- README update from actual final implementation;
- final diff review;
- commit and push.

Add focused tests alongside each phase rather than waiting until the end.

---

# Part XVII — Final Verification, README, Commit, and Push

## 58. Full Automated Gate

Run the complete established verification suite. At minimum, where scripts exist:

```text
npm run typecheck
npm test
npm run smoke
npm run batch
npm run hpladder
npm run build
```

Add focused commands as needed.

Record exact commands and results for the final report.

Do not weaken/delete existing tests merely to make the build pass without explaining and justifying the semantic change.

HP-ladder/batch values may change because Alpha 0.5 deliberately changes System identities and content. Evaluate correctness, not byte identity to Alpha 0.4.1.

---

## 59. README Update

After implementation and verification, update `README.md` before committing.

The README should describe the repository as actually shipped in Alpha 0.5, including as appropriate:

- version/build identity;
- data-driven Hacker/Deck/System identity architecture;
- two authored Systems;
- System Selection / random System selection flows;
- current Build flow;
- System-specific ICE and strength profiles;
- COERCE / `EFFECT_TRANSFORM`;
- EBUFF delayed delivery;
- MIDNIGHT Bomb variants and SPAM charge behavior at a high level;
- dynamic System Function activation where useful to explain current mechanics;
- save schema/version behavior;
- BASIC / VERBOSE / COMPLETE logging and current compact-log behavior;
- current verification commands and final pass results;
- relevant known manual limitations if any remain.

Do not turn README into the coding-agent final report. Keep it a durable project overview.

Do not add speculative Alpha 0.6 roadmap detail unless the existing README has a small clearly labeled future-scope section that needs minimal maintenance.

---

## 60. Pre-Commit Review

Before staging:

1. run `git status`;
2. inspect `git diff` for unintended changes, generated junk, encoding churn, or accidental data edits;
3. run `git diff --check`;
4. confirm supplied runtime datasheet copies in the repo match intended Alpha 0.5 content;
5. confirm README reflects the actual build;
6. confirm no unrelated user changes are being overwritten;
7. rerun any verification invalidated by late documentation/content edits if necessary.

Pay particular attention to avoiding a repeat of prior accidental full-file encoding churn.

---

## 61. Commit and Push

Once the full build is green and final diff review is clean:

1. stage the intended Alpha 0.5 changes;
2. create a concise build commit, e.g. conceptually:

```text
Implement Alpha 0.5.0 System identities and encounter selection
```

The exact message may be adjusted to the final implementation.

3. push the current branch to its configured upstream.

Do not force push.

If a normal safe push cannot complete, report the exact blocker and leave the verified local commit intact.

---

## 62. Final Report

After commit/push attempt, provide a concise but complete report containing:

1. implementation summary;
2. exact final authored Systems and Program builds resolved from data;
3. System dataset/schema/fingerprint summary;
4. Run and Quick Match System-selection behavior;
5. save schema/version and Alpha 0.4.x rejection behavior;
6. COERCE / `EFFECT_TRANSFORM` behavior and focused tests;
7. dynamic System Function-phase behavior and termination safeguards;
8. EBUFF countdown/delivery behavior;
9. SPAM/Bomb behavior and charge behavior;
10. System identity damage/profile integration;
11. logging/compact-export remediation;
12. total charge-waste metric change;
13. exact automated verification commands/results and test counts;
14. content validation warnings and whether expected;
15. manual browser checks performed;
16. manual checks still outstanding;
17. deviations from this handoff and why;
18. README update summary;
19. final `git status` state after commit;
20. commit hash/message;
21. push result and remote/branch target, or exact external blocker if push failed.

Be explicit about uncertainty. Do not report a manual/browser result that was not actually observed.

---

# Part XVIII — Design Notes for Future Builds (Non-Implementation)

These notes are context only and must not expand Alpha 0.5 scope:

- System passive Skills are deferred and should be designed in a later build.
- Future Run encounter design may use a fixed introductory System or a pool of intentionally easy “romp” Systems for early battles so players can learn new Hacker builds/Functions.
- Final Function-description authoring/storage remains unresolved and should be decided in a future UX pass.
- Axis-specific charge-waste metrics remain deferred until analysis shows they are useful.
- If logging stream sizes grow enough that bounded whole-stream rewrites become measurable again, reconsider chunked/segmented storage; do not add it preemptively in Alpha 0.5.

