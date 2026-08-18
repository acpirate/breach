# Breach Alpha 0.7.0 — Coding Agent Handoff

**Build identity:** `alpha-0.7.0`

**Status:** Canonical implementation requirements and coding-agent instructions for Alpha 0.7.0.

**Primary objective:** Add the externally defined Boss (`BOS`) identity layer and the first boss encounter, ODANSHAY; make Boss Selection the first committed New Run choice; preserve Alpha 0.6 path/HOST/UPGRADE behavior for Battles 1–3; make Battle 4 use the selected Boss with a normal randomized HOST and normal final UPGRADE choice; implement ODANSHAY's Override mechanic using the supplied Boss notes and supporting zero-cost Functions; preserve save/resume, source attribution, logging, PASSIVE behavior, combat mechanics, and current Quick Match behavior; verify the new selection/route/boss UI at a concrete 390×844 CSS-pixel viewport; update README; then commit and push the verified build.

---

# Part I — Authority, Inputs, and Working Method

## 0. Document authority

This document is the authoritative Alpha 0.7.0 implementation specification.

Read this entire handoff, the current Alpha 0.7 datasheets, and the current Alpha 0.6 repository before proposing or writing implementation code.

Use sources in this order:

1. **This Alpha 0.7.0 coding-agent handoff** for resolved behavior, architecture boundaries, lifecycle ordering, persistence rules, and acceptance criteria.
2. **The supplied Alpha 0.7 runtime datasheets/workbook exports** for exact IDs, values, Program/Function content, Boss identity fields, and other authored runtime content.
3. **The supplied `boss passive notes` sheet** for ODANSHAY's unique mechanic behavior. This sheet is normative design input but is not itself required to become a runtime dataset.
4. **The supplied dataset notes / Effect parameter notes** for field meanings and Effect parameter enumerations where this document does not narrow or override them.
5. The current verified Alpha 0.6.0 repository implementation and tests.
6. Earlier Alpha handoffs only for behavior explicitly preserved here.
7. Older design/history/backlog material only as historical context.

If an actual supplied runtime file conflicts with this handoff, report the exact conflict during Stage 1 rather than silently choosing one.

## 0.1 Current Alpha 0.7 authored content

The current workbook includes the existing Alpha 0.6 content plus:

- a `BOS` sheet;
- `BOS_01` / `ODANSHAY`;
- `FNC_018 DATABEND`;
- `FNC_019 REBOOT`;
- `FNC_020 CODESHATTER`;
- the normative `boss passive notes` sheet describing ODANSHAY's Override mechanic.

Do not invent additional bosses, Boss PASSIVE fields, Boss mechanic IDs, boss phases, or generic boss scripting merely because future bosses may need them.

## 0.2 Expected runtime datasets

Alpha 0.7 runtime content consists of ten required datasets:

1. Hacker Programs (`PRG_H`)
2. System Programs (`PRG_S`)
3. Functions (`FNC`)
4. Hackers (`HAK`)
5. Systems (`SYS`)
6. Bosses (`BOS`)
7. PASSIVEs (`PSV`)
8. Decks (`DEK`)
9. HOSTs (`HST`)
10. UPGRADEs (`UPG`)

The workbook's notes/conventions/mechanic-description sheets are design/reference material, not additional runtime datasets unless the current repository already has a deliberate equivalent convention.

## 0.3 Fresh-context rule

Begin Alpha 0.7 with a fresh coding-agent context. Inspect the repository and current data rather than relying on assumptions from the Alpha 0.6 implementation session.

## 0.4 One-agent execution model

There is **no Senior/Junior developer split**.

One heavy coding agent owns:

- repository inspection;
- Stage 1 implementation plan;
- implementation;
- integration;
- tests and fixtures;
- manual browser verification;
- README update;
- final diff review;
- commit;
- push;
- final report.

## 0.5 README and source control

The coding agent owns README and source-control completion.

After implementation and the complete verification gate pass:

1. update `README.md` to describe Alpha 0.7 as actually shipped;
2. inspect the final diff and run `git diff --check` or equivalent;
3. stage only intended changes;
4. create a concise Alpha 0.7 build commit;
5. push the current branch to its configured upstream.

Do not push a knowingly failing or partially verified build. Do not force-push, rewrite published history, or discard unrelated user changes.

---

# Part II — Build Objective and Explicit Scope

## 1. Alpha 0.7 objective

Alpha 0.7 completes the major Alpha gameplay skeleton by adding Boss selection and a distinct Boss battle.

The completed build must:

1. Add external Boss (`BOS`) content as a distinct identity layer rather than folding Bosses into `SYS`.
2. Add Boss Selection as the first explicit New Run choice.
3. Commit the new Run when Boss Selection is committed and persist the Boss immediately.
4. Persist setup progress through Hacker and Deck selection so Continue resumes at the next unfinished setup screen.
5. Use the canonical New Run order:

   `Boss Selection → Hacker Selection → Deck Selection → Path Choice → Build → Battle 1`

6. Preserve `Path Choice → Build → Battle` for Battles 2–4.
7. Preserve the fixed DOORMAN + THRESHOLD intro encounter for Battle 1.
8. Preserve ordinary randomized System + HOST route behavior for Battles 2 and 3.
9. Make Battle 4 always use the Boss selected at New Run start.
10. Make both Battle-4 path options reference that same selected Boss while varying valid HOSTs when possible and applying the normal final UPGRADE choice.
11. Treat Boss as the enemy-side combat identity/source, never as a fake `SYS_ID`.
12. Reuse current System-side Program charge routing, dynamic Function phase, enemy targeting, matching/timer behavior, damage, and battle plumbing for ODANSHAY where semantics are the same.
13. Implement ODANSHAY's Override mechanic exactly as specified below.
14. Reuse `FNC_018–020` through the existing Function → Effect machinery.
15. Preserve current HOST and UPGRADE semantics in the Boss battle.
16. Preserve current PASSIVE semantics and source attribution.
17. Preserve current Quick Match behavior; do not add player-facing Boss Quick Match.
18. Preserve current default battle/settings configuration; Alpha 0.7 does not change matching/timer defaults, Normal Link defaults, or unrelated settings.
19. Extend save schema, content fingerprinting, logs, metrics, UI identity, and browser/headless parity for Boss state.
20. Reject incompatible Alpha 0.6 active saves cleanly rather than synthesizing Boss/setup state.
21. Verify relevant UI at **390×844 CSS pixels** in portrait-oriented browser emulation.
22. Update README, commit, and push after verification.

## 2. Explicit exclusions

Do **not** implement in Alpha 0.7:

- additional Bosses not present in supplied content;
- a generalized Boss-mechanic scripting engine;
- a `MECHANIC_ID` field not present in the workbook;
- a new Boss `PASSIVES` column not present in the workbook;
- parameterization intended only for hypothetical future Bosses;
- Boss phases unless explicitly required by current ODANSHAY behavior;
- boss-specific HOST routing rules;
- fixed boss HOSTs;
- Boss Quick Match player flow;
- boss reward tables;
- post-run completion/high-score matrix;
- permanent account progression;
- procedural route maps;
- broad normal-System/HOST/UPGRADE content expansion;
- broad balance work;
- JSON/XML content migration;
- schema-aware editor tooling;
- in-game content editor;
- Godot migration;
- final art/audio/presentation polish.

