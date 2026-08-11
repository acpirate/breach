# Breach Alpha 0.6.0 — Coding Agent Handoff

**Build identity:** `alpha-0.6.0`

**Status:** Canonical implementation requirements and coding-agent instructions for Alpha 0.6.0.

**Primary objective:** Add HOST (`HST`) as a first-class environment source, UPGRADE (`UPG`) as persistent-in-Run reward state, and a unified PASSIVE (`PSV`) framework shared by Hacker, System, HOST, and UPGRADE content; add route choices that commit a `SYS + HST + UPG` encounter before the player edits the upcoming Build; preserve exact pending choices through save/resume; migrate the existing Hacker Skill behavior into PASSIVE semantics; implement the authored continual and START_OF_TURN PASSIVEs, including source attribution and BIGGER_BOMB; extend Constructed/Random Quick Match for HOST selection; preserve four-battle ICE progression; and fix the Normal LINK settings accordion behavior without adding bosses, permanent progression, System build editing, broad balance work, or speculative framework expansion.

---

# Part I — Authority, Inputs, and Working Method

## 0. Document authority

This document is the authoritative Alpha 0.6.0 implementation specification.

The coding agent will also receive the proposed Alpha 0.6 datasheets/reference material. Read this entire handoff and all supplied data/reference files before proposing or writing implementation code.

Use sources in this order:

1. **This Alpha 0.6.0 coding-agent handoff** for required behavior, resolved ambiguities, architecture boundaries, persistence rules, lifecycle ordering, and acceptance criteria.
2. **The supplied Alpha 0.6 runtime datasheets** for exact authored IDs, references, Program/Function content, PASSIVE rows, HOST rows, UPGRADE rows, values, ordering, and other authored gameplay data.
3. **The supplied dataset notes / Effect parameter notes** for field meanings, area-pattern context, and Effect parameter enumerations where this document does not narrow or override them.
4. Any supplied **gameplay-conventions** material as non-normative context only.
5. The current verified Alpha 0.5.0 repository implementation and tests.
6. Earlier Alpha handoffs only for behavior explicitly preserved here.
7. Older design/history/backlog material only as historical context.

### 0.1 Datasheet authority

The current Alpha 0.6 datasheets override conflicting older designer-handoff prose for exact authored content.

Do not “correct” current content back toward an older narrative example.

Explicit semantic decisions in this handoff override stale labels or wording in the supplied PDF/export where noted below.

### 0.2 Expected runtime datasets

Alpha 0.6 runtime content consists of nine required datasets:

1. Hacker Programs (`PRG_H`)
2. System Programs (`PRG_S`)
3. Functions (`FNC`)
4. Hackers (`HAK`)
5. Systems (`SYS`)
6. PASSIVEs (`PSV`)
7. Decks (`DEK`)
8. HOSTs (`HST`)
9. UPGRADEs (`UPG`)

The former general Skill dataset/terminology is replaced by PASSIVE for current runtime content.

The supplied notes PDFs are reference material, not executable runtime data.

### 0.3 Known supplied-document staleness

The proposed PDF may still show `SKILL` as the Hacker/System PASSIVE-reference column. The designer has already renamed those columns in the current datasheets.

For Alpha 0.6 the canonical Hacker/System field is **`PASSIVES`**.

Do not add a permanent `SKILL` compatibility alias merely because an older PDF export contains the stale header. If the actual runtime CSV supplied to the agent still uses `SKILL`, report that exact mismatch during Stage 1.

Similarly, the established Alpha 0.5 quantity rule remains authoritative even if older dataset notes still describe quantity as “number of deployments”:

> `quantity` means **up to this many valid targets** for the Effect resolution.

### 0.4 Fresh-context rule

Begin the build with a fresh coding-agent context and inspect the current repository rather than relying on stale assumptions from the Alpha 0.5 coding session.

### 0.5 One-agent execution model

There is **no Senior/Junior developer split**.

One heavy coding agent owns:

- repository inspection;
- implementation planning;
- architecture decisions within this specification;
- implementation;
- integration;
- tests and fixtures;
- manual verification where practical;
- README update;
- final diff review;
- commit;
- push;
- final report.

Do not introduce role-based task division or role-specific escalation language.

### 0.6 README and source control

The coding agent owns README and source-control completion for this build.

After implementation and the complete verification gate pass:

1. update `README.md` to describe the repository as actually shipped in Alpha 0.6;
2. inspect the final diff;
3. stage the intended build changes;
4. create a concise Alpha 0.6 build commit;
5. push the current branch to its configured upstream.

Do not commit a knowingly failing or partially verified build.

Do not force-push, rewrite published history, discard unrelated user work, or use destructive Git operations to resolve an ambiguous repository state.

If a safe normal push cannot complete, report the exact blocker and leave the verified local commit intact.

---

# Part II — Build Objective and Explicit Scope

## 1. Alpha 0.6 objective

Alpha 0.6 adds the next Run-structure layer while preserving the established combat architecture.

The completed build must:

1. Replace Skill as the general passive mechanic with the unified external `PSV` PASSIVE layer.
2. Allow HAK, SYS, HST, and UPG content to reference one or more PASSIVEs.
3. Preserve the exact former Hacker Red Skill behavior through migrated PASSIVE content.
4. Add HOST as a first-class environment/battlefield source rather than pretending HOST Effects are Hacker- or System-owned.
5. Add UPGRADE as persistent-in-Run reward state, always Hacker-owned.
6. Add a path-choice state before every Run Build.
7. Use fixed DOORMAN + THRESHOLD encounter identity for Battle 1 route offers while varying the offered UPGRADE.
8. Use randomized valid System + HOST + eligible UPGRADE packages for Battles 2–4.
9. Acquire the selected UPGRADE before opening the Build for the attached battle.
10. Preserve all acquired UPGRADEs for subsequent battles in that Run.
11. Prevent duplicate acquisition of an UPGRADE ID.
12. Preserve exact pending route offers across save/reload.
13. Commit/replace the active save when the initial Path Choice screen is entered, not when Battle 1 begins.
14. Add deliberate HOST selection to Constructed Quick Match before Build.
15. Add random HOST selection to Random Quick Match.
16. Do not add UPGRADE selection to Quick Match.
17. Preserve System `BASE_ICE + 0/50/100/150` Run progression.
18. Implement current continual PASSIVE semantics and START_OF_TURN carrier semantics.
19. Resolve HOST-triggered board Effects with HOST causal attribution but the active-turn agent as Sync-resolution owner where an agent owner is required.
20. Resolve ordered START_OF_TURN PASSIVEs before countdown ticking.
21. Invoke PASSIVE Function payloads without paying the Function cost.
22. Implement BIGGER_BOMB as named area-pattern progression.
23. Preserve duplicate PASSIVE stacking by source.
24. Attribute each PASSIVE contribution to the source that supplied it.
25. Extend persistence, content fingerprinting, logs, metrics, browser/headless parity, and UI for HST/UPG/PSV/path state.
26. Preserve Alpha 0.5 logging fixes and Alpha 0.4.1 BASIC/VERBOSE/COMPLETE storage behavior.
27. Fix the LINK/ICE Settings accordion so changing Normal Link never collapses an already-open accordion.
28. Reject incompatible Alpha 0.5 active saves cleanly rather than synthesizing HOST/UPGRADE/PASSIVE/path state.
29. Update README, commit, and push after verification.

## 2. Explicit exclusions

Do **not** implement in Alpha 0.6:

- boss mechanics;
- boss-specific route rules;
- boss selection;
- permanent account progression;
- rewards outside the Run-local UPGRADE layer;
- reward rarity/economy;
- a procedural map beyond the required two-option path screen;
- path branching history visualization beyond what is needed for current choice state;
- System build editing;
- HOST active abilities outside PASSIVEs;
- UPGRADE selection in Quick Match;
- PASSIVE anti-stacking rules;
- passive cooldowns;
- generalized trigger scripting;
- generalized rule scripting;
- multiple new activation event types beyond current data needs;
- large content expansion beyond supplied datasheets;
- broad numerical balance work;
- post-beta Function/Effect data-model refactoring;
- final art/audio/animation/accessibility polish.

