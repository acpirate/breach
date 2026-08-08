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

import { getContent } from './data/content';
import { GameEvent, Side, opponentOf } from './types';

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

// §21.3 — per-Skill trigger and contribution counters, keyed by stable SKL_ ID.
export interface SkillMetrics {
  triggers: number;
  damage: number; // SKL_EXTRA_MATCH_DAMAGE raw contribution (pre-floor)
  charge: number; // SKL_EXTRA_MATCH_CHARGE charge actually granted
}

export interface SideMetrics {
  totalDamage: number;
  // MK7.3/7.4 + §11.3 + §15.3 — SIX DISJOINT causal buckets: match + bomb +
  // attacker + lineslice + bufferDamageAdded + skillDamage === totalDamage,
  // exactly. `lineslice` is its own bucket rather than a generic Function
  // catch-all so DATACUT stays separable (§15.3).
  matchDamage: number; // BASE Sync damage only (zero under Reinforced Connection)
  attackerDamage: number;
  bombDamage: number;
  linesliceDamage: number; // §13.4 direct row/column slices AND their cascades
  // Alpha 0.5.0 (director ruling, 2026-08-07) — damage from Syncs an
  // EFFECT_TRANSFORM created, credited to the Effect so it can be balanced.
  // Disjoint from matchDamage: a transform-created Sync lands here INSTEAD of
  // there, never in both, so the buckets still sum to totalDamage.
  transformDamage: number;
  skillDamage: number; // §6.4 Hacker-Skill damage, never folded into matchDamage
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
  skills: Record<string, SkillMetrics>; // keyed by stable Skill ID
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
  sides: Record<Side, SideMetrics>;
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

const emptySkill = (): SkillMetrics => ({ triggers: 0, damage: 0, charge: 0 });

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
    skillDamage: 0,
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
    skills: {},
  };
}

export function createBattleMetrics(
  playerPrograms: readonly string[],
  enemyPrograms: readonly string[],
): BattleMetrics {
  return {
    turns: 0,
    autoReshuffles: 0,
    detonations: 0,
    systemWithholds: 0,
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

function skillOf(sm: SideMetrics, skillId: string): SkillMetrics {
  return (sm.skills[skillId] ??= emptySkill());
}

export function consumeEvents(m: BattleMetrics, events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.t) {
      case 'damage': {
        const side = opponentOf(ev.target); // damage is dealt BY the target's opponent
        const sm = m.sides[side];
        const bonus = ev.buffBonus ?? 0;
        const skill = ev.skillRaw ?? 0;
        const base = ev.amount - bonus; // MK7.4: buffer subtracted out of the causal bucket
        sm.totalDamage += ev.amount;
        if (ev.amount > sm.largestHit) sm.largestHit = ev.amount;
        if (ev.source === 'match') {
          // §6.4/§11.3: the Skill portion is its OWN bucket and is removed from
          // base Sync damage, so the two never double count. Under Reinforced
          // Connection the whole causal amount is Skill damage and base Sync
          // damage records as a clean zero.
          sm.matchDamage += base - skill;
          sm.skillDamage += skill;
          sm.critExtra += ev.critExtra ?? 0;
          sm.matchDamageColor += ev.colorRaw ?? 0;
          sm.matchDamageShape += ev.shapeRaw ?? 0;
        } else if (ev.source === 'attacker') {
          sm.attackerDamage += base;
          if (ev.programId) unitOf(sm, ev.programId).effect += base;
        } else if (ev.source === 'lineslice') {
          sm.linesliceDamage += base; // §13.4: direct slice + its cascades
          if (ev.programId) unitOf(sm, ev.programId).effect += base;
        } else if (ev.source === 'transform') {
          // Alpha 0.5.0 — the Syncs COERCE created, credited to COERCE. The
          // per-Program `effect` credit is what makes the Effect's contribution
          // legible next to ATTACK/BOMB damage in the same units.
          sm.transformDamage += base;
          if (ev.programId) unitOf(sm, ev.programId).effect += base;
        } else {
          sm.bombDamage += base; // MK7.3: includes bomb-caused settling + cascades
          if (ev.programId) unitOf(sm, ev.programId).effect += base;
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
        if (ev.ownerKind === 'deck') sm.deck.fires++;
        else unitOf(sm, ev.programId).fires++;
        break;
      }
      case 'op': {
        const sm = m.sides[ev.side];
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
      case 'skill': {
        const sm = m.sides[ev.side];
        const k = skillOf(sm, ev.skillId);
        k.triggers++;
        k.damage += ev.damage ?? 0;
        k.charge += ev.charge ?? 0;
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
