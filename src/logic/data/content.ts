// Alpha 0.1.0 §11 / Alpha 0.3.0 §4.8 — the resolved runtime content model, and
// the single active registry the engine reads. Resolved definitions are
// immutable for the application session: they are constructed once by the
// loader (load.ts), installed via setActiveContent() before any battle can
// start, and never reloaded or hot-swapped (§5.3). Mutable battle state
// (charge, placed specials, LINK/ICE, countdowns) lives in GameState.
//
// Alpha 0.3.0 adds Hacker, Skill, and Deck identity to this model. All human
// play, setup UI, battle construction, saves, logs, and headless tools consume
// these shared resolved definitions rather than reparsing CSV or keeping
// hardcoded copies (§4.8).
//
// Alpha 0.6.0 replaces Skill with the shared PASSIVE layer and adds HOST and
// UPGRADE as first-class content, taking the runtime to nine required datasets
// (§0.2). They join this same model and the same loader; there is no parallel
// content authority for the new kinds.
//
// Alpha 0.7.0 adds BOSS as the tenth, on the same terms: one loader, one
// resolved model, one registry. A Boss is a DISTINCT enemy identity layer, not
// a System with a flag — see ResolvedBoss.

import { AreaPatternId } from './areas';
import { EffectId, EffectParamName, TargetKind } from './effects';
import { AgentScope, PassiveActivation, PassiveEffectId } from './passives';
import type { Color, Shape, Side } from '../types';

export const GAME_VERSION = 'alpha-0.7.0';
// Alpha 0.7.0 §33 — schema 6: the committed Boss, the two resumable setup
// phases, and the honest `SYS | BOS` opponent union on both the pending route
// and the battle identity. Alpha 0.6 active saves (schema 5) cannot faithfully
// represent any of them — they have no Boss at all — and are rejected through
// the established incompatible-save path (§36), never migrated and never
// back-filled with a synthesized Boss or setup phase.
export const DATA_SCHEMA_VERSION = 6;

// §5.1/§4.4/§4.5 — every Hacker and every Deck contributes exactly this many
// ordered Programs; the two portfolios combine into the Run inventory.
export const PORTFOLIO_SIZE = 3;
export const INVENTORY_SIZE = PORTFOLIO_SIZE * 2;
// §5.3 — exactly this many distinct inventory Programs are active, in order.
export const ACTIVE_BUILD_SIZE = 4;

// §5.2 — explicit default identity. Until a configuration or account-selection
// system exists these are named constants; they are NEVER inferred from the
// first dataset row, and a missing/invalid default blocks startup.
export const DEFAULT_HACKER_ID = 'HAK_01';
export const DEFAULT_DECK_ID = 'DEK_01';

// Alpha 0.5.0 §5.4 — every authored System fields exactly this many ordered
// active Programs. Deliberately its own constant rather than a reuse of
// ACTIVE_BUILD_SIZE: the two are equal today by content design, not by rule,
// and the System has no inventory to draw from (§5.4 — no System Build screen).
export const SYSTEM_BUILD_SIZE = 4;

// Alpha 0.5.0 §44/§14 — headless simulations pin ONE System so balance output
// stays comparable between runs; random selection is a gameplay/setup behavior
// and does not belong in a measurement instrument. Designer note (2026-08-07):
// a purpose-built TESTER System should replace this in a future build.
export const HEADLESS_SYSTEM_ID = 'SYS_01';
// Alpha 0.6.0 — the same reasoning for the new environment layer: headless runs
// pin the zero-PASSIVE HOST so ladder/batch output moves only when combat
// changes, never because an encounter rolled a different battlefield.
export const HEADLESS_HOST_ID = 'HST_01';

// Alpha 0.6.0 §29 — Battle 1 is a FIXED encounter identity on both offered
// paths: only the UPGRADE differs. Named constants, never inferred from a row
// position, and validated at startup exactly like the default Hacker/Deck.
export const INITIAL_SYSTEM_ID = 'SYS_03'; // DOORMAN
export const INITIAL_HOST_ID = 'HST_01'; // THRESHOLD

// §8 — fewer than this many valid UPGRADE rows is a blocking startup error: the
// Run offers four acquisition decisions and the exhaustion edge case (§31) is
// deliberate content, not an accident to be papered over.
export const MIN_UPGRADE_ROWS = 4;