Do not refactor Program → Function → Effect merely because PASSIVE can invoke a Function.

---

# Part III — Existing Alpha 0.5 Behavior to Preserve

## 3. Preserve established systems unless explicitly changed

Preserve the current verified Alpha 0.5 behavior including:

- shared browser/Node external-data parse/validate/resolve pipeline;
- one-leading-apostrophe spreadsheet-safe normalization;
- data-driven HAK/DEK/SYS identity;
- `BASE_ICE` System durability;
- derived weak color/shape complements;
- Hacker and Deck portfolios and six-Program Hacker inventory;
- four ordered active Hacker Programs;
- always-valid Build-state interaction;
- authored fixed System Program build/order;
- top-to-bottom charge overflow;
- color streams resolving before shape streams;
- owner-scoped charge;
- B1 combined direct-match footprint line clears;
- no recursive line-clear generation;
- Reinforced Connection semantics;
- Deck-owned SCRAMBLE;
- DATACUT and PLINK targeting;
- EFFECT_TRANSFORM behavior;
- atomic Transform followed by immediate Sync resolution;
- EBUFF delayed delivery;
- SPAM's intentional Bomb-generated charge;
- System dynamic Function phase and one-activation-per-Program cap;
- valid-target gating before automated Function activation;
- Drain targeting and gating;
- existing countdown ordering after turn-start additions specified here;
- Battle/Function/Effect attribution established in Alpha 0.5;
- Constructed Hacker build preference storage;
- one active save slot;
- BASIC/VERBOSE/COMPLETE logging levels;
- Alpha 0.4.1 browser logging budget/retention behavior;
- compact event classification and battle-level config joins;
- side-level total charge discard as authoritative routing waste;
- current battle layout and System-turn border/dimming;
- gameplay RNG isolation from setup/selection RNG.

Do not create parallel implementations of these systems.

---

# Part IV — Data Contracts

## 4. Shared parser rules

### 4.1 Spreadsheet-safe leading apostrophe

For every dataset cell:

1. if the raw cell begins with one apostrophe (`'`), remove exactly one leading apostrophe;
2. do not remove a second leading apostrophe;
3. do not remove embedded/trailing apostrophes;
4. trim;
5. then perform blank handling, enum/reference parsing, numeric conversion, tuple parsing, validation, resolution, and fingerprint normalization.

This remains one shared parser rule, not per-dataset special casing.

### 4.2 List conventions

Colon-delimited authored lists retain their established semantics.

- Preserve authored order where order is meaningful.
- Reject blank interior list tokens.
- Reject duplicate stable IDs where duplicate references are invalid within a single owning record.
- PASSIVE duplication across **different sources** is valid and stacks; this is not the same as accidentally repeating the same PASSIVE reference twice in one source list unless the actual supplied data intentionally does so.

## 5. PASSIVE dataset (`PSV`)

### 5.1 Required schema

Use the current authoritative datasheet. Expected fields are:

```text
PASSIVE_ID
passive_effect
params
activation
function_payload
applies_to
display
notes
```

Do not add a parallel `agent_scope` column in Alpha 0.6 if the runtime data uses `applies_to`. Internal resolved naming may be clearer, but there must be one source-of-truth field.

### 5.2 Stable IDs

- PASSIVE IDs use `PSV_` stable IDs.
- IDs must be unique.
- Unknown PASSIVE references are startup errors.

### 5.3 PASSIVE activation

Current supported activation values:

- `CONTINUAL`
- `START_OF_TURN`

Do not invent additional authored activation values for Alpha 0.6.

### 5.4 `applies_to`

Current supported agent-scope values:

- `OWNER`
- `ENEMY`

For HAK/SYS/UPG sources, `applies_to` is meaningful.

For HST sources, `applies_to` is ignored by design; HOST semantics are defined separately below.

### 5.5 Continual versus carrier rows

A continual PASSIVE participates in each relevant calculation while active. It does not repeatedly “fire” a Function.

A START_OF_TURN carrier uses its `function_payload` to invoke a Function at the specified trigger.

Current `PSV_CARRIER` behavior requires a valid Function payload.

PASSIVE-triggered Function invocation pays **no Function cost**.

The Function's own cost remains unchanged for normal Program/Deck activation.

A PASSIVE-triggered Function still uses the normal Function expansion/chaining and Effect execution machinery.

### 5.6 Manual-target limitation for triggered payloads

Current START_OF_TURN content must be executable without a new player target-selection pause.

If a PASSIVE-triggered Function plan requires unresolved manual Hacker target selection and the current architecture cannot auto-resolve it under existing targeting rules, treat that authored combination as unsupported Alpha 0.6 content and report/reject it rather than inventing a new asynchronous start-of-turn targeting flow.

Current supplied carrier Functions are expected to be auto-resolvable.

### 5.7 Presentation fields

`display` is presentation derived from validated semantics; it never defines gameplay rules.

`notes` is non-normative and excluded from gameplay fingerprinting.

If a current PASSIVE has a blank `display` but carries a Function payload, using the player-facing Function name as the compact identifier is acceptable for Alpha 0.6. Do not synthesize detailed prose from notes.

## 6. HAK/SYS PASSIVE references

The canonical HAK/SYS reference field is:

```text
PASSIVES
```

It is an ordered colon-delimited list of zero or more valid `PSV_*` IDs.

- Preserve authored order.
- Include gameplay-relevant reference order in the fingerprint.
- Migrate the existing Hacker Red passive rows from the old Skill architecture into PASSIVE without changing their established mechanics.
- Do not keep a second live Skill authority in parallel.

## 7. HOST dataset (`HST`)

Expected fields from the current data:

```text
HOST_ID,name,passives,display_text,graphics_ref,notes
```

Contracts:

- `HOST_ID`: required unique stable `HST_` ID.
- `name`: required player-facing identity; duplicate-name handling follows existing warning convention.
- `passives`: ordered zero-or-more `PSV_*` references.
- `display_text`: presentation-only; may be blank.
- `graphics_ref`: placeholder only; no new art-loading requirement.
- `notes`: non-normative.

HOSTs have no separate active-ability table in Alpha 0.6.

## 8. UPGRADE dataset (`UPG`)

Expected fields:

```text
UPGRADE_ID,name,passives,display_text,graphics_ref,notes
```

Contracts:

- `UPGRADE_ID`: required unique stable `UPG_` ID.
- `name`: required player-facing identity.
- `passives`: ordered one-or-more valid `PSV_*` references unless the supplied content intentionally defines a zero-passive placeholder; current runtime content is expected to be meaningful.
- `display_text`: presentation-only; may be blank.
- `graphics_ref`: placeholder only.
- `notes`: non-normative.

The runtime must contain at least **four valid UPGRADE rows**. Fewer than four is a blocking startup validation error.

## 9. Current authored content is authoritative

The current supplied Alpha 0.6 data includes the new DOORMAN System, HOSTs, UPGRADEs, PASSIVEs, and the GREENING/SNEAK Functions.

Use the actual supplied runtime data as exact authority.

The proposed material currently indicates, among other rows:

- `SYS_03 DOORMAN`
- `HST_01 THRESHOLD` with no PASSIVEs
- `HST_02 BITMIRE` → `PSV_003`
- `HST_03 ARENA` → `PSV_004`
- `HST_04 VERDUN` → `PSV_007`
- `HST_05 WEEDS` → `PSV_008`
- `UPG_01 BRACER` → `PSV_005`
- `UPG_02 GRACE` → `PSV_006`
- `UPG_03 L33TSK1LL` → `PSV_003`
- `UPG_04 SNEAKERS` → `PSV_009`
- `FNC_016 GREENING` → `EFFECT_TRANSFORM`
- `FNC_017 SNEAK` → `EFFECT_TRANSFORM`

If the final supplied CSV differs, use the CSV unless it conflicts with an explicit semantic requirement here.

### 9.1 Axis-token sanity check

