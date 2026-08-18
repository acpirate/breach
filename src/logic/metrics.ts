// MK2.3 — Per-battle metrics, collected in the PURE LOGIC LAYER.
// A collector consumes the same GameEvent stream the resolver already emits
// and accumulates counters. No gameplay effect, no rendering dependency.
//
// Alpha 0.1.0 (§13.4): per-Program metrics are keyed by STABLE PROGRAM ID (the
// display name joins at presentation time), and composite execution
// distinguishes parent Function activations (fires) from expanded payload
// operations (ops) and their legal fizzles (§7.5). Child Functions are never
// counted as separately paid parent activations.
//
// Alpha 0.3.0 (§21.3): the Deck-owned Function gets its OWN bucket rather than
// appearing among the Programs, Hacker Skills get source-specific damage and
// charge attribution, and Shake attempts/successes/legal fizzles are counted.
// Damage buckets remain DISJOINT and never double count.

import { FN_CODESHATTER, FN_DATABEND, FN_REBOOT, getContent } from './data/content';
import { GameEvent, PassiveCause, PassiveSourceKind, Side, opponentOf } from './types';

export interface UnitMetrics {
  fires: number; // parent Function activations (paid events)
  ops: number; // expanded payload operations attempted (Effect executions)
  fizzles: number; // ops that legally fizzled (no valid target/placement)
  // "effect" per Program (aggregate of its Function-caused contribution):
  //   EFFECT_ATTACK    → direct damage dealt (incl. its share after shields)
  //   EFFECT_BOMB      → detonation damage from this Program's bombs (+ chains)
  //   EFFECT_BUFF      → bonus damage its buff tiles added to damage events
  //   EFFECT_DRAIN     → total charge drained from opponent Programs
  //   EFFECT_TRANSFORM → damage from the Syncs its transformation created
  effect: number;
  bombsPlaced: number; // EFFECT_BOMB deployments that actually placed a bomb
}

// §21.3 — the active Deck's own metrics. Deck-owned, never merged into the
// per-Program map (§7.1).
export interface DeckMetrics {
  fires: number; // paid Deck Function activations
  ops: number;
  fizzles: number;
  chargeFromNeutral: number; // §7.3 charge earned from sliced neutral Packets
  chargeWasted: number; // that charge discarded at the cap
  shakeAttempts: number; // EFFECT_SHAKE executions attempted
  shakeSuccesses: number;
  shakeFizzles: number; // §8.7 legal fizzles (Datastream left unchanged)
}

// Alpha 0.6.0 §47 — per-PASSIVE-INSTANCE trigger and contribution counters.
// Keyed by `<SOURCE_KIND>:<SOURCE_ID>:<PASSIVE_ID>`, NOT by PASSIVE_ID: the
// same PSV row supplied by two different sources is two instances and both
// apply (§11), so merging them here would make stacking unauditable.
export interface PassiveMetrics {
  sourceKind: PassiveSourceKind;
  sourceId: string;
  passiveId: string;
  triggers: number;
  damage: number; // raw damage contribution (pre-floor)
  charge: number; // charge granted (positive) or dampened away (negative)
  shield: number; // §21 permanent-Shield value contributed to preventions
  steps: number; // §22 named area-pattern steps contributed
}

