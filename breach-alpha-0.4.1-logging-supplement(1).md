# Breach Alpha 0.4.1 — Logging-System Supplement and Coding-Agent Handoff

**Build identity:** `alpha-0.4.1`

**Document type:** Supplement to the canonical Alpha 0.4.0 coding-agent handoff.

**Primary objective:** Replace the browser’s single-detail, full-history persisted turn logging with a versioned BASIC / VERBOSE / COMPLETE system that preserves high-value design and debugging telemetry while staying within a safe storage budget and avoiding repeated multi-megabyte parse/stringify/write operations.

---

## 0. Authority, Scope, and Supplied Material

This document supplements the Alpha 0.4.0 requirements. All Alpha 0.4.0 gameplay, data, build, save, UI, combat, metrics, and source-control rules remain in force unless this document explicitly changes a logging or telemetry requirement.

The coding agent will receive:

- this Alpha 0.4.1 supplement;
- the Alpha 0.4.0 repository state;
- the Alpha 0.4.0 coding-agent handoff and current data/reference files as needed for context.

Use sources in this order:

1. This Alpha 0.4.1 supplement for logging behavior, retention, versioning, storage-pressure behavior, and the charge-waste metric correction.
2. The Alpha 0.4.0 coding-agent handoff for unchanged build behavior, repository boundaries, and verification expectations.
3. The current repository implementation and tests.
4. Older requirements and design material only for unchanged historical context.

If repository inspection reveals that the current stream ownership or storage layout makes a stated requirement materially unsafe or impossible without broader persistence changes, report the exact conflict during Stage 1. Do not silently weaken retention, discard high-priority telemetry, or create a second parallel logging system.

### 0.1 Narrow patch scope

Alpha 0.4.1 is a logging and telemetry maintenance build. It must not alter:

- combat rules;
- Program, Function, Effect, Skill, build, inventory, targeting, or charge-routing behavior;
- damage values or balance;
- active battle or Run save schema 3;
- gameplay RNG consumption;
- renderer timing or animation pacing;
- selection, Build, Run, or Quick Match flows;
- current external content contracts.

The renderer performance issue that led to the logging investigation is independent. Do not use logging changes as a substitute for a renderer fix, and do not include unrelated renderer work in this patch unless the user separately authorizes it.

### 0.2 Source-control and README boundary

The user controls source control and README maintenance.

The coding agent must not:

- access or interact with a remote repository;
- stage or commit files;
- create branches, tags, or stashes;
- run source-control write operations;
- modify `README.md` or a replacement README.

Read-only inspection such as `git status`, `git diff`, and `git log` is permitted. The final report may recommend README changes.

---

# Part I — Problem and Required Outcome

## 1. Measured Problem

Alpha 0.4 investigation found persisted turn logs to be the dominant browser-storage and logging-performance problem.

Measured sample:

- 30 headless battles;
- 358 turn entries;
- approximately 11.9 turns per battle;
- approximately 2,778 serialized bytes per turn entry;
- current turn cap of 4,000 entries;
- projected turn-log footprint near 10.9 MB;
- projected total persisted logging footprint near 13.3 MB;
- typical browser `localStorage` budget near 5 MB per origin.

The current append path rereads, parses, extends, serializes, and rewrites an entire persisted array for each new entry. Near the cap, this creates main-thread work proportional to the complete retained history, can exceed quota, and may trigger failed writes and retry churn.

The turn stream is the primary problem. Battle metrics, committed selection/build records, wizard events, Drain telemetry, and targeted-Function telemetry provide substantially more analytical value per byte and must remain available.

## 2. Completion Outcome

Alpha 0.4.1 is complete when:

1. BASIC, VERBOSE, and COMPLETE logging levels exist.
2. Production/default human play uses BASIC.
3. Development builds default to VERBOSE.
4. COMPLETE is explicit, visibly identified, and short-retention.
5. Battle-static identity and configuration are no longer repeated in BASIC or VERBOSE turn records.
6. BASIC stores no ordinary per-turn reconstruction stream.
7. VERBOSE stores compact turns and only analytically interesting charge routes.
8. COMPLETE stores all charge routes and additional diagnostic detail.
9. Ordinary one-recipient, zero-discard routing is omitted from BASIC and VERBOSE.
10. Metrics, committed selection/build events, wizard actions, targeted Functions, Drain events, detonations, line clears, reshuffles, and interesting routes remain available.
11. Persisted logging stays under a defined safe browser-storage budget.
12. High-volume streams no longer require rereading and rewriting the full retained history on each append.
13. Storage trimming occurs before an expected quota failure.
14. A quota or storage failure cannot interrupt gameplay or enter an unbounded retry loop.
15. Exports identify logging schema and level.
16. Legacy Alpha 0.4 turn records are handled explicitly rather than partially interpreted.
17. The legacy per-Program `chargeWasted` metric is replaced by total discarded charge at battle level.

---

# Part II — Logging Model

## 3. Logging Levels

Use the exact enum values:

```text
BASIC
VERBOSE
COMPLETE
```

Every persisted record created under this system must either carry its logging level or belong to an export section whose level is explicit and unambiguous.

### 3.1 Defaults

- Production/non-development default: `BASIC`.
- Development default: `VERBOSE`.
- `COMPLETE` must never be the implicit default.

A previously saved explicit developer choice may override the environment default. The preference must be versioned and validated. Invalid or unknown values fall back to the environment default.

### 3.2 Mode changes

Changing logging level affects future records only.

- Do not reinterpret old records as though they were created under the new level.
- Do not duplicate records when the mode changes.
- Retained records from different levels may coexist and must preserve their original level tags.
- A mode change must not clear metrics, selection, wizard, targeting, or Drain telemetry.

### 3.3 Developer control

Expose the logging level through the established developer/wizard configuration surface rather than normal player-facing game settings.

The control must:

- show the active level;
- identify COMPLETE as short-retention diagnostic logging;
- avoid modal confirmation for BASIC or VERBOSE;
- require an explicit selection to enter COMPLETE;
- persist the validated preference independently of the active game save.

No polished player tutorial or production-facing explanation is required.

---

## 4. Record Ownership and Join Model

### 4.1 Battle-static context

Write battle-static context once per battle and reference it by `battleId`.

Do not repeat the following inside BASIC or VERBOSE turn records:

- battle `identity`;
- battle `config`;
- active Program order;
- inventory;
- Hacker/Deck selections;
- content fingerprint.

These values belong to the battle-level metrics/context record already keyed by `battleId`.

Every turn or event child record must be joinable through at least:

```text
battleId
loggingSchemaVersion
loggingLevel
```

The battle-level record remains the authority for identity, config, inventory, active build/order, build source, and content fingerprint.

### 4.2 Preserve the logic event stream

Do not reduce or mutate the underlying deterministic logic-layer event stream merely to reduce persisted log size.

Filtering, compaction, and presentation belong at the logging/persistence boundary. Existing metrics and renderer consumers must continue to receive the events they require.

### 4.3 High-value event stream

BASIC has no ordinary turn stream but must still preserve rare/high-value structured events. Use the existing stream structure where it can satisfy this requirement without duplication; otherwise introduce one coherent battle-event stream keyed by `battleId`.

The implementation must not create parallel duplicate copies of the same event solely because different logging levels exist.

---

# Part III — Persisted Content by Level

## 5. BASIC Requirements

BASIC is the default long-retention mode for normal human play and design analysis.

### 5.1 Persist in BASIC

Persist:

- one battle metrics/context record per completed battle;
- battle result and final totals;
- damage categories and existing source-specific metrics;
- one committed selection/build record for meaningful Hacker, Deck, inventory, active-build, or order changes;
- Run or Quick Match creation and battle-build application records;
- wizard actions;
- reshuffle events;
- detonation events;
- B1 line-clear events;
- targeted Function activations and outcomes;
- Drain activations and their established target telemetry;
- interesting charge-route records as defined in Section 8;
- logging schema version, logging level, build version, and battle join keys.