PASSIVE axis qualifiers must use the existing canonical axis-token enum used by runtime gameplay data.

The proposed PDF showed `YELLOW:1` for `PSV_006` while established content commonly uses `YEL`.

During Stage 1, inspect the **actual supplied runtime PSV data** and the parser enum. If the supplied value is not a valid canonical token, report the content/schema mismatch rather than silently creating a one-off alias solely to accept a stale export.

## 10. Content fingerprint

The Alpha 0.6 gameplay-content fingerprint must include gameplay-relevant new content, including at minimum:

- HAK/SYS ordered PASSIVE references;
- PASSIVE `passive_effect`;
- typed/normalized PASSIVE params;
- activation;
- function payload reference;
- `applies_to` where semantically used;
- HST ordered PASSIVE references;
- UPG ordered PASSIVE references;
- current gameplay-relevant SYS/HST/UPG IDs/references needed to validate persisted route state;
- any changed Function/Effect values from the supplied runtime data.

Exclude presentation-only values such as:

- display strings;
- names where names are already presentation-only under current fingerprint policy;
- HST/UPG `display_text`;
- graphics refs;
- BIO;
- notes.

Do not invalidate saves because punctuation or flavor copy changed.

---

# Part V — PASSIVE Runtime Model

## 11. PASSIVE instance identity and stacking

A PASSIVE instance is not identified solely by `PASSIVE_ID`.

Runtime attribution must preserve the source that supplied it, e.g. conceptually:

```text
source kind: HAK | SYS | HST | UPG
source id:   HAK_01 / SYS_... / HST_... / UPG_...
passive id:  PSV_...
```

Equivalent internal representation is acceptable.

PASSIVEs stack by source.

Examples:

- HAK and HST both supply `PSV_003`: both instances apply.
- two acquired UPGRADEs supply the same PASSIVE: both apply.
- SYS and HST supply the same PASSIVE: both apply.

Do not deduplicate active PASSIVEs by `PASSIVE_ID` across sources.

## 12. Agent ownership

Agent-owned PASSIVEs come from:

- Hacker identity;
- System identity;
- UPGRADEs.

UPGRADEs are always Hacker-owned.

For agent-owned PASSIVEs:

- `OWNER` means the owning agent;
- `ENEMY` means the opposing agent.

## 13. HOST ownership

HOST is a first-class causal source.

Do not label HOST-triggered Functions/Effects as Hacker- or System-owned merely to reuse old source types.

For HOST-owned PASSIVEs:

- ignore the authored `applies_to` field;
- continual global modifiers apply symmetrically to both agents where the PASSIVE type is agent-relative;
- START_OF_TURN triggers occur at the start of each agent's turn;
- triggered Function/Effect **causal source** remains HOST / HST PASSIVE.

## 14. HOST-created Sync ownership

Some HOST-triggered Effects change the board and can create immediate Syncs. A Sync still needs an agent resolution owner for damage profile, charge routing, and agent-specific PASSIVE logic.

For a HOST-triggered board Effect executing at START_OF_TURN:

- **causal source:** HOST / the exact HST and PASSIVE instance;
- **Sync resolution owner:** the agent whose turn is beginning.

Therefore:

- a WEEDS/GREENING trigger at Hacker turn start creates Hacker-owned Sync consequences if it creates Syncs;
- the same HOST trigger at System turn start creates System-owned Sync consequences;
- damage profile, target, charge routing, and owner-scoped PASSIVEs follow that resolution owner;
- logs/metrics still preserve HOST as the causal source of the transformation.

Do not collapse causal source and resolution owner into one field if doing so loses either fact.

## 15. START_OF_TURN ordering

At the beginning of every agent turn, resolve in this order:

1. HOST START_OF_TURN PASSIVEs.
2. Active agent identity START_OF_TURN PASSIVEs.
3. Hacker UPGRADE START_OF_TURN PASSIVEs in **UPGRADE acquisition order** when the active agent is Hacker.
4. Within one source record, PASSIVEs resolve in authored PASSIVE-reference order.
5. After all relevant START_OF_TURN PASSIVEs fully resolve, tick/resolve countdown objects.
6. Continue the established normal turn flow.

Each triggered PASSIVE Function resolves completely—including Effect resolution, immediate Syncs, cascades, damage, and charge—before the next START_OF_TURN PASSIVE begins.

If normal terminal battle resolution occurs during one of these effects, honor the established terminal-state rules rather than continuing to mutate a finished battle.

## 16. PASSIVE Function cost

A Function invoked by PASSIVE trigger pays no listed Function cost.

- Do not require a Program charge pool.
- Do not decrement a Program/Deck pool.
- Do not treat `startCharged` as relevant to the PASSIVE trigger.
- A composite Function invoked through a PASSIVE likewise pays no parent or child Function cost; preserve existing one-level Function expansion semantics.

Log the Function and PASSIVE source even though no cost is paid.

---

# Part VI — Continual PASSIVE Semantics

## 17. `PSV_EXTRA_MATCH_DAMAGE`

Migrate the established Hacker Red behavior without mechanical change.

For a qualifying axis Sync event:

- apply once per resolved qualifying axis blob/event, not per Packet or hidden line component;
- require the qualifying **axis match**, not merely a moved Packet of that color;
- shape-only Syncs do not trigger a color-qualified PASSIVE;
- overlapping cross-axis destruction does not suppress a valid qualifying color-axis trigger;
- distinct qualifying blobs trigger independently;
- owner/scoped semantics determine which agent's Sync qualifies.

Damage-order behavior remains the established Alpha rule:

- add the PASSIVE bonus to raw Sync damage before critical multiplier/flooring and subsequent Buff/Shield processing;
- preserve source-specific PASSIVE attribution in metrics/logs;
- under Reinforced Connection, base Sync damage is suppressed but match-triggered PASSIVE/Function effects remain active under the existing interpretation.

Duplicate instances stack additively.

## 18. `PSV_EXTRA_MATCH_CHARGE`

For each qualifying axis Sync charge stream:

- add the PASSIVE amount to the generated stream before queue routing;
- do not create a separate pool for each compatible Program;
- do not grant the amount independently to every bound Program;
- preserve the established color-before-shape routing order;
- cascades use the same rule.

Duplicate instances stack additively.

## 19. `PSV_CHARGE_DAMPEN`

Current params such as `ALL:1` reduce qualifying Sync charge streams.

For each stream, calculate:

```text
finalGenerated = max(0, baseGenerated + all applicable extra-charge bonuses - all applicable dampening)
```

Then route `finalGenerated` through the established top-to-bottom charge queue.

This formula is order-independent.

For an agent-owned PASSIVE with `ENEMY`, dampening applies to the opponent's qualifying streams.

For a HOST-owned instance, ignore `applies_to` and apply the modifier to both agents' qualifying streams.

Log enough information to distinguish base stream, each PASSIVE adjustment, final generated amount, assignments, and discard when the route is retained by the existing logging policy.

## 20. `PSV_FUNCTION_DAMAGE_INCREASE`

For current params such as `ALL:2`:

- `ALL` means all qualifying Function-originated direct damage instances for the affected agent/source scope;
- add the PASSIVE amount to raw Function damage before ordinary Buff/Shield defensive processing;
- multiple applicable instances stack additively;
- preserve the original Function/Effect as the base damage source;
- record each PASSIVE's incremental contribution separately enough for source attribution.

This applies to Program Functions, Deck Functions, and PASSIVE-triggered Functions when they generate qualifying Function damage and the modifier's scope applies.

Under HOST ownership the modifier applies symmetrically to both agents' qualifying Function damage.

## 21. `PSV_PERM_SHIELD`

For current params such as `ALL:1`:

- treat the PASSIVE as non-removable Shield value for the affected agent;
- add it to the live Shield amount used against every qualifying incoming damage instance;
- stack it with existing Packet-based Shield value;
- apply existing Shield timing/order and minimum-zero behavior;
- it cannot be sliced because it is not a Packet special;
- it remains active as long as the supplying PASSIVE instance is active;
- include the effective permanent contribution in player-facing Shield total where Shield total is displayed.

