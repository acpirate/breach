// Alpha 0.2.0 §§3-7 / Alpha 0.3.0 §§5,10,12,17 — SESSION LAYER: application
// mode, the sequential Run, pending New Run setup, pending-result state, active
// Hacker/Deck identity, effective LINK/ICE resolution, and the versioned save
// envelope. This module owns the state semantics; UI composes screens and wires
// actions through this API but never invents progression, save-clearing,
// identity, or battle-construction logic.
//
// Pure logic: no DOM, no storage APIs. The orchestrator persists the strings
// this module produces and applies the transitions it exposes.

import { Game } from './game';
import {
  ACTIVE_BUILD_SIZE,
  DATA_SCHEMA_VERSION,
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  INITIAL_HOST_ID,
  INITIAL_SYSTEM_ID,
  InventoryEntry,
  PATH_CHOICE_COUNT,
  allUpgrades,
  bossById,
  deckById,
  defaultBuild,
  getContent,
  hackerById,
  hostById,
  inventoryFor,
  inventoryProgramIds,
  isValidBuild,
  poolHosts,
  poolSystems,
  systemById,
} from './data/content';
import { RNG, makeRNG } from './rng';
import {
  PlainGameState,
  SAVE_VERSION,
  isValidConfigShape,
  isValidIdentity,
  isValidSettingsShape,
  plainGameState,
  restoreGameState,
} from './save';
import {
  BattleConfig,
  BattleIdentity,
  BattleSettings,
  BuildOrigin,
  Color,
  Mode,
  NaturalOutcome,
  OpponentKind,
  RunStep,
  SelectionSource,
  Shape,
  SystemSelectionSource,
  WizardAction,
  isOpponentKind,
  isSystemSelectionSource,
} from './types';

// ---- Run encounter table (§4.1 — explicit definition, NOT a formula) ----
//
// Alpha 0.5.0 §10.1 — the table now holds ADDITIVE modifiers rather than
// absolute ICE. Effective ICE is `selected System BASE_ICE + modifier`, so a
// BASE_ICE=100 System still produces the established 100/150/200/250 ladder
// while a future System with different durability escalates correctly without
// redesigning Run progression.

export interface RunEncounter {
  step: RunStep;
  iceModifier: number;
}

export const RUN_LENGTH = 4;

export const RUN_ENCOUNTERS: ReadonlyArray<RunEncounter> = [
  { step: 1, iceModifier: 0 },
  { step: 2, iceModifier: 50 },
  { step: 3, iceModifier: 100 },
  { step: 4, iceModifier: 150 },
];

export function encounterFor(step: RunStep): RunEncounter {
  return RUN_ENCOUNTERS[step - 1];
}

export function nextStep(step: RunStep): RunStep | null {
  return step < RUN_LENGTH ? ((step + 1) as RunStep) : null;
}

// ---- active identity (§5.1/§5.2) ----

// The chosen identity, before it is expanded into a full BattleIdentity.
export interface SelectedIdentity {
  hackerId: string;
  deckId: string;
  selectionSource: SelectionSource;
}

// §5.2 — Quick Match resolves the explicit default IDs. These are named
// constants, never the first dataset row; a missing/invalid default blocks
// startup in the loader, so reaching here they are known-valid.
export function defaultIdentity(): SelectedIdentity {
  return { hackerId: DEFAULT_HACKER_ID, deckId: DEFAULT_DECK_ID, selectionSource: 'QUICK_MATCH_DEFAULT' };
}

// §5.1/§5.3 — expand a selection plus its chosen build into the full explicit
// battle identity: the ordered Skill IDs of the chosen Hacker, the Deck's
// Function, the ordered ACTIVE build, the inventory it was drawn from, and the
// System's roster from the current content contract. Nothing here is inferred
// from a display name, screen, or row position.
export function buildIdentity(
  hackerId: string,
  deckId: string,
  opponent: SelectedOpponent,
  hostId: string,
  upgradeIds: readonly string[],
  selectionSource: SelectionSource,
  build: readonly string[],
  buildOrigin: BuildOrigin,
): BattleIdentity {
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  // Alpha 0.5.0 §5.4/§9, Alpha 0.7.0 §18 — the enemy roster is the SELECTED
  // opponent's ordered PRG_SET, not "every loaded PRG_S_*" as it was through
  // Alpha 0.4. A Boss fields the same four-Program enemy model a System does
  // (§5.5), so the roster resolves identically once the identity is known.
  const enemy = opponentContent(opponent);
  // Alpha 0.6.0 §7/§12 — the HOST and the acquired UPGRADEs complete the
  // battle's PASSIVE sources. hostById throws on an unknown ID, so a bad
  // reference surfaces here rather than as a battle with a missing environment.
  const host = hostById(hostId);
  return {
    hackerId,
    deckId,
    opponentKind: opponent.kind,
    opponentId: enemy.id,
    opponentSelectionSource: opponent.source,
    hostId: host.id,
    upgradeIds: [...upgradeIds],
    passiveIds: [...hacker.passiveIds],
    deckFunctionId: deck.fn.id,
    hackerPrograms: [...build],
    inventory: inventoryProgramIds(hackerId, deckId),
    systemPrograms: [...enemy.programIds],
    selectionSource,
    buildOrigin,
  };
}

// Alpha 0.7.0 §16/§17 — the ONE place the opponent union resolves to content.
// Both identity layers supply the same enemy-side battle facts (ICE, strong
// axes, ordered Programs), so every consumer that needs those reads them here
// rather than branching on `kind` itself. `systemById`/`bossById` both THROW on
// an unknown ID (§36 — never silently substitute a default or ODANSHAY).
export interface OpponentContent {
  kind: OpponentKind;
  id: string;
  name: string;
  baseIce: number;
  strongColors: ReadonlyArray<Color>;
  weakColors: ReadonlyArray<Color>;
  strongShapes: ReadonlyArray<Shape>;
  weakShapes: ReadonlyArray<Shape>;
  programIds: ReadonlyArray<string>;
}

export function opponentContent(o: SelectedOpponent): OpponentContent {
  if (o.kind === 'BOS') {
    const b = bossById(o.id);
    return {
      kind: 'BOS',
      id: b.id,
      name: b.name,
      baseIce: b.baseIce,
      strongColors: b.strongColors,
      weakColors: b.weakColors,
      strongShapes: b.strongShapes,
      weakShapes: b.weakShapes,
      programIds: b.programIds,
    };
  }
  const s = systemById(o.id);
  return {
    kind: 'SYS',
    id: s.id,
    name: s.name,
    baseIce: s.baseIce,
    strongColors: s.strongColors,
    weakColors: s.weakColors,
    strongShapes: s.strongShapes,
    weakShapes: s.weakShapes,
    programIds: s.programIds,
  };
}

// The same lookup from a battle's own identity, for consumers that hold a
// BattleIdentity rather than a route selection.
export function opponentOfIdentity(id: BattleIdentity): OpponentContent {
  return opponentContent({ kind: id.opponentKind, id: id.opponentId, source: id.opponentSelectionSource });
}

// ---- Alpha 0.5.0 §11/§13/§14, Alpha 0.7.0 §16 — opponent selection ----

// A resolved opponent choice plus how it was made. Carried through pending
// setup, saved state, battle identity, and logs as one unit so the parts can
// never disagree.
//
// Alpha 0.7.0 §16 — `kind` makes the union HONEST. A Run's Battle 4 opponent is
// a BOSS, and §16 forbids storing a fake SYS_ID to keep a SYS-only route shape.
// Every consumer that needs the opponent's content looks it up through `kind`.
export interface SelectedOpponent {
  kind: OpponentKind;
  id: string;
  source: SystemSelectionSource;
}

// Convenience constructor for the overwhelmingly common System case.
export function systemOpponent(systemId: string, source: SystemSelectionSource): SelectedOpponent {
  return { kind: 'SYS', id: systemId, source };
}