// §29/§30 — how many paths a Path Choice screen offers.
export const PATH_CHOICE_COUNT = 2;

// ---- Alpha 0.7.0 §21-§27 — the ODANSHAY mechanic's payload Functions ----
//
// ODANSHAY's Override mechanic is CODE keyed to BOS_01 (§21), not a data-driven
// scripting field: §2 explicitly forbids a MECHANIC_ID column or a generalized
// Boss trigger table. These three Functions are therefore invoked from the
// mechanic handler rather than from any Program, Deck, or PASSIVE reference.
//
// Naming them here does two jobs at once. The mechanic implementation resolves
// its payloads through one authority instead of scattering string literals
// through combat code, and the loader can count them as genuinely REFERENCED
// content — otherwise every startup would emit three permanent "unreferenced
// Function row" warnings for rows the engine demonstrably uses.
export const BOSS_MECHANIC_BOSS_ID = 'BOS_01'; // ODANSHAY
export const FN_DATABEND = 'FNC_018'; // §24 — insufficient-capacity fallback
export const FN_REBOOT = 'FNC_019'; // §27 — post-threshold Datastream wipe
export const FN_CODESHATTER = 'FNC_020'; // §27 — the threshold's damage payload

export const BOSS_MECHANIC_FUNCTION_IDS: ReadonlyArray<string> = [
  FN_DATABEND,
  FN_REBOOT,
  FN_CODESHATTER,
];

// §24 — the ODANSHAY end-of-turn placement contract, and §25's threshold.
// Authored values used exactly as supplied (§60): three Overrides placed as the
// final action of every non-terminal Boss turn, and the threshold firing at 15
// or more on-board Overrides (>=, never exactly 15, §25).
export const OVERRIDE_PLACEMENT_COUNT = 3;
export const OVERRIDE_THRESHOLD = 15;

// Director ruling (2026-08-17) — handoff §24 specified an UNBOUNDED
// DATABEND/retry loop whose only exit was Hacker defeat. That is a hang if the
// board can never reach three valid targets. The loop is hard-capped here;
// on exhaustion the Boss places nothing and the turn continues normally. With
// current content it realistically never iterates at all: the cap exists to
// preempt hypothetical future unremovable Hacker- or HOST-placed specials.
export const OVERRIDE_DATABEND_RETRY_LIMIT = 5;

// ---- EFFECT_SHAKE typed parameters (§8.2-8.6) ----

// Enum value names, kept as named constants so combat code never compares bare
// integers. Resolved once at startup into ShakeParams.
export const SHAKE_REARRANGE = 0; // permute existing tile objects
export const SHAKE_REPLACE = 1; // regenerate affected tiles as ordinary Packets
export const SHAKE_RETAIN_SPECIALS = 0;
export const SHAKE_REMOVE_SPECIALS = 1;
// Alpha 0.7.0 §7.1 — remove only the overlays the ACTIVATING side does not own.
// DATABEND (`1:2:1:2`) uses it so ODANSHAY's fallback clears Hacker-placed
// overlays that are blocking Override capacity without destroying the Boss's own
// accumulated Overrides — which would make the §25 threshold unreachable.
export const SHAKE_REMOVE_ENEMY_SPECIALS = 2;
export const SHAKE_PREVENT_MATCHES = 0;
export const SHAKE_ALLOW_MATCHES = 1;
export const SHAKE_CASCADE_NONE = 0; // initial post-Shake wave only
export const SHAKE_CASCADE_CONFIGURED = 1; // the battle's saved cascade limit
export const SHAKE_CASCADE_UNTIL_STABLE = 2; // ignore the finite limit

export interface ShakeParams {
  boardComposition: 0 | 1;
  specialGems: 0 | 1 | 2;
  matches: 0 | 1;
  cascades: 0 | 1 | 2;
}

// ---- Alpha 0.4.0 shared targeting/damage/charge enums (§13.2/§14.2) ----
// Named constants so combat code never compares bare integers, exactly as the
// Shake enums above. Resolved once at startup into the typed objects below.
export const TARGETING_RANDOM = 0;
export const TARGETING_TARGETED = 1;
export const DEAL_DAMAGE_YES = 0;
export const DEAL_DAMAGE_NO = 1;
export const GAIN_CHARGE_YES = 0;
export const GAIN_CHARGE_NO = 1;