export interface SideMetrics {
  totalDamage: number;
  // MK7.3/7.4 + §11.3 + §15.3 — SEVEN DISJOINT causal buckets: match + bomb +
  // attacker + lineslice + transform + bufferDamageAdded + passiveDamage ===
  // totalDamage, exactly. `lineslice` is its own bucket rather than a generic
  // Function catch-all so DATACUT stays separable (§15.3).
  matchDamage: number; // BASE Sync damage only (zero under Reinforced Connection)
  attackerDamage: number;
  bombDamage: number;
  linesliceDamage: number; // §13.4 direct row/column slices AND their cascades
  // Alpha 0.5.0 (director ruling, 2026-08-07) — damage from Syncs an
  // EFFECT_TRANSFORM created, credited to the Effect so it can be balanced.
  // Disjoint from matchDamage: a transform-created Sync lands here INSTEAD of
  // there, never in both, so the buckets still sum to totalDamage.
  transformDamage: number;
  // §17/§20/§48 — PASSIVE-contributed damage from every source, never folded
  // into the bucket of the mechanism it modified.
  passiveDamage: number;
  // MK7.3 cross-cutting (overlaps the buckets, does NOT sum with them)
  cascadeDamage: number;
  // MK7.5 — behavioral split of Sync-cause damage by paying axis
  matchDamageColor: number;
  matchDamageShape: number;
  // MK7.6 — per-round (per game turn) damage: ceiling and baseline
  biggestRound: number;
  roundDamageSum: number; // over rounds where this side dealt > 0
  roundDamageCount: number;
  critExtra: number;
  largestHit: number; // biggest single damage event (Sync step, Function, or bomb)
  deepestCascade: number;
  // MK5.6 — charge-source contention
  tilesDestroyed: number;
  contentionTiles: number;
  // Alpha 0.4.1 §8.4, completed by Alpha 0.5.0 §39 — THE canonical charge-waste
  // figure for this side: every unit of Program-pool charge generated for it
  // that could not be stored, whatever the source. That is end-of-stream
  // routing discard (the queue ran out of compatible non-full Programs) PLUS
  // flat/timer overflow that Alpha 0.4.1 still reported per Program.
  //
  // §39.2 — per-Program `chargeWasted` is GONE as an analytical authority: it
  // invited "which Program wasted charge", a question the routing rules make
  // meaningless. §39.4 — no color/shape split; axis-specific waste is deferred.
  //
  // Director ruling (2026-08-07): PROGRAM POOLS ONLY. The Deck Function's pool
  // keeps its own `deck.chargeWasted` bucket and is deliberately not folded in.
  chargeWastedTotal: number;
  // MK6.7 — buffer damage added (disjoint bucket)
  bufferDamageAdded: number;
  // §9.5 — line-clear frequency, so board churn under the B1 rule is observable
  lineClears: number;
  units: Record<string, UnitMetrics>; // keyed by stable Program ID
  deck: DeckMetrics;
  passives: Record<string, PassiveMetrics>; // keyed by source kind + source ID + PASSIVE ID
}

export interface BattleMetrics {
  turns: number;
  autoReshuffles: number;
  // Alpha 0.4.1 (designer ruling, 2026-08-01) — bomb detonations are an
  // AGGREGATE counter here rather than a per-turn count or a discrete event
  // stream, so BASIC can still answer "did this materially appear?" without
  // retaining any per-turn records. Reshuffles and B1 line clears were already
  // aggregated this way (autoReshuffles above, sides[].lineClears below).
  detonations: number;
  winner: Side | null;
  thinkTimesMs: number[];
  hintsShown: number;
  // Alpha 0.5.0 §19.4/§37.2 — how many times a ready System Program was NOT
  // activated because it had no valid target (COERCE with no neutral Packets,
  // a placement Function with nowhere to place, Drain with nothing charged).
  // A compact battle-level count is exactly what §37.2 asks for instead of
  // per-turn decision logging.
  systemWithholds: number;
  // MK9.3 — Shielder instrumentation. Alpha data places shields only on the
  // System side; these track SYSTEM-owned shields (prevention is NOT damage
  // dealt and never enters a damage-source bucket).
  enemyShieldCreated: number;
  enemyShieldRemoved: number;
  enemyShieldInstances: number; // Hacker->System damage instances that hit active shield
  enemyShieldPrevented: number; // total damage absorbed by shields
  // Alpha 0.7.0 §42 — Boss-battle aggregates. Battle-level counters, exactly
  // like `detonations` and `systemWithholds` above, so the encounter can be
  // evaluated later without adding per-turn storage (§42). DAMAGE is NOT
  // duplicated here: the existing attribution buckets remain authoritative for
  // amounts, and §42 forbids a second Boss-only damage tree.
  boss: BossMetrics | null; // null in every non-Boss battle
  sides: Record<Side, SideMetrics>;
}