// §11.1/§13 — one valid loaded System, sampled with replacement. Repeats
// across Run battles are allowed; there is no shuffle bag and no anti-repeat
// rule beyond §30.1's within-one-offer pair rule.
//
// §14/§35 — the caller supplies a SETUP/ROUTE RNG (makeSetupRandom), never the
// battle's gameplay stream: selecting an opponent must not perturb the board,
// refills, or AI sequence for a given gameplay seed.
//
// Alpha 0.6.0 — random selection samples the `in_pool` subset; deliberate
// selection screens still list everything (director spec 2026-08-11).
export function randomSystem(rng: RNG, source: SystemSelectionSource): SelectedOpponent {
  const catalog = poolSystems();
  // The loader guarantees a nonempty pool, so this cannot pick from nothing; a
  // content bug would surface at startup, not as a silent default here.
  return systemOpponent(rng.pick(catalog).id, source);
}

export function randomHost(rng: RNG): string {
  return rng.pick(poolHosts()).id;
}

// ============================================================================
// Alpha 0.6.0 §27-§35 — RUN ROUTE STATE
//
// A Run is now a sequence of PATH CHOICES: before every battle the player picks
// one of two offered `SYS + HST + UPG` packages, and the choice is committed
// BEFORE the Build screen opens, so the build can be edited against a known
// encounter (§27). Offers are real saved state, never UI-transient (§42).
// ============================================================================

// One offered path: a complete encounter package plus the reward for taking it.
// Alpha 0.7.0 §16 — the opponent is an HONEST union. A Battle-4 offer names the
// Run's selected Boss with `opponentKind: 'BOS'`; it never stores a placeholder
// SYS_ID, and there is no placeholder System row anywhere in the content.
export interface PathOffer {
  index: number; // 0-based position on the screen, for logging and audit (§46)
  opponentKind: OpponentKind;
  opponentId: string;
  hostId: string;
  upgradeId: string;
}

// The two pending offers for a specific upcoming battle. Persisted verbatim and
// restored verbatim: reloading a Path Choice NEVER rerolls (§35).
export interface PendingPath {
  step: RunStep; // the battle these offers lead into
  offers: PathOffer[];
  // §31 — true when the eligible pool held only one UPGRADE and both cards
  // therefore show it. Recorded rather than inferred so the log can say WHY the
  // duplicate happened (§46).
  upgradeExhausted: boolean;
}

// §29 — the Battle 1 offers. Both paths are the FIXED DOORMAN + THRESHOLD
// encounter; the only intended difference is the UPGRADE.
export function initialPathOffers(rng: RNG, acquired: readonly string[]): PendingPath {
  const upgrades = pickOfferUpgrades(rng, acquired);
  return {
    step: 1,
    offers: upgrades.ids.map((upgradeId, index) => ({
      index,
      opponentKind: 'SYS' as const,
      opponentId: INITIAL_SYSTEM_ID,
      hostId: INITIAL_HOST_ID,
      upgradeId,
    })),
    upgradeExhausted: upgrades.exhausted,
  };
}

// §30 — offers for Battles 2-3: one valid System and one valid HOST per path,
// independently randomized from the in_pool subsets, plus one eligible UPGRADE.
// Alpha 0.7.0 §14 keeps this EXACTLY as Alpha 0.6 had it; the Boss choice does
// not alter Battles 2 or 3 in any way.
export function laterPathOffers(rng: RNG, step: RunStep, acquired: readonly string[]): PendingPath {
  const upgrades = pickOfferUpgrades(rng, acquired);
  const pairs: { opponentId: string; hostId: string }[] = [];
  for (let i = 0; i < PATH_CHOICE_COUNT; i++) {
    // §30.1 — avoid two identical SYS+HST pairs within ONE offer whenever
    // another valid combination exists. Sharing a System OR a HOST is fine;
    // repeating a PRIOR battle's encounter is fine. Deliberately a retry loop
    // over the ordinary sampler rather than a shuffle-bag policy (§30.1 —
    // "do not add shuffle-bag/no-repeat policy beyond this requirement").
    const combos = poolSystems().length * poolHosts().length;
    let opponentId = randomSystem(rng, 'RUN_RANDOM').id;
    let hostId = randomHost(rng);
    if (combos > 1) {
      let guard = 0;
      while (pairs.some((p) => p.opponentId === opponentId && p.hostId === hostId) && guard < 32) {
        opponentId = randomSystem(rng, 'RUN_RANDOM').id;
        hostId = randomHost(rng);
        guard++;
      }
    }
    pairs.push({ opponentId, hostId });
  }
  return {
    step,
    offers: pairs.map((pair, index) => ({
      index,
      opponentKind: 'SYS' as const,
      ...pair,
      upgradeId: upgrades.ids[index],
    })),
    upgradeExhausted: upgrades.exhausted,
  };
}

// Alpha 0.7.0 §15 — the FINAL path offers. Both paths lead to the Boss the
// player committed at New Run start; only the HOST and (pool permitting) the
// UPGRADE differ. There is deliberately no random Boss routing (§5.3) and no
// normal System opponent at Battle 4 (§15).
export function bossPathOffers(rng: RNG, step: RunStep, bossId: string, acquired: readonly string[]): PendingPath {
  const upgrades = pickOfferUpgrades(rng, acquired);
  const hosts: string[] = [];
  for (let i = 0; i < PATH_CHOICE_COUNT; i++) {
    let hostId = randomHost(rng);
    // §15.1 — avoid offering the same `Boss + HST` pair twice while at least
    // two eligible HOSTs exist. With current content THRESHOLD is out of the
    // random pool and four escalation HOSTs remain, so two distinct HOSTs are
    // the normal outcome. If future content leaves exactly one eligible HOST,
    // a duplicate is ALLOWED rather than failing route generation (§15.1).
    if (poolHosts().length > 1) {
      let guard = 0;
      while (hosts.includes(hostId) && guard < 32) {
        hostId = randomHost(rng);
        guard++;
      }
    }
    hosts.push(hostId);
  }
  return {
    step,
    offers: hosts.map((hostId, index) => ({
      index,
      opponentKind: 'BOS' as const,
      opponentId: bossId,
      hostId,
      upgradeId: upgrades.ids[index],
    })),
    upgradeExhausted: upgrades.exhausted,
  };
}

// §30.2/§31 — the eligible UPGRADE pool is every valid row not already acquired
// in this Run. Offer DISTINCT IDs whenever at least two remain; when exactly one
// remains, both paths legitimately show it and that is not a validation error.
function pickOfferUpgrades(rng: RNG, acquired: readonly string[]): { ids: string[]; exhausted: boolean } {
  const eligible = allUpgrades().filter((u) => !acquired.includes(u.id));
  if (eligible.length === 0) {
    // Unreachable with four UPGRADEs and four decisions, but a content change
    // must not produce an offer with no reward at all.
    throw new Error('no eligible UPGRADE remains for a path offer');
  }
  if (eligible.length === 1) {
    return { ids: Array(PATH_CHOICE_COUNT).fill(eligible[0].id), exhausted: true };
  }
  const pool = rng.shuffle([...eligible]);
  return { ids: pool.slice(0, PATH_CHOICE_COUNT).map((u) => u.id), exhausted: false };
}

// §32 — committing a path. Acquisition is idempotent by ID: the one-remaining
// duplicate-offer case (§31) acquires exactly once however it is chosen, and
// the acquired list stays unique and ordered (§43).
export function acquireUpgrade(acquired: readonly string[], upgradeId: string): string[] {
  return acquired.includes(upgradeId) ? [...acquired] : [...acquired, upgradeId];
}

// ============================================================================
// Alpha 0.4.0 §5/§8 — BUILD STATE. Every Build screen (initial Run,
// between-battle, retry, Constructed Quick Match) drives this one model, and
// every transition below preserves the §5.5 validity invariant: exactly four
// distinct inventory Programs in explicit order. There is no invalid
// intermediate state and no empty slot to assemble from.
// ============================================================================

export type BuildContext = 'INITIAL_RUN' | 'RUN_BETWEEN' | 'RUN_RETRY' | 'CONSTRUCTED_QUICK_MATCH';

