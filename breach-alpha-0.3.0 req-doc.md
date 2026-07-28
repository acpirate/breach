# Breach Alpha 0.3.0 - Coding Agent Handoff

**Build identity:** `alpha-0.3.0`

**Status:** Canonical implementation requirements and coding-agent instructions for Alpha 0.3.0.

**Primary objective:** Add externally defined Hacker, Deck, and Skill identity; explicit New Run selection flow; fixed Build Review; data-driven Hacker Skills; a formal Deck-owned Shake Function; the combined direct-match line-clear rule; Link/ICE configuration formalization; and the approved Alpha 0.2 UX cleanup without expanding into build editing, inventory, rewards, or System-side content architecture.

---

## 0. Document Authority and Working Method

This document is the authoritative Alpha 0.3.0 build specification.

Use sources in this order when inspecting or implementing:

1. This Alpha 0.3.0 handoff.
2. Explicit user decisions incorporated into this handoff.
3. The current repository and Alpha 0.2.0 implementation.
4. The Alpha 0.2.0 and Alpha 0.1.0 requirements for unchanged behavior.
5. Older design documents, backlog items, and historical discussions only for context.

The earlier designer handoff is a scope source, but later data-structure and ambiguity decisions have already been reconciled here. Do not reopen resolved alternatives merely because the designer handoff used older or less-defined wording.

All Alpha 0.2.0 and Alpha 0.1.0 requirements remain in force unless this document explicitly changes them. Preserve current behavior where this document says to preserve it. Do not reinterpret requirements to fit the current code silently. Report genuine conflicts during Stage 1.

Before each implementation iteration, use a fresh coding-agent context rather than carrying stale implementation assumptions from a prior build.

### 0.1 Source-control and README boundary

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

# Part I - Alpha 0.3.0 Requirements

## 1. Build Objective

Alpha 0.3.0 establishes Hacker-side identity and selection architecture around the successful Alpha 0.2.0 Run skeleton.

The completed build must:

1. Load and validate external Hacker, Deck, and Skill datasets through the shared content pipeline.
2. Extend Function data with Effect-specific parameters and starting-charge metadata.
3. Resolve Hacker and Deck identity as authoritative runtime, save, UI, log, and battle-construction state.
4. Add the New Run flow:

   ```text
   Title -> Hacker Selection -> Deck Selection -> Build Review -> Battle 1
   ```

5. Keep Quick Match as a direct single-battle flow using explicit default Hacker and Deck IDs.
6. Preserve the fixed ordered four-Program Hacker roster; Decks do not define or edit the roster in this build.
7. Replace the prior hardcoded Hacker Red passive with externally defined, coded Skill records.
8. Make the Deck-owned `FNC_010` SCRAMBLE Function invoke the formally defined `EFFECT_SHAKE` contract.
9. Add owner-scoped Deck Function charging from neutral Packets sliced during qualifying Sync resolution.
10. Implement combined directly matched footprints for row/column-clear qualification.
11. Formalize Hacker LINK and System ICE under the Normal LINK setting.
12. Rename and clarify the prior No Match Damage mode as Reinforced Connection.
13. Apply the approved result-control, terminology, System-turn indication, and battle-UI cleanup.
14. Persist and log Hacker, Deck, Skill, Function, and fixed Program identity consistently.
15. Reject incompatible Alpha 0.2 saves cleanly.
16. Preserve all other Alpha 0.2 combat, Run, save, layout, metrics, and content behavior.

This is not a balance pass. Existing values remain authoritative except for the new externally supplied Alpha 0.3 content.

---

## 2. Explicit Alpha 0.3 Overrides and Reconciliations

The following decisions override older or less-defined wording:

1. **Deck scope:** A Deck controls `ADD_LINK` and exactly one Deck Function. It does not own the Hacker Program roster in Alpha 0.3.
2. **Fixed build:** The existing ordered `PRG_H_*` roster remains the fixed build shown on Build Review and used in battle.
3. **Hacker strength:** `STRONG_COLORS` and `STRONG_SHAPES` on the selected Hacker are authoritative. Weak sets are calculated complements. There is no exact three-color/three-shape requirement.
4. **System strength:** Until a System identity dataset exists, System strong sets are the complements of the selected Hacker strong sets.
5. **Hacker passive architecture:** The prior hardcoded Red passive is removed. The Hacker references separate `SKILL_*` records whose behavior is handled by coded `SKL_*` effect types.
6. **Deck ability architecture:** Deck active abilities reference the existing Function dataset. Do not create a separate Deck Function table.
7. **Effect architecture:** Shake is a coded Effect registered as `EFFECT_SHAKE`. Do not add a generalized external Effect scripting table.
8. **Compatibility:** All valid Decks are compatible with all valid Hackers in this build. Do not add compatibility fields or filtering.
9. **Save compatibility:** Alpha 0.2 saves are rejected, not migrated.
10. **Quick Match:** Quick Match bypasses the selection screens and uses `HAK_01` and `DEK_01` explicitly.
11. **Force Win:** Force Win changes progression only when overriding a natural defeat. On a natural victory where the control remains visible, it records wizard use without changing progression.
12. **Graphics and prose placeholders:** Hacker `BIO`, Hacker `GRAPHICS`, Deck `DESCRIPT`, and Deck `GRAPHICS` are schema placeholders only. Alpha 0.3 does not display or load them.
13. **Reinforced Connection:** Base Sync damage is suppressed for both sides, but Skill- and Function-originated effects triggered by a Sync still resolve.
14. **Line clear:** Row/column-clear qualification uses the union of all directly matched footprints in one resolution wave, not the size of one internal match group.
15. **Drain:** Drain targets Programs only. Deck Function charge is never an eligible Drain target.

---

## 3. Existing Architecture and Behavior to Preserve

Unless explicitly changed here, preserve:

- the shared browser/Node CSV acquisition adapters and pure TypeScript parse/validate/resolve pipeline;
- immutable `ResolvedContent` as the runtime content authority;
- existing Program -> Function -> Effect execution architecture;
- existing Effect registry and typed runtime dispatch;
- stable ID and reference validation;
- existing Hacker and System Program records and authored order;
- existing System timer charging and optional System matching behavior;
- current targeting defaults and the established deterministic System Drain priority rule;
- current Buff, Shield, Bomb, E-Bomb, Attack, and Drain behavior;
- current countdown timing and special-object state ownership;
- current damage ordering and disjoint attribution invariants except for the explicit Skill integration below;
- current Quick Match and four-battle Run lifecycle;
- current single save slot and pending-result persistence;
- current deterministic active-battle restore;
- current vertical battle layout and avatar character-sheet controls;
- current server log storage protection and graceful logging failure;
- current metrics granularity;
- current simulation and test infrastructure unless the coding agent finds a concrete reason to adjust it.

Do not create parallel loaders, parallel battle constructors, parallel match detectors, or UI-owned copies of gameplay rules.

---

## 4. Required External Datasets

### 4.1 Required dataset set

Alpha 0.3 requires these startup datasets:

1. Hacker Programs.
2. System Programs.
3. Functions.
4. Hackers.
5. Hacker Skills.
6. Decks.

The first three extend the Alpha 0.1 content set. The last three are new.

All six must pass startup parsing, validation, reference resolution, and normalized gameplay fingerprint generation before title-screen initialization. Do not partially accept valid rows from an invalid required dataset.

Browser and Node/headless consumers must use the same raw resources and shared parser/validator/resolver logic.

### 4.2 Common parsing rules

For all datasets:

- bind fields by validated header name rather than raw positional index;
- trim field values before semantic validation;
- use `:` as the list and tuple delimiter;
- reject blank tokens inside a nonblank list;
- reject duplicate tokens in fields where duplicates have no defined meaning;
- preserve authored list and row order where it may be meaningful;
- stable IDs are case-sensitive machine identifiers;
- display names are not identifiers;
- duplicate display names are valid but produce a startup warning;
- notes and placeholder presentation fields are never interpreted as gameplay instructions;
- spreadsheet content selects coded behavior and parameters; it is not executable scripting.

### 4.3 Hacker dataset

Canonical header:

```csv
HAK_ID,name,BASE_LINK,STRONG_COLORS,STRONG_SHAPES,SKILL,BIO,GRAPHICS
```

