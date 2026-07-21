// MK2.3 — Per-battle metrics, collected in the PURE LOGIC LAYER.
// A collector consumes the same GameEvent stream the resolver already emits
// and accumulates counters. No gameplay effect, no rendering dependency.
//
// Alpha 0.1.0 (§13.4): per-unit metrics are keyed by STABLE PROGRAM ID (the
// display name joins at presentation time), and composite execution
// distinguishes parent Function activations (fires) from expanded payload
// operations (ops) and their legal fizzles (§7.5). Child Functions are never
// counted as separately paid parent activations.

import { programsFor } from './data/content';
import { GameEvent, Side, opponentOf } from './types';

export interface UnitMetrics {
  fires: number; // parent Function activations (player-paid events)
  ops: number; // expanded payload operations attempted (Effect executions)
  fizzles: number; // ops that legally fizzled (no valid target/placement)
  // "effect" per Program (aggregate of its ability-caused contribution):
  //   EFFECT_ATTACK  → direct damage dealt (incl. its share after shields)
  //   EFFECT_BOMB    → detonation damage from this Program's bombs (+ chains)
  //   EFFECT_BUFF    → bonus damage its buff tiles added to damage events
  //   EFFECT_DRAIN   → total charge drained from opponent Programs
  effect: number;
  chargeWasted: number; // charge granted but discarded at the cap
  bombsPlaced: number; // EFFECT_BOMB deployments that actually placed a bomb
}

export interface SideMetrics {
  totalDamage: number;
  // MK7.3/7.4 — FOUR DISJOINT causal buckets: match + bomb + attacker +
  // bufferDamageAdded === totalDamage, exactly.
  matchDamage: number;
  attackerDamage: number;
  bombDamage: number;
  // MK7.3 cross-cutting (overlaps the buckets, does NOT sum with them)
  cascadeDamage: number;
  // MK7.5 — behavioral split of match-cause damage by paying axis
  matchDamageColor: number;
  matchDamageShape: number;
  // MK7.6 — per-round (per game turn) damage: ceiling and baseline
  biggestRound: number;
  roundDamageSum: number; // over rounds where this side dealt > 0
  roundDamageCount: number;
  critExtra: number;
  largestHit: number; // biggest single damage event (match step, ability, or bomb)
  deepestCascade: number;
  // MK5.6 — charge-source contention
  tilesDestroyed: number;
  contentionTiles: number;
  // MK6.7 — buffer damage added (disjoint bucket)
  bufferDamageAdded: number;
  units: Record<string, UnitMetrics>; // keyed by stable Program ID
}

export interface BattleMetrics {
  turns: number;
  autoReshuffles: number;
  winner: Side | null;
  thinkTimesMs: number[];
  hintsShown: number;
  // MK9.3 — Shielder instrumentation. Alpha data places shields only on the
  // System side; these track ENEMY-owned shields (prevention is NOT damage
  // dealt and never enters a damage-source bucket).
  enemyShieldCreated: number;
  enemyShieldRemoved: number;
  enemyShieldInstances: number; // player->enemy damage instances that hit active shield
  enemyShieldPrevented: number; // total damage absorbed by shields
  sides: Record<Side, SideMetrics>;
}

const emptyUnit = (): UnitMetrics => ({ fires: 0, ops: 0, fizzles: 0, effect: 0, chargeWasted: 0, bombsPlaced: 0 });

function emptySide(side: Side): SideMetrics {
  const units: Record<string, UnitMetrics> = {};
  for (const p of programsFor(side)) units[p.id] = emptyUnit();
  return {
    totalDamage: 0,
    matchDamage: 0,
    attackerDamage: 0,
    bombDamage: 0,
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
    units,
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

export function consumeEvents(m: BattleMetrics, events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.t) {
      case 'damage': {
        const side = opponentOf(ev.target); // damage is dealt BY the target's opponent
        const sm = m.sides[side];
        const bonus = ev.buffBonus ?? 0;
        const base = ev.amount - bonus; // MK7.4: buffer subtracted out of the causal bucket
        sm.totalDamage += ev.amount;
        if (ev.amount > sm.largestHit) sm.largestHit = ev.amount;
        if (ev.source === 'match') {
          sm.matchDamage += base;
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
      case 'ability':
        unitOf(m.sides[ev.side], ev.programId).fires++;
        break;
      case 'op': {
        const um = unitOf(m.sides[ev.side], ev.programId);
        um.ops++;
        if (!ev.resolved) um.fizzles++;
        if (ev.drained) um.effect += ev.drained;
        break;
      }
      case 'chargeWaste':
        unitOf(m.sides[ev.side], ev.programId).chargeWasted += ev.amount;
        break;
      case 'placed':
        if (ev.kind === 'bomb') unitOf(m.sides[ev.side], ev.programId).bombsPlaced += ev.count;
        else if (ev.side === 'enemy') m.enemyShieldCreated += ev.count;
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