export interface BuildState {
  context: BuildContext;
  hackerId: string;
  deckId: string;
  inventory: InventoryEntry[]; // the fixed six, with portfolio attribution
  build: string[]; // ordered active four
  origin: BuildOrigin; // what the screen OPENED with
  edited: boolean; // §18.3 — changed by the player during this visit
}

// Open a Build screen. `initial` is used when it is a currently valid build;
// anything missing, stale, or malformed silently falls back to the default so
// the screen can never open in a dead end (§19.3).
export function beginBuild(
  context: BuildContext,
  hackerId: string,
  deckId: string,
  initial: readonly string[] | null,
  origin: BuildOrigin,
): BuildState {
  const inventory = inventoryFor(hackerId, deckId);
  const ids = inventory.map((e) => e.programId);
  const usable = initial && isValidBuild(initial, ids);
  return {
    context,
    hackerId,
    deckId,
    inventory,
    build: usable ? [...initial] : defaultBuild(hackerId, deckId),
    origin: usable ? origin : 'DEFAULT',
    edited: false,
  };
}

export function inactiveOf(s: BuildState): InventoryEntry[] {
  return s.inventory.filter((e) => !s.build.includes(e.programId));
}

// §5.6 — replacement is a SWAP: the incoming inactive Program takes the slot,
// the displaced one returns to the inventory. All four slots stay occupied and
// duplicates remain impossible by construction. A no-op (dropping a Program
// onto the slot it already holds) is not an edit.
export function replaceInBuild(s: BuildState, slot: number, programId: string): BuildState {
  if (slot < 0 || slot >= s.build.length) return s;
  if (s.build[slot] === programId) return s;
  if (!s.inventory.some((e) => e.programId === programId)) return s;
  if (s.build.includes(programId)) return s; // already active elsewhere — never duplicate
  const build = [...s.build];
  build[slot] = programId;
  return { ...s, build, edited: true, origin: 'PLAYER_EDITED' };
}

// §5.7 — reorder by swapping a slot with its neighbour. Preserves all four
// entries and their uniqueness; top-to-bottom priority is the array order.
export function moveBuildSlot(s: BuildState, slot: number, delta: -1 | 1): BuildState {
  const to = slot + delta;
  if (slot < 0 || slot >= s.build.length || to < 0 || to >= s.build.length) return s;
  const build = [...s.build];
  [build[slot], build[to]] = [build[to], build[slot]];
  return { ...s, build, edited: true, origin: 'PLAYER_EDITED' };
}

// ---- §10.2 Normal LINK resolution ----

// Hacker maximum LINK. Normal LINK ON: BASE_LINK + the Deck's ADD_LINK.
// OFF: the manual Hacker LINK setting.
export function resolveHackerMaxLink(settings: BattleSettings, hackerId: string, deckId: string): number {
  if (!settings.normalLink) return settings.manualHackerLink;
  return hackerById(hackerId).baseLink + deckById(deckId).addLink;
}

// Quick Match System maximum ICE. Alpha 0.5.0 §10.1 CHANGES this: under Normal
// LINK it is the selected System's own BASE_ICE, not a mirror of the Hacker's
// resolved maximum LINK. With the current authored content that moves Quick
// Match System ICE from 150 (100 BASE_LINK + 50 Deck ADD_LINK) to 100.
// Designer-approved 2026-08-07 as the correct "System identity owns System
// durability" rule, accepting the difficulty delta. OFF: the manual setting.
// Alpha 0.7.0 §16 — resolved through the opponent union so the one non-Run
// battle path (Quick Match, and the harness/dev fixtures that reuse it, §45)
// cannot crash on a Boss opponent by looking it up as a System.
export function resolveQuickMatchIce(settings: BattleSettings, opponent: SelectedOpponent): number {
  return settings.normalLink ? opponentContent(opponent).baseIce : settings.manualSystemIce;
}

// Run enemy maximum ICE per encounter.
//
// Normal LINK ON:
//  - a SYSTEM opponent takes its BASE_ICE plus that step's additive modifier
//    (§10.1) — a BASE_ICE=100 System still yields the 100/150/200 ladder;
//  - a BOSS opponent takes its authored BASE_ICE with NO modifier at all
//    (Alpha 0.7.0 §19). The authored value is already the final Boss-battle
//    ICE, so adding the step-4 +150 on top would double-count the escalation.
//
// Normal LINK OFF: the manual enemy ICE value for EVERY encounter, Boss battles
// included (§19 — there is deliberately no separate manual Boss ICE setting).
// The manual setting intentionally overrides both the base and the Run
// sequence, and the two are never silently combined (§10.2).
export function resolveRunIce(settings: BattleSettings, opponent: SelectedOpponent, step: RunStep): number {
  if (!settings.normalLink) return settings.manualSystemIce;
  const enemy = opponentContent(opponent);
  if (enemy.kind === 'BOS') return enemy.baseIce;
  return enemy.baseIce + encounterFor(step).iceModifier;
}

// §5.4, revised by Alpha 0.5.0 §9 — assemble the per-battle config: the chosen
// settings plus the values resolved from identity. Each side's authored strong
// sets are authoritative for that side: the selected Hacker's for the player,
// the selected System's for the enemy. The Alpha 0.4 complement rule is gone.
// There is no competing hardcoded HIGH/LOW authority anywhere.
// Alpha 0.7.0 §20 — the enemy's authored strong sets come from whichever
// identity layer supplied the opponent. ODANSHAY's axes are its own; nothing
// here consults a System when the opponent is a Boss.
export function buildBattleConfig(
  settings: BattleSettings,
  hackerId: string,
  opponent: SelectedOpponent,
  hackerMaxLink: number,
  enemyMaxIce: number,
): BattleConfig {
  const h = hackerById(hackerId);
  const e = opponentContent(opponent);
  return {
    ...settings,
    playerHp: hackerMaxLink,
    enemyHp: enemyMaxIce,
    strongColors: { player: [...h.strongColors], enemy: [...e.strongColors] },
    strongShapes: { player: [...h.strongShapes], enemy: [...e.strongShapes] },
  };
}

// ---- Session state (runtime) ----

export interface QuickMatchInfo {
  mode: 'QUICK_MATCH';
  identity: SelectedIdentity;
  // Alpha 0.5.0 §12/§13 — the resolved opponent for this Quick Match, chosen
  // before the battle (explicitly in Constructed, rolled in Random) and
  // restored verbatim by Continue rather than rerolled (§14).
  // Alpha 0.7.0 §45 — Quick Match remains System-only. The union type is shared
  // for one plumbing path, but Quick Match never produces a `BOS` opponent and
  // the save validator enforces that.
  opponent: SelectedOpponent;
  // Alpha 0.6.0 §37/§39/§44 — the resolved HOST for this Quick Match, chosen
  // deliberately in Constructed and rolled in Random, restored verbatim by
  // Continue. Quick Match has NO UPGRADE state at all (§37/§44).
  hostId: string;
  // §9.5 — the exact resolved build and where it came from, so Continue
  // restores this battle rather than rerolling a Random build or rereading the
  // remembered Constructed preset.
  build: string[];
  buildOrigin: BuildOrigin;
}