Keep the implementation narrow. A small ODANSHAY-specific handler keyed to `BOS_01` is acceptable and preferred over premature generic boss architecture.

---

# Part III — Alpha 0.6 Behavior to Preserve

## 3. Preserve established systems unless explicitly changed

Preserve the verified Alpha 0.6 implementation, including:

- the shared browser/Node external-data pipeline;
- one-leading-apostrophe spreadsheet-safe normalization;
- current `PASSIVES` field naming and PASSIVE runtime model;
- PASSIVE stacking by source;
- HOST as a distinct causal source;
- UPGRADE persistence/acquisition order;
- `in_pool` route eligibility for normal Systems/HOSTs;
- DOORMAN and THRESHOLD exclusion from later random pools;
- `Path → Build → Battle` tactical flow;
- exact pending-path persistence;
- isolated route/setup RNG versus gameplay RNG;
- System `BASE_ICE + 0/50/100/150` progression for **normal System battles only**;
- current Build/inventory/order behavior;
- top-to-bottom Program charge routing;
- dynamic enemy Function phase with readiness recomputation and at-most-once activation per Program per Function phase;
- current enemy activation selection behavior among eligible ready Programs;
- valid-target gating before automated Function activation;
- Drain deterministic enemy targeting and no-empty-target activation;
- atomic EFFECT_TRANSFORM behavior and immediate generated Sync resolution;
- current countdown behavior;
- B1 line-clear behavior;
- owner-scoped charge;
- Bomb charge semantics from the authored Function tuple;
- Reinforced Connection behavior;
- current Function-damage, Shield, and PASSIVE arithmetic;
- BIGGER_BOMB named area progression;
- current matching/timer configuration behavior and current default mode;
- BASIC / VERBOSE / COMPLETE logging levels;
- current logging storage/retention budget and compact exporter remediation;
- side-level total discarded-charge metrics;
- Constructed Quick Match deliberate SYS + HST selection;
- Random Quick Match random SYS + HST selection;
- current Settings accordion fix;
- current README/source-control workflow.

Do not duplicate or replace these systems merely to support Boss.

---

# Part IV — Data Contracts

## 4. Shared parser behavior

All existing parser conventions remain, including stripping exactly one spreadsheet-safe leading apostrophe before trim/type/reference validation.

List parsing, enum parsing, duplicate-ID validation, warning conventions, immutable resolved content, and fingerprint normalization remain shared rather than duplicated for BOS.

## 5. Boss dataset (`BOS`)

### 5.1 Required Alpha 0.7 schema

Use the workbook exactly as supplied. The current Boss header is:

```text
BOS_ID
name
in_pool
BASE_ICE
STRONG_COLORS
STRONG_SHAPES
PRG_SET
BOSS_PASSIVE_DESCRIPTION
BIO
GRAPHICS
```

Do **not** add `PASSIVES`, `MECHANIC_ID`, or parallel boss-mechanic columns in Alpha 0.7.

### 5.2 Current authored Boss

Current content:

```text
BOS_ID: BOS_01
name: ODANSHAY
BASE_ICE: 100
STRONG_COLORS: GRE:BLU:MAG
STRONG_SHAPES: SQU:CIR:DIA
PRG_SET: PRG_S_004:PRG_S_002:PRG_S_007:PRG_S_003
```

Resolved top-to-bottom Program order:

1. `PRG_S_004` DISABLER
2. `PRG_S_002` SHIELDER
3. `PRG_S_007` SPAMBOT
4. `PRG_S_003` ATTACKER

Weak colors/shapes derive as the normal enum-order complement of the Boss strong sets, using the same established rule used by Hacker/System identities.

### 5.3 `in_pool`

Keep the existing shared `in_pool` parser semantics: blank/default means included, `n` means excluded from random pools.

Alpha 0.7 has no random Boss-selection pool. Boss Selection is explicit and should show every valid authored Boss row. Therefore `BOS.in_pool` is not a player-selection filter in this build.

Do not invent random Boss routing from this field.

### 5.4 Presentation fields

`BOSS_PASSIVE_DESCRIPTION`, `BIO`, and `GRAPHICS` are presentation/non-gameplay fields in Alpha 0.7.

Do not infer boss mechanic semantics from placeholder copy. ODANSHAY behavior comes from this handoff and the normative boss notes.

Do not include non-gameplay presentation text in the gameplay fingerprint unless the current fingerprint architecture intentionally fingerprints equivalent presentation fields elsewhere.

### 5.5 Boss validation

At startup validate at minimum:

- `BOS_ID` unique and stable;
- required name present;
- `BASE_ICE` valid positive integer under existing health sanity conventions;
- strong colors valid and non-duplicated;
- strong shapes valid and non-duplicated;
- `PRG_SET` references valid System Programs;
- ODANSHAY's current Program set resolves to the four authored Programs in authored order;
- invalid references fail rather than silently substitute a System or default Boss.

The loader may parse `PRG_SET` generically, but do not build speculative variable-size Boss combat support. ODANSHAY uses the existing four-Program enemy combat model and therefore must resolve four valid distinct Programs in this build.

## 6. Supporting Functions

Current new supporting rows are:

```text
FNC_018 DATABEND   cost 0  EFFECT_SHAKE   params 1:2:1:2
FNC_019 REBOOT     cost 0  EFFECT_SHAKE   params 1:1:0:0
FNC_020 CODESHATTER cost 0 EFFECT_ATTACK damage 70
```

Use the existing Function → Effect machinery.

Do not create a Boss Function table.

### 6.1 Formal zero-cost Function rule

Alpha 0.7 makes the existing convention explicit:

- `cost = 0` is valid only for Functions that are **not directly assigned to a Program or Deck** and are invoked only through PASSIVE/boss/mechanic payload paths or equivalent non-charge activation.
- A zero-cost Function must never enter normal Program readiness/charge-cap logic as an always-ready Program Function.
- `FNC_016`, `FNC_017`, `FNC_018`, `FNC_019`, and `FNC_020` are valid examples under this rule.
- Startup validation must reject a zero-cost Function if directly assigned to a Program or Deck unless a later explicit requirement changes the rule.

Payload invocation pays no Function charge cost.

## 7. Existing Effect parameter semantics used by ODANSHAY

Do not add new Effects for Alpha 0.7.

### 7.1 `FNC_018 DATABEND` — `EFFECT_SHAKE 1:2:1:2`

Interpret through the existing SHAKE tuple:

1. datastream composition `1`: randomize non-special Packets;
2. special-packet behavior `2`: remove only **enemy** overlays relative to the activating Boss — therefore remove Hacker-owned overlays while retaining Boss-owned overlays;
3. Sync behavior `1`: allow Sync detection after the shake;
4. cascade behavior `2`: use the existing unlimited/stability-resolution behavior defined for this authored parameter.

Any Syncs/cascades created by DATABEND are Boss-side Syncs and use ODANSHAY's strong/weak axes, enemy damage target, Program charge routing, PASSIVEs/HOST modifiers, B1 behavior, and existing source attribution rules.

DATABEND itself has no separate direct damage beyond consequences produced by its normal SHAKE/Sync resolution.