### 5.2 Do not persist in BASIC

Do not persist:

- ordinary per-turn snapshots;
- ordinary one-recipient, zero-discard charge routes;
- repeated `identity` or `config`;
- per-route `order`;
- per-route `eligible` lists;
- human-readable `actions[]` mirrors when equivalent structured data exists;
- UI navigation noise, inspection-modal opens, Back navigation, abandoned edits, or uncommitted clicks.

### 5.3 BASIC review goal

A BASIC export must still allow an analyst to determine:

- the resolved Hacker, Deck, inventory, build, and Program order;
- who won and battle duration;
- major damage sources;
- whether targeting, Drain, overflow, Skill-modified charge, Effect-generated charge, detonations, line clears, reshuffles, or wizard controls materially appeared.

It is not required to reconstruct every turn.

---

## 6. VERBOSE Requirements

VERBOSE is the default active-development and routine-playtesting mode.

### 6.1 Persist in VERBOSE

Persist everything required by BASIC, plus one compact record per completed game turn containing:

- `battleId`;
- turn index/number;
- acting side or completed phase where required to interpret the record;
- Hacker LINK after the turn;
- System ICE after the turn;
- active Hacker Program charge after the turn, keyed by stable Program ID or unambiguous active slot;
- Deck Function charge after the turn;
- System Program charge after the turn where currently available in the turn state;
- per-turn damage totals using existing disjoint categories;
- compact structured references or embedded fields for unusual events occurring during that turn;
- targeted Function and Drain records;
- interesting charge routes as defined in Section 8.

### 6.2 Do not persist in each VERBOSE turn

Do not persist:

- `identity`;
- `config`;
- inventory;
- active order;
- full Program definitions;
- content fingerprint;
- derived eligible lists;
- redundant player-readable mirrors of structured action data.

### 6.3 Human-readable actions

Do not persist the current human-readable `actions[]` mirror in VERBOSE when it duplicates structured data.

Readable export text may be generated from structured records at export or dump time. COMPLETE may retain raw action mirrors.

---

## 7. COMPLETE Requirements

COMPLETE is opt-in diagnostic logging for short investigations.

Persist everything required by VERBOSE, plus:

- every charge route, including ordinary single-recipient routes;
- active Program order at routing time;
- eligible Program IDs at routing time;
- full structured targeted-Function detail;
- full structured Drain detail;
- human-readable action mirrors;
- additional transient-event detail already available and useful for reproduction;
- explicit mode identification in every export and diagnostic summary.

Do not repeat battle-static `identity` and `config` in every COMPLETE turn merely for convenience. COMPLETE remains join-based through `battleId`; its additional detail concerns transient execution, not redundant static context.

COMPLETE must use the short retention defined in Section 11 and must not share VERBOSE’s turn cap.

---

# Part IV — Charge Routing and Metrics

## 8. Charge-Route Persistence Policy

### 8.1 Interesting-route predicate

A charge route is interesting and must be persisted in BASIC and VERBOSE when at least one condition is true:

1. More than one Program receives nonzero charge.
2. Nonzero charge is discarded after all compatible active Programs are full.
3. A Skill modifies the generated stream.
4. An Effect generates the stream.
5. A future explicitly coded source marks the route as diagnostically significant.

Ordinary routing where one compatible Program receives the full generated amount and zero charge is discarded must not be persisted in BASIC or VERBOSE.

COMPLETE persists every route.

### 8.2 Irreducible persisted route fields

Whenever a route is persisted in any level, retain:

- charge source category;
- stable source ID where applicable;
- owner/side;
- axis or charge type;
- token/color/shape where applicable;
- generated amount;
- assignments in routing order;
- recipient Program ID;
- charge before assignment;
- amount assigned;
- charge after assignment;
- overflow passed onward where needed to interpret multi-recipient routing;
- final discarded amount.

### 8.3 Redundant route fields