// Run-only identity (§6.2/§10.4): step, the settings snapshot taken at the
// final New Run commitment, the selected Hacker/Deck, and the effective Hacker
// maximum LINK resolved at that moment. The snapshot is authoritative for the
// whole Run — changing title Settings afterwards must not alter it.
export interface RunInfo {
  mode: 'RUN';
  // Alpha 0.7.0 §9 — the Boss committed at New Run start. FIXED for the whole
  // Run: ordinary Back navigation can never change it, and only deliberately
  // starting/replacing the Run picks a different one (§10). Battle 4 always
  // uses exactly this ID (§15).
  bossId: string;
  step: RunStep;
  settings: BattleSettings;
  identity: SelectedIdentity;
  hackerMaxLink: number;
  // §5.2/§8.4 — the Run's fixed six-Program inventory and the ordered build
  // that carries from one battle to the next. Both are Run-scoped: they are
  // discarded with the Run save and never leak into a later Run (§8.6).
  inventory: string[];
  build: string[];
  buildOrigin: BuildOrigin;
  // Alpha 0.5.0 §11.2/§33 — the UPCOMING battle's opponent, resolved exactly
  // once when the pre-battle state is created and then persisted. Reopening
  // Build, saving and quitting, resuming, or retrying after a defeat all reuse
  // this value; only successful progression to a new step rolls a new one
  // (§11.4/§11.5). Alpha 0.7.0 §16 — at step 4 this is the selected Boss.
  opponent: SelectedOpponent;
  // Alpha 0.6.0 §32 — the committed HOST for the current encounter, chosen with
  // the System as one package at the Path Choice and never re-resolved.
  hostId: string;
  // §32/§41 — every UPGRADE acquired so far this Run, in acquisition order.
  // That order is their START_OF_TURN resolution order (§15.3), so it is real
  // gameplay state rather than a display convenience. Unique by ID (§43).
  upgradeIds: string[];
  // §35/§41 — the isolated ROUTE RNG state. Persisted so a save/reload cannot
  // perturb later route generation compared with an uninterrupted Run: offer
  // generation always continues the same stream from where it left off, and it
  // never touches the battle's gameplay RNG.
  routeRngState: number;
  // §42 — the exact pending offers while the Run sits on a Path Choice. Real
  // saved state: `PENDING_PATH` restores these verbatim rather than rerolling.
  pendingPath?: PendingPath;
  // §17.2 — true while the Run is sitting on a pre-battle Build screen rather
  // than inside a battle. A committed Run in this phase is fully saveable.
  pendingBuild?: true;
}

// ============================================================================
// Alpha 0.7.0 §9/§10 — RUN SETUP, A REAL SAVED PHASE
//
// Boss commitment is now the destructive New-Run boundary (§9): committing a
// Boss replaces the active save immediately, and setup progress from there is
// itself resumable (§10). This is deliberately its OWN session shape rather
// than a RunInfo with half its fields nulled — a Run in setup has no encounter,
// no build, no inventory, and no resolved LINK maximum, and every consumer of a
// committed Run would otherwise have to defend against reading one.
//
// Because it is a distinct `mode`, every existing `info.mode === 'RUN'` guard
// correctly excludes it by construction.
// ============================================================================

export interface RunSetupInfo {
  mode: 'RUN_SETUP';
  // §9.3 — persisted immediately at commitment and fixed from that moment.
  bossId: string;
  // §10 — which setup screen Continue resumes to.
  step: 'HACKER' | 'DECK';
  // §10 — COMMITTED selections only. A highlighted-but-uncommitted UI row is
  // never Run state, so this stays null until the Hacker screen is committed.
  hackerId: string | null;
  // §9/§10.4 — the settings snapshot is taken at BOSS commitment, which is now
  // the New-Run boundary, and is authoritative for the whole Run.
  settings: BattleSettings;
  // §35 — the Run's isolated route stream, seeded at commitment so the initial
  // path offers cannot vary with how long identity selection took.
  routeRngState: number;
}

export type SessionInfo = QuickMatchInfo | RunSetupInfo | RunInfo;

// The persisted mode discriminator. `Mode` itself stays the two-value BATTLE
// vocabulary used by battle records (§21.2): a setup phase produces no battle,
// so it never appears on one.
export type SessionMode = Mode | 'RUN_SETUP';

// A concluded battle whose result has not been accepted yet (§5.1). This is
// REAL, saveable state — not renderer state. `metricsLogged` guards against
// double-appending the Tier-1 battle record across a save/resume boundary.
// `forcedWin` marks that WIZARD_FORCE_WIN was applied to this result; it never
// overwrites `natural` (§18.2).
export interface PendingResultInfo {
  natural: NaturalOutcome;
  forcedWin?: true;
  metricsLogged: boolean;
}

export function naturalOf(winner: 'player' | 'enemy'): NaturalOutcome {
  return winner === 'player' ? 'NATURAL_VICTORY' : 'NATURAL_DEFEAT';
}

// Run Complete presentation (§4.4/§5.2): the step-4 result presents as Run
// Complete when won naturally OR forced; it never offers Force Win.
export function isRunComplete(info: SessionInfo, pending: PendingResultInfo | null): boolean {
  return (
    info.mode === 'RUN' &&
    info.step === RUN_LENGTH &&
    !!pending &&
    (pending.natural === 'NATURAL_VICTORY' || pending.forcedWin === true)
  );
}

// Whether this pending result progresses as a victory (naturally won or
// wizard-forced). Used by the orchestrator to pick the progression action.
export function progressesAsVictory(pending: PendingResultInfo): boolean {
  return pending.natural === 'NATURAL_VICTORY' || pending.forcedWin === true;
}

// §18.1 — the Force Win availability matrix, owned by the session layer so
// rendering code cannot drift from it. Force Win is NEVER available during
// active combat; this answers only "should the control appear on this result
// screen".
export function forceWinAvailable(info: SessionInfo, pending: PendingResultInfo | null): boolean {
  if (!pending || pending.forcedWin) return false;
  // A Run in setup has no battle and therefore no result to force; the guard
  // keeps the Run branch below narrowed to a committed Run.
  if (info.mode !== 'RUN') {
    // Quick Match: offered on a natural defeat only.
    return pending.natural === 'NATURAL_DEFEAT';
  }
  if (pending.natural === 'NATURAL_DEFEAT') return true; // Run battles 1-4 defeat
  // Natural victory: offered on battles 1-3 (logs the wizard action without
  // altering progression); never on Battle 4, which presents as Run Complete.
  return info.step < RUN_LENGTH;
}

// ============================================================================
// Alpha 0.4.0 §9.2 — RANDOM QUICK MATCH build generation
// ============================================================================

// §9.2 — a SETUP-ONLY random source. Deliberately its own RNG instance so
// generating a build cannot consume or perturb the battle's gameplay stream:
// the Game seeds its own RNG independently at construction, so the board,
// refills, and AI sequence for a given gameplay seed are unaffected. The seed
// is returned so a run can be reproduced from the log (§18.4).
export function makeSetupRandom(seed?: number): { rng: RNG; seed: number } {
  const s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return { rng: makeRNG(s), seed: s };
}

// §9.2 — four distinct inventory Programs, sampled without replacement, in an
// explicitly randomized order. One shuffle gives both properties.
export function randomBuild(inventory: readonly string[], rng: RNG): string[] {
  const pool = [...inventory];
  rng.shuffle(pool);
  return pool.slice(0, ACTIVE_BUILD_SIZE);
}

// ============================================================================
// Alpha 0.4.0 §9.4/§17.6 — REMEMBERED CONSTRUCTED BUILD
//
// Convenience preference data, NOT an active save: it is versioned separately,
// never competes for the single save slot, survives Run completion and
// abandonment, and is revalidated-then-defaulted rather than being allowed to
// block startup.
// ============================================================================

export const PREFERENCE_SCHEMA_VERSION = 1;

export interface ConstructedPreset {
  v: number;
  hackerId: string;
  deckId: string;
  build: string[];
}

export function serializeConstructedPreset(hackerId: string, deckId: string, build: readonly string[]): string {
  return JSON.stringify({ v: PREFERENCE_SCHEMA_VERSION, hackerId, deckId, build: [...build] } satisfies ConstructedPreset);
}

// §9.4 — returns the remembered build only if it is still coherent with
// CURRENT content: both identities resolve, the inventory resolves, and the
// four IDs are distinct members of it. Anything else yields null, which the
// caller treats as "open with the default build". A content-fingerprint
// change alone does not invalidate it — only unresolvable references do.
export function deserializeConstructedPreset(json: string | null): ConstructedPreset | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Partial<ConstructedPreset>;
    if (p.v !== PREFERENCE_SCHEMA_VERSION) return null;
    if (typeof p.hackerId !== 'string' || typeof p.deckId !== 'string') return null;
    if (!Array.isArray(p.build) || p.build.some((id) => typeof id !== 'string')) return null;
    const c = getContent();
    if (!c.hackers.has(p.hackerId) || !c.decks.has(p.deckId)) return null;
    const inventory = inventoryProgramIds(p.hackerId, p.deckId);
    if (!isValidBuild(p.build, inventory)) return null;
    return { v: p.v, hackerId: p.hackerId, deckId: p.deckId, build: [...p.build] };
  } catch {
    return null;
  }
}