| Field | Type | Required | Contract |
|---|---|---:|---|
| `HAK_ID` | string | yes | Globally unique; must begin with `HAK_`. |
| `name` | string | yes | Trimmed, nonempty player-facing name. |
| `BASE_LINK` | integer | yes | Positive base Hacker LINK. |
| `STRONG_COLORS` | colon list | yes for current content | Recognized color enum values; no duplicates. No exact cardinality requirement. |
| `STRONG_SHAPES` | colon list | yes for current content | Recognized shape enum values; no duplicates. No exact cardinality requirement. |
| `SKILL` | colon list | yes | One or more `SKL_*` Skill record references in authored order. |
| `BIO` | string | no | Placeholder only; parsed and retained but not displayed or interpreted in Alpha 0.3. |
| `GRAPHICS` | string | no | Placeholder only; no asset loading or display in Alpha 0.3. |

Current required Alpha record:

```csv
HAK_01,CR45H,100,RED:GRE:YEL,TRI:SQU:STR,SKL_001:SKL_002,...,...
```

The exact placeholder text in `BIO` and `GRAPHICS` is non-normative.

### 4.4 Hacker Skill dataset

Canonical header:

```csv
SKILL_ID,skill_effect,params,display
```

| Field | Type | Required | Contract |
|---|---|---:|---|
| `SKILL_ID` | string | yes | Globally unique Skill record ID beginning with `SKL_`. |
| `skill_effect` | string enum | yes | Coded Skill-effect type. Current values are `SKL_EXTRA_MATCH_DAMAGE` and `SKL_EXTRA_MATCH_CHARGE`. |
| `params` | effect-specific tuple | yes for current effects | Colon-delimited typed tuple validated by the selected `skill_effect`. |
| `display` | string | yes | Presentation template only; never gameplay authority. |

Current required records:

```csv
SKL_001,SKL_EXTRA_MATCH_DAMAGE,RED:1,Deal %1 extra damage on a %0 Sync
SKL_002,SKL_EXTRA_MATCH_CHARGE,RED:1,Gain %1 extra charge on a %0 Sync
```

Minimal display behavior:

- `%0`, `%1`, and any later `%N` refer to the zero-based ordered parsed parameter tokens;
- current enum tokens should be rendered in normal player-facing title case where practical, such as `RED` -> `Red`;
- unsupported or out-of-range placeholders are startup validation errors;
- do not create a generalized localization or expression engine;
- the parsed Skill contract, not the display string, controls behavior.

### 4.5 Deck dataset

Canonical header:

```csv
DEK_ID,name,ADD_LINK,FUNCTIONS,DESCRIPT,GRAPHICS
```

| Field | Type | Required | Contract |
|---|---|---:|---|
| `DEK_ID` | string | yes | Globally unique; must begin with `DEK_`. A `HAK_*` value in this field is invalid. |
| `name` | string | yes | Trimmed, nonempty player-facing name. |
| `ADD_LINK` | integer | yes | Nonnegative LINK added to the selected Hacker under Normal LINK rules. |
| `FUNCTIONS` | colon list | yes | Alpha 0.3 requires exactly one `FNC_*` reference. More than one is a startup error. |
| `DESCRIPT` | string | no | Placeholder only; not displayed or interpreted in Alpha 0.3. |
| `GRAPHICS` | string | no | Placeholder only; no asset loading or display in Alpha 0.3. |

Current required Alpha record:

```csv
DEK_01,AGIMA,50,FNC_010,...,...
```

The older `HAK_01` value shown in a draft Deck sheet is a corrected authoring typo. The canonical Deck ID is `DEK_01`.

Every valid Deck is compatible with every valid Hacker. Do not add compatibility fields or validation.

### 4.6 Function dataset extensions

Extend the existing Function schema with these fields:

```text
params
startCharged
```

The canonical exported header should preserve the existing columns and append the new fields to minimize migration churn:

```csv
FNC_ID,name,cost,payload,notes,quantity,countdown,areaPattern,magnitude,damage,params,startCharged
```

The parser must still bind by header name.

#### `params`

- Blank means the selected Effect requires no compound parameter tuple.
- Nonblank values use `:` delimiters.
- `0` is a supplied value, not absence.
- Each coded Effect contract validates exact tuple length, token type, and allowed values at startup.
- Runtime Effect execution consumes a typed resolved object; it must not parse the raw string on demand.

#### `startCharged`

Accepted values:

```text
Y
N
blank
```

Rules:

- `Y` means a directly assigned owner starts each battle with charge equal to the Function cost.
- `N` or blank means a directly assigned owner starts each battle with zero charge unless another explicit mechanic changes it.
- The rule applies uniformly when a Function is directly assigned to a Program or to a Deck.
- Each Program or Deck owns independent charge state even when content references the same Function definition.
- Charge resets at the start of every Quick Match and every Run encounter; it does not carry between Run battles.
- A child Function's `startCharged` metadata remains valid data but is ignored when that Function executes only as a child of a composite. If later assigned directly, its metadata applies normally.
- Do not use `startCharged` to alter child activation costs or composite payment semantics.

### 4.7 Required SCRAMBLE Function

Add the Deck Function:

| Field | Value |
|---|---|
| `FNC_ID` | `FNC_010` |
| `name` | `SCRAMBLE` |
| `cost` | `3` |
| `payload` | `EFFECT_SHAKE` |
| `params` | `0:0:0:0` |

Other Effect-specific fields are blank unless the supplied authoritative Alpha 0.3 CSV states otherwise. `startCharged` is data-authoritative; blank is interpreted as `N`.

### 4.8 Resolved runtime models

Extend shared resolved content with immutable definitions equivalent to:

```text
ResolvedHacker
- id
- name
- baseLink
- strongColors
- weakColors (derived)
- strongShapes
- weakShapes (derived)
- ordered skills
- retained placeholder metadata

ResolvedSkill
- id
- effectType
- typed parameters
- resolved display text or deterministic display template inputs

ResolvedDeck
- id
- name
- addLink
- exactly one resolved Function
- retained placeholder metadata
```

Exact TypeScript names may follow repository conventions. All human play, setup UI, battle construction, saves, logs, and headless tools must consume these shared resolved definitions rather than reparsing CSV or using hardcoded copies.

### 4.9 Validation behavior

Startup errors include at least:

- missing required dataset;
- wrong or missing required header;
- duplicate stable ID;
- wrong ID prefix for dataset role;
- missing Hacker, Skill, Deck, or Function reference;
- unknown color, shape, Skill effect, Function, or Effect ID;
- malformed list or tuple;
- invalid numeric value;
- invalid `startCharged` token;
- Deck with zero or more than one Function;
- unsupported Skill display placeholder;
- Effect- or Skill-specific parameter contract failure.

Warnings include at least:

- duplicate display names;
- valid but currently unreferenced content rows;
- `EFFECT_SHAKE` Replace mode combined with Retain-specials mode, because Retain is ineffective;
- `EFFECT_SHAKE` matches disabled while a nonzero cascade mode is supplied, because cascade mode is currently ignored.

Use the established strict startup-failure path. Browser startup should show a graceful blocking diagnostic. Node/headless tools should exit/fail clearly. Do not silently substitute default rows or row-order fallbacks.

### 4.10 Gameplay-content fingerprint

The normalized gameplay fingerprint must include gameplay-affecting values from all required datasets, including:

- Hacker IDs, base LINK, strong sets, and ordered Skill IDs;
- Skill IDs, coded effect types, and typed parameters;
- Deck IDs, added LINK, and ordered Function references;
- Function `params` and `startCharged` in addition to existing gameplay fields;
- Program and Function content already fingerprinted in Alpha 0.1/0.2.

Exclude non-gameplay content such as:

- notes;
- `BIO`;
- `GRAPHICS`;
- `DESCRIPT`;
- purely presentational Skill `display` text;
- formatting and row whitespace that normalize to the same gameplay values.

A fingerprint mismatch rejects a save. Do not load changed gameplay content into an existing battle or Run.

---

## 5. Hacker, Deck, and Fixed-Build Identity

### 5.1 Active identity

An active battle must have explicit:

- Hacker ID;
- Deck ID;
- ordered Hacker Skill IDs;
- Deck Function ID;
- ordered Hacker Program IDs;
- ordered System Program IDs.

Do not infer Hacker or Deck identity from display name, current screen, Function ID, Program roster, or row position.

### 5.2 Default IDs

Until a future configuration or account-selection system exists, define explicit defaults:

```text
DEFAULT_HACKER_ID = HAK_01
DEFAULT_DECK_ID = DEK_01
```

These may be named constants or equivalent typed configuration, but must not be inferred from the first dataset row.

Missing or invalid defaults block startup. There is no fallback to another row.