// ---- EFFECT_LINESLICE typed parameters (§13.2) ----
export const LINE_DIMENSION_ROW = 0;
export const LINE_DIMENSION_COLUMN = 1;
export const SPECIALS_DESTROY = 0;
export const SPECIALS_RETAIN_ALL = 1;
export const SPECIALS_RETAIN_OWN = 2;

export interface LineSliceParams {
  dimension: 0 | 1;
  targeting: 0 | 1;
  specialRetention: 0 | 1 | 2;
  dealDamage: 0 | 1;
  gainCharge: 0 | 1;
}

// ---- EFFECT_BOMB typed parameters (§14.2) ----
export interface BombParams {
  targeting: 0 | 1;
  dealDamage: 0 | 1;
  gainCharge: 0 | 1;
}

// ---- Alpha 0.5.0 §23 EFFECT_TRANSFORM typed parameters ----
// `specialPacketTreatment` shares the SPECIALS_* enum above; retaining a
// special preserves its ownership and Effect-specific state while the
// underlying Packet's color/shape changes (§22.3).
export interface TransformParams {
  targeting: 0 | 1;
  specialPacketTreatment: 0 | 1 | 2;
}

// Alpha 0.6.0 §24 (director override 2026-08-11, superseding handoff §24's
// narrower `ANY` wording) — the Transform axis GRAMMAR. Both columns resolve
// once at startup into the typed objects below; runtime never re-parses the
// authored strings.
//
//   axisTarget:  NEU | ALL | <COLOR> | <SHAPE> | <COLOR>:<SHAPE>
//   axisResult:  NEU | <COLOR> | <SHAPE> | <COLOR>:<SHAPE>
//
// The colon is INTERSECTION in both columns — `GRE:TRI` means "green triangles",
// never "green or triangular". There is deliberately no OR targeting, no
// multi-value axis, and no negation: this is a fixed grammar, not a query
// language.
export const AXIS_NEUTRAL = 'NEU';
export const AXIS_ALL = 'ALL';

// Which Packets an EFFECT_TRANSFORM may target.
//   'NEU'  — neutral Packets only.
//   'ALL'  — every Packet on the Datastream, neutrals included.
//   'AXIS' — standard Packets matching every authored axis; a single authored
//            axis leaves the other free. Neutrals are NEVER eligible here: a
//            neutral has no axis to match against.
export interface AxisTarget {
  token: string; // authored text, retained for logs and tooling
  kind: 'NEU' | 'ALL' | 'AXIS';
  color?: Color;
  shape?: Shape;
}

// What a targeted Packet becomes. A single authored axis PRESERVES the other —
// except on a neutral target, which has no axis to preserve, so the unauthored
// axis is randomized per Packet from the battle's gameplay RNG (§24).
// `neutral` turns the Packet neutral and clears both axes.
export interface AxisResult {
  token: string; // authored text, retained for logs and tooling
  neutral?: true;
  color?: Color;
  shape?: Shape;
}

// One validated leaf operation of a Function's payload plan. A leaf Function
// has exactly one op (its own Effect); a composite Function has one op per
// child Function reference, in payload order (§7.2 — repeats allowed and
// intentional). Strings are resolved to typed IDs at startup; combat never
// re-parses colon lists (§11.2).
export interface PlanOp {
  fnId: string; // the LEAF Function this op came from (self for a leaf)
  effectId: EffectId;
  params: EffectParams;
  // Alpha 0.4.0 §12 — the RESOLVED targeting requirement for this op. Alpha
  // 0.3 read targeting off the Effect contract alone; Bomb and LineSlice now
  // select it per Function row through their typed tuples, so it is resolved
  // once at startup and never recomputed from raw data at runtime.
  target: TargetKind | null;
}

export interface EffectParams {
  quantity?: number;
  countdown?: number;
  areaPattern?: AreaPatternId;
  magnitude?: number;
  damage?: number;
  // §4.6/§8.2 — the resolved compound tuple, present iff the Effect's contract
  // declares one. Runtime execution consumes this typed object.
  shake?: ShakeParams;
  bomb?: BombParams; // §14.2
  line?: LineSliceParams; // §13.2
  transform?: TransformParams; // Alpha 0.5.0 §23
  // §22 — the resolved Transform axes, present iff the Effect declares them.
  axisTarget?: AxisTarget;
  axisResult?: AxisResult;
}