// §42 — present only when the opponent is a Boss.
export interface BossMetrics {
  bossId: string;
  overridesPlaced: number; // total placed across the battle
  overridePeak: number; // peak simultaneous on-board count
  hackerSpecialsOverwritten: number;
  databendActivations: number;
  codeshatterActivations: number;
  rebootActivations: number;
  // The director-mandated retry cap actually being hit. Expected to stay 0 with
  // current content; a nonzero value means the board reached a state where three
  // Overrides could not be placed even after the permitted DATABEND retries.
  placementsAbandoned: number;
}

const emptyUnit = (): UnitMetrics => ({ fires: 0, ops: 0, fizzles: 0, effect: 0, bombsPlaced: 0 });

const emptyDeck = (): DeckMetrics => ({
  fires: 0,
  ops: 0,
  fizzles: 0,
  chargeFromNeutral: 0,
  chargeWasted: 0,
  shakeAttempts: 0,
  shakeSuccesses: 0,
  shakeFizzles: 0,
});

const emptyPassive = (cause: PassiveCause): PassiveMetrics => ({
  sourceKind: cause.sourceKind,
  sourceId: cause.sourceId,
  passiveId: cause.passiveId,
  triggers: 0,
  damage: 0,
  charge: 0,
  shield: 0,
  steps: 0,
});

// Alpha 0.4.0 §5.8 — seeded from the battle's ACTIVE roster, not from every
// loaded Program: an inactive inventory Program has no metrics slot.
function emptySide(programIds: readonly string[]): SideMetrics {
  const units: Record<string, UnitMetrics> = {};
  for (const id of programIds) units[id] = emptyUnit();
  return {
    totalDamage: 0,
    matchDamage: 0,
    attackerDamage: 0,
    bombDamage: 0,
    linesliceDamage: 0,
    transformDamage: 0,
    passiveDamage: 0,
    cascadeDamage: 0,
    matchDamageColor: 0,
    matchDamageShape: 0,
    biggestRound: 0,
    roundDamageSum: 0,
    roundDamageCount: 0,
    critExtra: 0,
    largestHit: 0,
    deepestCascade: 0,
    tilesDestroyed: 0,
    contentionTiles: 0,
    chargeWastedTotal: 0,
    bufferDamageAdded: 0,
    lineClears: 0,
    units,
    deck: emptyDeck(),
    passives: {},
  };
}

export function createBattleMetrics(
  playerPrograms: readonly string[],
  enemyPrograms: readonly string[],
  // §42 — supplied only for a Boss battle; every other battle carries null and
  // no Boss counters at all.
  bossId?: string,
): BattleMetrics {
  return {
    turns: 0,
    autoReshuffles: 0,
    detonations: 0,
    systemWithholds: 0,
    boss: bossId
      ? {
          bossId,
          overridesPlaced: 0,
          overridePeak: 0,
          hackerSpecialsOverwritten: 0,
          databendActivations: 0,
          codeshatterActivations: 0,
          rebootActivations: 0,
          placementsAbandoned: 0,
        }
      : null,
    winner: null,
    thinkTimesMs: [],
    hintsShown: 0,
    enemyShieldCreated: 0,
    enemyShieldRemoved: 0,
    enemyShieldInstances: 0,
    enemyShieldPrevented: 0,
    sides: { player: emptySide(playerPrograms), enemy: emptySide(enemyPrograms) },
  };
}

// Buff attribution: the damage event carries the aggregate buff bonus; the
// per-Program credit goes to the side's ACTIVE Program whose plan contains
// EFFECT_BUFF (unique in the Alpha datasets — one Buffer per side at most).
// Alpha 0.4: scanned over the battle's own roster, so a Buffer left in the
// inventory is never credited. Revisit if future data gives one side multiple
// buff sources.
function buffProgramId(sm: SideMetrics): string | null {
  for (const id of Object.keys(sm.units)) {
    const p = getContent().programsById.get(id);
    if (p?.fn.plan.some((op) => op.effectId === 'EFFECT_BUFF')) return id;
  }
  return null;
}

function unitOf(sm: SideMetrics, programId: string): UnitMetrics {
  return (sm.units[programId] ??= emptyUnit());
}

export const passiveMetricKey = (cause: PassiveCause): string =>
  `${cause.sourceKind}:${cause.sourceId}:${cause.passiveId}`;