### 5.3 Fixed Hacker Program roster

Alpha 0.3 uses the current authored Hacker Program rows in their existing stable top-to-bottom order:

```text
PRG_H_001
PRG_H_002
PRG_H_003
PRG_H_004
```

The Deck does not define these IDs. Do not add a Deck `PROGRAMS` field or separate Build dataset in Alpha 0.3.

Preserve this Program order through:

- Build Review;
- battle initialization;
- Program rendering;
- save serialization;
- restore;
- logs and summaries.

The build is reviewable but not editable.

### 5.4 Hacker and System strength sets

The selected Hacker's `STRONG_COLORS` and `STRONG_SHAPES` are authoritative for Hacker owner-dependent damage strength.

Derive:

```text
Hacker weak colors = recognized colors - Hacker strong colors
Hacker weak shapes = recognized shapes - Hacker strong shapes
System strong colors = Hacker weak colors
System weak colors = Hacker strong colors
System strong shapes = Hacker weak shapes
System weak shapes = Hacker strong shapes
```

Rules:

- no exact three-strong/three-weak partition is required;
- preserve recognized enum order when presenting derived complements;
- charge bindings remain independent of strong/weak identity;
- do not duplicate the old hardcoded HIGH/LOW sets as a competing authority.

---

## 6. Hacker Skill Architecture and Behavior

### 6.1 Architecture boundary

Hacker Skills are passive coded behavior referenced by the selected Hacker.

They are not:

- activated Functions;
- charge-owning entities;
- Deck Functions;
- arbitrary spreadsheet scripts;
- a generalized event-rule language.

Use a small typed Skill-effect registry or exhaustive typed dispatch consistent with the existing Effect registry. The dataset chooses a coded `skill_effect` and supplies validated parameters.

Remove the prior hardcoded Hacker Red damage/charge passive entirely. There must be one authority: the resolved Skill records referenced by the active Hacker.

### 6.2 Owner scope

A Hacker Skill triggers only from a qualifying Sync event owned by the side using that Hacker.

For current content:

- Hacker-owned direct matches and Hacker-owned cascades may trigger the Skills;
- System-owned Syncs do not trigger Hacker Skills;
- environment-owned resolution does not trigger Hacker Skills unless a later mechanic explicitly assigns that event to the Hacker;
- a Shake-created Sync is owned by the Shake initiator and therefore triggers only that initiator's applicable Skills.

### 6.3 Qualifying match event identity

For current Red Skills:

- only a resolved `RED` color-axis Sync qualifies;
- moving a Red Packet does not qualify by itself;
- a shape-axis Sync caused by moving a Red Packet does not qualify;
- if one resolution contains both a Red color-axis Sync and a shape-axis Sync, the Red Skill triggers once for the Red-axis event and not for the shape event;
- same-axis Red runs merged by the match engine into one player-visible resolved Red blob count as one qualifying event;
- multiple distinct resolved Red blobs in the same move or cascade wave each qualify independently;
- line-clear collateral, Bomb slices, Function slices, and other non-match destruction do not create qualifying Red Sync events.

The Skill contract must not expose hidden detector details that the player cannot observe meaningfully.

### 6.4 `SKL_EXTRA_MATCH_DAMAGE`

Current parameters:

```text
<color>:<positive integer magnitude>
```

For `RED:1`:

- add `1` raw Skill damage once per qualifying Red color-axis Sync event;
- duplicate qualifying Skills stack additively;
- the Skill bonus participates in the existing damage order established for the former inherent passive;
- add the Skill bonus to raw Sync damage before the current critical multiplier, current flooring/rounding behavior, Buffer addition, and Shield reduction;
- preserve the existing critical multiplier order rather than redesigning critical damage in this build;
- retain Skill damage as its own source-specific metric attribution without double counting total damage.

Under Reinforced Connection, base Sync damage is suppressed but this Skill's damage still resolves. Preserve current attribution machinery for separating the surviving Skill contribution from suppressed base Sync damage. If current rounding allocation makes that separation nontrivial, the Senior Developer must inspect and preserve the established damage-order result while keeping metrics disjoint.

### 6.5 `SKL_EXTRA_MATCH_CHARGE`

Current parameters:

```text
<color>:<positive integer magnitude>
```

For `RED:1`:

- increase the normal charge payout of each qualifying Red color-axis Sync event by `1`;
- apply the increased payout through the existing charge-distribution rules;
- do not create a separate universal charge pool;
- do not grant `+1` independently to every Red-bound Program unless that is already what the normal distribution rule produces from the increased payout;
- duplicate qualifying Skills stack additively;
- cascades apply the same rule;
- Reinforced Connection does not suppress this charge effect.

### 6.6 Skill persistence

The current Skills have no mutable state of their own.

Saves must persist enough stable identity to verify and restore the selected Hacker and its ordered Skill IDs, but do not create a generalized passive-state payload until a stateful Skill exists.

---

## 7. Deck Function Ownership, Charge, and Presentation

### 7.1 Exactly one active Deck Function

Alpha 0.3 supports exactly one Function reference per Deck.

The existing fifth Hacker-side Function control may remain visually similar to the four Program controls, but runtime, save, targeting, metrics, and logs must identify it as Deck-owned rather than as a `PRG_H_*` Program.

A more distinct Deck presentation is deferred.

### 7.2 Deck Function charge state

The active Deck owns an independent charge pool for its directly assigned Function.

- Its charge cap is the active Function cost.
- Initial battle charge follows `startCharged`.
- It resets at every battle start.
- Active-battle save/restore preserves its exact current charge.
- It does not persist charge between Run encounters.

### 7.3 Neutral Packet charge rule

The active Deck Function gains:

```text
+1 charge per neutral Packet sliced during the owner's qualifying Sync resolution
```

Include neutral Packets sliced by:

- the directly detected Sync footprint;
- a qualifying row or column clear generated by that resolution wave;
- cascades owned by the same side.

Rules:

- apply the charge to the Deck owned by the side that made the Sync or caused the qualifying match-resolution slice;
- charge remains capped at the Deck Function cost;
- opponent-owned resolution does not charge the Hacker's Deck;
- environment-owned resolution uses its own explicit ownership rules;
- Bomb destruction explicitly grants no charge;
- no general rule is established for future non-match destructive Effects. Their charge behavior must be specified when introduced, potentially through Effect parameters or Function metadata.

### 7.4 Drain exclusion

`EFFECT_DRAIN` targets Programs only.

- Hacker targeting UI must not offer the Deck Function as a Drain target.
- System Drain candidate selection must not include the Deck Function.
- A Deck Function's charge does not affect fully charged/highest-charge/highest-cost Drain priority calculations.

Preserve the established System Drain fizzle and payment rules for Program targets.

---

## 8. Formal `EFFECT_SHAKE` Contract

### 8.1 Registration and invocation

Register `EFFECT_SHAKE` as a coded Effect in the existing Effect registry and validation architecture.

`FNC_010` SCRAMBLE invokes it as the active Deck Function.

Whether the existing Board-Shake implementation is removed, adapted, or wrapped internally is a coding-agent implementation decision. The required result is one authoritative Shake behavior and no competing hardcoded cost, ownership, parameter, or charge path.

### 8.2 Parameter tuple

`EFFECT_SHAKE` requires exactly four colon-delimited integer enum values:

```text
boardComposition:specialGems:matches:cascades
```

Resolve the tuple during startup into a typed immutable object. Do not parse the raw tuple during activation.

### 8.3 `boardComposition`

Accepted values:

```text
0 = REARRANGE
1 = REPLACE
```

#### REARRANGE (`0`)

- Permute the existing tile objects across affected coordinates.
- Preserve board membership and overall composition.
- Packet positions change; the phrase "preserve the underlying tile" does not mean preserving it at the same coordinate.
- When special state is retained, the special object moves with its underlying Packet object.

#### REPLACE (`1`)

- Replace affected tiles with newly generated ordinary Packets under existing board-generation rules.
- Board composition may change.
- The prior underlying Packet and any special state on that tile are removed.

### 8.4 `specialGems`

Accepted values:

```text
0 = RETAIN
1 = REMOVE
```

Under REARRANGE:

- RETAIN moves each special object with its underlying Packet and preserves ownership, placing Program ID, countdown, magnitude, footprint/area identity, and other Effect state;
- REMOVE strips the special overlay/state, keeps the underlying ordinary Packet, and rearranges that Packet normally.

Under REPLACE:

- replacement is destructive and removes the entire prior tile and special state regardless of this parameter;
- REPLACE + RETAIN remains valid data but emits a startup warning because RETAIN is ineffective.

