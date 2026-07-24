# Breach Alpha 0.2.0 — Coding Agent Handoff

**Build:** Alpha 0.2.0  
**Theme:** Sequential Run Skeleton and Battle-Screen Layout Revision  
**Source design document:** `Breach_Alpha_0.2.0_Architect_Handoff(1).md`

---

## 0. Document Authority and Working Method

This handoff defines the implementation requirements for Breach Alpha 0.2.0.

Read this entire document before changing code. Also inspect:

- the current Alpha 0.1.0 implementation;
- `breach-alpha-0.1.0-requirements.md`;
- the current Program and Function datasets;
- the Alpha 0.1.0 post-build notes and established repository conventions.

Alpha 0.1.0 remains the baseline for combat and the data-driven Program/Function/Effect architecture. Alpha 0.2.0 is an additive superstructure and layout build. Where this handoff explicitly changes Alpha 0.1.0 behavior, Alpha 0.2.0 governs. Everything not changed here remains intact.

This handoff was prepared from an architect design document rather than directly from code. Compare every requirement with the current implementation. Report meaningful disagreement, hidden coupling, obsolete assumptions, or requirements that cannot be implemented honestly. Do not silently reinterpret a requirement merely to fit the code.

### 0.1 Source-control and README boundary — explicit override

The user is handling source control.

The coding agent must:

- not access or interact with any remote repository;
- not run `git fetch`, `git pull`, `git push`, `git clone`, or any other remote Git operation;
- not create commits, tags, branches, stashes, or modify the Git index;
- not run `git add`, `git commit`, `git checkout`, `git reset`, `git rebase`, or equivalent source-control write operations;
- not modify `README.md` or any replacement README file.

Read-only local inspection such as `git status`, `git diff`, or `git log` is permitted only when useful for understanding or reporting the existing worktree. The agent must leave all source-control actions and README maintenance to the user.

This section supersedes every earlier instruction that pre-authorized an automatic source commit.

---

# Part I — Alpha 0.2.0 Requirements

## 1. Build Objective

Alpha 0.2.0 adds the first minimal run structure around the validated combat system and revises the battle-screen layout toward the intended Hacker-versus-System presentation.

The build must:

1. Add a four-battle sequential Run.
2. Preserve Quick Match as the existing single-battle experience.
3. Maintain one save slot that may contain either mode.
4. Resume the exact saved mode and Run position.
5. Add result-screen wizard controls without allowing Force Win during active combat.
6. Establish stable authored Program order as runtime, save, UI, and log state.
7. Rebuild the battle layout around vertical Hacker and System Program stacks.
8. Move character sheets from Pause to the side avatar controls.
9. Add compact Buff and Shield totals to avatar boxes.
10. Reserve a compact bottom status/help region.
11. Preserve existing combat behavior and the Alpha 0.1.0 content architecture.

This build does not add the full game loop, a unique boss, rewards, inventory, build selection, or Program reordering.

---

## 2. Alpha 0.1.0 Architecture and Clarifications to Preserve

### 2.1 Data-driven content remains authoritative

Preserve the Alpha 0.1.0 Program/Function/Effect pipeline:

- browser and Node tools acquire the same source CSV resources through thin environment adapters;
- both use the same pure TypeScript parser, phased validator, resolver, and immutable `ResolvedContent`;
- human play, headless play, UI, saves, logs, and metrics consume the same resolved content;
- there is no hardcoded Program or Function fallback;
- validated dataset values are authoritative;
- data is loaded once during startup and is not reloaded mid-session or mid-run.

No Program, Function, Effect-contract, area-pattern, or dataset-schema redesign is required by Alpha 0.2.0.

### 2.2 Current content and enum vocabulary remain valid

Preserve the accepted enums:

- Colors: `RED`, `YEL`, `MAG`, `GRE`, `CYA`, `BLU`
- Shapes: `CIR`, `SQU`, `TRI`, `DIA`, `STR`, `CRO`

Recognized but currently unused enum values remain valid.

### 2.3 System timer charging

Preserve the uniform engine-level timer-charge behavior:

```text
ENEMY_TIMER_CHARGE_RATE = 3
```

This remains one shared engine default for all System Programs in timer-charge mode. Do not add a per-Program timer-charge field, and do not derive the System rate from Hacker Program data.

### 2.4 Board-Shake

Board-Shake remains the existing deck/engine-level ability. It is not converted into Program or Function data in this build.

### 2.5 Targeting convention and System Drain override

Unless a specific Effect overrides the default:

- Hacker-controlled targeted Effects present a targeting interface and require the player to select a valid target.
- System-controlled targeted Effects choose randomly among valid targets.

System Drain preserves the approved explicit override:

1. Eligible opposing Programs have raw charge greater than `0`.
2. If any eligible Program is fully charged, restrict the candidate pool to fully charged Programs.
3. Within that pool, choose the highest raw charge.
4. If none are fully charged, choose the highest partial raw charge.
5. Break remaining ties by highest activation cost.
6. Break final ties randomly.
7. If no opposing Program has charge and the expanded Function plan consists entirely of Drain operations, withhold activation before payment and preserve the System Program's charge.
8. A future mixed composite containing Drain plus another operation still activates and pays normally; an unavailable Drain operation may legally fizzle while later operations continue.

Do not simplify this rule to only “deterministic Drain.”

### 2.6 Effects, special state, rendering, and attribution

Preserve these Alpha 0.1.0 implementation clarifications:

- Shield protects the side that owns it, not an intrinsically fixed enemy side.
- Special board objects retain their resolved Effect data, including ownership, placing Program ID, countdown, footprint/area identity, and magnitude where applicable.
- Bomb/detonation render events carry the actual resolved footprint cells. Rendering must not reconstruct or assume a base 3×3 footprint.
- Effect validation contracts remain centralized in the Effect registry. Runtime dispatch may remain an exhaustive typed switch.
- Metrics distinguish paid parent Function activation, operation attempt, successful Effect resolution, legal fizzle, and unexpected failure.
- Composite children are not counted as separately paid activations.
- Existing Buffer and Shield timing, damage ordering, and metric-bucket invariants remain unchanged unless inspection reveals an already-approved implementation difference that must be reported.

### 2.7 Current metric limitations remain acceptable

Do not expand metric scope merely because the mechanics are side-general:

- current shield metrics may remain focused on the production System-shield case;
- current Buffer credit may retain the one-buff-source-per-side assumption.

If Alpha 0.2.0 implementation would make either assumption incorrect in production content, escalate before changing the schema.

---

## 3. Application Modes and Title Screen

### 3.1 Mode model

The application has exactly two playable start modes:

```text
QUICK_MATCH
RUN
```

Use a typed mode discriminator rather than inferring mode from screen state, Run step, labels, or nullable fields.

### 3.2 Quick Match

Rename the current **New Game** title control to **Quick Match**.

Quick Match:

- starts the existing single-battle flow;
- uses the existing supported battle configuration;
- retains current combat, save, result, restart, and configuration behavior except where the shared one-save-slot and result rules below explicitly change it;
- does not create Run progression.

### 3.3 New Run

Add a **New Run** title control.

New Run:

- begins at Battle 1 of 4;
- snapshots the supported menu/battle configuration at Run start;
- uses that saved configuration for the entire Run;
- applies the Run encounter's System HP override for each step;
- does not allow mid-Run settings changes to alter the saved Run.

Starting a new Run creates a fresh Run state. No rewards, inventory, branching, or between-battle editing scene occurs.

### 3.4 Continue

Show **Continue** only when the single save slot contains a valid, compatible save.

The label must identify mode and context:

```text
Continue Quick Match
Continue Run — Battle 1 of 4
Continue Run — Battle 2 of 4
Continue Run — Battle 3 of 4
Continue Run — Battle 4 of 4
```

If a saved battle is currently displaying a pending result modal, the label still uses the battle number. Continue restores the saved battle and its pending modal rather than skipping the unresolved result.

An invalid, incompatible, corrupt, or content-fingerprint-mismatched save does not count as a valid save and must not produce a Continue control.

### 3.5 Single save slot

There is one active save slot.

It may contain:

- one Quick Match; or
- one Run.

It may never contain both.

Starting Quick Match or New Run replaces the resident save only after any required confirmation succeeds.

### 3.6 Replacement confirmation

If a valid save exists, selecting Quick Match or New Run must display a confirmation stating that the existing resumable progress will be replaced.

Requirements:

- no confirmation is needed when no valid save exists;
- cancel leaves the save and current title state unchanged;
- confirm clears/replaces the save and starts the selected mode;
- the dialog identifies the saved mode being replaced when practical;
- this is a meaningful destructive action and is an approved exception to the project's general avoidance of trivial confirmations.

---

## 4. Sequential Run Model

### 4.1 Encounter table

The Run contains exactly four encounters:

| Run step | System HP | Hacker roster | System roster |
|---|---:|---|---|
| Battle 1 of 4 | 100 | Current resolved Hacker roster | Current resolved System roster |
| Battle 2 of 4 | 150 | Current resolved Hacker roster | Current resolved System roster |
| Battle 3 of 4 | 200 | Current resolved Hacker roster | Current resolved System roster |
| Battle 4 of 4 | 250 | Current resolved Hacker roster | Current resolved System roster |

Store this as a small explicit encounter definition, not as a mathematical HP formula or generalized encounter generator.

Battle 4 is the final Run slot only. It is not a boss and gains no unique mechanics.

### 4.2 Run configuration

At New Run:

- snapshot the current supported battle settings;
- preserve them for all four battles;
- override System starting HP with the encounter table;
- use the saved configured Hacker maximum/starting HP as the Hacker's full HP;
- preserve the selected System behavior mode and other supported combat toggles.

The title-screen menu configuration is not allowed to silently mutate an existing saved Run. Continue always uses the saved Run configuration.

### 4.3 Fresh battle state per encounter

Each Run encounter creates a fresh battle state.

At the start of every Run battle:

- Hacker HP is restored to full configured HP;
- System HP is set from the encounter table;
- Hacker and System Program charge returns to normal battle-start values;
- Board-Shake returns to normal battle-start state;
- no Buff, Shield, Bomb, countdown, selection, or other transient combat object carries forward;
- battle metrics start fresh;
- a new random starting board is generated;
- a new battle RNG state/seed is used;
- the same resolved Program and Function content and saved Run configuration are used.

Only Run progression state carries between battles. There is no attrition, reward, inventory, Program mutation, or persistent combat Effect in Alpha 0.2.0.

### 4.4 Progression after victory

A natural or wizard-forced Run victory advances to the next Run step after the result action is accepted.

There is no map, reward, selection, or interstitial scene between encounters.

For Battles 1–3:

1. show the ordinary result modal;
2. preserve the pending result in the save;
3. when the victory progression action is accepted, create the next fresh battle;
4. update the save to the new Run step;
5. enter the next battle.

For Battle 4:

- victory leads to **Run Complete**;
- no Force Win control appears on Run Complete;
- accepting the completed-Run exit clears the active save and returns to the title flow.

### 4.5 Run defeat

A natural Run defeat ends normal Run progression and displays a Run-loss result.

The Run-loss result must include:

- **Restart Run**;
- the current existing exit/end/return-to-title behavior;
- the wizard/dev **Restart Lost Battle** control defined below;
- the wizard/dev **Force Win** control defined below.

Choosing the terminal exit/end action clears the active Run save and returns to title.

Choosing Restart Run or Restart Lost Battle replaces the terminal/pending state with a new active battle and saves that new state.

### 4.6 Restart Run

Restart Run:

- starts a new Run at Battle 1 of 4;
- uses the same saved Run configuration unless the existing product convention explicitly returns through title/settings first;
- creates a fresh Battle 1 board and RNG state;
- restores all normal starting state;
- replaces the old Run save.

Do not preserve the original Battle 1 seed or board.

---

## 5. Result State and Wizard Controls

### 5.1 Pending result is saveable state

A concluded battle whose result modal has not yet been resolved is still resumable state.

The save model must represent at least:

```text
ACTIVE_BATTLE
PENDING_RESULT
```

Do not infer pending result solely from HP or renderer state.

If the application closes while a result modal is open, Continue must restore the battle and the same pending result context.

### 5.2 Force Win availability

Force Win:

- is never available during active combat;
- appears only on ordinary battle victory and defeat result modals;
- appears in both Quick Match and Run result modals;
- does not appear after Run Complete;
- is a wizard/developer control and should remain visually distinguishable from normal player controls.

### 5.3 Force Win behavior

Using Force Win records a wizard-forced win and applies the same mode-specific progression that a won battle would receive.

For Run:

- Battles 1–3 progress to the next fresh encounter;
- Battle 4 progresses to Run Complete.

For Quick Match:

- the battle is resolved as a wizard-forced Quick Match victory;
- there is no Run progression;
- normal Quick Match terminal handling applies.

If Force Win is used on an already-natural victory result, progression is unchanged, but the explicit wizard invocation must still be logged distinctly.

### 5.4 Natural versus wizard outcomes

Logs and result/progression events must distinguish at least:

```text
NATURAL_VICTORY
NATURAL_DEFEAT
WIZARD_FORCE_WIN
WIZARD_RESTART_LOST_BATTLE
WIZARD_RESTART_RUN
```

Do not overwrite the original natural battle outcome when recording a later wizard decision. Preserve both:

- the battle's natural result;
- the wizard action that changed progression.

No new generalized analytics framework is required. Extend the existing event/log model consistently.

### 5.5 Restart Lost Battle

After a Run defeat, provide a wizard/dev **Restart Lost Battle** action.

It creates a fresh instance of the same Run step:

- same Run step number;
- same encounter System HP;
- same saved Run configuration;
- same resolved rosters and content fingerprint;
- Hacker restored to full HP;
- normal starting charge and Board-Shake state;
- no carried special objects or metrics;
- new random board;
- new RNG state/seed.

It does not restore the original battle-start board or RNG seed.

### 5.6 Quick Match result behavior

Preserve the current Quick Match result controls and flow unless they conflict with this section.

A completed Quick Match save is cleared when the user accepts a terminal result/exit action. A restart action creates and saves a fresh Quick Match battle under the existing configuration behavior.

---

## 6. Save and Resume

### 6.1 Save version

Update active save/build identity to Alpha 0.2.0.

Pre-Alpha 0.2.0 saves may be rejected cleanly as incompatible. Migration from Alpha 0.1.0 is not required unless the existing save architecture makes a safe migration trivial and the Senior Developer explicitly recommends it during Stage 1.

Do not partially load a mixed-version save.

### 6.2 Save envelope

Use an explicit discriminated save model. Exact type names may follow repository conventions, but the saved information must include:

Common identity:

- build/save version;
- schema version;
- content fingerprint;
- active mode;
- saved configuration;
- stable ordered Hacker Program IDs;
- stable ordered System Program IDs;
- active battle state or pending result state.

Run-only identity:

- current Run step, `1` through `4`;
- resolved encounter configuration or enough stable information to verify/recreate it;
- the Run configuration snapshot;
- pending progression/result context when applicable.

Quick Match must not carry fake Run values merely to satisfy one broad nullable interface.

### 6.3 Restore

Continue restores directly into:

- the active Quick Match battle;
- the active Run battle;
- or the saved pending result modal.

Restore must preserve:

- exact battle state;
- deterministic RNG continuation for active battles;
- mode;
- Run step;
- encounter HP;
- configuration;
- Program order;
- content fingerprint;
- current result/wizard context.

### 6.4 Save clearing

Clear the active save when:

- a completed Quick Match terminal exit/result is accepted;
- a Run-loss terminal exit/end action is accepted;
- Run Complete exit is accepted;
- a confirmed new Quick Match or New Run replaces it.

Do not clear the save merely because a result modal appears. The pending result must remain resumable until the player chooses an action.

### 6.5 Content compatibility

Preserve existing content-fingerprint rules:

- normalized gameplay content controls compatibility;
- formatting and notes-only changes should not invalidate a save;
- a fingerprint mismatch rejects the save rather than loading changed Function behavior into an existing battle or Run.

---

## 7. Stable Program Ordering

### 7.1 Authoritative order

Alpha 0.2.0 establishes explicit stable Program sequence for both sides.

For this build, use the authored order of Programs produced by the validated Program dataset/resolver unless the current implementation already has a more explicit stable authoring-order field.