export interface ResolvedFunction {
  id: string;
  name: string;
  cost: number;
  composite: boolean;
  plan: ReadonlyArray<PlanOp>;
  notes: string;
  // §4.6 — a directly assigned owner (Program or Deck) starts each battle with
  // charge equal to cost when true, zero otherwise. Ignored when this Function
  // executes only as a child of a composite.
  startCharged: boolean;
}

export interface ResolvedProgram {
  id: string;
  side: Side;
  name: string;
  colors: ReadonlyArray<Color>; // charge-color bindings (order preserved)
  shapes: ReadonlyArray<Shape>;
  functionId: string;
  fn: ResolvedFunction;
  cost: number; // activation cost of the assigned Function
  chargeCap: number; // §11.1 — at least the highest cost among assigned Functions
  notes: string;
}

// Alpha 0.6.0 §5/§53 — a resolved PASSIVE. The parsed contract, NOT the display
// string, controls behavior. One row can be referenced by any number of HAK,
// SYS, HST, and UPG records; the SOURCE that supplied an instance lives in the
// runtime instance model (logic/passive.ts), never here — this is the shared
// immutable definition (§11).
export interface ResolvedPassive {
  id: string;
  effectType: PassiveEffectId;
  activation: PassiveActivation;
  // §5.4 — meaningful for HAK/SYS/UPG instances; IGNORED for HST instances,
  // whose scope is defined by §13. Retained verbatim either way so a log can
  // show what the data actually said.
  agentScope: AgentScope;
  // Typed parameter 0, present iff this effect's tuple declares a color.
  color?: Color;
  // True iff typed parameter 0 is the ALL wildcard.
  allScope?: true;
  // The magnitude parameter, present iff the tuple declares one.
  magnitude?: number;
  // §23 — the carrier's payload Function, present iff the contract requires it.
  functionId?: string;
  display: string; // resolved player-facing text (presentation only)
  displayTemplate: string; // authored template, retained for tooling
  paramTokens: ReadonlyArray<string>; // authored tuple tokens, in order
}

// §7 — an authored HOST: the battlefield/environment a battle is fought on.
// A first-class causal source, NOT a Hacker- or System-owned effect bundle
// (§13). Alpha 0.6 HOSTs have no active abilities beyond their PASSIVEs.
export interface ResolvedHost {
  id: string;
  name: string;
  passiveIds: ReadonlyArray<string>; // authored order; may be empty (THRESHOLD)
  passives: ReadonlyArray<ResolvedPassive>;
  // Director addition (2026-08-11) — whether random encounter generation may
  // offer this HOST. Blank/`y` includes, `n` excludes. Deliberate selection
  // screens ignore it; only the random pools consult it.
  inPool: boolean;
  displayText: string; // presentation only; may be blank
  graphics: string; // placeholder only — no asset loading in Alpha 0.6
}

// §8 — an authored UPGRADE: Run-local reward state, ALWAYS Hacker-owned (§12).
// Acquired at a Path Choice, active for the rest of that Run, never acquired
// twice, and never present in Quick Match.
export interface ResolvedUpgrade {
  id: string;
  name: string;
  passiveIds: ReadonlyArray<string>;
  passives: ReadonlyArray<ResolvedPassive>;
  displayText: string; // presentation only; may be blank
  graphics: string; // placeholder only
}

export interface ResolvedHacker {
  id: string;
  name: string;
  baseLink: number;
  // §5.4 — the selected Hacker's strong sets are authoritative for Hacker
  // owner-dependent damage strength; weak sets are calculated complements in
  // recognized enum order. No 3/3 partition is required.
  strongColors: ReadonlyArray<Color>;
  weakColors: ReadonlyArray<Color>;
  strongShapes: ReadonlyArray<Shape>;
  weakShapes: ReadonlyArray<Shape>;
  // Alpha 0.6.0 §6 — the `PASSIVES` column: an ordered list of zero or more
  // PSV references. Authored order is gameplay-relevant (it is the resolution
  // order within this source, §15.4) and is fingerprinted. Duplicates stack.
  passiveIds: ReadonlyArray<string>;
  passives: ReadonlyArray<ResolvedPassive>;
  // §4.4/§5.1 — the ordered three-Program portfolio from PRG_SET. Order is
  // gameplay-significant: it drives default-build derivation (§5.4) and
  // inventory presentation, and it is fingerprinted (§4.12).
  portfolioProgramIds: ReadonlyArray<string>;
  // §2.12 — schema placeholders only: parsed and retained, never displayed,
  // interpreted, or used to load assets in Alpha 0.3.
  bio: string;
  graphics: string;
}

