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

import { programsFor } from './data/content';
import { GameEvent, Side, opponentOf } from './types';

export interface UnitMetrics {
  fires: number; // parent Function activations (paid events)
  ops: number; // expanded payload operations attempted (Effect executions)
  fizzles: number; // ops that legally fizzled (no valid target/placement)
  // "effect" per Program (aggregate of its Function-caused contribution):
  //   EFFECT_ATTACK  → direct damage dealt (incl. its share after shields)
  //   EFFECT_BOMB    → detonation damage from this Program's bombs (+ chains)
  //   EFFECT_BUFF    → bonus damage its buff tiles added to damage events
  //   EFFECT_DRAIN   → total charge drained from opponent Programs
  effect: number;
  chargeWasted: number; // charge granted but discarded at the cap
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
  // MK7.3/7.4 + §11.3 — FIVE DISJOINT causal buckets: match + bomb + attacker
  // + bufferDamageAdded + skillDamage === totalDamage, exactly.
  matchDamage: number; // BASE Sync damage only (zero under Reinforced Connection)
  attackerDamage: number;
  bombDamage: number;
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
  winner: Side | null;
  thinkTimesMs: number[];
  hintsShown: number;
  // MK9.3 — Shielder instrumentation. Alpha data places shields only on the
  // System side; these track SYSTEM-owned shields (prevention is NOT damage
  // dealt and never enters a damage-source bucket).
  enemyShieldCreated: number;
  enemyShieldRemoved: number;
  enemyShieldInstances: number; // Hacker->System damage instances that hit active shield
  enemyShieldPrevented: number; // total damage absorbed by shields
  sides: Record<Side, SideMetrics>;
}

const emptyUnit = (): UnitMetrics => ({ fires: 0, ops: 0, fizzles: 0, effect: 0, chargeWasted: 0, bombsPlaced: 0 });

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

function emptySide(side: Side): SideMetrics {
  const units: Record<string, UnitMetrics> = {};
  for (const p of programsFor(side)) units[p.id] = emptyUnit();
  return {
    totalDamage: 0,
    matchDamage: 0,
    attackerDamage: 0,
    bombDamage: 0,
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
    bufferDamageAdded: 0,
    lineClears: 0,
    units,
    deck: emptyDeck(),
    skills: {},
  };
}

export function createBattleMetrics(): BattleMetrics {
  return {
    turns: 0,
    autoReshuffles: 0,
    winner: null,
    thinkTimesMs: [],
    hintsShown: 0,
    enemyShieldCreated: 0,
    enemyShieldRemoved: 0,
    enemyShieldInstances: 0,
    enemyShieldPrevented: 0,
    sides: { player: emptySide('player'), enemy: emptySide('enemy') },
  };
}

// Buff attribution: the damage event carries the aggregate buff bonus; the
// per-Program credit goes to the side's Program whose plan contains
// EFFECT_BUFF (unique in the Alpha datasets — one Buffer per side at most).
// Revisit if future data gives one side multiple buff sources.
function buffProgramId(side: Side): string | null {
  for (const p of programsFor(side)) {
    if (p.fn.plan.some((op) => op.effectId === 'EFFECT_BUFF')) return p.id;
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
        } else {
          sm.bombDamage += base; // MK7.3: includes bomb-caused settling + cascades
          if (ev.programId) unitOf(sm, ev.programId).effect += base;
        }
        sm.cascadeDamage += ev.cascadeRaw ?? 0; // cross-cutting, any cause
        if (bonus > 0) {
          const buffProg = buffProgramId(side);
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
      case 'chargeWaste': {
        const sm = m.sides[ev.side];
        if (ev.ownerKind === 'deck') sm.deck.chargeWasted += ev.amount;
        else unitOf(sm, ev.programId).chargeWasted += ev.amount;
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