Do not introduce a new data column solely for Alpha 0.2.0 unless inspection shows that source order is not preserved or cannot be validated reliably. Report that issue during Stage 1.

### 7.2 Order requirements

Program order must:

- remain stable throughout a battle and Run;
- be identical in runtime state, rendering, saves, and relevant logs;
- be stored as ordered stable `PRG_ID` values where serialized;
- not be derived from display name, Function cost, current charge, readiness, damage, or UI sorting;
- not dynamically change when a Program activates or becomes fully charged;
- use authored stable order for the System roster as well as the Hacker roster.

### 7.3 No gameplay routing yet

Program order has no charge-routing or combat-resolution effect in Alpha 0.2.0.

Do not implement:

- charge overflow;
- top-to-bottom compatible routing;
- neutral wildcard charging;
- Program reordering;
- build editing.

The order is being established now so future mechanics can rely on a stable sequence without another state/save/UI rewrite.

---

## 8. Battle-Screen Layout

### 8.1 Layout goals

Revise the whitebox battle layout to communicate two opposing vertical stacks.

Required arrangement:

- Hacker avatar box: upper-left.
- System avatar box: upper-right.
- Pause control: top center between avatar boxes.
- Hacker Programs: vertical stack down the left side.
- System Programs: vertical stack down the right side.
- Gem board: shifted downward by approximately five percent relative to the current layout.
- Bottom margin: approximately five percent of the available battle viewport.
- Bottom margin contains the compact status/help region.

The percentages are layout targets, not exact fixed pixel contracts. Preserve:

- a square board;
- readable Program controls;
- non-overlapping hitboxes;
- the existing mobile portrait/letterboxed phone target;
- usability on narrow screens.

Do not add an MTGPQ-style card queue.

### 8.2 Layout implementation

Use a centralized layout calculation or existing layout framework. Do not scatter independent magic coordinates through input and rendering code.

Rendering and hit-testing must consume the same computed rectangles/regions.

The layout must account for:

- device/viewport size;
- established letterboxing or safe viewport;
- avatar bounds;
- pause bounds;
- Program stack bounds;
- square board bounds;
- bottom status/help bounds;
- modal overlays.

If the current renderer already centralizes layout, extend it. Do not create a parallel layout system.

### 8.3 Input priority and separation

Input channels must remain distinct:

1. blocking modal/overlay;
2. character-sheet close/back actions;
3. Pause and avatar controls;
4. Program activation/targeting controls;
5. board selection/swapping.

Avatar hitboxes must not overlap Program activation hitboxes. Pause must not overlap either avatar.

A tap on an avatar must never activate the adjacent top Program. A tap on a Program must never open the character sheet.

### 8.4 Interaction stability

Pause and character-sheet overlays should be available only at state boundaries the current architecture can pause safely.

Do not introduce arbitrary mid-resolution suspension of logic or animation merely to make the controls always clickable. Preserve the established stable-input-phase restrictions unless the current pause framework already safely supports more.

---

## 9. Avatar Boxes and Persistent-Effect Indicators

### 9.1 Avatar controls

Each side has one avatar box used for:

- side identity;
- character-sheet access;
- compact persistent-effect totals.

The avatar is not a Program and cannot be activated as a Function.

### 9.2 Buff and Shield totals

Display the current total active Buff and Shield value for the owning side.

Requirements:

- show total Effect value, not the number of tiles;
- compute from the authoritative current battle state;
- support both Buff and Shield on either side;
- update when special tiles are placed, removed, matched, detonated, or otherwise changed;
- do not duplicate these persistent totals in the bottom status region.

Acceptable whitebox placeholders:

```text
B +5
S 10
```

A similarly clear compact icon/abbreviation is allowed.

Zero-value indicators should be hidden by default to reduce clutter. The layout must still reserve or adapt cleanly when both values are present.

Do not infer values from render objects or cached text. Use logic state or an existing state-derived selector.

---

## 10. Character Sheets

### 10.1 Move from Pause to avatars

Remove character-sheet content from the Pause menu.

- Hacker avatar opens the Hacker character sheet.
- System avatar opens the System character sheet.

### 10.2 Sheet contents

Each side's character sheet lists:

- strong colors;
- weak colors;
- strong shapes;
- weak shapes.

Use current battle configuration/resolved combat identity as the authority. Weak sets are the recognized complement of the side's strong sets.

Do not add Program statistics, build editing, reordering, inventory, or content authoring controls unless already present and required elsewhere.

### 10.3 Overlay behavior

The character sheet:

- opens as a blocking overlay;
- pauses/blocks battle input consistently with existing modal behavior;
- has a clear close action;
- may also close through established outside-tap or normal back behavior if the UI framework supports it consistently;
- restores the previous battle input state without consuming a turn or changing selection/charge.

Opening or closing a sheet is not a combat event and should not alter deterministic game state.

---

## 11. Pause Menu

Move Pause to the top center between the avatar boxes.

The Pause menu must show current context:

```text
Quick Match
Run — Battle 1 of 4
Run — Battle 2 of 4
Run — Battle 3 of 4
Run — Battle 4 of 4
```

Requirements:

- remove character-sheet data from Pause;
- preserve existing Resume, Reset, Quit, and other valid current Pause actions unless explicitly incompatible;
- preserve existing stable-phase restrictions;
- Pause hitbox may not overlap avatar hitboxes;
- Reset in a Run restarts the current battle according to existing Reset semantics only if those semantics remain distinct from the wizard Restart Lost Battle action;
- any ambiguity between Reset, Restart Lost Battle, Restart Run, and Quit must be reported during Stage 1 rather than resolved through duplicate controls.