### 7.2 `FNC_019 REBOOT` — `EFFECT_SHAKE 1:1:0:0`

Interpret through existing SHAKE semantics:

1. randomize non-special Packets;
2. remove all special overlays;
3. do not resolve Syncs created by the rearrangement;
4. do not run cascades from the rearrangement.

All Hacker-, Boss-, and HOST-created board overlays/countdowns that fall under the existing "special overlay" category are removed according to ordinary SHAKE semantics. Do not preserve Overrides specially.

### 7.3 `FNC_020 CODESHATTER`

`CODESHATTER` is a normal Function-damage `EFFECT_ATTACK` with authored raw damage `70`.

It therefore:

- uses existing Function-damage modifier handling;
- is affected by applicable continual PASSIVEs such as Function damage increase;
- is reduced by ordinary Packet Shield and permanent Shield using current damage ordering;
- remains active under Reinforced Connection because Reinforced Connection suppresses ordinary/base Sync damage, not Function damage;
- is attributed to ODANSHAY / the boss mechanic / `FNC_020` rather than to a fake System.

If CODESHATTER reduces Hacker LINK to zero, the battle ends immediately as an ordinary damage loss with boss-mechanic causal attribution. Do not execute REBOOT or the remainder of the Boss turn after terminal defeat.

---

# Part V — New Run Setup and Persistence Boundary

## 8. Canonical New Run order

The approved Alpha 0.7 flow is:

```text
New Run
→ Boss Selection
→ Hacker Selection
→ Deck Selection
→ Path Choice
→ Build
→ Battle 1
```

This explicitly overrides designer-handoff text that placed Build before the initial Path Choice.

The design principle established in Alpha 0.6 remains: the player sees the committed encounter package and newly acquired UPGRADE **before** editing the Build for that battle.

Battles 2–4 continue:

```text
Path Choice → Build → Battle
```

## 9. New-Run commitment boundary

Boss commitment is now the destructive New-Run boundary.

When the player commits a Boss selection:

1. apply the existing new-run replacement confirmation behavior if an active Run save exists;
2. replace/start the active Run save;
3. persist the selected `BOS_ID` immediately;
4. set the Run setup phase to the next unfinished setup step (Hacker Selection);
5. from this point the selected Boss is fixed for that Run.

Do not preserve the previous Alpha 0.6 rule that delayed Run commitment until initial Path Choice entry.

## 10. Persist setup progress

After Boss commitment, setup progress must itself be resumable.

The save model must be able to represent equivalents of:

- awaiting Hacker Selection;
- awaiting Deck Selection;
- pending initial Path Choice;
- pending Build;
- active battle;
- existing result/retry/run-complete states.

Exact internal enum names are implementation-owned; do not add parallel setup persistence outside the active Run save.

Required behavior:

- Close/reload after Boss commit but before Hacker selection → Continue restores the fixed Boss and resumes Hacker Selection.
- Close/reload after Hacker commit but before Deck selection → Continue restores Boss + Hacker and resumes Deck Selection.
- Close/reload after Deck commit while initial path offers are pending → restore the exact generated offers; do not reroll.
- Once Boss is committed, ordinary Back navigation must not silently change the Boss inside the same Run. Choosing a different Boss requires deliberately starting/replacing the Run again.

Persist only committed selections. Do not treat a highlighted-but-uncommitted UI row as saved Run state.

---

# Part VI — Boss Selection UI

## 11. Boss Selection screen

Add Boss Selection before Hacker Selection.

Use the existing identity-selection patterns where practical without forcing BOS into the HAK/SYS schema.

At minimum:

- list all valid Boss rows;
- show Boss name;
- show `BASE_ICE`;
- show strong/weak color and shape axes using existing identity presentation conventions where readable;
- show ordered Programs/Functions if the current selection-card pattern supports it without major new UI;
- allow one Boss to be selected and committed;
- clearly proceed to Hacker Selection after commit.

`BOSS_PASSIVE_DESCRIPTION`, BIO, and GRAPHICS may follow existing placeholder/display conventions but are not gameplay authority.

Do not build a major boss lore/help UI.

## 12. Selection logging

Use the existing event-sourced pipeline.

Record at least:

- Boss Selection screen/offer event with available valid `BOS_ID`s;
- committed selected `BOS_ID`;
- relevant content fingerprint/version context using the existing normalized battle/setup context pattern.

Do not create a separate boss logging store.

---

# Part VII — Run Route Structure

## 13. Battle 1

Battle 1 remains the controlled intro encounter.

After Deck Selection:

1. generate/persist the initial two Path choices;
2. both paths use `SYS_03 DOORMAN`;
3. both paths use `HST_01 THRESHOLD`;
4. UPGRADE choices follow current Alpha 0.6 uniqueness/exhaustion rules;
5. selecting a path acquires its UPGRADE immediately;
6. then open Build;
7. then enter Battle 1.

Boss choice does not alter Battle 1.

## 14. Battles 2 and 3

Preserve Alpha 0.6 escalation route generation exactly:

- normal randomized eligible `SYS`;
- normal randomized eligible `HST`;
- eligible UPGRADE;
- avoid duplicate encounter combinations where alternatives exist;
- persist exact offers before display;
- use route RNG isolated from gameplay RNG;
- acquire selected UPGRADE before Build.

Boss choice does not alter Battles 2 or 3.

## 15. Battle 4 path generation

After Battle 3 victory, generate two final paths.

Each path contains:

- opponent kind = `BOS`;
- opponent ID = the already selected `BOS_ID`;
- a randomized valid escalation-pool `HST`;
- an eligible UPGRADE under existing exhaustion rules.

Both paths must reference the same selected Boss.

Do **not** include a normal `SYS_ID` as the Battle-4 opponent and do not create a placeholder System row.

### 15.1 HOST uniqueness

When at least two distinct eligible HOSTs exist, avoid offering the same `Boss + HST` pair twice.

With current content, THRESHOLD is excluded from the random pool and multiple valid escalation HOSTs exist, so the normal expectation is two different HOSTs.

If future content leaves only one eligible HOST, duplicate HOST offers are allowed rather than failing route generation.

### 15.2 UPGRADE exhaustion

Preserve Alpha 0.6 behavior.

With four authored UPGRADEs and four acquisition decisions, the final path screen intentionally has one unacquired UPGRADE remaining, so both final paths may display the same remaining UPGRADE.

Selecting either path acquires that UPGRADE once.

## 16. Route data model

Do not lie about opponent identity merely to preserve a SYS-only route shape.

Adapt the route/encounter representation minimally so an encounter can honestly reference either:

- normal System opponent (`SYS` + ID), or
- Boss opponent (`BOS` + ID).

An `opponentKind/opponentId` union or equivalent is appropriate.

Do not store a fake `SYS_ID` for Battle 4.

Pending route persistence, selection logs, battle context, character sheet, save validation, and metrics must all preserve the distinction.

---

# Part VIII — Boss Enemy-Side Combat Semantics

## 17. Boss as enemy agent

ODANSHAY is the enemy-side combat identity for Battle 4.

Reuse current System-side combat machinery where behavior is the same, including:

- enemy health/ICE plumbing;
- authored strong/weak axis evaluation;
- ordered Program build;
- charge routing;
- dynamic Function readiness;
- at-most-once activation per Program per enemy Function phase;
- existing eligible-ready activation selection behavior;
- automated target gating;
- deterministic enemy Drain targeting;
- countdown objects;
- enemy Sync ownership;
- enemy damage target = Hacker;
- enemy matching/timer behavior according to current settings;
- normal turn-ending resolution.

But identity/source must remain Boss.

Logs, battle context, passive/source attribution, saves, UI, and metrics must not report ODANSHAY as `SYS_01/02/03` or any synthetic System.

## 18. Boss Programs

ODANSHAY's four Programs are ordinary referenced `PRG_S_*` content and use their existing Functions:

- DISABLER → DRAIN;
- SHIELDER → SHIELD;
- SPAMBOT → SPAM;
- ATTACKER → ATTACK.

Program order remains charge-routing priority. Do not make Program order a Function-activation priority if current enemy activation behavior is random among ready unfired Programs.

Current valid-target gating remains. A Boss Program does not spend charge on an activation that the normal enemy engine would withhold for lack of valid targets.

## 19. Boss ICE

Boss ICE does **not** receive the normal Battle-4 `+150` System escalation bonus.

When Normal Link is ON:

```text
ODANSHAY max ICE = BOS.BASE_ICE = 100
```

Treat the authored Boss `BASE_ICE` as the final Boss-battle identity ICE for Alpha 0.7.

When Normal Link is OFF, preserve the existing manual health override convention: the manual enemy/System ICE setting acts as the manual enemy ICE override for the Boss battle as well. This keeps the existing testing/settings behavior coherent across all Run battles.

Do not add a separate manual Boss ICE setting.

## 20. Boss strong/weak axes

ODANSHAY strong axes come directly from `BOS`:

- colors: `GRE`, `BLU`, `MAG`;
- shapes: `SQU`, `CIR`, `DIA`.

Weak axes are the complement of those sets within the recognized six-color/six-shape enums, preserving canonical enum order.

Use these axes for ordinary Boss Sync damage, DATABEND-created Syncs, and other existing calculations that depend on enemy identity strength.

---

# Part IX — ODANSHAY Override Mechanic

## 21. Mechanic implementation boundary

ODANSHAY's mechanic is Boss-specific Alpha 0.7 behavior.

A small handler keyed to `BOS_01` is acceptable.

Do not create a generalized mechanic DSL, generic Boss trigger table, `MECHANIC_ID`, or new PASSIVE type solely for this mechanic.

Use existing board-overlay, Function, Effect, turn-order, source-attribution, save, and event systems wherever they already fit.

## 22. Override overlay definition

An **Override** is a Boss-owned special overlay placed on a Packet.

An Override:

- does not alter the Packet's color or shape;
- does not itself deal damage;
- does not itself grant charge;
- does not itself trigger a Sync;
- carries Boss ownership/source;
- counts toward ODANSHAY's current on-board Override count;
- is removable/destructible through ordinary existing mechanics that remove/destroy enemy special overlays;
- has no bespoke immunity or bespoke player-removal action.

If the underlying Packet is sliced by an Effect whose existing special-packet rules destroy the overlay, the Override is destroyed normally.

Do not create a second board layer if the current special-overlay representation can express it safely.

## 23. Valid Override targets

A valid target for Override placement is:

- an occupied normal axis-bearing Packet;
- not already carrying a Boss-owned special overlay.

A Hacker-owned special overlay **does not** make the Packet invalid.

When Override is placed on a Packet carrying a Hacker-owned special:

1. destroy/replace the Hacker-owned overlay using the existing special-overlay replacement/removal semantics;
2. retain the underlying Packet axes;
3. install the Boss-owned Override overlay.

Boss-owned specials, including existing Overrides, Boss Bombs, Boss Shields, or other Boss-owned overlays, are not valid Override-placement targets and must not be silently overwritten by placement.

The broad DATABEND special-removal tuple is intentionally future-proofing; do not reinterpret its authored parameters merely because current Override targeting already allows overwriting Hacker specials.

## 24. End-of-Boss-turn Override placement

The final action of every non-terminal ODANSHAY turn is an attempt to place **exactly three** new Overrides.

This occurs **after all normal Boss-turn resolution**, including the normal enemy Function phase, normal match/timer behavior, resulting cascades, damage, charge, countdown consequences occurring in their established locations, and terminal-state checks.

Algorithm:

1. compute the current valid Override target set;
2. if at least three valid distinct targets exist:
   - choose three distinct targets using the **gameplay RNG**;
   - choose all three targets before mutating the board;
   - place all three Overrides as one mechanic resolution/batch;
   - do not resolve Syncs because axes are unchanged;
   - finish the Boss turn;
3. if fewer than three valid targets exist:
   - place **none**;
   - invoke `FNC_018 DATABEND` at zero cost as an ODANSHAY mechanic payload;
   - resolve DATABEND completely, including generated Syncs/cascades/damage/charge and terminal-state checks;
   - if Hacker is defeated, stop;
   - otherwise recompute valid target capacity and retry from step 1.

Do not partially place one or two Overrides before DATABEND.

Do not use route/setup RNG for target selection or DATABEND board randomization; these are battle mechanics and belong to the gameplay RNG stream.

## 25. Start-of-Boss-turn threshold

At the start of every ODANSHAY turn, count current on-board Overrides.

Trigger the threshold when:

```text
overrideCount >= 15
```

Do not require exactly 15.

If the count is below 15, no boss-threshold payload fires and normal turn-start ordering continues.

## 26. Boss-turn start ordering

For an ODANSHAY turn, preserve/extend Alpha 0.6 ordering as follows:

1. relevant HOST `START_OF_TURN` PASSIVEs resolve;
2. any standard Boss-owned start-of-turn PASSIVE layer would resolve here if a future Boss schema supplies one — **current Alpha 0.7 BOS data has no PASSIVES field, so do not add one just to populate this step**;
3. evaluate ODANSHAY Override threshold;
4. if threshold triggers, resolve CODESHATTER and then REBOOT as specified below;
5. tick/resolve remaining countdown objects;
6. enter the normal enemy/Boss Function phase;
7. continue established normal enemy turn flow;
8. as the final non-terminal action, perform the three-Override placement procedure.

Terminal-state checks occur after every damage-producing/resolution step. Do not continue after battle end.

## 27. Threshold resolution — CODESHATTER then REBOOT

When `overrideCount >= 15` at the threshold check:

1. invoke `FNC_020 CODESHATTER` as an ODANSHAY boss-mechanic Function payload without charge cost;
2. resolve all ordinary Function-damage modifiers and defenses;
3. perform terminal-state check;
4. if Hacker is defeated, end the battle immediately;
5. otherwise invoke `FNC_019 REBOOT` without charge cost;
6. resolve REBOOT completely;
7. continue the remainder of the ordinary Boss turn beginning with the countdown stage specified above.

Because REBOOT removes all special overlays under its authored SHAKE tuple, it clears the current Override accumulation along with other special overlays that the normal SHAKE rule removes.

Do not treat 15 as a permanent phase change. ODANSHAY may accumulate Overrides again after REBOOT.