In BASIC and VERBOSE, omit:

- active `order` copied into each route;
- full `eligible` Program list.

The order is battle-static and belongs to battle identity. Eligibility is derivable from active order, Program bindings, axis, and token.

COMPLETE may retain `order` and `eligible` for diagnosis.

### 8.4 Charge-waste metric correction

Replace the legacy per-Program `chargeWasted` interpretation.

Required new behavior:

- record total charge discarded after routing at battle level;
- do not attribute end-of-stream discarded charge to the bottom-most compatible Program;
- preserve per-route `discarded` values when the route itself is retained;
- aggregate all discarded route amounts into one battle-level total such as `chargeDiscardedTotal`;
- do not add separate color-versus-shape waste totals in Alpha 0.4.1;
- axis-specific waste may be added later only if metrics analysis demonstrates a concrete use.

Historical metrics records may retain their old field and schema. New records must be distinguishable by metrics/logging schema version and must not populate misleading per-Program waste attribution.

---

# Part V — Stream Priorities and Selection Noise

## 9. Priority Order

Under storage pressure, preserve streams and fields in this order:

1. Battle metrics/context.
2. Committed selection/build records.
3. Wizard actions.
4. Targeted Function telemetry.
5. Drain telemetry.
6. Interesting charge routes.
7. Detonation, line-clear, and reshuffle events.
8. Compact VERBOSE turn state.
9. Human-readable action mirrors.
10. COMPLETE-only ordinary route and transient detail.

Within a priority class, trim oldest records first unless doing so would leave a child record without any retained battle-level context. Avoid retaining unjoinable orphan records.

## 10. Selection and Build Logging

Keep committed events that explain active identity and build state:

- Hacker selected;
- Deck selected;
- Run created;
- Quick Match created;
- Build opened when it represents a committed resumable Run state;
- Program replaced;
- active order changed;
- battle build applied;
- remembered Constructed build committed.

Do not add or retain low-value UI noise:

- modal opened or closed;
- Program inspected;
- Back navigation;
- selection merely highlighted;
- abandoned build edits that were never committed to a resumable state or battle;
- repeated copies of unchanged identity when a battle/run reference already joins to it.

---

# Part VI — Retention and Storage Budget

## 11. Retention Targets

Retention is governed first by the total byte budget in Section 12 and second by these caps:

- **BASIC:** retain up to approximately 1,000 completed battles and their high-priority events.
- **VERBOSE:** retain at most 750 compact turn records.
- **COMPLETE:** retain at most 150 turn records.

These are hard maximum counts, not guaranteed minimums. The byte budget may require earlier oldest-first trimming.

Records from different levels may coexist. Apply each level’s turn cap to records created under that level.

Battle metrics should receive the longest retention. COMPLETE diagnostic detail should be the first mode-specific detail removed under pressure.

## 12. Total browser logging budget

Define one browser persisted-logging budget:

```text
3 MiB estimated storage footprint
```

The budget covers all Breach browser logging keys and retained log metadata, but not the active game save or non-log preferences.

Estimate localStorage usage conservatively using serialized key/value lengths and at least two bytes per JavaScript string code unit. The implementation may use a more accurate conservative estimator if already available.

After any successful logging append and required trim, estimated persisted logging must not exceed the configured budget.

Do not raise the budget merely because a browser permits more than the typical quota. The purpose is to retain headroom for active saves, preferences, browser implementation differences, and unrelated origin storage.

### 12.1 Budget constants

All caps and byte budgets must be centralized constants, not scattered literals. The final report must state the chosen constant names and measured post-change record sizes.

---

# Part VII — Persistence Mechanics and Failure Behavior

## 13. Bounded-write requirement

The current full-array append strategy is prohibited for high-volume turn/event history.

A normal append must not reread, parse, stringify, and rewrite the complete retained turn history.

Implement a bounded-write persistence strategy such as:

- chunked append-only JSON segments with a small index;
- a ring of bounded segments;
- per-record keys with bounded metadata;
- another equivalent design that rewrites only a bounded current segment and small metadata.