---

## 12. Bottom Status and Help Region

Reserve the lower margin for one compact contextual status/help line.

It may display:

- target-selection prompts;
- invalid-action messages;
- no-valid-target messages;
- no-match feedback;
- brief Function guidance;
- Shield reduction or similar immediate resolution feedback.

Requirements:

- this is not a persistent scrolling combat log;
- use short current-context messages;
- preserve existing message timing where suitable;
- higher-priority new messages replace or supersede lower-priority stale messages;
- target-selection instructions remain visible while targeting is armed;
- persistent Buff and Shield totals remain only in avatar boxes;
- the region must not overlap the square board or become a second result/metrics panel.

Use the existing notice/status mechanism if one exists. Do not add a generalized notification framework unless inspection proves the current mechanism cannot support this requirement.

---

## 13. Metrics, Logs, and Versioning

### 13.1 Build stamps

Update active build/version stamps to:

```text
alpha-0.2.0
```

Inspect browser logs, server JSONL, readable dumps, summaries, saves, smoke/batch headers, and production bundle metadata.

The only older build strings allowed in active source are deliberate compatibility fixtures or tests. Report them explicitly.

### 13.2 Mode and Run context

Relevant save, log, result, and battle-summary records must include:

- mode: Quick Match or Run;
- Run step when mode is Run;
- encounter System HP or stable encounter identity where useful;
- ordered Hacker Program IDs;
- ordered System Program IDs;
- natural battle outcome;
- wizard action when one occurs.

Do not add fake Run step values to Quick Match records.

### 13.3 Existing combat metrics

Preserve current per-battle combat metrics and attribution.

No Run-wide aggregate metrics UI is required.

Do not merge the four Run battles into one battle metric record. Each encounter remains a normal battle record with mode/step context.

### 13.4 Wizard logging

Wizard-forced progression and restart actions must be distinguishable from natural outcomes as defined in Section 5.4.

Do not report a wizard-forced progression as though the bot/player naturally won.

### 13.5 Server and browser logging boundaries

Preserve the established separation:

- combat events use the event-sourced combat stream;
- server-side development log operations remain development tooling;
- filesystem threshold and dump behavior remain server-side;
- logging failures may not interrupt gameplay.

Alpha 0.2.0 does not redesign logging storage.

---

## 14. Required Tests and Verification

Map tests to the repository's existing test style. Reuse fixtures and helpers rather than creating a parallel harness.

### 14.1 Mode and title tests

Verify:

- New Game is replaced by Quick Match.
- New Run exists.
- Continue is hidden with no valid save.
- Continue labels identify Quick Match or exact Run step.
- replacement confirmation appears only with a valid resident save;
- cancel preserves the save;
- confirm replaces it and starts the selected mode.

### 14.2 Run progression tests

Verify:

- Run starts at Battle 1.
- System HP is exactly `100`, `150`, `200`, and `250`.
- current resolved rosters are used in all four battles.
- Hacker starts each encounter at full configured HP.
- charge, Board-Shake, special objects, transient selection, and battle metrics reset each encounter.
- Battles 1–3 victories create the next fresh battle.
- Battle 4 victory creates Run Complete.
- Run defeat does not advance normally.
- terminal Run exit clears the save.
- Run Complete exit clears the save.

### 14.3 Save tests

Verify:

- one slot holds only one mode;
- Quick Match save restores Quick Match;
- each Run step saves and restores correctly;
- active battle restores deterministically;
- pending result modal restores without skipping progression;
- saved Run configuration remains authoritative;
- title settings do not mutate an existing Run;
- Program order round-trips;
- content fingerprint mismatch rejects safely;
- incompatible prior-version save rejects safely;
- replacement confirmation and clearing behavior are correct.

### 14.4 Wizard tests

Verify:

- Force Win is absent during active combat.
- Force Win appears on ordinary victory and defeat results.
- Force Win is absent on Run Complete.
- forced Run win advances correctly.
- forced Quick Match win terminates correctly.
- natural result and later wizard action are both retained in logs.
- Restart Lost Battle preserves step/config/HP target/rosters but creates a new board and RNG state.
- Restart Run creates a new Battle 1.
- drain-only withholding and other existing targeting behavior remain unchanged.

### 14.5 Program-order tests

Verify:

- authored order is stable;
- both sides render and serialize in that order;
- charge/readiness/cost changes do not reorder;
- order is included in relevant saves/logs;
- order has no charge-routing effect.

### 14.6 Layout and input tests

Where geometry can be tested headlessly, verify:

- board remains square;
- avatar, Pause, Program, board, and status bounds do not overlap incorrectly;
- Pause is centered between avatar regions;
- Hacker and System Program bounds are vertical and ordered;
- avatar hitboxes are distinct from top Program hitboxes;
- status/help region remains outside the board;
- representative narrow portrait dimensions remain valid.

### 14.7 Regression verification

Run the complete current repository verification suite, including as applicable:

```text
npm test
npm run smoke
npm run batch
npm run hpladder
npm run typecheck
npm run build
```

Do not remove or weaken existing tests merely to accommodate Alpha 0.2.0.

The batch and HP-ladder harnesses should continue to function as battle tools. They are not required to simulate the four-battle Run unless a small reuse of the new encounter controller is clearly beneficial and does not create scope.

### 14.8 Manual checks

Clearly distinguish manual checks from automated checks.

Required human/browser checks to request or report as remaining:

- Quick Match and New Run title flow;
- confirmation dialog;
- Continue labels and restoration;
- all four Run steps;
- natural defeat, Restart Lost Battle, Restart Run, and Run Complete;
- desktop mouse and mobile touch on avatar, Program, Pause, board, and targeting hitboxes;
- character-sheet overlays;
- Buff/Shield avatar indicators;
- bottom status/help line;
- narrow-device readability and board squareness.

Do not claim the agent personally completed physical mobile-touch or visual checks it could not actually perform.

---

## 15. Completion Standard

Alpha 0.2.0 is complete when:

1. Quick Match and New Run are distinct title modes.
2. One save slot resumes the correct mode, battle state, pending result, and Run step.
3. The four-battle Run uses the required HP sequence and fresh battle state.
4. Natural and wizard progression behave and log correctly.
5. Program order is stable across data, runtime, UI, save, and logs.
6. The battle layout presents Hacker and System as opposing vertical stacks.
7. Avatar status, character sheets, Pause, and bottom help regions work without hitbox conflict.
8. Existing combat, data validation, effects, targeting, persistence safeguards, metrics, logs, and headless tools remain behaviorally intact.
9. All required automated verification passes.
10. Remaining manual checks are identified honestly.
11. No remote repository, source-control write, or README action was performed.

---

## 16. Explicitly Out of Scope

Do not add:

- unique boss mechanics;
- Hacker selection;
- Deck selection;
- functional Build selection;
- inventory;
- rewards;
- random Program acquisition;
- Program reordering;
- build editing;
- charge overflow or trickle-down;
- neutral wildcard charging;
- persistent between-battle Effects or attrition;
- battlefields;
- map effects;
- branching routes;
- Quick Match random-build generation;
- sandbox battle setup;
- additional Program content;
- deterministic restart from the original battle seed or starting board;
- a card queue;
- a new generalized notification framework unless required after inspection and approved;
- a new generalized encounter-generation framework;
- an art/theme pass beyond clear whitebox layout and compact placeholders;
- README changes;
- Git commits, branches, tags, or remote repository operations.

---

# Part II — Two-Tier Implementation Workflow

## 17. Objective

The implementation must use a provisional two-tier division of labor:

- **Senior Developer:** heavier model for cross-cutting architecture, ambiguous state semantics, shared interfaces, framework changes, and final integration review.
- **Junior Developer:** lighter model for bounded iteration inside established frameworks, UI implementation against defined contracts, tests, fixtures, version updates, and administrative source changes other than README/source control.

The division below is provisional. The Senior Developer must inspect the codebase, refine the assignments, and explain any changes before implementation.

## 18. Token-Usage Optimization Objective

Efficient model-token use is an explicit project objective, but correctness and architectural coherence remain constraints.

The Senior Developer must lean toward delegating work to the Junior Developer when a task can be bounded by existing interfaces or by a concise interface established during senior foundation work.

However:

- senior analysis and task optimization also consume tokens;
- do not spend more senior-model effort refining a small task assignment than the likely delegation savings;
- do not split a tightly coupled feature merely to create Junior work;
- do not assign a Junior task that requires the Junior to rediscover the entire codebase;
- prefer concise task packets containing exact boundaries, dependencies, likely files/interfaces, acceptance criteria, and escalation triggers;
- batch related low-risk Junior work when doing so reduces repeated context loading;
- retain Senior ownership when hidden coupling, persistence semantics, event ordering, state ownership, or new framework design makes delegation likely to cause rework;
- during implementation, reclassify tasks when inspection changes the actual risk;
- the final Senior integration review is mandatory even when most implementation was delegated.

The optimization target is total development cost, not the percentage of tasks labeled Junior.

## 19. Classification Rules

Assign a task to Senior when it:

- changes shared state ownership or lifecycle;
- changes save envelopes, compatibility, result-state semantics, or deterministic restoration;
- introduces a new controller, state machine, abstraction, or cross-system interface;
- changes event ordering, progression semantics, or battle creation;
- touches several subsystems whose invariants must remain aligned;
- requires reconciliation between requirements and existing architecture;
- has a meaningful risk of silent data loss or gameplay regression.

Assign a task to Junior when it:

- follows an established UI, modal, serializer-field, event, test, or logging pattern;
- is isolated behind interfaces defined by Senior work;
- adds bounded rendering or hit-testing using a central layout contract;
- adds fixtures, tests, labels, version stamps, or small data tables;
- updates existing output/reporting fields without changing semantic ownership;
- has objective acceptance tests and limited cross-system impact.

## 20. Required Junior Escalation Triggers

A Junior Developer must stop and escalate when the assigned task unexpectedly requires:

- a new shared abstraction;
- changes to save compatibility or persistence ownership;
- changes to event-stream semantics or event ordering;
- changes to deterministic RNG ownership;
- changes to battle/result/progression lifecycle;
- changes across interfaces outside the task packet;
- a parallel implementation of logic already owned elsewhere;
- reinterpretation of an ambiguous requirement;
- weakening an existing test or invariant;
- modifying README or performing source-control operations.

Do not permit a Junior agent to silently work around a missing Senior interface.

---

## 21. Provisional Division of Labor

The Senior Developer must review and may reassign these tasks after code inspection.

### SENIOR-0 — Architecture inventory and assignment refinement

**Purpose:** Confirm the current implementation and refine this division before coding.

**Affected systems:** title flow, save model, battle creation, result modal, wizard controls, renderer layout, input routing, logs, metrics, tests.

**Deliverable:**