## 28. Mechanic source/ownership

All ODANSHAY mechanic actions are Boss-caused.

- Override overlay owner/source = selected Boss (`BOS_01`).
- DATABEND Function source = Boss / ODANSHAY mechanic.
- DATABEND-created Sync resolution owner = Boss/enemy side.
- CODESHATTER source = Boss / ODANSHAY mechanic.
- REBOOT source = Boss / ODANSHAY mechanic.

Where the existing event model distinguishes causal source from side/agent resolution owner, preserve both dimensions rather than collapsing Boss into System.

---

# Part X — HOST, UPGRADE, PASSIVE, and Settings Interaction

## 29. HOST in Boss battle

Battle 4 uses the selected route HOST exactly like an escalation battle.

Preserve:

- HOST as first-class causal source;
- continual HOST PASSIVE semantics;
- HOST START_OF_TURN before Boss threshold/countdown ordering as specified above;
- HOST source attribution;
- duplicate PASSIVE stacking by source;
- current BIGGER_BOMB and other authored PASSIVE behavior.

Do not add Boss-specific HOST exceptions.

## 30. UPGRADEs in Boss battle

All acquired UPGRADEs remain active.

The final UPGRADE is acquired when the Battle-4 path is committed and is active before the Build/Boss battle.

UPGRADE PASSIVEs remain Hacker-owned and use existing stacking/attribution semantics.

Do not filter or disable UPGRADEs for ODANSHAY.

## 31. PASSIVE interaction with boss Functions

Existing continual calculations apply according to existing scope/source rules.

Examples:

- ARENA / Function-damage increase can modify CODESHATTER where the existing HOST-global semantics say it affects the relevant agent calculation.
- BRACER permanent Shield reduces CODESHATTER under existing Shield ordering.
- Reinforced Connection does not suppress CODESHATTER because it is Function damage.
- Charge-dampening/extra-charge PASSIVEs affect Boss-generated Sync charge streams according to the same arithmetic used for Systems.

Do not special-case PASSIVE arithmetic solely because the enemy identity is BOS.

## 32. Settings

Preserve all current Settings behavior, including:

- current default matching/timer configuration;
- current Normal Link behavior;
- manual LINK/ICE overrides when Normal Link is OFF;
- LINK/ICE accordion staying open when Normal Link is toggled either direction.

Do not change defaults as an incidental consequence of adding Boss.

---

# Part XI — Save / Resume / Compatibility

## 33. Save schema

Bump the active save schema from Alpha 0.6's schema to a new Alpha 0.7 schema.

Expected direction is schema `5 → 6` if repository inspection confirms Alpha 0.6 shipped schema 5.

Set `GAME_VERSION` to `alpha-0.7.0`.

Do not guess silently if the repository differs; Stage 1 must report the actual baseline.

## 34. Required persisted Boss/setup state

Persist enough state to restore exactly:

- selected `BOS_ID`;
- current setup phase before initial path;
- committed Hacker ID once selected;
- committed Deck ID once selected;
- current/pending route choices;
- current encounter opponent kind/ID;
- selected Boss-battle HOST;
- acquired UPGRADE IDs in acquisition order;
- current Build/order;
- current battle number;
- current Boss ICE/current battle health state;
- Boss Program charge/readiness state through the existing battle-state model;
- Override overlays through the normal board-special persistence model;
- Boss-specific mechanic state only if anything exists beyond what can be reconstructed from persisted board/battle state;
- route RNG state;
- gameplay RNG state through the existing battle save convention;
- required content/gameplay fingerprints.

Do not persist derived PASSIVE instance caches or derived weak-axis sets if they are already reconstructed safely from IDs/content.

## 35. Boss mechanic resume

Mid-Boss-battle save/resume must preserve the exact board and Override count implicitly/explicitly such that:

- no Overrides disappear or duplicate on reload;
- threshold timing does not refire incorrectly;
- countdowns preserve their existing state;
- Program charge remains exact;
- HOST and UPGRADE state remain exact;
- gameplay RNG resumes deterministically;
- the selected Boss and selected Battle-4 HOST do not reroll.

If a save is captured between discrete mechanic steps under the current save architecture, restore to a state that does not double-execute CODESHATTER, REBOOT, DATABEND, or Override placement. Prefer existing atomic action/save boundaries rather than adding speculative micro-step persistence if saves cannot currently occur mid-resolution.

## 36. Incompatible saves

Reject Alpha 0.6 active Run saves cleanly.

Also reject Alpha 0.7 saves with at least:

- missing/unknown selected Boss ID after the Run has committed;
- setup phase inconsistent with required committed selection IDs;
- invalid Boss Program identity/content compatibility;
- pending Battle-4 route that references a normal System instead of the selected Boss;
- Battle-4 route Boss ID different from the Run-selected Boss;
- invalid/unknown HOST or UPGRADE references;
- duplicate acquired UPGRADE IDs;
- inconsistent content fingerprint under existing rules.

Do not silently substitute ODANSHAY for invalid/missing Boss data.

---

# Part XII — Gameplay Fingerprint and Content Authority

## 37. Fingerprint

Extend the normalized gameplay fingerprint to include Boss gameplay content that affects battle/save compatibility.

At minimum include, in stable normalized order:

- Boss stable ID;
- `BASE_ICE`;
- strong color set/order under existing identity normalization;
- strong shape set/order;
- ordered `PRG_SET`;
- referenced Program/Function content through the existing content fingerprint dependency model;
- new supporting Function rows (`FNC_018–020`) through the existing FNC fingerprint.

Do not fingerprint `BIO`, `GRAPHICS`, or placeholder `BOSS_PASSIVE_DESCRIPTION` as gameplay content unless current project policy fingerprints equivalent non-gameplay fields elsewhere.

ODANSHAY's mechanic algorithm is code, not a second data authority. Version/build change plus referenced FNC/data fingerprint provides compatibility boundary for this Alpha implementation.

---

# Part XIII — Logging and Metrics

## 38. Preserve logging architecture

Use the current event-sourced logging/metrics architecture.

Do not create a separate Boss log stream.

Preserve BASIC / VERBOSE / COMPLETE behavior, current storage budget/retention, normalized battle config joins, and compact-export correctness.

## 39. Boss selection and route events

Record sufficient structured data for:

- Boss Selection available Boss IDs;
- selected Boss ID;
- setup-phase progression where existing selection logging conventions apply;
- Battle-4 route offers;
- opponent kind = BOS;
- same selected Boss ID on both final paths;
- each offered HOST ID;
- each offered UPGRADE ID;
- selected HOST;
- selected UPGRADE;
- acquired-UPGRADE list after selection;
- duplicate final UPGRADE offer due to normal pool exhaustion.

## 40. Boss battle context

Battle start/metrics context must identify at least:

- battle number = 4;
- opponent kind = BOS;
- Boss ID;
- Boss starting/max ICE;
- Boss strong axes;
- Boss ordered Program IDs;
- selected HOST ID;
- active UPGRADE IDs;
- gameplay/content fingerprint.

Do not emit a misleading SYS identity for the Boss.

## 41. ODANSHAY mechanic events

Add structured boss-mechanic events through the existing event pipeline for meaningful transitions.

At minimum capture:

- Override placement batch:
  - Boss ID;
  - count before placement;
  - target Packet identifiers/coordinates at the logging level where detailed targets are appropriate;
  - count placed;
  - Hacker special overlays overwritten, if any;
  - count after placement;
- insufficient-target condition and DATABEND invocation;
- DATABEND completion/result where useful;
- threshold trigger with Override count;
- CODESHATTER activation and resulting damage through existing Function-damage events;
- REBOOT activation;
- Boss mechanic terminal defeat cause if CODESHATTER or DATABEND-generated combat consequences end the battle.

Do not log every threshold check at BASIC if nothing happened. Preserve the compactness goals of Alpha 0.4.1/0.6.

## 42. Boss mechanic metrics

Extend battle-level metrics enough to evaluate the encounter later without bloating per-turn storage.

Recommended required Boss-battle aggregates:

- `bossId` / opponent identity;
- total Overrides placed;
- peak simultaneous Override count;
- number of Hacker specials overwritten by Override placement;
- DATABEND activation count;
- CODESHATTER activation count;
- REBOOT activation count.

Existing damage attribution remains authoritative for damage amounts. Do not duplicate complete damage accounting in a second Boss-only metric tree.

---

# Part XIV — UI / Character Sheet

## 43. Run visibility

The player should be able to tell which Boss was selected during the Run using the simplest existing whitebox pattern.

Do not build a route map or major progression UI.

At minimum retain Boss identity in relevant Build/path/battle context once the Run has begun.

## 44. Boss battle reference/character sheet

For the Boss battle, adapt the existing opponent character/reference sheet to show where applicable:

- Boss name;
- current/max ICE;
- strong/weak colors;
- strong/weak shapes;
- ordered Programs;
- resolved Functions;
- selected HOST and its PASSIVEs through current battle-context conventions;
- Boss description/mechanic text only if meaningful authored content is already available through the supplied runtime fields or an existing non-invasive whitebox convention.

Do not fabricate polished boss-help copy from placeholder text.

An Override count display is optional if it falls naturally out of the existing whitebox/debug reference UI, but it is not required for completion; the board and logs remain authoritative.

## 45. Quick Match

Do not add Boss Selection to Quick Match.

Preserve:

- Random Quick Match using normal System + HOST selection;
- Constructed Quick Match allowing deliberate System + HOST selection;
- no UPGRADE selection in Quick Match;
- current isolated setup RNG behavior.

If automated/manual testing needs direct Boss entry, use existing test fixtures/harnesses or a narrowly scoped dev/test helper rather than expanding player-facing Quick Match.

---

# Part XV — Automated Test Requirements

## 46. Data/schema tests

Add automated coverage for at least:

1. BOS is a required runtime dataset.
2. Valid ODANSHAY row loads with correct ICE, strong axes, and ordered PRG_SET.
3. Duplicate/invalid BOS IDs reject.
4. Invalid Boss Program references reject.
5. Invalid strong-axis tokens reject.
6. Stale/missing required BOS headers reject according to existing header policy.
7. Presentation fields do not alter gameplay behavior/fingerprint if equivalent existing fields are excluded.
8. Zero-cost support Functions are accepted when not directly assigned to Program/Deck.
9. Zero-cost Functions directly assigned to Program/Deck reject under the formalized rule.
10. FNC_018/019/020 resolve from authored rows exactly.

## 47. New Run/setup tests

Cover at least:

11. New Run opens Boss Selection first.
12. Committing Boss creates/replaces the Run save immediately.
13. Selected Boss persists before Hacker selection.
14. Reload after Boss commit resumes Hacker Selection with same Boss.
15. Hacker selection persists and reload resumes Deck Selection.
16. Deck selection proceeds to initial Path Choice, not Build.
17. Initial path offers survive reload exactly.
18. Initial path remains DOORMAN + THRESHOLD regardless of selected Boss.
19. Initial UPGRADE is acquired before Build.
20. Once Boss is committed, ordinary navigation cannot silently substitute/change the Boss within that Run.

## 48. Route tests

Cover at least:

21. Battles 2 and 3 preserve Alpha 0.6 normal SYS/HST route behavior.
22. Battle 4 route options use opponent kind BOS.
23. Both Battle-4 paths use the Run-selected Boss ID.
24. Battle 4 never substitutes a normal SYS opponent.
25. Final paths use valid random HOSTs from the escalation pool.
26. Final HOSTs are distinct when at least two valid alternatives exist.
27. Final UPGRADE exhaustion may show the same single remaining UPGRADE on both paths.
28. Selecting either duplicate-UPGRADE final path acquires the UPGRADE once.
29. Pending final offers survive reload without reroll.
30. Selected final HOST survives reload without reroll.
31. Route generation remains isolated from gameplay RNG.

## 49. Boss combat-model tests

Cover at least:

32. ODANSHAY uses `BASE_ICE=100` with Normal Link ON; no `+150` Run escalation is added.
33. Manual enemy ICE override applies to Boss when Normal Link is OFF.
34. ODANSHAY weak axes derive correctly.
35. Boss Program order is DISABLER → SHIELDER → SPAMBOT → ATTACKER.
36. Boss Program charge routing uses existing enemy top-to-bottom behavior.
37. Dynamic Boss Function phase matches System semantics.
38. Each Boss Program activates at most once per Function phase.
39. Enemy Drain targeting/gating is preserved for ODANSHAY.
40. SPAM charge behavior is preserved for Boss.
41. Boss ordinary Syncs use Boss axes and damage Hacker.
42. Boss identity/source is BOS in logs/context, not a fake SYS.

## 50. Override tests

Cover at least:

43. Override placement does not change Packet axes.
44. Override itself deals no damage and grants no charge.
45. Existing Boss-owned special is invalid as an Override target.
46. Hacker-owned special is a valid target and is replaced/destroyed when Override is installed.
47. Ordinary mechanics that destroy enemy specials can destroy Overrides.
48. Three distinct valid targets are selected before placement.
49. Successful end-turn resolution places exactly three Overrides.
50. Override placement uses gameplay RNG, not route/setup RNG.
51. No Sync is created merely by installing Override because axes are unchanged.
52. On fewer than three valid targets, no partial Overrides are placed before DATABEND.
53. DATABEND executes and then capacity is recomputed.
54. DATABEND removes Hacker-owned overlays but preserves Boss-owned overlays under authored SHAKE semantics.
55. DATABEND-created Syncs are Boss-owned and can damage/charge normally.
56. Retry continues until three can be placed or Hacker is defeated.

## 51. Threshold/ordering tests

Cover at least:

57. Threshold does not trigger below 15 Overrides.
58. Threshold triggers at exactly 15.
59. Threshold triggers above 15.
60. HOST START_OF_TURN resolves before ODANSHAY threshold check.
61. ODANSHAY threshold resolves before countdown ticking.
62. CODESHATTER invokes at zero Function cost.
63. CODESHATTER uses normal Function-damage modifiers.
64. CODESHATTER is reduced by current Shield/permanent-Shield rules.
65. Reinforced Connection does not suppress CODESHATTER.
66. Hacker defeat from CODESHATTER stops REBOOT and all remaining Boss-turn actions.
67. If Hacker survives, REBOOT fires after CODESHATTER.
68. REBOOT removes special overlays and suppresses post-shake Sync/cascades per `1:1:0:0`.
69. After REBOOT, normal Boss turn continues from the countdown/Function flow.
70. End-of-turn Override placement occurs only after normal Boss-turn resolution.
71. Threshold can trigger again on a later turn after Overrides reaccumulate.