// ---- Alpha 0.7.0 §8-§10 — New Run setup ----

// §8 — the canonical New Run order is
//   Boss Selection -> Hacker Selection -> Deck Selection -> Path -> Build -> Battle
// BOSS happens before the Run exists; HACKER and DECK are persisted phases of a
// committed Run (§10).
export type SetupStep = 'BOSS' | 'HACKER' | 'DECK';

// §9 — THE ALPHA 0.7 DESTRUCTIVE COMMITMENT BOUNDARY, moved forward from Alpha
// 0.6's initial Path Choice. Committing a Boss replaces the active save right
// then, persists the Boss immediately, fixes it for the Run, and parks setup on
// Hacker Selection. The Alpha 0.6 rule that delayed Run commitment until Path
// Choice entry is deliberately NOT preserved (§9).
//
// The caller supplies the route seed so the whole Run's route randomness comes
// from one persisted, gameplay-isolated stream (§35).
export function commitBossSelection(bossId: string, settings: BattleSettings, routeSeed: number): RunSetupInfo {
  // §5.5/§36 — throws on an unknown ID rather than substituting a default Boss.
  const boss = bossById(bossId);
  return {
    mode: 'RUN_SETUP',
    bossId: boss.id,
    step: 'HACKER',
    hackerId: null,
    settings: snapshotRunSettings(settings),
    routeRngState: makeRNG(routeSeed).getState(),
  };
}

// §10 — committing the Hacker advances the persisted setup phase. The Boss is
// untouched: it is already fixed for this Run.
export function commitSetupHacker(s: RunSetupInfo, hackerId: string): RunSetupInfo {
  hackerById(hackerId); // reject an unknown ID here rather than at battle time
  return { ...s, hackerId, step: 'DECK' };
}

// §8/§10 — committing the Deck COMPLETES setup: the Run gains its identity, its
// inventory and default build, and its initial Path Choice offers, which are
// persisted immediately (§29/§42). Battle 1's encounter is the fixed
// DOORMAN + THRESHOLD on both offered paths regardless of the Boss (§13), so
// the player's first real decision is which UPGRADE to take.
export function commitSetupDeck(s: RunSetupInfo, deckId: string): RunInfo {
  const hackerId = s.hackerId!;
  deckById(deckId); // reject an unknown ID here rather than at battle time
  const routeRng = makeRNG(s.routeRngState);
  const pendingPath = initialPathOffers(routeRng, []);
  return {
    mode: 'RUN',
    bossId: s.bossId,
    step: 1,
    settings: cloneSettings(s.settings),
    identity: { hackerId, deckId, selectionSource: 'EXPLICIT_SELECTION' },
    hackerMaxLink: resolveHackerMaxLink(s.settings, hackerId, deckId),
    inventory: inventoryProgramIds(hackerId, deckId),
    build: defaultBuild(hackerId, deckId),
    buildOrigin: 'DEFAULT',
    // Until a path is chosen there is no committed encounter. The fixed Battle
    // 1 identity is what both offers name, so these placeholders are replaced
    // by selectPath() before any battle or Build screen can exist.
    opponent: systemOpponent(INITIAL_SYSTEM_ID, 'RUN_RANDOM'),
    hostId: INITIAL_HOST_ID,
    upgradeIds: [],
    routeRngState: routeRng.getState(),
    pendingPath,
  };
}

// §30, extended by Alpha 0.7.0 §15 — generate the offers for the NEXT battle
// after a win or a Force Win. Advances the persisted route RNG in place so an
// interrupted-and-resumed Run produces the same sequence an uninterrupted one
// would (§35). The FINAL step routes to the Run's committed Boss; every earlier
// step keeps Alpha 0.6 behavior exactly (§14).
export function openPathChoice(info: RunInfo, step: RunStep): RunInfo {
  const routeRng = makeRNG(info.routeRngState);
  const pendingPath = step === 1
    ? initialPathOffers(routeRng, info.upgradeIds)
    : step === RUN_LENGTH
      ? bossPathOffers(routeRng, step, info.bossId, info.upgradeIds)
      : laterPathOffers(routeRng, step, info.upgradeIds);
  const next: RunInfo = { ...info, step, pendingPath, routeRngState: routeRng.getState() };
  delete next.pendingBuild;
  return next;
}

// §32 — selecting a path is immediate and final for that battle: acquire the
// UPGRADE (once), commit the opponent and HOST, drop the pending offers, and
// move to the pre-battle Build state. Back navigation cannot undo it (§32).
export function selectPath(info: RunInfo, offerIndex: number): RunInfo {
  const pending = info.pendingPath;
  if (!pending) return info;
  const offer = pending.offers[offerIndex];
  if (!offer) return info;
  const next: RunInfo = {
    ...info,
    step: pending.step,
    opponent: { kind: offer.opponentKind, id: offer.opponentId, source: 'RUN_RANDOM' },
    hostId: offer.hostId,
    upgradeIds: acquireUpgrade(info.upgradeIds, offer.upgradeId),
    pendingBuild: true,
  };
  delete next.pendingPath;
  return next;
}

// ---- Battle creation (§4.2/§4.3/§10.5) ----
// A fresh `Game` already provides every §10.5 reset (new board, new RNG, zero
// Program charge, `startCharged` Deck charge, fresh metrics): nothing carries
// over unless it is in the config. Run battles resolve System ICE per encounter.

export function cloneSettings(s: BattleSettings): BattleSettings {
  return { ...s };
}

function cloneConfig(c: BattleConfig): BattleConfig {
  return {
    ...c,
    strongColors: { player: [...c.strongColors.player], enemy: [...c.strongColors.enemy] },
    strongShapes: { player: [...c.strongShapes.player], enemy: [...c.strongShapes.enemy] },
  };
}

// Snapshot the menu settings at New Run (§10.4): later menu edits must never
// mutate the saved Run.
export function snapshotRunSettings(menuSettings: BattleSettings): BattleSettings {
  return cloneSettings(menuSettings);
}

// The effective per-battle config for a Run step, from the Run's snapshot and
// its already-selected opponent (§10.3 — never rederived from current menu
// Settings, never rerolled).
export function effectiveRunConfig(info: RunInfo, step: RunStep): BattleConfig {
  return buildBattleConfig(
    info.settings,
    info.identity.hackerId,
    info.opponent,
    info.hackerMaxLink,
    resolveRunIce(info.settings, info.opponent, step),
  );
}

export function createQuickMatchBattle(
  settings: BattleSettings,
  ids: SelectedIdentity,
  opponent: SelectedOpponent,
  hostId: string,
  build: readonly string[],
  buildOrigin: BuildOrigin,
  seed?: number,
): Game {
  const hackerMaxLink = resolveHackerMaxLink(settings, ids.hackerId, ids.deckId);
  const config = buildBattleConfig(
    settings,
    ids.hackerId,
    opponent,
    hackerMaxLink,
    resolveQuickMatchIce(settings, opponent),
  );
  // §37/§44 — Quick Match acquires no UPGRADEs, so the list is empty by
  // construction rather than by a filter somewhere downstream.
  return new Game(config, buildIdentity(ids.hackerId, ids.deckId, opponent, hostId, [], ids.selectionSource, build, buildOrigin), seed);
}

// Quick Match "Reset" restarts under the concluded battle's OWN config and
// identity (§18.3), not under current menu settings.
export function recreateBattleFromConfig(config: BattleConfig, identity: BattleIdentity, seed?: number): Game {
  return new Game(cloneConfig(config), { ...identity }, seed);
}