Metrics must preserve actual prevention attributable to PASSIVE Shield separately from removable Packet Shield where practical under the existing damage-prevention event model.

Synthetic tests should cover overlap between permanent and Packet Shield even if current authored content rarely stacks them.

## 22. `PSV_BIGGER_BOMB`

BIGGER_BOMB applies to every qualifying `EFFECT_BOMB` operation that has an `areaPattern`, regardless of which Function invoked it.

This includes, where applicable:

- normal Bomber;
- E-Bomber;
- SPAM;
- ONEBOMB;
- PLINK;
- chained Functions;
- future PASSIVE-triggered Functions using `EFFECT_BOMB`.

### 22.1 Named pattern progression

Use the existing named area-pattern registry/catalog as the authority.

Order patterns by their canonical nominal unobstructed footprint size/order already represented by the area catalog; do not implement mathematical radius growth and do not create a second independent pattern catalog in UI code.

Each active BIGGER_BOMB PASSIVE instance advances the effective pattern by one named step.

- edge clipping does not change the step;
- multiple instances advance multiple steps;
- saturation occurs at the largest registered named Bomb-compatible area pattern.

### 22.2 Delayed Bomb persistence

For countdown Bombs, resolve the effective upgraded pattern at placement/arming time and preserve/stamp the effective pattern on the delayed object using the established delayed-payload contract so save/resume and later detonation remain deterministic.

Immediate Bomb Effects use the effective upgraded pattern immediately.

BIGGER_BOMB changes area only; it does not silently change quantity, countdown, damage, targeting, or gain-charge tuple values.

---

# Part VII — Carrier PASSIVEs and Transform Behavior

## 23. `PSV_CARRIER`

A START_OF_TURN carrier invokes its authored `function_payload` under the PASSIVE execution rules.

Current content includes carriers such as:

- HOST WEEDS → GREENING;
- UPGRADE SNEAKERS → SNEAK.

The triggered Function's normal cost is ignored.

The triggered Function otherwise uses the existing Function/Effect contract, valid-target checks, targeting policy, atomic resolution, immediate Sync resolution, causal attribution, and cascade behavior.

## 24. GREENING/SNEAK Transform semantics

Preserve Alpha 0.5 `EFFECT_TRANSFORM` semantics.

- `quantity` means up to this many valid targets.
- random targeting consumes the appropriate non-gameplay/Effect RNG already established for battle logic; do not introduce UI targeting.
- `axisTarget=ANY` means any valid Packet axis target under the existing Transform contract.
- an `axisResult` containing only a color changes only the color axis and preserves shape;
- an `axisResult` containing only a shape changes only the shape axis and preserves color;
- an authored color+shape pair changes both;
- special-Packet treatment follows the typed Transform tuple;
- all selected transformations in one Effect are applied atomically;
- detect Syncs once after the atomic transformation;
- generated Syncs resolve immediately.

For HOST carriers, Section 14 determines Sync-resolution owner.

For UPGRADE carriers, the Hacker is both agent owner and Sync-resolution owner.

---

# Part VIII — HOST and UPGRADE Presentation

## 25. HOST visibility

HOST must be visible enough that its encounter effect is understandable during testing.

Minimum whitebox requirement:

- path choices show HOST name;
- Constructed Quick Match HOST Selection shows every valid HOST;
- Build/battle context exposes the currently committed HOST name and its resolved PASSIVE identities/displays through a compact existing or minimally extended information surface;
- no new art system or third avatar composition is required.

Reuse existing identity/inspection patterns where practical.

A HOST with no PASSIVEs, such as THRESHOLD, must still be a valid selectable/displayable HOST.

## 26. UPGRADE visibility

Minimum whitebox requirement:

- each path choice shows the offered UPGRADE name;
- where a PASSIVE has a nonblank display, render the resolved PASSIVE display;
- for a carrier with blank PASSIVE display, showing the payload Function name is sufficient for Alpha 0.6;
- pre-battle Build/Run context must provide a compact list of already acquired UPGRADE names so the player/tester can verify persistent Run state;
- no inventory rarity, art, economy, or detailed description system is required.

Do not use `notes` as player-facing copy.

---

# Part IX — Run Route State and Flow

## 27. Canonical Run flow

The resolved Alpha 0.6 Run flow is:

```text
Title
→ New Run
→ Hacker Selection
→ Deck Selection
→ Initial Path Choice
→ Build
→ Battle 1
→ Result
→ Path Choice
→ Build
→ Battle 2
→ Result
→ Path Choice
→ Build
→ Battle 3
→ Result
→ Path Choice
→ Build
→ Battle 4
→ Result / Run Complete
```

This explicitly overrides older wording that placed the initial Build before the first Path Choice.

The player knows the committed `SYS + HST + UPG` package before editing the Build for that battle.

## 28. New-Run persistence commitment boundary

The existing resident save remains untouched while the player is still on Hacker Selection or Deck Selection.

When the player advances from setup into the **initial Path Choice screen**:

1. create/commit the new Run;
2. replace the previous active save;
3. generate the two initial route offers;
4. persist those exact offers immediately;
5. enter `PENDING_PATH` (or equivalent) Run state.

This is the Alpha 0.6 destructive commitment boundary.

Do not add a second “pending new Run” persistence store outside the single active save merely to preserve the older Battle-1-start commit boundary.

## 29. Initial path offers

For Battle 1, both paths use:

- System: `DOORMAN` / the exact current DOORMAN `SYS_ID` from the supplied data;
- HOST: `THRESHOLD` / the exact current THRESHOLD `HST_ID`;
- UPGRADE: randomly chosen from currently eligible UPGRADEs.

The two offered UPGRADE IDs must be distinct whenever at least two eligible UPGRADEs remain.

The only intended encounter difference between the initial two paths is the UPGRADE.

## 30. Later path offers

After Battles 1, 2, and 3 are won or successfully Force-Win overridden:

- create two path choices for the next battle;
- each contains one valid System, one valid HOST, and one eligible UPGRADE;
- System and HOST are independently randomized under the constraints below;
- no boss-specific Battle 4 exception exists.

### 30.1 Encounter-pair duplication

Within one two-path offer, avoid two identical `SYS_ID + HST_ID` combinations whenever another valid combination exists.

It is valid for:

- both paths to share the same System if HOST differs;
- both paths to share the same HOST if System differs;
- a later battle to repeat a prior battle's System or HOST.

Do not add shuffle-bag/no-repeat policy beyond this requirement.

### 30.2 UPGRADE eligibility

Eligible UPGRADEs are valid UPGRADE rows not already acquired in the current Run.

Offer distinct UPGRADE IDs within one screen whenever the eligible pool has at least two distinct IDs.

If only one eligible UPGRADE remains, both paths may show that same UPGRADE.

## 31. Four-UPGRADE exhaustion edge case

The current content deliberately has four UPGRADEs and four acquisition decisions.

Therefore before Battle 4 there is intentionally only one unacquired UPGRADE left.

Required behavior:

- both final path cards may show the same remaining UPGRADE;
- choosing either card acquires that UPGRADE exactly once;
- the duplicated offer is not a validation error;
- the path log records that duplicate display occurred because of pool exhaustion.

## 32. Path selection commit

Selecting a path is immediate and final for that battle.

On selection:

1. add the selected UPGRADE ID to the acquired list if not already present;
2. make its PASSIVE instances active immediately;
3. commit the selected System ID;
4. commit the selected HOST ID;
5. preserve the selected path/offer identity for logging;
6. transition to the pre-battle Build state;
7. apply the UPGRADE to the upcoming battle and every later battle in the Run.

Do not allow the selected path to be changed by Back navigation after commitment.

## 33. Build after route selection

The Build screen opens only after the encounter package is committed.

### Battle 1

- open with the normal default Hacker build for a new Run;
- show enough committed System/HOST/UPGRADE context for the player to edit knowingly.

### Battles 2–4

- carry the current Hacker build/order forward from the previous battle unless the player edits it;
- show the newly committed System/HOST and acquired UPGRADE list.