// Alpha 0.5.0 §5/§9 — an authored System. This is the SINGLE System-side
// authority for base ICE, strong/weak axes, and the ordered active Program
// build. The Alpha 0.4 behavior of deriving System strengths as the selected
// Hacker's complement is gone: each System now carries its own independent
// profile (§2.4).
export interface ResolvedSystem {
  id: string;
  name: string;
  baseIce: number;
  // §5.3 — strong sets are authored; weak sets are calculated complements over
  // the recognized enum vocabularies, in enum order. No 3/3 partition required.
  strongColors: ReadonlyArray<Color>;
  weakColors: ReadonlyArray<Color>;
  strongShapes: ReadonlyArray<Shape>;
  weakShapes: ReadonlyArray<Shape>;
  // §5.4 — the complete ordered System battle build. Authoritative for battle
  // initialization, charge-routing priority, display order, save identity, and
  // fingerprinting. It is NOT Function-activation priority (§2.11).
  programIds: ReadonlyArray<string>;
  // Alpha 0.6.0 §6 — System PASSIVEs are LIVE now. Through Alpha 0.5 a nonblank
  // value here was a startup error; the column is the same `PASSIVES` list the
  // Hacker uses and resolves through the same shared PSV dataset. No authored
  // System currently references one, which is content, not a rule.
  passiveIds: ReadonlyArray<string>;
  passives: ReadonlyArray<ResolvedPassive>;
  // Director addition (2026-08-11) — whether random encounter generation may
  // offer this System. DOORMAN is excluded because it is the fixed Battle 1
  // opponent (§29); deliberate selection screens still list it.
  inPool: boolean;
  bio: string; // §5.2 placeholder only — never displayed
  graphics: string; // §5.2 placeholder only — no asset loading
}

// Alpha 0.7.0 §5 — an authored BOSS: the enemy-side combat identity for the
// final Run battle. A DISTINCT identity layer rather than a System with a flag
// (§1.1/§17): it is never reported as a SYS_ID in combat, saves, logs, metrics,
// or UI, and it never receives the Run's additive ICE escalation (§19).
//
// It deliberately has NO `passives` field. The workbook supplies no PASSIVES
// column, and §2/§5.1 forbid inventing one merely because a future Boss might
// want it. ODANSHAY's Override mechanic is code keyed to BOS_01 (§21), not data.
export interface ResolvedBoss {
  id: string;
  name: string;
  // §19 — the FINAL Boss-battle ICE under Normal LINK, not a base the Run
  // escalation table adds to. Director override 2026-08-17: authored as 250 so
  // the Boss matches the Battle-4 durability the Alpha 0.6 ladder produced.
  baseIce: number;
  // §20 — authored strong sets; weak sets are calculated complements over the
  // recognized enum vocabularies in enum order, exactly as Hacker and System
  // weak sets are. No 3/3 partition is required.
  strongColors: ReadonlyArray<Color>;
  weakColors: ReadonlyArray<Color>;
  strongShapes: ReadonlyArray<Shape>;
  weakShapes: ReadonlyArray<Shape>;
  // §5.2/§18 — the ordered PRG_SET. Order is charge-routing priority and display
  // order; it is NOT Function-activation priority (§18), exactly as a System's.
  programIds: ReadonlyArray<string>;
  // §5.3 — parsed and fingerprinted, but NOT a selection filter: Alpha 0.7 has
  // no random Boss pool, and Boss Selection lists every valid row.
  inPool: boolean;
  // §5.4 — presentation only. Never mechanic authority, never fingerprinted.
  passiveDescription: string;
  bio: string;
  graphics: string;
}

export interface ResolvedDeck {
  id: string;
  name: string;
  addLink: number;
  functionId: string;
  fn: ResolvedFunction; // §7.1 — exactly one in Alpha 0.3
  // §4.5/§5.1 — the ordered three-Program portfolio from PRG_SET. The Deck
  // FUNCTION is separate and is NEVER one of these Programs (§2.11).
  portfolioProgramIds: ReadonlyArray<string>;
  descript: string; // placeholder only (§2.12)
  graphics: string; // placeholder only (§2.12)
}