### 8.5 `matches`

Accepted values:

```text
0 = PREVENT_POST_SHAKE_MATCHES
1 = ALLOW_POST_SHAKE_MATCHES
```

When `0`:

- the completed Shake must satisfy the current legal/stable post-generation board invariants without immediate Sync resolution;
- no post-Shake match wave begins.

When `1`:

- all matches created by the final Shake board resolve immediately;
- those Syncs are owned by the side or game entity that initiated the Shake;
- normal owner-scoped damage, Program charge, Skill triggers, Deck neutral charge, cascades, metrics, and causal attribution apply according to the selected cascade mode.

Do not hardcode Shake-created matches as Hacker-owned.

### 8.6 `cascades`

Accepted values:

```text
0 = resolve initial post-Shake match wave only; no cascades
1 = use the active battle's saved configured cascade limit
2 = resolve cascades until stable, ignoring the configured finite limit
```

Rules:

- cascade mode matters only when `matches=1`;
- `matches=0` with cascade mode `1` or `2` is valid but warns and currently ignores the cascade value;
- mode `2` must use existing infinite-settle safeguards and deterministic RNG ownership rather than an unbounded unsafe loop.

### 8.7 Failure and legal fizzle

Shake generation/rearrangement may use bounded attempts consistent with existing board-generation safeguards.

If no valid final result can be produced:

- leave the Datastream unchanged;
- treat the Effect as a legal fizzle rather than an unexpected application error;
- retain normal paid Function activation cost;
- record the Function activation, Effect attempt, and legal fizzle through existing granular metrics/logging;
- do not corrupt RNG, board state, turn ownership, save state, or input state.

### 8.8 Current live variant

The current SCRAMBLE content uses:

```text
0:0:0:0
```

This means:

- rearrange existing tiles;
- retain special state;
- prevent immediate post-Shake Syncs;
- no cascade resolution.

---

## 9. Combined Direct-Match Line-Clear Rule

### 9.1 Qualification rule

Replace single-match-group-only line-clear qualification with the following player-visible rule:

> Within each match-resolution wave, union every tile belonging directly to a detected color-axis or shape-axis Sync. Any contiguous horizontal or vertical run of four or more cells in that union triggers the corresponding row or column clear.

This is the approved **B1 combined directly matched footprint** rule.

Examples:

- overlapping color and shape Syncs whose union forms four adjacent cells trigger a line clear;
- two adjacent but internally separate match-3 groups such as `RRR` beside `GGG` may combine into a six-cell qualifying row;
- the player-visible directly matched footprint controls qualification rather than hidden group composition.

### 9.2 Resolution boundaries

For each resolution wave:

1. Detect and preserve all constituent color-axis and shape-axis match groups using current semantics.
2. Build a deduplicated set of tiles belonging directly to those groups.
3. Find every maximal contiguous horizontal and vertical run of length `4+` in that set.
4. Trigger each qualifying row and column once for that wave.
5. Deduplicate sliced tiles at intersections while retaining both line-clear events for causal/logging purposes.
6. Resolve the resulting line-clear destruction through the existing destruction pipeline.

### 9.3 Exclusions and non-recursion

The following do not contribute to line-clear qualification:

- tiles sliced only as row/column-clear collateral;
- Bomb or countdown destruction;
- Function or Skill destruction;
- prior line clears;
- unrelated environment destruction.

Line-clear destruction does not recursively generate additional line clears. A later ordinary cascade wave performs a fresh direct-match analysis under the same rule.

### 9.4 Constituent match authority

The union exists only for line-clear qualification.

Preserve constituent match groups as the authority for:

- base Sync damage;
- critical handling;
- Program charge;
- Hacker Skill triggers;
- match ownership;
- per-match metrics and causal attribution.

Do not merge charge, damage, or Skill events merely because their tile footprints contributed to the same line clear.

### 9.5 Board-churn observation

This rule intentionally favors player-visible consistency over internal grouping purity. After implementation, logs and playtesting should make it possible to observe line-clear frequency and cascade/board-churn changes. Do not rebalance the rule in Alpha 0.3; report unexpectedly extreme churn for later evaluation.

---

## 10. LINK, ICE, and Normal LINK Configuration

### 10.1 Player-facing vocabulary

- Hacker health is **LINK**.
- System health is **ICE**.

Internal fields such as `currentHp` may remain when renaming would create unnecessary migration risk.

### 10.2 Normal LINK setting

Add or formalize a boolean setting:

```text
Normal LINK
```

Default: `ON`.

When Normal LINK is ON:

```text
Hacker maximum LINK = selected Hacker BASE_LINK + selected Deck ADD_LINK
Quick Match System maximum ICE = resolved Hacker maximum LINK
Run System maximum ICE = encounter table value 100 / 150 / 200 / 250
```

When Normal LINK is OFF:

```text
Hacker maximum LINK = manual Hacker LINK setting
Quick Match System maximum ICE = manual System ICE setting
Run System maximum ICE = manual System ICE setting for every encounter
```

Thus the manual System ICE value intentionally overrides the Run's 100/150/200/250 sequence when Normal LINK is OFF.

### 10.3 Settings presentation

- Hide the manual Hacker LINK and System ICE controls when Normal LINK is ON.
- Retain their stored values while hidden.
- Show and use them only when Normal LINK is explicitly OFF.
- Rename visible legacy HP labels to LINK and ICE.

### 10.4 Battle and Run snapshot behavior

At Quick Match creation, resolve and save the effective Hacker maximum LINK and System maximum ICE used by that battle.

At final New Run commitment:

- snapshot the Normal LINK setting and relevant configuration;
- resolve and save effective Hacker maximum LINK;
- resolve the System ICE rule for the Run;
- use the saved values/rule for all four encounters and all resumes.

Every Run battle starts the Hacker at full saved maximum LINK.

Changing title Settings after a Run begins must not silently change that Run. Continue uses the saved Run snapshot.

### 10.5 Fresh encounter state

Each new Run encounter starts with:

- Hacker at full saved maximum LINK;
- System at the saved encounter/manual maximum ICE;
- Program and Deck Function charge reset using `startCharged`;
- fresh board and battle RNG state under existing rules;
- no carried Buff, Shield, Bomb, countdown, target, or per-battle metric state unless an existing Alpha 0.2 rule explicitly says otherwise.

---

## 11. Reinforced Connection Mode

### 11.1 Rename and scope

Rename the player-facing **No Match Damage** setting/mode to:

```text
Reinforced Connection
```

Reuse the existing internal setting/behavior path where practical rather than creating a second toggle.

### 11.2 Behavior

When Reinforced Connection is enabled:

- suppress ordinary base Sync damage for Hacker-owned and System-owned Syncs;
- continue normal Program charge;
- continue `SKL_EXTRA_MATCH_CHARGE`;
- continue Skill and Function effects triggered by the Sync event;
- continue `SKL_EXTRA_MATCH_DAMAGE` as Skill-originated damage;
- continue Bomb, Attack, Buff, Shield, Drain, and other non-base-Sync systems normally.

The Sync event still exists; only its base damage output is suppressed.

### 11.3 Metrics

Preserve source-specific metric granularity.

- base Sync damage should record as suppressed/zero under the existing convention;
- each Skill or Function damage source retains its own metric category;
- do not create a generic Function-damage bucket;
- do not attribute surviving Skill damage to base Sync damage;
- preserve total-damage and Shield-prevention disjointness.

---

## 12. New Run Setup State and Screen Flow

### 12.1 Flow

Selecting **New Run** enters:

```text
Hacker Selection -> Deck Selection -> Build Review
```

Only the final **Start Run** action commits or replaces persistent save state and constructs Battle 1.

### 12.2 Pending setup state

Pending setup state contains at least:

- selected Hacker ID;
- selected Deck ID;
- fixed ordered Hacker Program IDs derived from the current content contract;
- derived review values needed by the screens.

Pending setup is ephemeral UI/application state, not an active save.

Rules:

- entering setup does not modify the existing save;
- Back navigation retains current pending choices;
- returning to Title discards pending setup only;
- closing/reloading during setup returns through normal startup/title behavior and does not replace the existing save;
- do not create a resumable half-configured Run.

### 12.3 Save replacement timing

If a valid save already exists:

- preserve it throughout Hacker Selection, Deck Selection, and Build Review;
- on **Start Run**, use the established destructive replacement confirmation;
- Cancel leaves the old save and pending Build Review unchanged;
- Confirm atomically replaces the old save, commits the selected identity, constructs the new Run, saves Battle 1, and enters battle.