## 52. Save/resume tests

Cover at least:

72. Alpha 0.6 save rejects cleanly under Alpha 0.7.
73. Missing/unknown Boss ID rejects.
74. Setup phase with inconsistent committed IDs rejects.
75. Battle-4 path with wrong Boss ID rejects.
76. Mid-Boss save/resume preserves Boss ICE and Program charge.
77. Mid-Boss save/resume preserves exact Override overlays/count.
78. Mid-Boss save/resume preserves HOST and UPGRADE stack.
79. Mid-Boss save/resume does not duplicate threshold payloads or end-turn placements.
80. Boss battle gameplay RNG resumes deterministically.

## 53. Logging/metrics tests

Cover at least:

81. Boss Selection available/selected IDs log correctly.
82. Battle-4 routes log BOS opponent kind and selected Boss ID.
83. Boss battle config/metrics identify BOS rather than SYS.
84. Override placement logs correct Boss source.
85. DATABEND/CODESHATTER/REBOOT activations preserve Boss causal source.
86. Boss Function damage remains correctly attributed through existing damage metrics.
87. Boss aggregate mechanic counters update correctly.
88. BASIC/VERBOSE/COMPLETE behavior remains within current logging architecture.
89. Compact exporter continues to classify valid records correctly and does not regress `cfg[missing]` remediation.

## 54. Regression gate

Existing Alpha 0.6 test coverage must continue passing for:

- PASSIVEs;
- HOSTs;
- UPGRADEs;
- route persistence/exhaustion;
- DOORMAN intro;
- System identity;
- COERCE;
- EBUFF;
- SPAM;
- charge routing;
- Drain;
- B1;
- Reinforced Connection;
- DATACUT;
- PLINK;
- SCRAMBLE;
- settings accordion behavior;
- normal Quick Match;
- logging levels/storage behavior.

Do not weaken regression assertions merely to make Boss support pass.

---

# Part XVI — Manual Browser Verification

## 55. Required browser checks

Perform and report actual observation of at least:

1. Title/version identifies Alpha 0.7.0.
2. New Run opens Boss Selection before Hacker Selection.
3. ODANSHAY selection shows the correct authored identity data appropriate to current whitebox UI.
4. Commit Boss, reload before Hacker selection, and confirm Continue resumes with ODANSHAY fixed.
5. Select Hacker, reload before Deck selection, and confirm setup resumes correctly.
6. Deck selection proceeds to Path Choice before Build.
7. Initial paths remain DOORMAN + THRESHOLD with normal UPGRADE choice.
8. Build appears after path commit and shows the committed encounter/UPGRADE context.
9. Battles 1–3 retain normal flow.
10. After Battle 3, both final path cards lead to ODANSHAY.
11. Final paths show valid HOST choices and the expected final UPGRADE exhaustion behavior.
12. Boss Build screen shows selected ODANSHAY/HOST/UPGRADE context.
13. Boss battle character/reference UI shows ODANSHAY rather than a System identity.
14. Observe normal ODANSHAY Program combat behavior.
15. Observe Overrides being added three at the end of an ODANSHAY turn.
16. Confirm Override does not alter underlying Packet color/shape.
17. Where practical, observe a Hacker special being replaced by Override.
18. Reach/force a 15+ Override state and visually observe CODESHATTER → survival check → REBOOT ordering.
19. Confirm REBOOT clears specials and the Boss turn continues if Hacker survives.
20. Save/reload during Boss battle and confirm exact Boss/HOST/UPGRADE/Override state resumes.
21. Win the Boss battle and confirm the Run completes cleanly.
22. Lose the Boss battle and confirm ordinary Run-loss handling remains clean.
23. Review logs/export for Boss identity and mechanic attribution.
24. Verify normal Constructed and Random Quick Match still use Systems/HOSTs and do not expose Boss selection.

## 56. Required narrow viewport

Repeat the critical new selection/route/battle-reference UI checks at:

```text
390 × 844 CSS pixels
portrait orientation
```

At minimum inspect:

- Boss Selection;
- Hacker/Deck progression controls;
- Path cards including the Battle-4 Boss paths;
- Build opponent/route context;
- Boss character/reference sheet;
- Settings LINK/ICE accordion behavior.

The requirement is the browser's **rendered CSS viewport**, not merely resizing the outer desktop window.

If browser automation cannot produce the target viewport, use DevTools/device emulation or another method that exposes the actual viewport dimensions. If the environment still cannot do so, report it explicitly rather than claiming the check passed.

A real phone/touch test is desirable if available but is not a completion blocker; report whether it was performed.

## 57. Manual test honesty

Do not claim manual behavior was observed if only an automated test covered it.

The final agent report must separate:

- observed browser/manual checks;
- automated-only coverage;
- checks not performed and why.

---

# Part XVII — Stage 1 Inspection and Authorization

## 58. Stage 1 — mandatory inspection and authorization stop

Before writing implementation code:

1. Read this entire handoff.
2. Read all supplied Alpha 0.7 runtime datasheets and the boss mechanic notes.
3. Inspect the current Alpha 0.6 repository and working-tree state.
4. Run the current baseline verification suite appropriate to the repository.
5. Confirm actual Alpha 0.6 `GAME_VERSION` and save schema.
6. Confirm the existing required-dataset integration point and how BOS is added as the tenth required runtime dataset for browser/Node.
7. Confirm current identity/source types for Hacker, System, HOST, UPGRADE/PASSIVE source attribution, and the minimum extension required for Boss.
8. Confirm current route representation and identify the minimum safe change needed for `SYS | BOS` opponent identity.
9. Confirm current initial Run setup/save boundary and how to persist Boss/Hacker/Deck setup phases in the single active Run save.
10. Confirm current Hacker/Deck selection screens and Continue routing.
11. Confirm current enemy Program charge routing, Function phase, Drain targeting, matching/timer behavior, and terminal checks that ODANSHAY will reuse.
12. Confirm current special-overlay representation, ownership, replacement/destruction rules, rendering, and save serialization before implementing Override.
13. Confirm current `EFFECT_SHAKE` tuple implementation matches the authored `1:2:1:2` and `1:1:0:0` semantics.
14. Confirm current zero-cost Function validation and update it to the explicit Alpha 0.7 rule without breaking GREENING/SNEAK.
15. Confirm current turn-start ordering and exact insertion point for ODANSHAY threshold between HOST start-of-turn effects and countdown ticking.
16. Confirm the normal end-of-enemy-turn boundary and exact insertion point for final Override placement.
17. Confirm gameplay RNG access for Override target selection and DATABEND; ensure route/setup RNG is not used.
18. Confirm current battle metrics/event source model can represent Boss causal identity without fake System attribution.
19. Confirm current content fingerprint structure and fields to add for BOS.
20. Confirm current manual health override behavior and apply it to Boss as specified while leaving Normal Link ON Boss ICE at authored `BASE_ICE` with no `+150`.
21. Confirm current README structure and verification commands.
22. Identify exact modules/files to change.
23. Produce a concise Stage 1 report containing:
   - data/schema findings;
   - exact BOS content resolved from data;
   - Boss source/identity plan;
   - route union plan;
   - setup save-phase plan;
   - Override overlay representation plan;
   - Boss turn-order plan;
   - supporting Function/zero-cost validation plan;
   - save schema/fingerprint plan;
   - logging/metrics plan;
   - automated test plan;
   - 390×844 manual test plan;
   - README plan;
   - commit/push plan;
   - genuine contradictions or blockers only.