The agent may choose the exact strategy after Stage 1 inspection, but it must satisfy all of the following:

- append cost does not grow linearly with total retained history;
- trimming can remove oldest records without rewriting every retained record;
- each stream remains exportable in chronological order;
- incomplete or corrupt segments fail cleanly;
- mode changes do not require rewriting prior records;
- the storage adapter remains testable without a browser.

Target a maximum normal segment/value size of 128 KiB or less. If the chosen architecture requires a larger bounded segment, report the reason during Stage 1 before implementation.

## 14. Pre-write trimming

Before calling browser storage for an append that would exceed the budget:

1. calculate the projected conservative footprint;
2. trim lower-priority and oldest eligible records according to Sections 9–12;
3. remove orphan child records if their battle context is removed;
4. recompute the projected footprint;
5. write only when projected storage is within budget.

A failed `setItem` must not be the normal trigger for retention trimming.

## 15. Quota and storage failure

If browser storage still throws after preflight:

1. catch the failure;
2. perform one emergency priority trim;
3. retry the failed write once;
4. if the retry fails, disable lower-priority persisted logging for the remainder of the session;
5. preserve gameplay and in-memory logic operation;
6. emit one diagnostic warning for the session;
7. do not enter repeated retry behavior on every subsequent event.

Metrics are highest priority, but no logging write may block gameplay indefinitely. If even the smallest high-priority record cannot be stored, continue play and mark persisted logging unavailable for the session.

The logging failure path must not mutate battle state, consume RNG, or change combat timing.

## 16. Storage isolation

Keep browser persisted-log behavior separate from:

- the active save slot;
- Constructed Quick Match preference storage;
- server/filesystem JSONL logging and its existing filesystem-usage guard;
- headless simulation result generation.

A browser log trim or clear must not delete or invalidate an active game save.

---

# Part VIII — Schema Versioning, Legacy Handling, and Export

## 17. Schema versions

Introduce a new browser logging schema version for Alpha 0.4.1.

Do not change the active game save schema solely for this logging patch.

At minimum, distinguish:

- logging/export schema version;
- metrics schema version where the charge-waste field changes;
- record logging level;
- game/build version.

## 18. Alpha 0.4 legacy logs

Legacy Alpha 0.4 turn records are incompatible with the compact/join-based shapes and are the source of the storage problem.

Required startup behavior:

- detect the legacy persisted turn-log key/schema;
- do not partially parse legacy turn entries as Alpha 0.4.1 records;
- clear the legacy turn-history stream on first Alpha 0.4.1 startup;
- clear any legacy low-priority human-readable turn/action mirror stored with that stream;
- retain unaffected metrics, committed selection/build, and wizard streams when their existing records remain structurally valid and independently keyed;
- retain targeted/Drain records only where they are independently versioned and valid; otherwise treat them as part of the cleared legacy turn stream;
- record or emit one migration diagnostic indicating what was cleared and what was retained.

If the current repository stores all streams in one inseparable envelope, do not invent a silent partial migration. Report that conflict during Stage 1 and propose the smallest safe clear/retain boundary.

## 19. Export contract

Every exported logging package must include an envelope with:

- game/build version;
- logging schema version;
- metrics schema version;
- export timestamp;
- active logging level at export time;
- levels present in retained records;
- retention constants or a compact retention summary;
- estimated retained browser-log footprint;
- content fingerprint or battle-level fingerprints through the existing metrics/context records;
- records grouped or typed so joins by `battleId` remain unambiguous.

Exports must preserve chronological ordering within each stream and include each record’s original logging level.

Readable dump generation may derive player/developer-readable action text from structured records. Do not persist duplicate text merely to make export formatting easier.

Unknown or corrupt segments must be reported in the export diagnostics and skipped safely rather than crashing export or gameplay.

---

# Part IX — Validation and Acceptance Tests

## 20. Automated acceptance tests

Add focused automated coverage for at least the following:

### 20.1 Mode field sets