If no valid save exists, Start Run commits immediately without a replacement modal.

The explicit Choose/Done controls on selection screens are not secondary modal confirmations.

---

## 13. Hacker Selection Screen

### 13.1 Content

Display every loaded Hacker definition after successful global startup validation.

For each option, display at minimum:

- Hacker name;
- base LINK;
- strong colors;
- strong shapes;
- separately rendered Skill descriptions.

Do not display or load `BIO` or `GRAPHICS` in Alpha 0.3.

### 13.2 Interaction

- Alpha 0.3 may ship with only `HAK_01`.
- The sole option may be preselected.
- Advancing still requires an explicit player action such as **Choose**, **Done**, or **Continue**.
- Do not add a modal confirmation after that action.
- Provide Back navigation to Title.
- Choosing the Hacker updates pending setup only.
- Do not log hover, screen view, preselection, or Back navigation as a committed selection.

The UI should be mobile-first whitebox presentation and must not introduce speculative carousel, art, filtering, inventory, or unlock behavior.

---

## 14. Deck Selection Screen

### 14.1 Content

Display every loaded Deck definition. All are compatible with the selected Hacker.

For each option, display at minimum:

- Deck name;
- added LINK;
- Deck Function name;
- Deck Function cost;
- Deck Function starting-charge state where useful for review.

Do not display or load `DESCRIPT` or `GRAPHICS` in Alpha 0.3.

### 14.2 Interaction

- Alpha 0.3 may ship with only `DEK_01`.
- The sole option may be preselected.
- Advancing still requires an explicit final action.
- Do not add a modal confirmation.
- Provide Back navigation to Hacker Selection.
- Choosing the Deck updates pending setup only.
- Do not add compatibility filtering, construction, inventory, Program replacement, or Program ordering controls.

---

## 15. Fixed Build Review Screen

### 15.1 Purpose

Build Review confirms the selected identity and fixed combat build before persistent Run creation. It is not a build editor.

### 15.2 Required display

Display at minimum:

- selected Hacker name;
- resolved total Hacker LINK under the current pending Normal LINK/configuration rules;
- selected Hacker Skill descriptions;
- selected Deck name;
- selected Deck Function name, cost, and starting-charge state;
- four fixed Hacker Programs in exact battle order;
- for each Program: name, color bindings, shape bindings, Function name, activation cost, and starting-charge state.

Use loaded/resolved content. Do not hardcode display labels or values that already exist in the datasets.

### 15.3 Controls

Provide:

- Back to Deck Selection;
- **Start Run** as the final commit action.

Do not provide:

- Program replacement;
- Program reordering;
- inventory;
- acquisition/ownership state;
- target selection;
- Function activation;
- a second non-save-related confirmation modal.

---

## 16. Quick Match Identity and Start Flow

Quick Match retains its direct single-battle title flow.

At Quick Match creation:

- resolve `HAK_01` and `DEK_01` explicitly;
- use the fixed Hacker Program roster;
- use the active System Program roster;
- apply current Settings and Normal LINK rules;
- store and log the default Hacker and Deck IDs;
- identify the selection source as defaulted rather than explicitly chosen;
- use the existing save-replacement confirmation when a valid save exists.

Quick Match does not show Hacker Selection, Deck Selection, or Build Review.

Missing or invalid default IDs prevent startup; do not select the first valid row.

---

## 17. Save, Resume, Compatibility, and Battle Identity

### 17.1 Save version

Update active save/build identity to Alpha 0.3.0 and increment the schema according to repository convention.

Alpha 0.2 and earlier saves are incompatible.

- Reject them cleanly.
- Do not infer `HAK_01`, `DEK_01`, Skills, Link state, or a new fingerprint into an old save.
- Do not partially load old battle state.
- Do not classify an expected version mismatch as arbitrary corruption.
- Return the user to the normal title/start flow with clear incompatibility behavior.

### 17.2 Required saved identity

Common Quick Match and Run save identity must include, directly or through an unambiguous typed envelope:

- build/save/schema version;
- normalized gameplay-content fingerprint;
- mode;
- explicit Hacker ID;
- explicit Deck ID;
- ordered Hacker Skill IDs;
- Deck Function ID and active-battle charge state;
- ordered Hacker Program IDs;
- ordered System Program IDs;
- saved battle configuration, including Reinforced Connection and Normal LINK state where applicable;
- effective Hacker maximum LINK;
- effective System maximum ICE or the saved Run encounter rule/state;
- active battle or pending-result discriminator;
- exact active battle state and deterministic RNG continuation.

Run saves additionally retain current step and existing Alpha 0.2 Run/result/progression context.

Do not store fake Run fields in Quick Match.

### 17.3 Restore validation

Restore must verify:

- save/schema compatibility;
- fingerprint equality;
- referenced Hacker, Deck, Skills, Deck Function, and Programs exist;
- saved ordered identities match the resolved content contract;
- mode-specific state is coherent;
- active battle and pending-result state restore exactly.

A failed identity or fingerprint check rejects the save rather than substituting current defaults.

### 17.4 Battle IDs

Replace timestamp-only battle IDs with a collision-resistant non-gameplay identifier.

Requirements:

- synchronous battle creation must not create duplicate IDs;
- identifier generation must not consume gameplay RNG;
- save/restore must preserve the active battle ID;
- a session identifier plus monotonic counter, UUID, or equivalent is acceptable after Senior inspection;
- logs across Quick Match, Run retries, Force Win overrides, and fresh encounters must remain distinguishable.

Do not rewrite historical pre-Alpha logs.

### 17.5 Save clearing

Preserve Alpha 0.2 save-clearing semantics except for the delayed New Run commitment in Section 12.

A pending result remains resumable until the user resolves it. Merely entering setup screens does not clear the resident save.

---

## 18. Result Screens, Wizard Controls, and Exit Wording

### 18.1 Force Win availability matrix

Force Win is never available during active combat.

| Context | Force Win shown? | Behavior |
|---|---:|---|
| Quick Match natural defeat | yes | Override defeat as wizard-forced victory. |
| Quick Match natural victory | no | Not shown. |
| Run Battle 1-3 natural defeat | yes | Override defeat and advance as a won battle. |
| Run Battle 4 natural defeat | yes | Override defeat and complete the Run. |
| Run Battle 1-3 natural victory | yes | Explicit use logs wizard action but does not skip or otherwise alter normal progression. |
| Run Battle 4 natural victory | no | Not shown. |
| Run Complete | no | Not shown. |

This overrides older wording that suggested Force Win on a successful between-battle screen skips an upcoming battle.

### 18.2 Natural result preservation

When Force Win overrides a defeat:

- preserve the original natural defeat;
- record the separate wizard action;
- apply normal mode-specific victory progression;
- do not rewrite the combat record as a natural victory.

When invoked after an already-natural Run victory under preserved Alpha 0.2 behavior:

- preserve normal progression unchanged;
- record the explicit wizard invocation;
- do not create an additional skipped encounter.

Use the existing separate wizard log stream/storage convention.

### 18.3 Pause and restart controls

Preserve the approved Alpha 0.2 mode distinction:

- Quick Match Pause retains its normal **Reset** control.
- Run Pause does not show **Reset**.
- Run restart actions remain result-screen wizard controls; do not reintroduce a competing Run-reset path in Pause.
- Preserve the existing visually distinct amber wizard-control styling.

### 18.4 Exit labels

Replace terminal **Quit** wording with:

```text
Back to Title
```

Use:

```text
Save and Quit
```

for resumable exits from:

- Pause;
- between-battle Run screens.

Do not change underlying save-clearing or preservation semantics merely by changing labels.

---

## 19. Player-Facing Vocabulary Formalization

Apply the following terms consistently across implemented player-facing setup, battle, character-sheet, status/help, result, and tutorial/help text:

| Generic/prior term | Player-facing Breach term |
|---|---|
| Player / player side | Hacker |
| Enemy / enemy side | System |
| Player health / HP | LINK |
| Enemy health / HP | ICE |
| Board / battlefield | Datastream |
| Gem / tile | Packet |
| Match | Sync |
| Destroy / remove | Slice |
| Unit | Program |
| Ability | Function |
| Coded game action | Effect |

Required visible replacements include at least:

- `YOU` -> `HACKER`;
- `ENEMY` -> `SYSTEM`;
- `LINK 150/150`-style Hacker stat labels;
- `ICE 250/250`-style System stat labels;
- `No valid Sync`;
- `Packets sliced` where such feedback exists;
- `Sync Damage`;
- `System ICE breached`;
- `Hacker LINK damaged`.

Rules:

- prose forms use Hacker, System, Datastream, Packet, Sync, Slice, Program, Function, Effect;
- compact stat labels may use uppercase LINK and ICE;
- `cascade` may remain unchanged;
- do not rename stable IDs or ID prefixes;
- technical internal code and analysis log keys may retain `player`, `enemy`, `hp`, `tile`, `board`, and `match` where migration would reduce clarity or create needless risk;
- player-readable log text should use the glossary;
- do not perform broad internal renaming solely for flavor.

---

## 20. Battle UI and Character-Sheet Cleanup

### 20.1 Existing layout

Preserve the successful Alpha 0.2 battle layout:

- Hacker avatar upper left;
- System avatar upper right;
- Pause between avatars;
- Hacker Programs vertically stacked left;
- System Programs vertically stacked right;
- Buff and Shield totals in avatar boxes;
- square Datastream centered within the viewport;
- compact bottom status/help region;
- wizard/debug controls excluded from player-facing layout evaluation.

### 20.2 System-turn input-lock indicator

While Hacker input is disabled during the System turn:

- draw an approximately `3px` red border around the battle viewport;
- dim the Datastream grid by approximately `10%`;
- do not dim avatars, Programs, status text, or visible System actions;
- remove both effects immediately when Hacker control resumes;
- do not alter turn timing, event ordering, input-lock semantics, or deterministic state.

Whether Pause and avatar sheets remain available during the System turn is deferred; preserve current behavior.

### 20.3 Character sheets

Preserve separate Hacker and System character sheets opened from the side avatars.

Update displayed content from resolved state:

- side name and LINK/ICE values where currently shown;
- strong colors;
- weak colors;
- strong shapes;
- weak shapes;
- Program names, bindings, Function names, and costs where the current fuller Alpha 0.1/0.2 sheet already presents them;
- Hacker Skill descriptions for the selected Hacker;
- Deck name and Deck Function summary on the Hacker side where it fits the existing sheet structure;
- general charge/neutral explanatory text remains at the bottom where currently intended.

Do not display Hacker `BIO`, Hacker `GRAPHICS`, Deck `DESCRIPT`, or Deck `GRAPHICS`.

Do not turn the sheet into build editing, inventory, or content-authoring UI.

---

## 21. Metrics, Logs, and Versioning

### 21.1 Build stamps

Update active build/version stamps to:

```text
alpha-0.3.0
```

Inspect browser logs, server JSONL, readable dumps, summaries, saves, test/simulation headers, and bundle metadata. Older strings may remain only in deliberate compatibility fixtures or historical content.

### 21.2 Selection and identity logging

Relevant battle, Run, save, and summary records must include:

- Hacker ID;
- Deck ID;
- ordered Skill IDs;
- Deck Function ID;
- ordered Hacker Program IDs;
- ordered System Program IDs;
- selection source: explicit New Run selection or Quick Match default;
- mode;
- Run step when applicable;
- effective maximum LINK and ICE context where useful;
- content fingerprint;
- battle ID.

Log committed selection events and final Run creation. Do not log mere preselection, screen viewing, or Back navigation as committed choices.

Run resume logs must identify the restored Hacker, Deck, fixed build, and Run step.

### 21.3 Skill and Deck metrics

Preserve current granular source-specific metrics.

At minimum distinguish:

- Skill trigger/attempt where consistent with current event patterns;
- `SKL_EXTRA_MATCH_DAMAGE` contribution;
- `SKL_EXTRA_MATCH_CHARGE` contribution;
- Deck Function charge gained from neutral Packet slices;
- Deck Function paid activation;
- `EFFECT_SHAKE` attempt, success, and legal fizzle;
- Shake-created Sync ownership and causal attribution;
- base Sync damage versus Skill damage under Reinforced Connection.

Do not merge all Function damage into one category. Do not double count damage or charge.

### 21.4 Wizard logging

Preserve the dedicated wizard log stream, including the existing `breach:log:wizard` / `wizard` JSONL convention where implemented.

Natural result and wizard action must remain separately visible.

### 21.5 Historical logs

Do not rewrite prior logs to replace historical unknown mode values or old vocabulary. Compatibility is forward-only for new records.

### 21.6 Logging failure

Logging failure must remain nonfatal to gameplay. Preserve server storage-threshold behavior and current graceful-failure boundaries.

---

## 22. Verification Requirements and Acceptance Scenarios

The coding agent decides the appropriate allocation among unit, integration, headless, simulation, and manual tests after inspecting the existing harness. Do not create a parallel browser-testing framework merely to satisfy one UI check when existing pure logic or geometry extraction is sufficient.

The final evidence must cover the following behavior.

### 22.1 Content and validation

Verify:

- all six required datasets load through the shared pipeline;
- valid Hacker, Skill, Deck, and extended Function rows resolve;
- wrong prefixes, missing references, malformed tuples, invalid `startCharged`, and invalid Skill placeholders fail startup;
- unused valid rows warn rather than fail;
- `BIO`, `GRAPHICS`, and `DESCRIPT` neither load assets nor affect gameplay startup;
- gameplay fingerprint changes for gameplay-field changes and remains stable for placeholder/notes/display-only changes.

### 22.2 Selection and fixed build

Verify:

- New Run follows Hacker -> Deck -> Build Review -> Battle 1;
- sole options may be preselected but require explicit forward action;
- all Decks appear for every Hacker;
- Back retains pending choices;
- returning to Title discards pending setup and preserves the resident save;
- Start Run is the only setup action that replaces/creates a Run save;
- Build Review shows the four Programs in battle order;
- no editing or inventory interactions exist.

### 22.3 Quick Match and defaults

Verify:

- Quick Match remains direct;
- it resolves `HAK_01` and `DEK_01` explicitly;
- it logs defaulted selection identity;
- invalid default IDs block startup;
- it does not show setup screens.

### 22.4 Save and restore

Verify:

- Alpha 0.2 save rejection is clean and nonpartial;
- Alpha 0.3 active battle and pending result restore Hacker, Deck, Skills, Deck Function charge, Program order, LINK/ICE, mode, Run step, and battle ID;
- content-fingerprint mismatch rejects restore;
- Run configuration remains stable after title Settings change;
- no battle ID collisions occur during rapid/synchronous battle construction.

### 22.5 Strength and LINK/ICE

Verify:

- Hacker strong sets come from `HAK_01`;
- weak and System complementary sets derive correctly for non-3/3 cardinalities;
- Normal LINK ON produces `BASE_LINK + ADD_LINK` Hacker LINK;
- Quick Match ICE equals resolved Hacker LINK under Normal LINK ON;
- Run ICE uses 100/150/200/250 under Normal LINK ON;
- Normal LINK OFF uses manual Hacker LINK and manual System ICE, including all Run encounters;
- hidden manual values are retained.

### 22.6 Skills

Verify:

- no hardcoded Red passive remains without Skill records;
- Red color-axis Sync triggers each current Skill once per resolved Red blob;
- shape-only Sync caused by moving a Red Packet does not trigger;
- overlapping Red color and shape Syncs trigger only from the Red-axis event;
- multiple distinct Red blobs trigger separately;
- cascades and Shake-created owned Syncs follow owner scope;
- System/opponent-owned Syncs do not trigger Hacker Skills;
- duplicate qualifying Skills stack;
- extra damage follows preserved critical/Buffer/Shield order and has separate attribution;
- extra charge modifies normal payout and remains active under Reinforced Connection.

### 22.7 Deck Function and Shake

Verify:

- Deck Function is Deck-owned in runtime, save, logs, and metrics;
- `startCharged` resets correctly at every battle;
- neutral Packet slices during qualifying owned match resolution charge the Deck Function;
- direct, line-clear, and cascade neutral slices qualify;
- Bomb destruction does not charge;
- Drain excludes Deck Function charge;
- all four Shake parameter axes validate and resolve;
- current `0:0:0:0` variant preserves composition and retained specials, prevents immediate Syncs, and performs no cascades;
- allowed post-Shake Syncs use initiator ownership;
- Replace removes underlying Packet/special state;
- legal fizzle leaves the Datastream unchanged and remains paid/logged.

### 22.8 B1 line clear

Verify:

- overlapping color/shape direct footprints can combine into a qualifying line;
- adjacent distinct direct match groups can combine into a qualifying line;
- every qualifying row and column fires once;
- intersections are sliced once;
- collateral does not contribute;
- line-clear destruction is nonrecursive;
- constituent groups still control damage, charge, Skills, and metrics.

### 22.9 Reinforced Connection and results

Verify:

- base Sync damage is suppressed for both sides;
- Skill/Function-triggered effects still occur;
- metrics remain separated;
- Force Win matrix matches Section 18;
- Battle 4 defeat can be Force Won to Run Complete;
- Quick Match defeat can be Force Won;
- natural victory behavior is not converted into battle skipping;
- exit labels and underlying save semantics remain correct.

### 22.10 UI and vocabulary

Verify:

- player-facing terminology is applied across implemented surfaces;
- System-turn border and grid dim appear only during input lock and do not cover side UI;
- selection/review screens are usable in the supported mobile/narrow layout;
- placeholder biography/graphics/description data is not displayed;
- existing battle layout and hitboxes do not regress.

### 22.11 Regression suite

Run the complete existing verification suite and all focused Alpha 0.3 checks. The exact command set follows repository availability and Senior inspection. Typical existing commands may include:

```bash
npm test
npm run smoke
npm run batch
npm run hpladder
npm run typecheck
npm run build
```

Report unavailable or intentionally inapplicable commands explicitly. Do not claim physical-device or visual checks that were not performed.

---

## 23. Alpha 0.3 Completion Standard

Alpha 0.3.0 is complete when:

1. Required Hacker, Skill, Deck, Program, and Function content loads, validates, resolves, and fingerprints through one shared pipeline.
2. New Run uses explicit Hacker Selection, Deck Selection, Build Review, and final atomic commitment.
3. Quick Match remains direct and uses explicit default identity.
4. The fixed Program build remains ordered and noneditable.
5. Hacker strength, LINK, Skills, Deck Function, and selection identity are data-authoritative.
6. The prior hardcoded Red passive is removed without behavioral duplication.
7. SCRAMBLE invokes the formal typed Shake Effect contract.
8. Deck charge, owner scope, `startCharged`, and Drain exclusion behave as specified.
9. B1 combined direct-match line-clear qualification works without recursive collateral qualification.
10. Normal LINK and Reinforced Connection behave and persist correctly.
11. Alpha 0.3 saves restore exact identity and reject Alpha 0.2 saves cleanly.
12. Force Win, exit wording, System-turn indication, vocabulary, and existing battle layout meet the specified UX behavior.
13. Metrics and logs preserve granular attribution and include selection/build identity.
14. Existing combat, Run progression, deterministic restore, and content architecture remain intact except for explicit changes.
15. Required verification passes or remaining manual checks are reported honestly.
16. README and source-control state were not modified by the coding agent.

---

## 24. Explicitly Out of Scope

Do not add:

- inventory screen or inventory state;
- Program acquisition, rewards, unlocks, or ownership;
- Program replacement or reordering;
- Deck-defined Program rosters;
- a Build dataset or editable build system;
- meaningful multiple-content balance pass;
- Hacker/Deck compatibility restrictions;
- System selection or System identity datasets;
- external encounter or Run-definition architecture;
- boss mechanics or boss content;
- battlefields, map effects, routing, or branching;
- charge overflow or top-to-bottom trickle-down;
- generalized neutral wildcard charging beyond the approved Deck charge rule;
- cross-battle charge persistence;
- generalized passive trigger scripting;
- generalized external Effect scripting;
- arbitrary Function nesting beyond existing rules;
- broad Function/Skill localization infrastructure;
- graphics asset loading for Hacker/Deck placeholder fields;
- biography or Deck description panels;
- final art, animation, audio, accessibility, or modal-availability polish;
- broad internal renaming solely to match flavor vocabulary;
- speculative handling for future destruction Effects that might grant charge;
- balance changes intended to compensate for possible B1 board churn;
- README changes;
- Git commits, branches, tags, staging, or remote repository operations.

---

# Part II - Two-Tier Implementation Workflow

## 25. Workflow Objective

Use a provisional two-tier implementation model:

- **Senior Developer / heavier model:** architecture inventory, shared content contracts, state ownership, save compatibility, match/effect event semantics, persistence, and final integration.
- **Junior Developer / lighter model:** bounded implementation inside established interfaces, UI against defined state APIs, data fixtures, labels, focused tests, and narrow log fields.

The Senior Developer must inspect the repository first and may refine the division. Optimize total token and rework cost rather than maximizing the percentage assigned to Junior.

## 26. Classification Rules

Keep a task with Senior when it:

- changes the shared loader/resolver/fingerprint contract;
- changes save envelopes or compatibility;
- introduces setup state or transition ownership;
- changes battle construction or identity;
- changes match-wave semantics, ownership, event ordering, RNG ownership, or damage attribution;
- integrates a new coded Effect/Skill contract across multiple systems;
- risks data loss, nondeterministic restore, or silent gameplay divergence;
- requires reconciliation between requirements and current architecture.

Delegate to Junior when it:

- follows a Senior-defined typed interface;
- extends established CSV fixtures or validation cases without choosing semantics;
- renders bounded setup/review screens from resolved view models;
- changes labels and visible vocabulary without altering state ownership;
- implements CSS/canvas indicators against existing turn/input state;
- adds narrow logs/metrics fields after event semantics are defined;
- adds focused tests with objective expected outcomes.

Do not spend more Senior effort decomposing a trivial task than direct completion would cost.

## 27. Required Junior Escalation Triggers

A Junior Developer must stop and escalate if the task unexpectedly requires:

- a new shared abstraction or parallel content pipeline;
- save schema or compatibility decisions;
- changed event ordering or causal attribution;
- changed deterministic RNG ownership;
- changed battle, result, Run, or setup lifecycle;
- interpretation of an unspecified gameplay rule;
- changes across interfaces outside the task packet;
- duplicating logic owned by content/state/combat layers;
- weakening an existing test or invariant;
- README or source-control changes.

---

## 28. Provisional Division of Labor

The Senior Developer must review and may reassign these tasks after Stage 1 inspection.

### SENIOR-0 - Architecture inventory and assignment refinement

**Purpose:** Establish the actual repository boundaries before code changes.

**Inspect:** content acquisition, schemas, validation phases, resolved content, fingerprinting, settings, title/screen state, save envelope, battle factory, Function/Effect registry, match detector/resolver, charge/damage attribution, metrics/logs, renderer/input layout, and tests.

**Deliverable:** Refined task plan, proposed types/interfaces, affected files, risks, and any requirement/code conflicts.

**Boundary:** No implementation before user authorization.

### SENIOR-1 - Content contracts and resolved identity foundation

**Responsibilities:**

- extend shared Function schema with `params` and `startCharged`;
- add Hacker, Skill, and Deck schemas;
- add typed Skill-effect and Shake parameter validation;
- resolve immutable Hacker/Skill/Deck definitions;
- derive complement strength sets;
- extend gameplay fingerprinting;
- define explicit default IDs;
- expose bounded selectors/view models for setup and battle construction.

**Acceptance:** Browser and Node share one pipeline; invalid content fails centrally; no hardcoded parallel identity remains.

**Likely delegation after foundation:** fixture CSV creation and focused parser tests.

### SENIOR-2 - Setup flow, save contract, and battle identity

**Responsibilities:**

- define pending New Run setup state and transitions;
- preserve old save until Start Run confirmation;
- extend battle/Run creation with Hacker and Deck identity;
- define Alpha 0.3 save envelope and Alpha 0.2 rejection;
- snapshot Normal LINK and effective LINK/ICE values;
- implement collision-resistant battle IDs independent of gameplay RNG;
- expose UI actions for Hacker choice, Deck choice, Back, Start Run, Quick Match defaults, and Continue.

**Acceptance:** One authority owns setup and persistence; UI callbacks do not mutate saves or construct battles ad hoc.

### SENIOR-3 - Combat integration: Skills, Deck charge, Shake, B1, and Reinforced Connection

**Responsibilities:**

- remove hardcoded Red passive;
- integrate typed Hacker Skills into owner-scoped Sync events;
- preserve critical/damage attribution order;
- add Deck-owned Function charge and `startCharged` lifecycle;
- exclude Deck from Drain;
- formalize `EFFECT_SHAKE` ownership, resolution, RNG, and fizzle behavior;
- implement B1 direct-footprint qualification without corrupting constituent match events;
- scope Reinforced Connection to base Sync damage only;
- define event/metric interfaces for Junior log/test work.