function passiveOf(sm: SideMetrics, cause: PassiveCause): PassiveMetrics {
  return (sm.passives[passiveMetricKey(cause)] ??= emptyPassive(cause));
}

export function consumeEvents(m: BattleMetrics, events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.t) {
      case 'damage': {
        const side = opponentOf(ev.target); // damage is dealt BY the target's opponent
        const sm = m.sides[side];
        const bonus = ev.buffBonus ?? 0;
        const passive = ev.passiveRaw ?? 0;
        const base = ev.amount - bonus; // MK7.4: buffer subtracted out of the causal bucket
        sm.totalDamage += ev.amount;
        if (ev.amount > sm.largestHit) sm.largestHit = ev.amount;
        if (ev.source === 'match') {
          // §17/§48: the PASSIVE portion is its OWN bucket and is removed from
          // base Sync damage, so the two never double count. Under Reinforced
          // Connection the whole causal amount is PASSIVE damage and base Sync
          // damage records as a clean zero.
          sm.matchDamage += base - passive;
          sm.passiveDamage += passive;
          sm.critExtra += ev.critExtra ?? 0;
          sm.matchDamageColor += ev.colorRaw ?? 0;
          sm.matchDamageShape += ev.shapeRaw ?? 0;
        } else if (ev.source === 'attacker') {
          // §20/§48 — a Function-damage PASSIVE increment is subtracted out of
          // the Function's own bucket the same way, so the base event stays
          // attributed to its original mechanism and the totals still reconcile.
          sm.attackerDamage += base - passive;
          sm.passiveDamage += passive;
          if (ev.programId) unitOf(sm, ev.programId).effect += base - passive;
        } else if (ev.source === 'lineslice') {
          sm.linesliceDamage += base - passive; // §13.4: direct slice + its cascades
          sm.passiveDamage += passive;
          if (ev.programId) unitOf(sm, ev.programId).effect += base - passive;
        } else if (ev.source === 'transform') {
          // Alpha 0.5.0 — the Syncs a Transform created, credited to the
          // Effect. The per-Program `effect` credit is what makes the Effect's
          // contribution legible next to ATTACK/BOMB damage in the same units.
          sm.transformDamage += base - passive;
          sm.passiveDamage += passive;
          if (ev.programId) unitOf(sm, ev.programId).effect += base - passive;
        } else {
          sm.bombDamage += base - passive; // MK7.3: includes bomb-caused settling + cascades
          sm.passiveDamage += passive;
          if (ev.programId) unitOf(sm, ev.programId).effect += base - passive;
        }
        sm.cascadeDamage += ev.cascadeRaw ?? 0; // cross-cutting, any cause
        if (bonus > 0) {
          const buffProg = buffProgramId(sm);
          if (buffProg) unitOf(sm, buffProg).effect += bonus;
        }
        sm.bufferDamageAdded += bonus; // MK6.7/MK7.4 disjoint bucket
        break;
      }
      case 'ability': {
        const sm = m.sides[ev.side];
        // Alpha 0.7.0 §42 — a `boss` activation is the ODANSHAY mechanic, not a
        // Program. Counting it through unitOf() would invent a phantom
        // per-Program row keyed by the Boss ID and corrupt the Program metrics,
        // so it goes to the Boss aggregates by payload Function instead.
        if (ev.ownerKind === 'boss') {
          const b = m.boss;
          if (b) {
            if (ev.fn === FN_DATABEND) b.databendActivations++;
            else if (ev.fn === FN_CODESHATTER) b.codeshatterActivations++;
            else if (ev.fn === FN_REBOOT) b.rebootActivations++;
          }
        } else if (ev.ownerKind === 'deck') sm.deck.fires++;
        else unitOf(sm, ev.programId).fires++;
        break;
      }
      case 'op': {
        const sm = m.sides[ev.side];
        // §42 — likewise: a Boss mechanic payload owns no Program slot.
        if (ev.ownerKind === 'boss') break;
        if (ev.ownerKind === 'deck') {
          sm.deck.ops++;
          if (!ev.resolved) sm.deck.fizzles++;
        } else {
          const um = unitOf(sm, ev.programId);
          um.ops++;
          if (!ev.resolved) um.fizzles++;
          if (ev.drained) um.effect += ev.drained;
        }
        break;
      }
      // Alpha 0.6.0 §47 — keyed by SOURCE+PASSIVE, not by PASSIVE_ID alone.
      // The same PSV row supplied by a Hacker and by a HOST is two instances
      // (§11), and collapsing them here would make the stacking rule
      // unauditable. `shield` and `steps` are prevention/area contributions
      // rather than damage, so they get their own counters.
      case 'passive': {
        const sm = m.sides[ev.side];
        const k = passiveOf(sm, ev.cause);
        k.triggers++;
        k.damage += ev.damage ?? 0;
        k.charge += ev.charge ?? 0;
        k.shield += ev.shield ?? 0;
        k.steps += ev.steps ?? 0;
        break;
      }
      case 'deckCharge': {
        const d = m.sides[ev.side].deck;
        d.chargeFromNeutral += ev.amount;
        d.chargeWasted += ev.wasted;
        break;
      }
      case 'shake': {
        const d = m.sides[ev.side].deck;
        d.shakeAttempts++;
        if (ev.resolved) d.shakeSuccesses++;
        else d.shakeFizzles++;
        break;
      }
      case 'lineClear':
        m.sides[ev.side].lineClears++;
        break;
      // Alpha 0.5.0 §39.1 — flat/timer overflow now joins routing discard in
      // the ONE canonical side-level total instead of being attributed to the
      // Program whose pool happened to be full. The Deck keeps its own bucket
      // (director ruling: the side total covers Program pools only).
      case 'chargeWaste': {
        const sm = m.sides[ev.side];
        if (ev.ownerKind === 'deck') sm.deck.chargeWasted += ev.amount;
        else sm.chargeWastedTotal += ev.amount;
        break;
      }
      // §39.1/§39.3 — the other half of the same total, read straight off each
      // routed stream so the figure stays verifiable against the routing events.
      case 'chargeRoute':
        m.sides[ev.side].chargeWastedTotal += ev.discarded;
        break;
      case 'detonate':
        m.detonations++;
        break;
      // §37.2 — aggregate only. The event is never persisted to a log stream.
      case 'withhold':
        m.systemWithholds++;
        break;
      // Alpha 0.7.0 §42 — Boss mechanic aggregates. `overridePeak` is tracked
      // from the count the placement batch reported rather than by rescanning
      // the board, so the metric and the event stream cannot disagree.
      case 'bossMechanic': {
        const b = m.boss;
        if (!b) break;
        if (ev.kind === 'OVERRIDE_PLACED') {
          b.overridesPlaced += ev.placed ?? 0;
          b.hackerSpecialsOverwritten += ev.overwrote ?? 0;
        } else if (ev.kind === 'PLACEMENT_ABANDONED') {
          b.placementsAbandoned++;
        }
        if (ev.countAfter > b.overridePeak) b.overridePeak = ev.countAfter;
        break;
      }
      case 'placed':
        if (ev.kind === 'bomb') {
          if (ev.ownerKind !== 'deck') unitOf(m.sides[ev.side], ev.programId).bombsPlaced += ev.count;
        } else if (ev.side === 'enemy') m.enemyShieldCreated += ev.count;
        break;
      case 'shield':
        if (ev.target === 'enemy') {
          m.enemyShieldInstances++;
          m.enemyShieldPrevented += ev.prevented;
        }
        break;
      case 'shieldRemoved':
        m.enemyShieldRemoved += ev.count;
        break;
      case 'autoReshuffle':
        m.autoReshuffles++;
        break;
      case 'cascadeDepth': {
        const sm = m.sides[ev.side];
        if (ev.depth > sm.deepestCascade) sm.deepestCascade = ev.depth;
        break;
      }
      case 'tileStats': {
        const sm = m.sides[ev.side];
        sm.tilesDestroyed += ev.destroyed;
        sm.contentionTiles += ev.contested;
        break;
      }
      case 'thinkTime':
        m.thinkTimesMs.push(ev.ms);
        break;
      case 'hintShown':
        m.hintsShown++;
        break;
      default:
        break;
    }
  }
}