// §5.8/§8.4 — the upcoming battle snapshots the Run's CURRENT ordered build.
export function createRunBattle(info: RunInfo, step: RunStep, seed?: number): Game {
  const config = effectiveRunConfig(info, step);
  return new Game(
    config,
    buildIdentity(
      info.identity.hackerId,
      info.identity.deckId,
      info.opponent,
      info.hostId,
      info.upgradeIds,
      info.identity.selectionSource,
      info.build,
      info.buildOrigin,
    ),
    seed,
  );
}

// ---- Log/record context (§21.2) ----

export interface BattleContext {
  mode: Mode;
  runStep?: RunStep;
  encounterSystemHp?: number;
}

export function battleContext(info: SessionInfo): BattleContext {
  if (info.mode === 'RUN') {
    return {
      mode: 'RUN',
      runStep: info.step,
      encounterSystemHp: resolveRunIce(info.settings, info.opponent, info.step),
    };
  }
  // A Run still in setup has no battle at all, so it can never reach here; the
  // branch exists so no fake Run values appear on a Quick Match record (§17.2).
  return { mode: 'QUICK_MATCH' };
}

// ---- Title labels (§3.4) ----

export function continueLabel(info: SessionInfo): string {
  if (info.mode === 'RUN') return `Continue Run — Battle ${info.step} of ${RUN_LENGTH}`;
  // Alpha 0.7.0 §10 — a Run parked in setup resumes to the screen it left off
  // on, so the Title button says which one rather than implying a battle.
  if (info.mode === 'RUN_SETUP') {
    return `Continue Run — ${info.step === 'HACKER' ? 'Hacker' : 'Deck'} Selection`;
  }
  return 'Continue Quick Match';
}

export function contextLabel(info: SessionInfo): string {
  if (info.mode === 'RUN') return `Run — Battle ${info.step} of ${RUN_LENGTH}`;
  if (info.mode === 'RUN_SETUP') return 'Run — setup';
  return 'Quick Match';
}

// ---- Save envelope (§17) ----
// One slot, one mode. Quick Match saves carry NO run field at all (§17.2 — no
// fake Run values to satisfy a broad nullable interface). Alpha 0.2 saves are
// rejected by the version/schema check: there is no migration path (§17.1).

// Alpha 0.6.0 §42 — PENDING_PATH is a real saved phase: a committed Run with no
// active battle, no committed encounter yet, and two exact pending offers. It
// is deliberately NOT encoded as UI-transient state (§42).
//
// Alpha 0.7.0 §10 — SETUP_HACKER and SETUP_DECK join it on exactly those terms:
// a Run whose Boss is committed but whose identity is not. They carry NO battle
// and NO BattleIdentity, because neither exists yet; inventing a synthetic one
// would be precisely the fake state §36 forbids.
type SavePhase =
  | 'ACTIVE_BATTLE'
  | 'PENDING_RESULT'
  | 'PENDING_BUILD'
  | 'PENDING_PATH'
  | 'SETUP_HACKER'
  | 'SETUP_DECK';

const SETUP_PHASES: ReadonlyArray<SavePhase> = ['SETUP_HACKER', 'SETUP_DECK'];

interface SavedRun {
  // Alpha 0.7.0 §34 — the Run's committed Boss. Persisted from the moment of
  // commitment and never rerolled; Battle 4's route must agree with it (§36).
  bossId: string;
  step: RunStep;
  settings: BattleSettings;
  hackerMaxLink: number;
  inventory: string[];
  build: string[];
  buildOrigin: BuildOrigin;
  // Alpha 0.5.0 §33, revised by Alpha 0.7.0 §16 — the upcoming (or in-progress)
  // encounter's opponent, as an identity KIND plus a stable ID plus its
  // selection source. Never a copy of the content definition: identity resolves
  // through the matching content fingerprint (§32 — no redundant serialization
  // of immutable content), and never a fake SYS_ID for a Boss (§16).
  opponent: SelectedOpponent;
  // Alpha 0.6.0 §41 — the committed HOST, the acquired UPGRADEs in acquisition
  // order, the isolated route RNG state, and the exact pending offers. All
  // stable IDs and primitives; no content definitions are duplicated here.
  hostId: string;
  upgradeIds: string[];
  routeRngState: number;
  pendingPath?: PendingPath;
}

// Alpha 0.7.0 §10/§34 — the persisted form of an unfinished Run setup.
interface SavedSetup {
  bossId: string;
  // Present iff the phase is SETUP_DECK. §10 — only COMMITTED selections are
  // persisted, so this is absent while Hacker Selection is still open.
  hackerId?: string;
  settings: BattleSettings;
  routeRngState: number;
}

interface SavedSession {
  version: string;
  schema: number;
  fp: string;
  mode: SessionMode;
  // §17.2 explicit Hacker/Deck/build identity. Alpha 0.7.0 §10 — ABSENT exactly
  // in the two setup phases, on precisely the terms `state` is absent in the
  // battle-less phases below.
  identity?: BattleIdentity;
  run?: SavedRun;
  setup?: SavedSetup;
  phase: SavePhase;
  result?: { natural: NaturalOutcome; forcedWin?: true; metricsLogged: boolean };
  // §17.2/§17.4 — absent exactly when the Run is parked on a pre-battle Build
  // screen, a Path Choice, or a setup screen: there is no battle yet, and
  // inventing an empty one would be a second source of truth for "what is the
  // player looking at".
  state?: PlainGameState;
}

export interface RestoredSession {
  info: SessionInfo;
  game: Game | null; // null iff the Run is in its pre-battle Build phase
  pending: PendingResultInfo | null;
}

const savedRunOf = (info: RunInfo): SavedRun => ({
  bossId: info.bossId,
  step: info.step,
  settings: cloneSettings(info.settings),
  hackerMaxLink: info.hackerMaxLink,
  inventory: [...info.inventory],
  build: [...info.build],
  buildOrigin: info.buildOrigin,
  opponent: { ...info.opponent },
  hostId: info.hostId,
  upgradeIds: [...info.upgradeIds],
  routeRngState: info.routeRngState,
  ...(info.pendingPath
    ? { pendingPath: { ...info.pendingPath, offers: info.pendingPath.offers.map((o) => ({ ...o })) } }
    : {}),
});

export function serializeSession(info: SessionInfo, game: Game | null, pending: PendingResultInfo | null): string {
  const content = getContent();
  const base = { version: SAVE_VERSION, schema: DATA_SCHEMA_VERSION, fp: content.fingerprint };

  // Alpha 0.7.0 §10 — a Run in setup carries its committed Boss and whatever
  // identity has been committed so far, and NOTHING else. There is no battle,
  // no encounter, no build, and no BattleIdentity to fabricate.
  if (info.mode === 'RUN_SETUP') {
    const env: SavedSession = {
      ...base,
      mode: 'RUN_SETUP',
      phase: info.step === 'HACKER' ? 'SETUP_HACKER' : 'SETUP_DECK',
      setup: {
        bossId: info.bossId,
        ...(info.hackerId ? { hackerId: info.hackerId } : {}),
        settings: cloneSettings(info.settings),
        routeRngState: info.routeRngState,
      },
    };
    return JSON.stringify(env);
  }

  // §17.4 — a committed Run parked on Build or on a Path Choice has no battle
  // state; its identity is still explicit, derived from the same authority a
  // battle would use. On a Path Choice the encounter fields are the not-yet-
  // superseded previous package, which the phase check below makes unusable as
  // a committed encounter on restore.
  const identity =
    game?.state.identity ??
    buildIdentity(
      info.identity.hackerId,
      info.identity.deckId,
      info.opponent,
      info.hostId,
      info.mode === 'RUN' ? info.upgradeIds : [],
      info.identity.selectionSource,
      info.build,
      info.buildOrigin,
    );
  const onPath = info.mode === 'RUN' && !!info.pendingPath;
  const env: SavedSession = {
    ...base,
    mode: info.mode,
    identity: { ...identity },
    ...(info.mode === 'RUN' ? { run: savedRunOf(info) } : {}),
    phase: onPath ? 'PENDING_PATH' : !game ? 'PENDING_BUILD' : pending ? 'PENDING_RESULT' : 'ACTIVE_BATTLE',
    ...(pending
      ? { result: { natural: pending.natural, ...(pending.forcedWin ? { forcedWin: true as const } : {}), metricsLogged: pending.metricsLogged } }
      : {}),
    ...(game ? { state: plainGameState(game.state) } : {}),
  };
  return JSON.stringify(env);
}