export interface ResolvedContent {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string; // normalized gameplay-content fingerprint (§4.10)
  hacker: ReadonlyArray<ResolvedProgram>; // player side, slot order
  system: ReadonlyArray<ResolvedProgram>; // enemy side, slot order
  functions: ReadonlyMap<string, ResolvedFunction>;
  programsById: ReadonlyMap<string, ResolvedProgram>;
  hackers: ReadonlyMap<string, ResolvedHacker>;
  passives: ReadonlyMap<string, ResolvedPassive>; // Alpha 0.6.0 §5
  decks: ReadonlyMap<string, ResolvedDeck>;
  systems: ReadonlyMap<string, ResolvedSystem>; // Alpha 0.5.0 §5
  hosts: ReadonlyMap<string, ResolvedHost>; // Alpha 0.6.0 §7
  upgrades: ReadonlyMap<string, ResolvedUpgrade>; // Alpha 0.6.0 §8
  bosses: ReadonlyMap<string, ResolvedBoss>; // Alpha 0.7.0 §5
  // Authored row order, for deterministic selection-screen presentation.
  hackerOrder: ReadonlyArray<string>;
  deckOrder: ReadonlyArray<string>;
  systemOrder: ReadonlyArray<string>; // §15 — System Selection listing order
  hostOrder: ReadonlyArray<string>; // §38 — HOST Selection listing order
  upgradeOrder: ReadonlyArray<string>; // §30.2 — eligible-pool iteration order
  bossOrder: ReadonlyArray<string>; // Alpha 0.7.0 §11 — Boss Selection listing order
}

// ---- active-content registry (set once at startup, read-only afterwards) ----

let active: ResolvedContent | null = null;

export function setActiveContent(c: ResolvedContent): void {
  active = c;
}

export function getContent(): ResolvedContent {
  if (!active) throw new Error('content not loaded — setActiveContent() must run before gameplay');
  return active;
}

export function programsFor(side: Side): ReadonlyArray<ResolvedProgram> {
  const c = getContent();
  return side === 'player' ? c.hacker : c.system;
}

export function programById(id: string): ResolvedProgram {
  const p = getContent().programsById.get(id);
  if (!p) throw new Error(`unknown program id: ${id}`);
  return p;
}

export function hackerById(id: string): ResolvedHacker {
  const h = getContent().hackers.get(id);
  if (!h) throw new Error(`unknown hacker id: ${id}`);
  return h;
}

export function deckById(id: string): ResolvedDeck {
  const d = getContent().decks.get(id);
  if (!d) throw new Error(`unknown deck id: ${id}`);
  return d;
}

// §41 — an unknown SYS_ID THROWS. There is deliberately no fallback to a
// default System, to the first row, or to the old Hacker-complement profile:
// a missing System is a broken save or broken content, not a playable state.
export function systemById(id: string): ResolvedSystem {
  const s = getContent().systems.get(id);
  if (!s) throw new Error(`unknown system id: ${id}`);
  return s;
}

// §11.1/§13 — the complete valid System catalog in authored order. Deliberate
// selection screens list exactly this; random generation uses poolSystems().
export function allSystems(): ResolvedSystem[] {
  const c = getContent();
  return c.systemOrder.map((id) => c.systems.get(id)!);
}

// Alpha 0.6.0 §7/§8 — the same unknown-ID contract as systemById: a missing
// HOST or UPGRADE is broken content or a broken save, not a playable state, so
// there is deliberately no fallback to a default or to the first row.
export function hostById(id: string): ResolvedHost {
  const h = getContent().hosts.get(id);
  if (!h) throw new Error(`unknown host id: ${id}`);
  return h;
}

export function upgradeById(id: string): ResolvedUpgrade {
  const u = getContent().upgrades.get(id);
  if (!u) throw new Error(`unknown upgrade id: ${id}`);
  return u;
}

// Alpha 0.7.0 §5.5/§36 — the same unknown-ID contract every other identity
// lookup uses. §36 is explicit that a missing or unknown Boss must NOT be
// silently substituted with ODANSHAY: a broken reference is a broken save or
// broken content, not a playable state.
export function bossById(id: string): ResolvedBoss {
  const b = getContent().bosses.get(id);
  if (!b) throw new Error(`unknown boss id: ${id}`);
  return b;
}

// §11 — every valid Boss in authored order, for the Boss Selection screen.
// `in_pool` is deliberately NOT consulted: Alpha 0.7 has no random Boss
// routing, so the flag never filters this list (§5.3).
export function allBosses(): ResolvedBoss[] {
  const c = getContent();
  return c.bossOrder.map((id) => c.bosses.get(id)!);
}