24. **Stop and request authorization before implementation.**

### 58.1 Stage 1 decision rule

Do not stop for routine implementation details clearly resolved by the current architecture.

Do escalate before implementation if inspection reveals a genuine conflict affecting:

- Boss identity/source correctness;
- route `SYS|BOS` persistence;
- destructive New Run commitment timing;
- setup resume behavior;
- Override target/replacement semantics;
- SHAKE tuple behavior;
- Boss turn ordering;
- gameplay versus route RNG;
- Boss ICE precedence;
- zero-cost Function safety;
- save compatibility;
- content authority/fingerprinting;
- logging attribution;
- required scope.

Do not use Stage 1 to propose unrelated refactors or content tooling.

---

# Part XVIII — Stage 2 Implementation Order

## 59. Implementation sequence

After authorization, implement in dependency order.

### Phase A — BOS content and identity

- add BOS required dataset;
- parser/types/resolution/validation;
- Boss identity lookup;
- weak-axis derivation;
- gameplay fingerprint;
- zero-cost Function validation formalization;
- content tests.

### Phase B — Boss selection and setup persistence

- Boss Selection UI;
- destructive commitment on Boss commit;
- setup save phases;
- Hacker/Deck resume routing;
- version/schema bump and Alpha 0.6 rejection;
- selection logging.

### Phase C — route/opponent union

- honest `SYS|BOS` encounter representation;
- preserve Battles 1–3;
- Battle-4 path generation using selected Boss;
- final HOST uniqueness and UPGRADE exhaustion;
- exact pending-route persistence/logging.

### Phase D — Boss combat identity

- adapt enemy battle construction to BOS;
- Boss ICE and manual override;
- Boss axes;
- Boss Program build/charge/function behavior;
- character/reference UI;
- metrics/config identity.

### Phase E — ODANSHAY mechanic

- Override overlay representation/render/save;
- valid-target/replacement semantics;
- end-turn placement;
- DATABEND fallback;
- start-turn threshold;
- CODESHATTER/REBOOT;
- terminal-state handling;
- source attribution;
- mechanic metrics/events.

### Phase F — integration and verification

- full automated suite;
- smoke/batch/hpladder/build as applicable;
- desktop manual verification;
- exact 390×844 viewport verification;
- README update;
- final diff inspection;
- commit and push.

Add focused tests with each phase rather than deferring all tests to the end.

---

# Part XIX — Balance and Regression Boundaries

## 60. Balance policy

Alpha 0.7 is feature completion, not a balance pass.

Use supplied values exactly, including:

- ODANSHAY `BASE_ICE = 100`;
- ODANSHAY strong axes;
- ODANSHAY Program order;
- Override placement = 3;
- Override threshold = 15;
- CODESHATTER damage = 70;
- authored DATABEND/REBOOT tuples;
- existing Program costs;
- existing PASSIVE/HOST/UPGRADE values.

Do not compensate for playtest difficulty by changing unrelated values during implementation.

Only alter authored gameplay numbers after an actual defect/blocker and explicit authorization.

## 61. No incidental default changes

Do not change current defaults for:

- matching/timer mode;
- Normal Link;
- Hacker/System manual health settings;
- logging level;
- Quick Match selection behavior;
- route probabilities;
- HOST/UPGRADE pools.

If a new feature appears inert under the current default configuration, report it rather than silently changing the default to make the content look active.

---

# Part XX — Verification Gate and Completion

## 62. Required command gate

Run the repository's current equivalents of:

```text
npm run typecheck
npm test
npm run smoke
npm run batch
npm run hpladder
npm run build
```

If command names differ after repository inspection, use the actual maintained commands and report them.

All required gates must pass before commit/push.

Record test counts, build size, batch/ladder summaries, and expected content warnings in the final report.

Do not hide new warnings. Explain each new warning and whether it is expected.

## 63. README requirements

Update README to reflect the shipped repository, including where appropriate:

- `alpha-0.7.0` version;
- ten runtime datasets including BOS;
- New Run Boss-first setup flow;
- Battles 1–3 normal route behavior;
- selected-Boss Battle 4 route behavior;
- Boss source/identity distinction;
- ODANSHAY's whitebox Override mechanic;
- zero-cost support Function convention;
- save/setup phase changes;
- Boss logging/metrics;
- Quick Match remaining System-only;
- current verification commands;
- meaningful known limitations/deferred Beta items.

README should describe what shipped, not reproduce implementation chatter or speculative roadmap detail.

## 64. Completion standard

Alpha 0.7 is complete when all of the following are true:

- BOS is an external validated runtime dataset.
- ODANSHAY resolves exactly from supplied BOS data.
- New Run begins with Boss Selection.
- Boss commit starts/replaces the Run save and persists immediately.
- Hacker and Deck setup progress resume correctly.
- Canonical setup order is `Boss → Hacker → Deck → Path → Build → Battle`.
- Battle 1 remains DOORMAN + THRESHOLD.
- Battles 2–3 retain Alpha 0.6 normal routes.
- Battle 4 always uses the selected Boss and never a normal System.
- Final path choices use the same Boss, valid randomized HOSTs, and normal UPGRADE exhaustion.
- Boss identity/source is represented honestly in combat, saves, logs, metrics, and UI.
- ODANSHAY uses the authored four-Program build and normal enemy combat systems.
- Boss ICE is authored `BASE_ICE` with no normal +150 when Normal Link is ON.
- Manual enemy ICE override still works when Normal Link is OFF.
- Override overlays behave exactly as specified.
- Three Overrides are attempted as the final action of each non-terminal Boss turn.
- DATABEND handles insufficient capacity without partial pre-placement.
- 15+ Overrides trigger CODESHATTER, survival check, then REBOOT before countdown ticking.
- Supporting Functions use existing Effects at zero charge cost under the formal zero-cost rule.
- Save/resume preserves exact Boss/setup/path/battle/mechanic state.
- Alpha 0.6 saves reject cleanly.
- Existing PASSIVE/HOST/UPGRADE/Quick Match/combat behavior remains intact outside explicit changes.
- Logging and metrics preserve Boss/mechanic attribution without a parallel pipeline.
- Required automated verification passes.
- Required browser checks are performed and truthfully reported.
- Critical UI is verified at a real **390×844 CSS-pixel** viewport or inability is explicitly reported.
- README describes the shipped Alpha 0.7 state.
- Final diff is reviewed.
- Verified build is committed and pushed normally.

Once these conditions are met, the major Alpha gameplay feature skeleton is complete. Content expansion, balance, broader boss parameterization, content tooling, and engine migration remain later work.