Save and Quit from a Run Build remains resumable.

## 34. Retry and Restart behavior

### 34.1 Retry after defeat

Retrying the same lost battle:

- preserves the already committed System;
- preserves the already committed HOST;
- preserves all acquired UPGRADEs;
- does not generate a new path;
- does not acquire another UPGRADE;
- returns through the pre-battle Build for that same encounter according to the existing retry flow.

### 34.2 Force Win

Preserve existing Force Win semantics:

- defeat override advances as a win;
- after Battles 1–3 it proceeds toward the next Path Choice;
- after Battle 4 it completes the Run;
- Force Win on a natural victory has no progression effect beyond wizard logging.

### 34.3 Full Run restart

A true Restart Run clears Run-local path/UPGRADE progression and reinitializes the Run according to the established restart intent.

It must not retain acquired UPGRADEs from the abandoned/restarted Run.

Do not confuse same-battle retry with full Run restart.

## 35. Route RNG

Route/setup randomness must remain isolated from gameplay RNG.

Use/reuse an isolated setup/route RNG mechanism.

Persist enough route RNG state—or otherwise preserve the existing deterministic setup-randomness contract—so save/reload cannot accidentally perturb future route generation compared with an uninterrupted Run.

At minimum:

- pending offers are saved exactly and never rerolled on reload;
- generating route choices does not consume gameplay RNG;
- Random Quick Match System/HOST/build selection does not consume gameplay RNG.

---

# Part X — ICE and Encounter Identity

## 36. Run ICE progression

Preserve:

```text
Battle 1: selected System BASE_ICE + 0
Battle 2: selected System BASE_ICE + 50
Battle 3: selected System BASE_ICE + 100
Battle 4: selected System BASE_ICE + 150
```

HOST and UPGRADE do not alter this progression unless a future explicit PASSIVE type does so; no current Alpha 0.6 content should invent an ICE-scaling rule.

Normal Link manual-override behavior remains as established unless current code already applies the manual System ICE override to Run battles; preserve the existing setting contract rather than creating a new one.

---

# Part XI — Quick Match

## 37. Constructed Quick Match flow

Constructed Quick Match must allow deliberate System and HOST testing before Build.

Canonical minimum flow:

```text
Constructed Quick Match
→ Hacker Selection
→ Deck Selection
→ System Selection
→ HOST Selection
→ Build
→ Battle
```

Equivalent integration into existing selection screens is acceptable only if all required deliberate choices remain explicit and System/HOST are known before Build.

No UPGRADE selection appears in Constructed Quick Match.

The existing remembered Constructed Hacker build preference remains independent of Run progression.

## 38. HOST Selection screen

Show every valid HOST definition.

Minimum content:

- HOST name;
- resolved PASSIVE display/function-name fallback sufficient to understand current whitebox behavior;
- explicit Choose/Done/Continue action;
- normal Back navigation within the Constructed setup flow.

Do not implement graphics-ref loading.

## 39. Random Quick Match

Random Quick Match:

- automatically chooses a valid Hacker/Deck under the existing default/random context;
- automatically chooses a valid System;
- automatically chooses a valid HOST;
- generates/uses the existing random valid Hacker build behavior;
- does not acquire or apply UPGRADEs;
- does not open System/HOST/Build selection screens unless existing Random Quick Match already does so for some unrelated reason;
- logs selection source and final resolved IDs;
- does not perturb gameplay RNG.

---

# Part XII — Save and Resume

## 40. Save version

Bump active save/game schema/version as required for Alpha 0.6.

Alpha 0.5 active saves are incompatible because they cannot faithfully represent:

- PASSIVE authority after Skill migration;
- HOST identity;
- acquired UPGRADEs;
- pending route offers;
- committed path package;
- new PASSIVE-derived state/attribution.

Reject Alpha 0.5 active saves cleanly through the established incompatible-save path.

Do not synthesize THRESHOLD/no-UPGRADE state into an in-progress Alpha 0.5 battle.

## 41. Run save state

An Alpha 0.6 Run save must preserve, as applicable:

- selected Hacker ID;
- selected Deck ID;
- Hacker inventory/build/order;
- current battle number/Run step;
- acquired UPGRADE IDs in acquisition order;
- current committed System ID;
- current committed HOST ID;
- selected path identity/details needed for audit;
- pending route offers when in Path Choice state;
- exact offered System/HOST/UPGRADE IDs for both paths;
- duplicate-UPGRADE-offer exhaustion flag/context when applicable;
- pre-battle Build state;
- active battle state;
- pending result state;
- active PASSIVE-derived state that cannot be deterministically recomputed from content + Run state;
- countdown/special state as already established;
- isolated route/setup RNG state if needed for deterministic continuation;
- gameplay RNG state;
- content fingerprint/version fields.

## 42. New pending path phase

Add or extend the Run phase model with an explicit saved pending-route state, conceptually `PENDING_PATH`.

A pending-path save has no active battle and must restore the exact same offers.

Do not encode pending path choices as UI-only transient state.

## 43. UPGRADE duplication validation in saves

A persisted Run acquired-UPGRADE list containing the same `UPGRADE_ID` more than once is invalid.

Reject incompatible/corrupt active saves rather than silently deduplicating them.

## 44. Quick Match save

An active Quick Match save must preserve selected System and HOST identity and all existing active-battle state.

Quick Match has no UPGRADE list in Alpha 0.6.

The separate Constructed Hacker-build convenience preference remains versioned/revalidated under its existing boundary.

---

# Part XIII — Logging and Metrics

## 45. Preserve Alpha 0.4.1 logging architecture

Do not regress:

- BASIC default in production;
- VERBOSE default in development;
- COMPLETE opt-in detail;
- event-stream promotion;
- battle-static joins by `battleId`;
- content-stamp deduplication;
- pre-write trimming;
- storage budget;
- bounded quota failure handling;
- current compact-export fixes;
- current side-level total charge-discard metrics.

Do not create a parallel PASSIVE/path logging system.

## 46. Route logging

Record enough structured information to reconstruct every offered and selected path.

At minimum:

- Run ID / battle context;
- target battle number;
- offer-generation event;
- both offered path indexes/IDs;
- each offered `SYS_ID`;
- each offered `HST_ID`;
- each offered `UPGRADE_ID`;
- whether UPGRADE duplication occurred due to pool exhaustion;
- selected path;
- selected `SYS_ID`;
- selected `HST_ID`;
- selected `UPGRADE_ID`;
- acquired-UPGRADE list after commitment.

Do not log abandoned hover/modal noise.

## 47. PASSIVE source attribution

For PASSIVE effects, retain:

- `PASSIVE_ID`;
- source kind (`HAK`/`SYS`/`HST`/`UPG` or equivalent);
- source stable ID;
- affected agent/side where relevant;
- activation type;
- payload Function ID where relevant;
- numeric contribution where relevant;
- causal source versus Sync-resolution owner when they differ.

If multiple PASSIVEs modify one calculation, do not collapse them into an unexplained aggregate.

## 48. Numeric modifier attribution

The base event remains attributed to its original mechanism/source.

Examples:

- Function damage remains Function/Effect damage, with separate PASSIVE increment contribution records/fields.
- Sync damage remains Sync damage, with PASSIVE contribution attributable to the relevant source.
- charge routing remains routing, with individual bonus/dampening adjustments traceable before the final generated stream.
- Shield prevention should distinguish permanent PASSIVE Shield contribution from Packet Shield where the current event model supports it.

Metrics totals must still reconcile to final gameplay totals.

## 49. HOST carrier attribution

When WEEDS/GREENING causes a Sync at Hacker turn start, logs must be able to say both:

- HOST/WEEDS/GREENING caused the transformation;
- Hacker owned the resulting Sync consequences.

The analogous System-turn case must preserve System Sync ownership.

## 50. Legacy logging remediation

The Alpha 0.5 report indicated the compact-event, `cfg[missing]`, and charge-waste issues were fixed.

Preserve those fixes.

If current repository inspection shows any of them remain or regressed, fix the root cause rather than merely hiding the symptom.