- current architecture map;
- requirement/code deviations;
- proposed state transitions;
- exact adjusted Senior/Junior split;
- dependencies and task order;
- expected token-saving rationale;
- risks and escalation points.

**Boundary:** No implementation code before user authorization.

---

### SENIOR-1 — Mode, Run, result, and save-state architecture

**Rationale:** This is the most cross-cutting Alpha 0.2.0 change. It affects state ownership, persistence, result lifecycle, deterministic restore, and title behavior.

**Responsibilities:**

- define typed mode discriminator;
- define Run state and encounter definitions;
- define active-battle versus pending-result state;
- define Run progression transitions;
- define terminal save clearing;
- define Quick Match compatibility;
- update save version/compatibility model;
- define Program-order serialization contract;
- expose narrow transition APIs for UI and wizard actions.

**Dependencies:** SENIOR-0.

**Acceptance:** Sections 3–7 and save/state tests can be implemented without UI code inventing progression logic.

**Escalation:** Any need to rewrite the Alpha 0.1 content pipeline or combat resolver must be reported before proceeding.

---

### SENIOR-2 — Battle creation and integration contract

**Rationale:** Fresh battle creation must preserve current combat/config/content invariants while applying Run encounter HP and progression context.

**Responsibilities:**

- centralize or extend battle creation for Quick Match and Run;
- ensure Run config snapshot and System HP override are applied correctly;
- preserve deterministic active-battle restore;
- reset only battle-local state between encounters;
- define context supplied to logs, metrics, and UI;
- ensure Board-Shake, Program content, timer charge, Drain, Effects, and metrics remain unchanged.

**Dependencies:** SENIOR-1.

**Acceptance:** A headless Run can create all four correct battle states without UI-specific logic.

---

### SENIOR-3 — Layout and input-region contract

**Rationale:** The new layout changes rendering and hit-testing across avatar, Pause, Program, board, and status regions. The framework/interface is cross-cutting; the visual implementation can be delegated.

**Responsibilities:**

- identify/extend the central layout calculation;
- define shared rectangles/regions consumed by render and input;
- define input priority;
- define safe interaction phases for Pause and character sheets;
- ensure square-board and narrow-portrait constraints;
- produce bounded interfaces for Junior UI implementation.

**Dependencies:** SENIOR-0; may proceed in parallel with SENIOR-1 if independent.

**Acceptance:** Junior tasks can render and hit-test without introducing separate coordinate logic.

---

### JUNIOR-1 — Title controls, Continue labels, and replacement confirmation

**Rationale:** Bounded UI work after SENIOR-1 exposes mode/start/replace APIs.

**Responsibilities:**

- rename New Game to Quick Match;
- add New Run;
- render contextual Continue labels;
- add save-replacement confirmation;
- wire controls only through Senior-defined APIs;
- add UI-focused tests.

**Dependencies:** SENIOR-1.

**Boundary:** No progression or save-clearing logic in title UI.

**Escalation:** Any missing mode transition must return to SENIOR-1.

---

### JUNIOR-2 — Run encounter table and result-control presentation

**Rationale:** The encounter values and result controls are explicit; lifecycle semantics come from Senior APIs.

**Responsibilities:**

- add explicit 100/150/200/250 encounter definitions if not completed by SENIOR-2;
- present Run battle context and Run Complete;
- add Restart Run, Force Win, and Restart Lost Battle controls;
- preserve current Quick Match result controls;
- wire actions through Senior transition APIs;
- distinguish wizard presentation.

**Dependencies:** SENIOR-1 and SENIOR-2.

**Boundary:** No direct save mutation or battle construction in modal code.

---

### JUNIOR-3 — Wizard event/log fields and version stamps

**Rationale:** Bounded extension of existing event/log patterns after Senior defines outcome semantics.

**Responsibilities:**

- add natural-result and wizard-action fields/events;
- add mode, Run step, encounter context, and Program order to required outputs;
- update active build stamps to `alpha-0.2.0`;
- add tests for stale tags and output context.

**Dependencies:** SENIOR-1 and SENIOR-2.

**Boundary:** Do not redesign event sourcing or logging storage.

**Escalation:** Any change to event ordering or causal metrics returns to Senior.

---

### JUNIOR-4 — Vertical battle layout and avatar/status rendering

**Rationale:** Rendering work should follow SENIOR-3's centralized layout contract.

**Responsibilities:**

- render avatar boxes;
- render vertical Hacker and System Program stacks in stable order;
- move Pause and board;
- render bottom status region;
- render side-general Buff and Shield totals;
- preserve square board and whitebox readability;
- add geometry tests where practical.

**Dependencies:** SENIOR-3 and Program-order contract from SENIOR-1.

**Boundary:** No independent hitbox coordinate calculations.

---

### JUNIOR-5 — Character-sheet overlays and Pause content

**Rationale:** Established modal patterns should make this bounded UI work.

**Responsibilities:**

- remove character-sheet data from Pause;
- open side-specific sheet from avatar;
- show strong/weak colors and shapes;
- implement close/back behavior;
- show mode/Run context in Pause;
- preserve interaction blocking and stable-phase rules;
- add input separation tests.

**Dependencies:** SENIOR-3.

**Boundary:** No combat-state mutation.

---

### JUNIOR-6 — Bottom status/help message integration

**Rationale:** This should iterate on the existing notice/message mechanism.

**Responsibilities:**

- position existing contextual feedback in the bottom region;
- support target prompts, invalid/no-target/no-match feedback, brief guidance, and immediate Shield notices;
- implement message priority/expiry using existing patterns;
- avoid persistent log behavior and Buff/Shield duplication.