export function passiveById(id: string): ResolvedPassive {
  const p = getContent().passives.get(id);
  if (!p) throw new Error(`unknown passive id: ${id}`);
  return p;
}

// §38 — every valid HOST, in authored order, for the deliberate selection
// screen. `in_pool` is deliberately NOT consulted here.
export function allHosts(): ResolvedHost[] {
  const c = getContent();
  return c.hostOrder.map((id) => c.hosts.get(id)!);
}

export function allUpgrades(): ResolvedUpgrade[] {
  const c = getContent();
  return c.upgradeOrder.map((id) => c.upgrades.get(id)!);
}

// Director addition (2026-08-11) — the RANDOM pools. Route offer generation and
// Random Quick Match sample from these; the loader guarantees each is nonempty,
// so a content mistake surfaces at startup rather than as an empty path screen.
export function poolSystems(): ResolvedSystem[] {
  return allSystems().filter((s) => s.inPool);
}

export function poolHosts(): ResolvedHost[] {
  return allHosts().filter((h) => h.inPool);
}

// Ordered selection lists for the setup screens (§13.1/§14.1 — every loaded
// definition is offered; all Decks are compatible with all Hackers, §2.8).
export function allHackers(): ResolvedHacker[] {
  const c = getContent();
  return c.hackerOrder.map((id) => c.hackers.get(id)!);
}

export function allDecks(): ResolvedDeck[] {
  const c = getContent();
  return c.deckOrder.map((id) => c.decks.get(id)!);
}

// ---- Alpha 0.4.0 §5.2/§5.3 — inventory and active build (ONE authority) ----
// Every consumer (setup UI, Build screen, battle construction, save/restore,
// logs, headless tools) derives inventory and default build here. There is no
// second derivation and no hardcoded default Program list (§5.4).

export type PortfolioSource = 'HACKER_PORTFOLIO' | 'DECK_PORTFOLIO';

export interface InventoryEntry {
  programId: string;
  program: ResolvedProgram;
  source: PortfolioSource;
  // 1-based position WITHIN the contributing portfolio, for display/telemetry.
  portfolioIndex: number;
}

// §5.2 — the fixed six-Program inventory for a Hacker/Deck pairing: the
// Hacker's ordered three followed by the Deck's ordered three. Source
// attribution is presentation/telemetry only — all six are Hacker-side
// Program choices in battle (§2.3).
export function inventoryFor(hackerId: string, deckId: string): InventoryEntry[] {
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  const entries: InventoryEntry[] = [];
  hacker.portfolioProgramIds.forEach((id, i) => {
    entries.push({ programId: id, program: programById(id), source: 'HACKER_PORTFOLIO', portfolioIndex: i + 1 });
  });
  deck.portfolioProgramIds.forEach((id, i) => {
    entries.push({ programId: id, program: programById(id), source: 'DECK_PORTFOLIO', portfolioIndex: i + 1 });
  });
  return entries;
}

export function inventoryProgramIds(hackerId: string, deckId: string): string[] {
  return inventoryFor(hackerId, deckId).map((e) => e.programId);
}

// §5.4 — the DEFAULT build: Hacker portfolio entries 1 and 2, then Deck
// portfolio entries 1 and 2. Derived from portfolio ORDER, never from a
// hardcoded list of Program IDs.
export function defaultBuild(hackerId: string, deckId: string): string[] {
  const hacker = hackerById(hackerId);
  const deck = deckById(deckId);
  const half = ACTIVE_BUILD_SIZE / 2;
  return [...hacker.portfolioProgramIds.slice(0, half), ...deck.portfolioProgramIds.slice(0, half)];
}

// §5.5 — the validity invariant, in one place. A build is valid iff it holds
// exactly ACTIVE_BUILD_SIZE distinct Program IDs, all drawn from the current
// inventory, all resolving. Order is carried by the array itself.
export function isValidBuild(build: readonly string[], inventoryIds: readonly string[]): boolean {
  if (!Array.isArray(build) || build.length !== ACTIVE_BUILD_SIZE) return false;
  if (new Set(build).size !== ACTIVE_BUILD_SIZE) return false;
  return build.every((id) => inventoryIds.includes(id) && getContent().programsById.has(id));
}