- BASIC persists only its allowed record classes and fields.
- VERBOSE adds compact turns but omits battle-static data and redundant route fields.
- COMPLETE retains every charge route plus `order`, `eligible`, and action mirrors.
- Every persisted record or containing section identifies logging level and schema.

### 20.2 Join behavior

- BASIC and VERBOSE turn/event records join to the correct battle metrics/context through `battleId`.
- No retained child record is left without retained battle context after trimming.
- Identity/config are not copied into BASIC or VERBOSE turn records.

### 20.3 Route filtering

- one-recipient, zero-discard ordinary route is omitted in BASIC and VERBOSE;
- multi-recipient route is retained;
- discarded-charge route is retained;
- Skill-modified route is retained;
- Effect-generated route is retained;
- COMPLETE retains all routes;
- persisted assignments retain before/assigned/after/discarded correctness.

### 20.4 Charge-waste metrics

- new battles aggregate discarded routing into one battle-level total;
- no new per-Program `chargeWasted` attribution is produced;
- sum of retained or internal routing discarded values equals the battle total;
- no axis-specific waste field is required.

### 20.5 Retention and budget

- BASIC, VERBOSE, and COMPLETE caps apply independently;
- byte budget overrides entry count;
- lower-priority records trim before higher-priority records;
- oldest eligible records trim first;
- projected trim occurs before the storage call;
- total estimated logging footprint remains at or below 3 MiB after successful append;
- active save and non-log preferences remain untouched.

### 20.6 Bounded persistence

Use an instrumented storage adapter to prove:

- appending one record does not read or rewrite the complete retained history;
- maximum normal segment/value write remains bounded;
- append serialization work does not increase in proportion to total retained record count;
- trimming removes bounded segments/records without rewriting the full history;
- exports still reconstruct chronological order.

Do not use fragile wall-clock thresholds as the sole automated performance proof. Assert operation counts, bytes serialized/written, and bounded segment behavior. A supplemental timing measurement may be reported.

### 20.7 Failure handling

- expected over-budget append trims before write;
- one simulated quota failure triggers one emergency trim and one retry;
- a second failure disables lower-priority persistence for the session;
- subsequent events do not trigger repeated failing writes;
- gameplay-facing logic continues;
- one session diagnostic is emitted.

### 20.8 Migration and mode changes

- Alpha 0.4 legacy turn history is cleared once and not partially interpreted;
- structurally compatible high-priority streams are retained;
- a mode change affects future records only;
- old and new levels coexist in export without corruption;
- invalid logging preference falls back to the environment default.

### 20.9 Regression suite

Run and report the repository’s complete verification suite, including at least:

```bash
npm run typecheck
npm test
npm run smoke
npm run batch
npm run hpladder
npm run build
```

Automated battle outputs and gameplay metrics must remain equivalent except for explicitly changed logging/metrics schemas and nondeterministic wall-clock data.

## 21. Manual verification

Perform and report:

1. A normal BASIC human battle and export review.
2. A VERBOSE battle showing compact turn-by-turn LINK, ICE, charge, and damage.
3. A COMPLETE short session showing ordinary and interesting routes, `order`, `eligible`, and action mirrors.
4. A mode change during one browser session, confirming future-only behavior.
5. A synthetic or real long session near retention limits, confirming no noticeable logging-related main-thread degradation.
6. Browser storage inspection confirming the total retained logging footprint remains under budget.
7. Legacy Alpha 0.4 log startup handling.
8. Storage-unavailable or simulated quota behavior, confirming gameplay continues.
9. Export readability and battle joins for each level.

The unrelated renderer pacing defect is not part of this manual acceptance list.

---

# Part X — Single-Agent Process

## 22. Stage 1 — Mandatory inspection and authorization stop

Before changing code, inspect the repository and report:

- current browser logging keys and record schemas;
- current append/read/trim/export paths;
- which streams are independently keyed versus embedded in turn records;
- actual current average and maximum serialized sizes for representative metrics, selection, wizard, turn, targeted, Drain, and route records;
- how browser logs differ from server/filesystem logs;
- current developer controls and console helpers;
- current schema/version fields;
- current tests covering storage, export, and metrics;
- proposed bounded-write storage design;
- proposed legacy clear/retain boundary;
- proposed exact centralized constant names;
- proposed implementation phases and dependencies;
- any requirement conflict or necessary escalation.

Do not begin implementation until the user authorizes the Stage 1 plan.

## 23. Single-agent responsibilities

One coding agent owns the full Alpha 0.4.1 patch from inspection through final verification. The agent is responsible for:

- final log ownership and schema design;
- bounded-write/chunked persistence architecture;
- total-budget accounting and priority trim behavior;
- quota-failure state machine;
- legacy schema handling;
- battle/child join integrity;
- metrics schema change for total discarded charge;
- integration with current export and browser/server logging boundaries;
- logging-level developer control;
- record allowlists and field-shape implementation;
- export formatting and readable derived action text;
- focused fixtures and automated acceptance tests;
- manual browser verification;
- final integration review and report.

The agent may organize the work into internal phases but retains end-to-end ownership of architecture, implementation, integration, and verification.

## 24. Escalation triggers

Stop and ask for authorization if repository inspection or implementation reveals any of the following:

- the required bounded-write design cannot be achieved safely with the current browser storage boundary;
- independently retaining high-priority streams requires a broader legacy migration than specified;
- the change would alter battle event semantics, combat state, RNG use, or renderer timing;
- the change would require modifying active save schema 3 or coupling logs to active-save lifecycle;
- the 3 MiB budget cannot preserve the required high-priority records under representative use;
- satisfying the requirements requires IndexedDB, compression, or another explicitly deferred technology;
- an acceptance test must be weakened or removed;
- source-control or README changes appear necessary.

Do not silently broaden scope, weaken telemetry priority, or substitute a parallel logging system.

## 25. Implementation order

1. Complete Stage 1 inspection and receive authorization.
2. Finalize schemas, storage adapter boundary, budget constants, migration, and failure behavior.
3. Implement bounded persistence and its tests before adding UI controls.
4. Implement level filters and the route-interest policy.
5. Implement the charge-waste metric correction.
6. Implement mode control and export changes.
7. Run focused automated tests.
8. Run the complete verification suite.
9. Perform manual browser checks.
10. Perform a final end-to-end integration review against this supplement.
11. Produce the final report without source-control or README writes.

---

# Part XI — Final Report Requirements

## 26. Required final report

The coding-agent report must include:

1. Implementation summary by architecture area.
2. Exact logging schema and metrics schema versions.
3. Exact centralized budget and retention constants.
4. Storage strategy and why append cost is bounded.
5. Legacy Alpha 0.4 log handling.
6. Record field differences among BASIC, VERBOSE, and COMPLETE.
7. Charge-route filtering behavior.
8. Total-discarded-charge metric behavior.
9. Pre-change versus post-change measured record sizes.
10. Maximum normal serialized/write segment size.
11. Synthetic near-cap retained footprint and record counts.
12. Quota-failure behavior demonstrated by tests.
13. Exact verification commands and results.
14. Manual checks performed and not performed.
15. Deviations from this supplement, with rationale.
16. Recommended README changes, not applied.
17. Confirmation that no source-control writes or remote operations occurred.

Do not claim that the unrelated renderer performance issue was fixed by this logging patch.

---

## 27. Explicitly Deferred

Do not implement in Alpha 0.4.1:

- renderer pacing or animation-delay corrections;
- IndexedDB migration unless Stage 1 proves the bounded localStorage design cannot safely meet this supplement and the user explicitly authorizes the change;
- remote telemetry or a backend log service;
- compression libraries;
- production analytics upload;
- user-facing log-management UX;
- axis-specific charge-waste totals;
- changes to combat event generation solely for logging convenience;
- changes to active save schema 3;
- gameplay or balance changes;
- README or source-control writes.