// Returns a fully restored session, or null for ANYTHING invalid: wrong or
// pre-Alpha-0.3.0 version (§17.1 — no migration, no partial load), schema or
// content-fingerprint mismatch, malformed mode/run/result shape, identity that
// disagrees with the resolved content contract, or invalid battle state.
export function deserializeSession(json: string | null): RestoredSession | null {
  if (!json) return null;
  try {
    const env = JSON.parse(json) as Partial<SavedSession>;
    if (env.version !== SAVE_VERSION) return null;
    if (env.schema !== DATA_SCHEMA_VERSION) return null;
    const content = getContent();
    if (env.fp !== content.fingerprint) return null;
    if (env.mode !== 'QUICK_MATCH' && env.mode !== 'RUN' && env.mode !== 'RUN_SETUP') return null;
    const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    if (
      env.phase !== 'ACTIVE_BATTLE' && env.phase !== 'PENDING_RESULT' &&
      env.phase !== 'PENDING_BUILD' && env.phase !== 'PENDING_PATH' &&
      env.phase !== 'SETUP_HACKER' && env.phase !== 'SETUP_DECK'
    ) {
      return null;
    }

    // Alpha 0.7.0 §10/§36 — the SETUP phases. They carry a Boss and, at
    // SETUP_DECK, a committed Hacker; they carry no identity, no run block, no
    // battle, and no result. §36 requires rejecting a setup phase that is
    // inconsistent with its committed selection IDs rather than repairing it,
    // and requires rejecting an unknown Boss rather than substituting ODANSHAY.
    const inSetup = SETUP_PHASES.includes(env.phase);
    if (inSetup !== (env.mode === 'RUN_SETUP')) return null;
    if (inSetup) {
      const s = env.setup;
      if (!s || typeof s !== 'object') return null;
      if (env.identity !== undefined || env.run !== undefined) return null;
      if (env.state !== undefined || env.result !== undefined) return null;
      if (typeof s.bossId !== 'string' || !getContent().bosses.has(s.bossId)) return null;
      if (!isValidSettingsShape(s.settings)) return null;
      if (!Number.isInteger(s.routeRngState)) return null;
      // The committed Hacker must be present at SETUP_DECK and absent before it.
      const wantHacker = env.phase === 'SETUP_DECK';
      if (wantHacker) {
        if (typeof s.hackerId !== 'string' || !getContent().hackers.has(s.hackerId)) return null;
      } else if (s.hackerId !== undefined) {
        return null;
      }
      return {
        info: {
          mode: 'RUN_SETUP',
          bossId: s.bossId,
          step: wantHacker ? 'DECK' : 'HACKER',
          hackerId: wantHacker ? s.hackerId! : null,
          settings: cloneSettings(s.settings),
          routeRngState: s.routeRngState,
        },
        game: null,
        pending: null,
      };
    }
    if (env.setup !== undefined) return null; // only the setup phases carry one

    // §17.3 — the envelope's identity must satisfy the content contract, and
    // the battle state must carry exactly the same identity.
    if (!isValidIdentity(env.identity)) return null;
    const envId = env.identity as BattleIdentity;
    // §17.4/§42 — both battle-less phases are Run-only and carry no battle.
    const onPath = env.phase === 'PENDING_PATH';
    const inBuild = env.phase === 'PENDING_BUILD' || onPath;
    if (inBuild && (env.mode !== 'RUN' || env.state !== undefined || env.result !== undefined)) return null;

    let game: Game | null = null;
    if (!inBuild) {
      game = restoreGameState(env.state, env.phase === 'PENDING_RESULT');
      if (!game) return null;
      const stateId = game.state.identity;
      if (
        stateId.hackerId !== envId.hackerId ||
        stateId.deckId !== envId.deckId ||
        stateId.deckFunctionId !== envId.deckFunctionId ||
        stateId.selectionSource !== envId.selectionSource ||
        stateId.buildOrigin !== envId.buildOrigin ||
        // Alpha 0.5.0 §32 / Alpha 0.7.0 §16 — the battle's opponent must
        // round-trip exactly, identity KIND included.
        stateId.opponentKind !== envId.opponentKind ||
        stateId.opponentId !== envId.opponentId ||
        stateId.opponentSelectionSource !== envId.opponentSelectionSource ||
        // Alpha 0.6.0 §7/§12 — so must the battlefield and the reward state.
        stateId.hostId !== envId.hostId ||
        !sameOrder(envId.upgradeIds, stateId.upgradeIds) ||
        !sameOrder(envId.passiveIds, stateId.passiveIds) ||
        !sameOrder(envId.hackerPrograms, stateId.hackerPrograms) ||
        !sameOrder(envId.inventory, stateId.inventory) ||
        !sameOrder(envId.systemPrograms, stateId.systemPrograms)
      ) {
        return null;
      }
    }

    let info: SessionInfo;
    if (env.mode === 'RUN') {
      const run = env.run;
      if (!run || !Number.isInteger(run.step) || run.step < 1 || run.step > RUN_LENGTH) return null;
      if (!isValidSettingsShape(run.settings)) return null;
      if (!Number.isInteger(run.hackerMaxLink) || run.hackerMaxLink < 1 || run.hackerMaxLink > 9999) return null;
      // §17.2 — an active save whose Program references disagree with the
      // current content is INCOMPATIBLE. It is never silently repaired by
      // substituting the default build.
      if (!Array.isArray(run.inventory) || !sameOrder(run.inventory, envId.inventory)) return null;
      if (!Array.isArray(run.build) || !isValidBuild(run.build, run.inventory)) return null;
      if (!inBuild && !sameOrder(run.build, envId.hackerPrograms)) return null;
      if (!isBuildOrigin(run.buildOrigin)) return null;
      // Alpha 0.7.0 §34/§36 — the Run's committed Boss must still resolve. A
      // missing or unknown Boss ID rejects the save; §36 forbids substituting
      // ODANSHAY or any other default for it.
      if (typeof run.bossId !== 'string' || !getContent().bosses.has(run.bossId)) return null;
      // §33/§41/§16 — the saved upcoming opponent must still resolve, and (once
      // a battle exists) must be the very opponent that battle was built
      // against, identity KIND included. A missing or unresolvable ID rejects
      // the save; it is NEVER replaced with a default or a fresh roll, which
      // would silently change the encounter the player saved.
      if (!isSelectedOpponent(run.opponent)) return null;
      // §36 — a committed Boss encounter must name the RUN's Boss, never a
      // different one.
      if (run.opponent.kind === 'BOS' && run.opponent.id !== run.bossId) return null;
      if (!inBuild && (run.opponent.kind !== envId.opponentKind || run.opponent.id !== envId.opponentId)) return null;
      // Alpha 0.6.0 §52/§41 — the committed HOST must still resolve, on exactly
      // the terms the System does: a missing or unknown HST_ID is an
      // incompatible save, never an invitation to substitute THRESHOLD (§40).
      if (typeof run.hostId !== 'string' || !getContent().hosts.has(run.hostId)) return null;
      if (!inBuild && run.hostId !== envId.hostId) return null;
      // §43 — a persisted acquired list containing the same UPGRADE_ID twice is
      // invalid. Reject rather than silently deduplicating.
      if (!Array.isArray(run.upgradeIds) || run.upgradeIds.some((id) => typeof id !== 'string')) return null;
      if (new Set(run.upgradeIds).size !== run.upgradeIds.length) return null;
      if (run.upgradeIds.some((id) => !getContent().upgrades.has(id))) return null;
      if (!inBuild && !sameOrder(run.upgradeIds, envId.upgradeIds)) return null;
      // §35 — the route RNG state, so continuation is deterministic.
      if (!Number.isInteger(run.routeRngState)) return null;
      // §42/§52 — pending offers must be structurally complete and reference
      // valid content. They are restored EXACTLY as saved; nothing rerolls.
      if (onPath !== (run.pendingPath !== undefined)) return null;
      if (run.pendingPath && !isValidPendingPath(run.pendingPath, run.step as RunStep, run.upgradeIds, run.bossId)) return null;
      info = {
        mode: 'RUN',
        bossId: run.bossId,
        step: run.step as RunStep,
        settings: cloneSettings(run.settings),
        identity: { hackerId: envId.hackerId, deckId: envId.deckId, selectionSource: envId.selectionSource },
        hackerMaxLink: run.hackerMaxLink,
        inventory: [...run.inventory],
        build: [...run.build],
        buildOrigin: run.buildOrigin,
        opponent: { ...run.opponent },
        hostId: run.hostId,
        upgradeIds: [...run.upgradeIds],
        routeRngState: run.routeRngState,
        ...(run.pendingPath
          ? { pendingPath: { ...run.pendingPath, offers: run.pendingPath.offers.map((o) => ({ ...o })) } }
          : {}),
        ...(inBuild && !onPath ? { pendingBuild: true as const } : {}),
      };
    } else {
      if (env.run !== undefined) return null; // Quick Match never carries Run values
      // §9.5/§17.5 — restore the EXACT saved build and its source. Continue
      // never rerolls a Random build and never rereads the Constructed preset.
      if (!isValidBuild(envId.hackerPrograms, envId.inventory)) return null;
      // §44 — Quick Match has no Run UPGRADE state at all. A save claiming one
      // is malformed rather than a Quick Match with rewards.
      if (envId.upgradeIds.length !== 0) return null;
      // Alpha 0.7.0 §45 — Quick Match is System-only. A Quick Match save
      // claiming a Boss opponent is malformed, not a hidden Boss Quick Match.
      if (envId.opponentKind !== 'SYS') return null;
      info = {
        mode: 'QUICK_MATCH',
        identity: { hackerId: envId.hackerId, deckId: envId.deckId, selectionSource: envId.selectionSource },
        // §14/§44 — the opponent AND the battlefield come from the saved battle
        // identity, so Continue never rerolls a Random Quick Match's encounter.
        opponent: { kind: envId.opponentKind, id: envId.opponentId, source: envId.opponentSelectionSource },
        hostId: envId.hostId,
        build: [...envId.hackerPrograms],
        buildOrigin: envId.buildOrigin,
      };
    }

    let pending: PendingResultInfo | null = null;
    if (env.phase === 'PENDING_RESULT') {
      const r = env.result;
      if (!r || (r.natural !== 'NATURAL_VICTORY' && r.natural !== 'NATURAL_DEFEAT')) return null;
      if (typeof r.metricsLogged !== 'boolean') return null;
      if (r.forcedWin !== undefined && r.forcedWin !== true) return null;
      pending = { natural: r.natural, metricsLogged: r.metricsLogged, ...(r.forcedWin ? { forcedWin: true as const } : {}) };
    } else if (env.result !== undefined) {
      return null; // an active battle cannot carry a result
    }

    if (game) {
      if (!isValidConfigShape(game.state.config)) return null;
      // concluded-state winner must agree with the recorded natural outcome
      if (pending && naturalOf(game.state.winner as 'player' | 'enemy') !== pending.natural) return null;
      // §10.4 — the battle's effective LINK/ICE must agree with the saved rule,
      // so a tampered or stale envelope cannot resume under different maxima.
      if (info.mode === 'RUN') {
        if (game.state.config.playerHp !== info.hackerMaxLink) return null;
        if (game.state.config.enemyHp !== resolveRunIce(info.settings, info.opponent, info.step)) return null;
      }
    }
    return { info, game, pending };
  } catch {
    return null;
  }
}