**Acceptance:** No duplicate match/Skill/Shake logic; deterministic behavior and existing attribution invariants remain intact.

### JUNIOR-1 - Alpha 0.3 content files and validation fixtures

**Dependencies:** SENIOR-1 contracts.

**Responsibilities:**

- add/update Hacker, Skill, Deck, and Function CSV resources;
- include corrected `DEK_01` and `FNC_010` records;
- add valid/invalid fixtures for prefixes, references, tuples, `startCharged`, warnings, and display placeholders;
- avoid choosing new validation semantics.

**Escalation:** Any mismatch between supplied data and Senior schema returns to SENIOR-1.

### JUNIOR-2 - Hacker Selection, Deck Selection, and Build Review UI

**Dependencies:** SENIOR-1 resolved view models and SENIOR-2 transition APIs.

**Responsibilities:**

- render all required option fields;
- preselect sole options while requiring explicit forward action;
- implement Back behavior;
- render fixed ordered Build Review;
- wire Start Run through Senior-defined atomic commit API;
- preserve mobile/narrow layout;
- ensure placeholder BIO/GRAPHICS/DESCRIPT fields are not displayed.

**Boundary:** No direct save mutation, content parsing, or battle construction.

### JUNIOR-3 - LINK/ICE settings presentation and vocabulary cleanup

**Dependencies:** SENIOR-2 configuration contract.

**Responsibilities:**

- add/rename Normal LINK control;
- hide/show manual LINK/ICE fields while preserving values;
- apply player-facing vocabulary across implemented surfaces;
- update character-sheet labels/content from resolved view models;
- avoid broad internal renaming.

**Escalation:** Any behavior choice about settings ownership returns to SENIOR-2.

### JUNIOR-4 - Result controls, exit labels, and System-turn indicator

**Dependencies:** Existing Alpha 0.2 result APIs and SENIOR-2 state contract.

**Responsibilities:**

- implement the Force Win visibility matrix without changing transition logic locally;
- update Back to Title and Save and Quit wording;
- render the red viewport border and 10% Datastream dim from existing input-lock state;
- preserve existing layout/hitboxes.

**Boundary:** No direct progression or save mutation in rendering/modal code.

### JUNIOR-5 - Logs, metrics fields, version stamps, and focused tests

**Dependencies:** SENIOR-1 through SENIOR-3 event contracts.

**Responsibilities:**

- add identity/selection fields to existing records;
- preserve dedicated wizard stream;
- add source-specific Skill and Deck fields using existing metric patterns;
- update active stamps to `alpha-0.3.0`;
- add focused tests for Sections 22.1-22.10;
- document manual checks honestly.

**Escalation:** Any need to redefine event ordering, causal buckets, or storage schema returns to Senior.

### SENIOR-4 - Integration review and final verification

**Responsibilities:**

- review all delegated work for contract compliance;
- remove duplicate or UI-owned logic;
- verify loader, battle construction, save/restore, match resolution, metrics, and UI agree on identity;
- inspect deterministic RNG and battle ID behavior;
- run the full available verification suite;
- inspect diffs for unrelated scope;
- confirm README and source control were untouched;
- produce the final report.

---

# Part III - Coding Agent Execution Instructions

## 29. Stage 1 - Required Inspection and Authorization Stop

The first session must use the Senior Developer/heavier model.

Before writing implementation code, inspect and report:

1. Current repository/build identity and any uncommitted work relevant to Alpha 0.3.
2. Current Program/Function CSV headers and whether the shipped files differ from the latest supplied data-structure sheets.
3. Browser and Node resource-acquisition paths.
4. Shared parser, validation phases, resolver, and immutable content types.
5. Current content fingerprint normalization and excluded fields.
6. Current hardcoded Hacker strong/weak sets and Red passive locations.
7. Current match-group/blob representation, axis identity, resolution-wave boundaries, line-clear generation, and destruction deduplication.
8. Current damage order, critical rounding/allocation, Reinforced/No Match Damage path, and source-specific metrics.
9. Current Program charge distribution and ownership semantics, including neutral Packet handling and Bomb non-charge behavior.
10. Current Board-Shake implementation, parameters, RNG use, anti-lock guarantees, special-object handling, ownership, and failure path.
11. Current Function ownership/charge model and how a Deck-owned Function can reuse it without becoming a Program.
12. Current Drain target typing and System priority implementation.
13. Current title, Quick Match, New Run, Continue, and screen/state ownership.
14. Current save envelope, schema/version checks, pending-result restore, Run snapshot, and save replacement confirmation.
15. Current battle ID generation and every persistence/log consumer.
16. Current LINK/HP settings and how Alpha 0.2 snapshots Hacker/System health.
17. Current Force Win visibility and behavior in every natural result state.
18. Current battle layout, input-lock state, character sheets, notices, and terminology sources.
19. Current metrics/log event schemas, wizard stream, build stamps, and simulation output.
20. Existing tests/fixtures appropriate for each Section 22 acceptance scenario.
21. Any conflict between this handoff and current implementation that materially affects architecture or player-visible behavior.
22. Any requirement that would force unrelated refactoring.
23. Proposed exact types/interfaces for:
    - raw and resolved Hacker, Skill, Deck, and extended Function content;
    - typed Skill parameters;
    - typed Shake parameters;
    - active Hacker/Deck identity;
    - pending New Run setup;
    - Quick Match and Run save identity;
    - Deck Function charge state;
    - resolution-wave direct-match footprint and line-clear events.
24. Proposed state-transition diagram for:
    - Title -> New Run setup -> Start Run;
    - Back navigation and pending setup discard;
    - Quick Match default identity;
    - Continue active battle/pending result;
    - natural defeat -> Force Win progression;
    - natural victory -> preserved progression.
25. Refined Senior/Junior assignment table containing dependencies, affected systems, boundaries, acceptance criteria, escalation triggers, and token-efficiency rationale.

### Stage 1 decision rule

Resolve implementation details through inspection when they do not alter the specified data contract or player-visible behavior. Escalate only material conflicts that require changing architecture, persistence, event semantics, gameplay behavior, or acceptance criteria.

**Stop after the inspection and refined assignment report. Wait for user authorization before implementation.**

Do not modify code, content files, README, Git state, or any remote repository during Stage 1.

---

## 30. Stage 2 - Implementation After Authorization

After authorization:

1. Complete Senior foundation contracts before delegating dependent work.
2. Give Junior agents bounded task packets with exact interfaces, likely files, tests, and escalation triggers.
3. Reclassify tasks when inspection reveals different coupling.
4. Keep content parsing in the shared startup pipeline.
5. Keep setup/progression/save ownership out of renderer callbacks.
6. Keep match, Skill, charge, and Effect rules in combat/state layers.
7. Preserve deterministic RNG ownership.
8. Use one authoritative Hacker, Deck, Skill, Shake, line-clear, and LINK/ICE path.
9. Implement only Alpha 0.3 scope.
10. Do not add speculative inventory, build, encounter, passive scripting, graphics, or balance systems.
11. Do not perform source-control writes or remote operations.
12. Do not modify README.
13. Finish with mandatory Senior integration review.

---

## 31. Final Verification

Run the full existing suite and the focused checks selected during Stage 1.

Report exact commands and results. Report unavailable commands, skipped checks, and manual-only checks explicitly. Do not claim visual, browser, or physical-device verification that was not performed.

Do not create a commit after verification.

---

## 32. Final Report

Report:

- refined Senior/Junior division actually used;
- tasks delegated, reclaimed, or merged and why;
- files changed;
- final Hacker, Skill, Deck, and Function schemas;
- startup validation and fingerprint changes;
- resolved identity architecture;
- New Run setup state and transitions;
- Quick Match default identity behavior;
- Build Review behavior;
- save version, Alpha 0.2 rejection, and restore behavior;
- battle ID solution;
- Normal LINK and effective LINK/ICE behavior;
- Skill trigger, damage, charge, ownership, and metrics behavior;
- Deck Function charge, `startCharged`, and Drain exclusion;
- `EFFECT_SHAKE` validation, execution, ownership, and fizzle behavior;
- B1 line-clear implementation and any observed churn implications;
- Reinforced Connection behavior and attribution;
- Force Win matrix and result/exit behavior;
- vocabulary and System-turn UI changes;
- automated commands run and exact results;
- manual checks performed and still required;
- deviations from this handoff;
- defects or architectural concerns discovered;
- known limitations and deferred items;
- recommended README changes for the user, without editing README;
- confirmation that no source-control write, remote operation, or README modification occurred.