**Dependencies:** SENIOR-3.

**Escalation:** If no suitable message mechanism exists and a new shared notification framework appears necessary, stop for Senior review.

---

### JUNIOR-7 — Focused tests and fixtures

**Rationale:** Testing is largely bounded after interfaces and state semantics are fixed.

**Responsibilities:**

- implement Sections 14.1–14.6 tests;
- extend save, mode, progression, wizard, order, geometry, and version fixtures;
- preserve all existing Alpha 0.1 tests;
- avoid weakening assertions;
- document remaining manual checks in the final report.

**Dependencies:** Relevant implementation tasks.

---

### SENIOR-4 — Integration review and final verification

**Rationale:** Mandatory cross-system verification after delegated work.

**Responsibilities:**

- review every Junior change for interface compliance;
- remove parallel logic or local workarounds;
- verify save/result/run transitions;
- verify deterministic restore;
- verify Program order consistency;
- verify UI state does not own game rules;
- run the full automated suite;
- inspect diffs for unrelated changes;
- confirm README and source control were untouched;
- produce the final report.

**Dependencies:** All implementation tasks.

**Boundary:** Do not commit, stage, push, or modify README.

---

# Part III — Coding Agent Execution Instructions

## 22. Stage 1 — Required inspection, task refinement, and authorization stop

The first coding-agent session must use the Senior Developer/heavier model.

Before writing implementation code, inspect and report:

1. Current title-screen controls, screen/state ownership, and start flow.
2. Current Quick Match/New Game creation path and configuration snapshot behavior.
3. Current save envelope, version, validation, content fingerprint, and restore path.
4. Whether result modals are represented in logic/save state or only UI state.
5. Current victory, defeat, Reset, Restart, Quit, and save-clearing semantics.
6. Current wizard/dev controls and their event/log behavior.
7. Current battle factory/constructor and how HP/config/rosters/RNG are supplied.
8. Current Program ordering source and whether validated dataset row order remains stable through resolution.
9. Every current serialization and log location that needs ordered Program IDs or mode/step context.
10. Current layout calculation, letterboxing, board bounds, Program rectangles, avatar/pause controls, and hit-testing.
11. Current character-sheet and Pause implementation.
12. Current notice/status/help mechanism.
13. Current Buff/Shield total derivation.
14. Current build/version stamp paths.
15. Existing tests and fixtures suitable for Sections 14.1–14.7.
16. Any conflict between this handoff and current code or Alpha 0.1.0 requirements.
17. Any requirement that would force unrelated refactoring.
18. The proposed exact state types and transition diagram for:
    - Quick Match active battle;
    - Quick Match pending result;
    - Run active battle;
    - Run pending result;
    - Run progression;
    - Run defeat;
    - Run Complete.
19. The proposed save compatibility decision for Alpha 0.1.0 saves.
20. A refined Senior/Junior assignment table with:
    - dependencies;
    - rationale;
    - affected systems;
    - implementation boundary;
    - acceptance criteria;
    - escalation triggers;
    - estimated reason delegation is or is not token-efficient.

### Assignment-review rule

Lean toward devolving tasks to the Junior Developer, but account for the Senior tokens spent on analysis, decomposition, supervision, and reintegration.

Do not perform a prolonged optimization exercise for obvious small tasks. Do not delegate a task if the expected context duplication and rework exceed the likely model savings.

**Stop after the inspection and refined assignment report. Wait for user authorization before implementation.**

Do not modify code, README, Git state, or any remote repository during Stage 1.

---

## 23. Stage 2 — Implementation after authorization

After authorization:

1. Complete Senior foundation tasks first.
2. Give Junior agents bounded task packets rather than the full repository problem.
3. Include exact interfaces, boundaries, likely files, tests, and escalation triggers in each Junior task.
4. Require Junior agents to stop on the escalation conditions in Section 20.
5. Reclassify tasks when actual coupling differs from the provisional plan.
6. Keep gameplay rules in logic/state layers, not renderer or modal callbacks.
7. Preserve the Alpha 0.1.0 data pipeline and combat model.
8. Implement only Alpha 0.2.0 scope.
9. Do not add speculative frameworks for future map, inventory, reward, routing, or build systems.
10. Do not perform any source-control write or remote action.
11. Do not modify README.
12. Finish with the mandatory Senior integration review.

---

## 24. Final Verification

Run the complete existing verification suite and all new focused tests.

At minimum, run when available:

```bash
npm test
npm run smoke
npm run batch
npm run hpladder
npm run typecheck
npm run build
```

If a command is unavailable or intentionally not applicable, report that explicitly.

Do not claim manual physical-device or visual checks that were not performed.

Do not create a commit even when all tests pass.

---

## 25. Final Report

Report:

- refined final Senior/Junior division used;
- tasks actually delegated and tasks reclaimed by Senior;
- meaningful token-optimization decisions;
- files changed;
- architecture and state transitions implemented;
- title and mode behavior;
- Run encounter/progression behavior;
- save version and compatibility behavior;
- pending-result restore behavior;
- Program-order authority and serialization;
- wizard controls and exact logging distinctions;
- battle layout and input-region implementation;
- character-sheet, Pause, avatar-status, and bottom-help behavior;
- build/version stamp updates;
- automated commands run and exact results;
- manual checks performed;
- manual checks still required;
- deviations from this handoff;
- issues discovered relative to Alpha 0.1.0 or the current code;
- known limitations;
- suggested README changes for the user to make, without editing README;
- confirmation that no source-control write, commit, remote operation, or README modification occurred.