const BUILD_ORIGINS: BuildOrigin[] = ['DEFAULT', 'RANDOM', 'REMEMBERED_CONSTRUCTED', 'CARRIED_RUN', 'PLAYER_EDITED'];
function isBuildOrigin(v: unknown): v is BuildOrigin {
  return typeof v === 'string' && (BUILD_ORIGINS as string[]).includes(v);
}

// Alpha 0.6.0 §52, extended by Alpha 0.7.0 §36 — pending route offers must be
// STRUCTURALLY COMPLETE and reference valid content: the right number of offers,
// each naming an opponent, a HOST, and an UPGRADE that all still resolve, none
// of them already acquired, and the exhaustion flag agreeing with what the
// offers actually show. Nothing here infers or repairs; a mismatch rejects the
// save (§52).
function isValidPendingPath(v: unknown, step: RunStep, acquired: readonly string[], bossId: string): boolean {
  const p = v as PendingPath | undefined;
  if (!p || typeof p !== 'object') return false;
  if (p.step !== step) return false;
  if (typeof p.upgradeExhausted !== 'boolean') return false;
  if (!Array.isArray(p.offers) || p.offers.length !== PATH_CHOICE_COUNT) return false;
  const c = getContent();
  for (let i = 0; i < p.offers.length; i++) {
    const o = p.offers[i];
    if (!o || typeof o !== 'object') return false;
    if (o.index !== i) return false;
    if (!isOpponentKind(o.opponentKind)) return false;
    if (typeof o.opponentId !== 'string') return false;
    // Alpha 0.7.0 §16 — the offer's ID must resolve in the layer it CLAIMS. A
    // SYS_ID stored under kind BOS (or the reverse) is a corrupt save.
    const known = o.opponentKind === 'BOS' ? c.bosses.has(o.opponentId) : c.systems.has(o.opponentId);
    if (!known) return false;
    if (typeof o.hostId !== 'string' || !c.hosts.has(o.hostId)) return false;
    if (typeof o.upgradeId !== 'string' || !c.upgrades.has(o.upgradeId)) return false;
    // §30.2 — an already-acquired UPGRADE is not eligible, so an offer naming
    // one is a corrupt save rather than a duplicate to be tolerated.
    if (acquired.includes(o.upgradeId)) return false;
  }
  // §31 — the flag must match reality: duplicated UPGRADE IDs across the offers
  // are legal ONLY as the recorded pool-exhaustion case.
  const distinct = new Set(p.offers.map((o) => o.upgradeId)).size;
  if (p.upgradeExhausted !== (distinct < p.offers.length)) return false;
  // §13/§29 — Battle 1 always offers the fixed encounter identity on both paths,
  // whichever Boss the Run selected.
  if (step === 1 && p.offers.some((o) => o.opponentKind !== 'SYS' || o.opponentId !== INITIAL_SYSTEM_ID || o.hostId !== INITIAL_HOST_ID)) {
    return false;
  }
  // Alpha 0.7.0 §15/§36 — the FINAL offers must BOTH name the Run's selected
  // Boss. A pending Battle-4 route referencing a normal System, or a different
  // Boss than the Run committed to, rejects the save (§36).
  if (step === RUN_LENGTH && p.offers.some((o) => o.opponentKind !== 'BOS' || o.opponentId !== bossId)) return false;
  // §14 — Battles 2 and 3 are always normal System encounters.
  if (step > 1 && step < RUN_LENGTH && p.offers.some((o) => o.opponentKind !== 'SYS')) return false;
  return true;
}

// §33 / Alpha 0.7.0 §16 — a persisted opponent choice: an identity kind, an ID
// that still resolves IN THAT LAYER against the current content, and a
// recognized selection source.
function isSelectedOpponent(v: unknown): v is SelectedOpponent {
  const s = v as SelectedOpponent | undefined;
  if (!s || typeof s !== 'object') return false;
  if (!isOpponentKind(s.kind)) return false;
  if (typeof s.id !== 'string') return false;
  const c = getContent();
  if (!(s.kind === 'BOS' ? c.bosses.has(s.id) : c.systems.has(s.id))) return false;
  return isSystemSelectionSource(s.source);
}

export type { WizardAction };