---

# Part XIV — Settings UX Fix

## 51. Normal Link accordion state

When the LINK/ICE Settings accordion is currently open and the user toggles **Normal Link**:

- toggling OFF must leave the accordion open;
- toggling ON must leave the accordion open;
- enabled/disabled input state updates in place;
- no rerender may reset/collapse that accordion merely because the checkbox value changed.

This must work in both directions.

The OFF case is especially important because the newly enabled manual LINK/ICE inputs should remain immediately visible.

Do not broadly redesign Settings.

---

# Part XV — Validation Rules

## 52. Required startup validation

Extend the existing collect-all validation pipeline.

At minimum validate:

### PASSIVE

- required PSV dataset/header;
- unique valid `PSV_*` IDs;
- recognized passive-effect names;
- typed params per passive effect;
- valid activation enum;
- valid `applies_to` enum where applicable;
- required/forbidden `function_payload` combinations by current passive type;
- Function payload references resolve;
- START_OF_TURN payloads are executable under current noninteractive trigger constraints;
- malformed display placeholders warn/error under the existing template policy without becoming gameplay semantics.

### HAK/SYS

- `PASSIVES` references resolve;
- old stale `SKILL` header is not silently treated as equivalent unless explicitly authorized after Stage 1 conflict report;
- ordered PASSIVE references preserved.

### HOST

- unique `HST_*` IDs;
- PASSIVE references resolve;
- zero-PASSIVE HOST is valid.

### UPGRADE

- unique `UPG_*` IDs;
- PASSIVE references resolve;
- at least four valid UPGRADE rows exist.

### Route/save

- pending route components reference valid SYS/HST/UPG IDs;
- acquired UPGRADE IDs resolve;
- no duplicate acquired UPGRADE IDs;
- committed encounter IDs resolve;
- pending route choices are structurally complete;
- content fingerprint matches.

Do not infer or silently repair invalid references.

## 53. PASSIVE typed contracts

Reuse the existing typed Skill/Effect contract philosophy rather than parsing strings ad hoc at runtime.

At startup resolve each PASSIVE to typed configuration appropriate to its passive effect.

Current expected passive effects include:

- `PSV_EXTRA_MATCH_DAMAGE`
- `PSV_EXTRA_MATCH_CHARGE`
- `PSV_CHARGE_DAMPEN`
- `PSV_FUNCTION_DAMAGE_INCREASE`
- `PSV_PERM_SHIELD`
- `PSV_BIGGER_BOMB`
- `PSV_CARRIER`

Do not build a generalized expression or scripting language.

---

# Part XVI — Required Automated Coverage

## 54. Content and validation tests

Add focused tests for at least:

1. all nine required datasets load through the shared pipeline;
2. leading-apostrophe normalization still works for new PSV/HST/UPG fields;
3. PASSIVE IDs/refs validate;
4. HST/UPG IDs/refs validate;
5. HAK/SYS `PASSIVES` refs validate;
6. stale/malformed reference failures are blocking;
7. fewer than four UPGRADE rows fails validation;
8. presentation-only fields do not change the gameplay fingerprint;
9. gameplay-relevant PASSIVE/HST/UPG changes do change the fingerprint;
10. actual current axis tokens used by PSV params validate under the canonical enum.

## 55. PASSIVE migration tests

Verify the former Hacker Skill behavior remains mechanically identical through PASSIVE migration:

- Red axis only;
- shape-only does not trigger;
- merged Red blob triggers once;
- distinct qualifying blobs trigger independently;
- System-owned Syncs do not trigger Hacker OWNER PASSIVE;
- duplicate source instances stack;
- match-damage ordering remains unchanged;
- charge-stream bonus semantics remain unchanged.

## 56. Continual PASSIVE tests

At minimum verify:

1. charge bonus + dampening combine additively and floor at zero;
2. routing occurs only after final stream amount is computed;
3. HOST dampening applies to both agents;
4. UPGRADE ENEMY dampening affects System, not Hacker;
5. Function damage increase adds before Buff/Shield handling;
6. multiple Function-damage PASSIVEs stack;
7. permanent Shield stacks with Packet Shield and is not sliceable;
8. Shield display/effective total includes permanent Shield;
9. BIGGER_BOMB advances one named pattern step;
10. multiple BIGGER_BOMB instances advance multiple steps and saturate;
11. BIGGER_BOMB applies to different EFFECT_BOMB Function sources;
12. delayed Bomb stores/restores the effective upgraded area pattern.

## 57. START_OF_TURN tests

Verify:

1. HOST START_OF_TURN triggers once at Hacker turn start;
2. HOST START_OF_TURN triggers once at System turn start;
3. active agent identity trigger follows HOST triggers;
4. Hacker UPGRADE triggers follow Hacker identity triggers in acquisition order;
5. authored PASSIVE order within one source is respected;
6. each triggered Function fully resolves before the next passive;
7. all START_OF_TURN triggers resolve before countdown ticking;
8. PASSIVE Function cost is not paid;
9. no Program/Deck charge pool is mutated solely to pay a PASSIVE-triggered Function;
10. sliced delayed object still fails to deliver under existing countdown rules;
11. terminal battle state stops inappropriate further turn-start mutation.

## 58. HOST causal-source tests

Verify:

- HOST-triggered Transform retains HOST/HST/PSV causal attribution;
- Hacker-turn generated Sync is Hacker-owned for damage/charge;
- System-turn generated Sync is System-owned;
- source and resolution owner survive event/log serialization;
- owner-scoped PASSIVEs evaluate against the resolution owner, not the HOST causal source.

## 59. Route generation tests

Required:

1. initial offers always use DOORMAN + THRESHOLD;
2. initial two UPGRADEs are distinct when at least two eligible remain;
3. entering initial Path Choice commits/replaces the active save and stores offers;
4. reloading pending initial choice does not reroll;
5. selecting a path acquires its UPGRADE before Build/Battle 1;
6. selected UPGRADE applies to Battle 1;
7. acquired UPGRADE persists into later battles;
8. acquired UPGRADE is removed from future eligible pool;
9. Battles 2–4 route offers use valid randomized SYS/HST combinations;
10. exact duplicate SYS+HST pair is avoided within one offer when alternatives exist;
11. later encounters may repeat prior Systems/HOSTs;
12. pending choices save/restore exactly;
13. one remaining UPGRADE may appear on both final paths;
14. selecting either duplicate-offer path acquires it once;
15. acquired list remains unique and ordered;
16. route generation does not consume gameplay RNG;
17. save/reload does not alter later route RNG behavior under the chosen isolated RNG design.

## 60. Run-flow tests

Verify:

- canonical Path → Build → Battle order for all four battles;
- Battle 1 Build opens with default Hacker build after route selection;
- later Builds carry current build/order forward;
- same-battle retry preserves SYS/HST/UPGs and generates no new path;
- Force Win defeat override advances correctly;
- natural-victory Force Win remains non-progressing wizard use;
- Battle 4 completion has no boss-specific behavior;
- full Run restart clears acquired UPGRADE/path progression;
- ICE remains BASE_ICE + 0/50/100/150.

## 61. Quick Match tests

Verify:

- Constructed Quick Match deliberately selects SYS and HST before Build;
- no UPGRADE selection appears;
- selected HST PASSIVEs apply in battle;
- Random Quick Match chooses valid SYS and HST automatically;
- Quick Match has no Run UPGRADE state;
- active Quick Match save restores exact SYS/HST;
- setup selection does not consume gameplay RNG.

## 62. Save/version tests

Verify:

- Alpha 0.5 active save rejects cleanly;
- Alpha 0.6 pending-path save round-trips;
- Alpha 0.6 pending-build save round-trips with committed route package;
- mid-battle save restores HST and active acquired UPGRADE effects;
- malformed duplicate acquired-UPGRADE save rejects;
- missing HST/UPG/PSV ref rejects;
- content-fingerprint mismatch rejects;
- existing unrelated preferences/logging preferences survive active-save schema bump where compatible.

## 63. Logging/metrics tests

Verify:

- route offer and selection records contain required IDs;
- duplicate-UPGRADE exhaustion is identified;
- PASSIVE source kind/source ID/passive ID are retained;
- multiple PASSIVE contributions to one calculation remain distinguishable;
- HOST causal source and agent Sync owner both survive logging;
- BASIC/VERBOSE/COMPLETE filtering remains correct;
- compact exporter does not regress into `unparsable`/`cfg[missing]` false signals;
- current total charge-discard metrics remain authoritative;
- new telemetry does not reintroduce large repeated battle-static payloads into turn records;
- metrics totals reconcile after PASSIVE modifiers.

## 64. Settings test

Automate the UI/state behavior where feasible:

- open LINK/ICE accordion;
- toggle Normal Link OFF;
- accordion remains open and manual inputs become enabled;
- toggle Normal Link ON;
- accordion remains open and manual inputs become disabled/hidden according to current UI rules.

Do not rely solely on manual verification for state logic if it can be covered by current UI/state tests.

---

# Part XVII — Manual Verification

## 65. Required browser/manual checks

Perform real-browser checks where practical and explicitly report anything not performed.

Priority checks:

1. New Run → Hacker → Deck → initial Path Choice → Build → Battle 1.
2. Initial path cards both show DOORMAN + THRESHOLD and different UPGRADEs.
3. Choosing an UPGRADE visibly changes Battle 1 when the selected UPGRADE has an observable current effect.
4. Build shows the committed encounter context and acquired UPGRADE list.
5. Battle 2–4 route screens show varying valid SYS/HST combinations.
6. Acquired UPGRADEs disappear from future eligible offers.
7. Final path screen shows the one remaining UPGRADE on both paths.
8. Save/reload on a Path Choice screen preserves the exact offers.
9. Save and Quit from a between-battle Build restores the committed System/HOST/UPGRADE package.
10. Retry after defeat keeps the same encounter package and UPGRADE list.
11. Constructed Quick Match allows deliberate System then HOST selection before Build.
12. No UPGRADE selector appears in Quick Match.
13. Observe WEEDS/GREENING on both Hacker and System turn starts if practical.
14. Confirm HOST-triggered transformation can create an immediate Sync and that the active-turn agent receives normal Sync consequences.
15. Observe SNEAKERS/SNEAK at Hacker turn start if practical.
16. Observe BRACER permanent Shield in displayed/effective Shield total.
17. Observe VERDUN/BIGGER_BOMB on at least one Bomb type if practical.
18. Confirm START_OF_TURN carrier effects occur before countdown tick where a visible setup can demonstrate it.
19. Open LINK/ICE accordion and toggle Normal Link both directions without collapse.
20. Review current logs/export for route and PASSIVE source attribution.
21. Check narrow mobile-oriented viewport for route cards, HOST selection, Build context, and settings accordion.
22. If available, test on a real phone/touch device; if not, explicitly say it was not performed.

Do not claim manual checks that were not actually observed.

---

# Part XVIII — Single-Agent Workflow

## 66. Workflow principle

One agent owns the build end to end.

Prefer extending established Alpha 0.5 abstractions over speculative generalization.

High-risk boundaries are:

- replacing SKL/Skill authority cleanly with PSV/PASSIVE;
- representing HOST as a third causal source without breaking agent ownership logic;
- PASSIVE contribution attribution;
- START_OF_TURN ordering relative to countdowns;
- route persistence and new `PENDING_PATH` state;
- initial Run commitment boundary moving to Path Choice;
- isolated route RNG;
- UPGRADE persistence/uniqueness;
- BIGGER_BOMB interaction with delayed Bomb contracts;
- save-schema rejection;
- preserving logging compaction/storage limits.

## 67. Stage 1 — mandatory inspection and authorization stop

Before writing implementation code:

1. Read this entire handoff.
2. Read every supplied Alpha 0.6 runtime datasheet and reference file.
3. Inspect the current Alpha 0.5 repository and clean working-tree/user-change state.
4. Run the current baseline verification suite appropriate to the repository.
5. Confirm current required dataset enumeration and SKL/Skill loader/runtime registry.
6. Confirm exact modules that own Hacker Skill evaluation, attribution, metrics, and UI display.
7. Confirm actual supplied HAK/SYS headers use `PASSIVES`.
8. Confirm actual supplied PSV/HST/UPG headers and values.
9. Confirm canonical axis token accepted by existing enums, specifically checking the GRACE/Yellow PASSIVE param.
10. Confirm current battle source/owner types and identify the minimum change required to represent HOST causal source separately from Hacker/System resolution owner.
11. Confirm current turn-start ordering, countdown tick location, System Function phase location, and terminal-state checks.
12. Confirm current delayed Bomb/countdown payload stamping and how BIGGER_BOMB can reuse it without parallel logic.
13. Confirm current Alpha 0.5 save schema/phases, especially `PENDING_BUILD`, active battle, result, retry, and Run restart.
14. Confirm current New Run save replacement/commit boundary and what must change to commit on initial Path Choice entry.
15. Confirm current isolated setup RNG implementation and propose route RNG persistence/reuse.
16. Confirm Constructed/Random Quick Match selection flow and where HOST selection fits before Build.
17. Confirm current Build opponent-summary surfaces and minimal HST/UPG display integration.
18. Confirm current logging/metrics schema for source attribution and Alpha 0.4.1 storage limits.
19. Confirm current `chargeDiscardedTotal`/legacy waste state and do not reintroduce bottom-Program attribution.
20. Identify exact source files/modules affected.
21. Identify any place where the proposed implementation would create a second content authority, second trigger pipeline, second RNG stream with unclear ownership, or second event pipeline.
22. Produce a concise implementation plan containing:
    - architecture findings;
    - exact content/schema mismatches, if any;
    - PSV migration plan;
    - PASSIVE registry/type plan;
    - HOST source/Sync-owner plan;
    - start-of-turn ordering plan;
    - route state/RNG plan;
    - save schema/phase plan;
    - Quick Match UI plan;
    - logging/metrics attribution plan;
    - test plan;
    - manual-check plan;
    - README plan;
    - commit/push plan.
23. **Stop and request authorization before implementation.**

### 67.1 Stage 1 decision rule

Do not stop for minor implementation details that the current architecture clearly resolves.

Do escalate before implementation if inspection reveals a genuine unresolved conflict affecting:

- player-visible PASSIVE semantics;
- source versus owner attribution;
- START_OF_TURN ordering;
- countdown ordering;
- route selection/persistence;
- RNG ownership;
- UPGRADE acquisition uniqueness;
- save compatibility;
- data authority;
- gameplay fingerprinting;
- logging/metrics correctness;
- required scope.

## 68. Stage 2 — implementation after authorization

Implement in dependency order. A suggested sequence:

### Phase A — content and PASSIVE migration

- add PSV/HST/UPG required datasets;
- migrate HAK/SYS reference fields to PASSIVES;
- replace SKL/Skill runtime authority with PASSIVE;
- typed PASSIVE registry/contracts;
- fingerprint/validation updates;
- preserve former Hacker Skill behavior through PSV.

### Phase B — PASSIVE runtime/source model

- PASSIVE instances with source attribution;
- agent/HOST scope resolution;
- continual modifiers;
- START_OF_TURN ordering;
- cost-free carrier Function invocation;
- HOST causal source vs active-agent Sync owner;
- BIGGER_BOMB.

### Phase C — Run route state and persistence

- `PENDING_PATH` or equivalent;
- initial commitment boundary;
- initial/later offer generation;
- UPGRADE acquisition list;
- route RNG persistence;
- retry/restart/Force Win integration;
- save schema bump/rejection.

### Phase D — Quick Match and UI

- Constructed HOST Selection;
- Random HOST selection;
- route choice cards;
- HST/UPG context in Build/battle information;
- acquired UPGRADE list;
- Normal Link accordion state fix;
- narrow-screen preservation.

### Phase E — logging/metrics

- route events;
- PASSIVE source contributions;
- HOST causal attribution;
- preserve compact logging/storage constraints;
- ensure current exporter fixes remain.