// The four resolved Programs of an ordered build, in build order. Throws on an
// unknown ID — callers validate first (the loader guarantees resolution).
export function buildPrograms(build: readonly string[]): ResolvedProgram[] {
  return build.map((id) => programById(id));
}

// §3.3/§12 — the target a Program's activation requires, resolved from its
// validated plan. The leading operation carries it: payload-order validation
// guarantees at most one targeted op and that it comes first (§7.3).
export function targetKindOf(p: ResolvedProgram): TargetKind | null {
  return p.fn.plan[0]?.target ?? null;
}

export function requiresTarget(p: ResolvedProgram): boolean {
  return targetKindOf(p) !== null;
}

// The same question for any directly assigned Function — the Deck-owned one
// included, so a future targeted Deck Function needs no parallel path (§7.1).
export function functionTargetKind(fn: ResolvedFunction): TargetKind | null {
  return fn.plan[0]?.target ?? null;
}

// Approved deviation (System Drain withhold): the System declines to activate
// a Function whose expanded plan consists ENTIRELY of drain ops when no
// opposing Program holds any charge — charge is preserved, not spent on a
// no-op. Mixed composites still fire (the drain op legally fizzles).
export function planIsAllDrain(p: ResolvedProgram): boolean {
  return p.fn.plan.length > 0 && p.fn.plan.every((op) => op.effectId === 'EFFECT_DRAIN');
}

// §21.2 — content identity stamped into battle/simulation records.
export interface ContentStamp {
  gameVersion: string;
  schemaVersion: number;
  fingerprint: string;
  hackerPrograms: string[]; // every LOADED Hacker Program, not the active build
  systemPrograms: string[];
  functions: { id: string; cost: number }[];
  hackers: string[];
  decks: string[];
  passives: string[];
  // Alpha 0.6.0 §46/§47 — the environment and reward catalogs a record was
  // produced against. Battle-level only: HOST and UPGRADE identity is
  // battle-static and is never copied into turn records (§35).
  hosts: string[];
  upgrades: string[];
  // §4.12/§18.2 — ordered portfolios, so a record identifies the content that
  // produced its inventory and default build.
  portfolios: { id: string; programs: string[] }[];
  // Alpha 0.5.0 §36 — the authored System catalog, so an exported battle record
  // identifies the opponent content it was played against. Battle-level only:
  // System identity is battle-static and is never copied into turn records
  // (§35).
  systems: { id: string; baseIce: number; programs: string[] }[];
  // Alpha 0.7.0 §40 — the authored Boss catalog, on exactly the System's terms,
  // so an exported Boss-battle record identifies the opponent content it was
  // played against without ever presenting the Boss as a System.
  bosses: { id: string; baseIce: number; programs: string[] }[];
}

export function contentStamp(): ContentStamp {
  const c = getContent();
  return {
    gameVersion: c.gameVersion,
    schemaVersion: c.schemaVersion,
    fingerprint: c.fingerprint,
    hackerPrograms: c.hacker.map((p) => p.id),
    systemPrograms: c.system.map((p) => p.id),
    portfolios: [
      ...[...c.hackers.values()].map((h) => ({ id: h.id, programs: [...h.portfolioProgramIds] })),
      ...[...c.decks.values()].map((d) => ({ id: d.id, programs: [...d.portfolioProgramIds] })),
    ],
    functions: [...c.functions.values()].map((f) => ({ id: f.id, cost: f.cost })),
    hackers: [...c.hackerOrder],
    decks: [...c.deckOrder],
    passives: [...c.passives.keys()],
    hosts: [...c.hostOrder],
    upgrades: [...c.upgradeOrder],
    systems: c.systemOrder.map((id) => {
      const s = c.systems.get(id)!;
      return { id: s.id, baseIce: s.baseIce, programs: [...s.programIds] };
    }),
    bosses: c.bossOrder.map((id) => {
      const b = c.bosses.get(id)!;
      return { id: b.id, baseIce: b.baseIce, programs: [...b.programIds] };
    }),
  };
}

// Alpha 0.5.0 §19.4 — the System never spends charge on a Function that cannot
// do anything. This is the shared shape of that answer; the board-aware
// implementation lives in the combat layer, which owns Datastream state.
export interface ActivationEligibility {
  eligible: boolean;
  reason?: string; // why it was withheld, for COMPLETE-level telemetry
}

export type { EffectParamName, TargetKind };