### Phase F — integration/documentation

- focused regression fixes only;
- complete automated gate;
- browser/manual verification;
- README update;
- diff inspection;
- commit and push.

Add focused tests as each phase is implemented rather than deferring all tests to the end.

---

# Part XIX — Balance and Regression Boundaries

## 69. Balance policy

Alpha 0.6 is a framework/content-structure build, not a balance pass.

Do not broadly tune:

- UPGRADE magnitudes;
- HOST magnitudes;
- System ICE;
- Program costs;
- Function damage;
- Bomb values;
- PASSIVE stacking;
- route difficulty;
- path probabilities.

Only change authored values for a concrete defect, validation blocker, severe nonfunctional interaction, or explicit user authorization.

The deliberate four-UPGRADE/four-choice exhaustion case must remain.

## 70. Regression expectations

Preserve focused coverage for established Alpha 0.5 mechanics:

- System identity;
- COERCE;
- EBUFF;
- SPAM;
- dynamic System Function phase;
- System valid-target gating;
- Hacker build/inventory;
- charge overflow;
- DATACUT;
- PLINK;
- SCRAMBLE;
- B1;
- Reinforced Connection;
- Drain gating/telemetry;
- countdowns;
- Bomb/Shield/Buff;
- save/preferences;
- logging levels/storage/export fixes.

Alpha 0.6 intentionally changes Run structure and adds PASSIVE effects, so batch/HP-ladder output is not expected to remain byte-identical to Alpha 0.5.

Do not tune merely to restore prior statistics.

---

# Part XX — Final Verification, README, Commit, Push

## 71. Full automated gate

Run the complete established verification suite. At minimum, where commands exist:

```bash
npm run typecheck
npm test
npm run smoke
npm run batch
npm run hpladder
npm run build
```

Add focused commands as needed.

Record exact commands, exits/results, test counts, content warnings, and meaningful batch/ladder observations in the final report.

Do not weaken/delete existing tests merely to make the build pass without explicitly justifying a semantic change.

## 72. README update

After implementation and verification, update `README.md` before committing.

Describe the project as actually shipped in Alpha 0.6, including as appropriate:

- current version/build identity;
- nine-dataset external content architecture;
- PASSIVE replacing Skill;
- HOST environment layer;
- UPGRADE Run-reward layer;
- Path → Build → Battle Run flow;
- initial DOORMAN/THRESHOLD route behavior;
- randomized later SYS/HST routes;
- four-UPGRADE Run-local progression;
- Constructed Quick Match System/HOST selection;
- relevant continual/START_OF_TURN PASSIVE behavior;
- current save schema/version rejection behavior;
- BASIC/VERBOSE/COMPLETE logging at a durable high level;
- verification commands/results;
- meaningful remaining manual limitations.

Do not turn README into the final agent report.

Do not add speculative Alpha 0.7 roadmap content beyond a minimal existing future-scope section if needed.

## 73. Pre-commit review

Before staging:

1. run `git status`;
2. inspect `git diff`;
3. inspect suspiciously large diffs for encoding/line-ending churn;
4. run `git diff --check`;
5. confirm runtime datasheets match the intended supplied content;
6. confirm no accidental changes to reference PDFs/data exports;
7. confirm README matches actual shipped behavior;
8. confirm no unrelated user changes are overwritten;
9. rerun any verification invalidated by late code/data edits.

## 74. Commit and push

Once the full gate is green and diff review is clean:

1. stage the intended Alpha 0.6 changes;
2. create a concise build commit, conceptually similar to:

```text
Implement Alpha 0.6.0 hosts, upgrades, passives, and run paths
```

The exact message may be adjusted to the final implementation.

3. push the current branch to its configured upstream.

Do not force push.

If a safe push cannot complete, report the exact external/repository blocker and leave the verified commit intact.

---

# Part XXI — Final Agent Report

## 75. Required final report

After commit/push attempt, provide a concise but complete report containing:

1. implementation summary;
2. final runtime dataset/schema list and any migration from SKL to PSV;
3. exact authored HST/UPG/PASSIVE content resolved from data;
4. PASSIVE runtime/source model;
5. continual PASSIVE arithmetic and attribution behavior;
6. START_OF_TURN order and carrier Function behavior;
7. HOST causal-source versus Sync-resolution-owner implementation;
8. BIGGER_BOMB named-pattern implementation;
9. canonical Run Path → Build → Battle flow;
10. initial save commitment boundary and `PENDING_PATH` behavior;
11. route generation/UPGRADE exhaustion behavior;
12. route RNG separation/persistence;
13. Constructed/Random Quick Match HOST behavior;
14. save schema/version and Alpha 0.5 rejection behavior;
15. logging/metrics/path/PASSIVE attribution summary;
16. Normal Link accordion fix;
17. exact automated verification commands/results/test counts;
18. content warnings and whether expected;
19. meaningful batch/HP-ladder observations without treating them as a balance pass;
20. manual browser/device checks performed;
21. manual checks not performed;
22. deviations from this handoff and why;
23. README update summary;
24. final `git status` state;
25. commit hash/message;
26. push result and target branch/remote, or exact push blocker.

Be explicit about uncertainty. Do not claim a browser/device observation that was not actually performed.

---

# Part XXII — Completion Standard

## 76. Alpha 0.6 is complete when

- PASSIVE replaces Skill as the shared passive framework.
- HAK/SYS/HST/UPG references resolve through PASSIVE.
- Existing Hacker Red passive behavior remains intact after migration.
- HOST is a first-class causal source.
- UPGRADE is a persistent Run-local reward source.
- duplicate PASSIVEs stack by source.
- HOST PASSIVEs ignore `applies_to` and use the defined global/per-agent semantics.
- HOST-created Syncs retain HOST causal attribution while the active-turn agent owns Sync consequences.
- START_OF_TURN ordering is HOST → active identity → Hacker UPGRADE acquisition order → countdown tick.
- PASSIVE Function payloads execute without Function cost.
- current continual PASSIVE arithmetic is implemented as specified.
- BIGGER_BOMB advances named area patterns and saturates.
- New Run commits when the initial Path Choice is entered.
- initial path offers use DOORMAN + THRESHOLD with distinct UPGRADEs when possible.
- selected UPGRADE applies before Battle 1 Build/Battle and persists.
- Battles 2–4 use valid randomized SYS/HST/UPG path offers.
- acquired UPGRADEs are never acquired twice.
- the one-remaining-UPGRADE final-offer edge case works.
- exact pending offers survive save/reload without reroll.
- same-battle retry preserves the committed encounter package.
- Run ICE remains `BASE_ICE + 0/50/100/150`.
- Constructed Quick Match allows deliberate SYS + HST selection before Build and no UPGRADE selection.
- Random Quick Match chooses valid SYS/HST without contaminating gameplay RNG.
- save schema rejects incompatible Alpha 0.5 active saves cleanly.
- logs/metrics preserve route and PASSIVE source attribution without regressing Alpha 0.4.1 compaction.
- Normal Link toggling does not collapse an open LINK/ICE accordion.
- no boss mechanics or broad balance pass are introduced.
- full automated verification passes.
- README reflects actual Alpha 0.6 behavior.
- final diff is reviewed.
- completed build is committed and pushed, or a safe external push blocker is explicitly reported.

---

# Part XXIII — Future Notes, Not Alpha 0.6 Scope

The following are reminders only and must not expand this build:

- future boss rules / final-battle identity;
- future fixed/easy “romp” encounter pool policy beyond current DOORMAN intro;
- future Function-description authoring/storage UX pass;
- future System PASSIVE content breadth;
- future authored System that deliberately fields Disabler if desired for live gameplay coverage;
- future purpose-built TESTER System/content fixture for headless regression rather than pinning live gameplay content;
- future axis-specific charge-waste metrics only if analysis finds them useful;
- future chunked logging storage only if measured bounded whole-stream writes become a problem again;
- future PASSIVE anti-stacking/exclusion rules only when actual content requires them;
- post-beta Function/Effect schema refactor remains deferred.
