// MK2.3 — Per-battle metrics, collected in the PURE LOGIC LAYER.
// A collector consumes the same GameEvent stream the resolver already emits
// (enriched with source/crit/waste data) and accumulates counters. No gameplay
// effect, no rendering dependency — headless batch runs read these directly.

import { GameEvent, Side, UNIT_ORDER, UnitType, opponentOf } from './types';

export interface UnitMetrics {
  fires: number;
  // "effect" per unit type (designer-confirmed definitions):
  //   attacker → direct damage dealt
  //   bomber   → total detonation damage from this side's bombs
  //   buffer   → total bonus damage its buff tiles added to damage events
  //   disabler → total charge drained from opponent units
  effect: number;
  chargeWasted: number; // charge granted but discarded at the cost cap
  // MK9.1/9.2 — bomber only: total bombs successfully placed across all
  // activations (2/activation for the player, 1 for the enemy E-Bomb).
  bombsPlaced: number;
}

export interface SideMetrics {
  totalDamage: number;
  // MK7.3/7.4 — FOUR DISJOINT causal buckets: match + bomb + attacker +
  // bufferDamageAdded === totalDamage, exactly. Each damage event's buff
  // portion is subtracted out of its causal bucket into the buffer bucket;
  // bomb-caused settling and cascades credit to bomb, not match.
  matchDamage: number;
  attackerDamage: number;
  bombDamage: number;
  // MK7.3 cross-cutting (overlaps the buckets, does NOT sum with them):
  // pre-floor damage from tiles destroyed exclusively by stochastic refill
  // matches, regardless of cause — "how much is unearned RNG?"
  cascadeDamage: number;
  // MK7.5 — behavioral split of match-cause damage by paying axis (pre-floor
  // raw; neutral-tile damage belongs to neither axis)
  matchDamageColor: number;
  matchDamageShape: number;
  // MK7.6 — per-round (per game turn) damage: ceiling and baseline
  biggestRound: number;
  roundDamageSum: number; // over rounds where this side dealt > 0
  roundDamageCount: number;
  // Crit metric: only the portion ADDED by the 1.5x multiplier
  // (sum of tile base x 0.5 for crit-multiplied tiles, measured pre-floor).
  critExtra: number;
  largestHit: number; // biggest single damage event (match step, ability, or bomb)
  deepestCascade: number; // max steps in one move/detonation (1 = no cascading)
  // MK5.6 — charge-source contention: of the tiles this side destroyed in
  // match steps, how many were bound (by color or shape) to an opposing unit
  tilesDestroyed: number;
  contentionTiles: number;
  // MK6.7 — buffer damage added: sum over damage events of (dealt − what
  // would have been dealt with zero active buff stacks). Stacking-safe.
  bufferDamageAdded: number;
  units: Record<UnitType, UnitMetrics>;
}

export interface BattleMetrics {
  turns: number;
  autoReshuffles: number; // match-lock count: automatic deadlock reshuffles fired
  winner: Side | null;
  // MK6.6 — RAW per-turn think-times (input-available -> move-committed),
  // never pre-aggregated; medians are computed at display/analysis time
  thinkTimesMs: number[];
  hintsShown: number; // MK7.7 — hint-assisted turns are excludable from think-time analysis
  // MK9.3 — enemy Shielder instrumentation (battle-level; shields are enemy-
  // only). `prevented` is damage absorbed, NOT damage dealt — it is never added
  // to any damage-source bucket.
  enemyShieldCreated: number;
  enemyShieldRemoved: number;
  enemyShieldInstances: number; // player->enemy damage instances that hit active shield
  enemyShieldPrevented: number; // total damage absorbed by shields
  sides: Record<Side, SideMetrics>;
}

function emptySide(): SideMetrics {
  const units = {} as Record<UnitType, UnitMetrics>;
  for (const t of UNIT_ORDER) units[t] = { fires: 0, effect: 0, chargeWasted: 0, bombsPlaced: 0 };
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
    sides: { player: emptySide(), enemy: emptySide() },
  };
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
          sm.units.attacker.effect += base;
        } else {
          sm.bombDamage += base; // MK7.3: includes bomb-caused settling + cascades
          sm.units.bomber.effect += base;
        }
        sm.cascadeDamage += ev.cascadeRaw ?? 0; // cross-cutting, any cause
        sm.units.buffer.effect += bonus;
        sm.bufferDamageAdded += bonus; // MK6.7/MK7.4 disjoint bucket
        break;
      }
      case 'ability': {
        const sm = m.sides[ev.side];
        sm.units[ev.unit].fires++;
        if (ev.drained) sm.units.disabler.effect += ev.drained;
        break;
      }
      case 'chargeWaste':
        m.sides[ev.side].units[ev.unit].chargeWasted += ev.amount;
        break;
      case 'placed':
        if (ev.kind === 'bomb') m.sides[ev.side].units.bomber.bombsPlaced += ev.count;
        else m.enemyShieldCreated += ev.count; // shields are enemy-only
        break;
      case 'shield':
        m.enemyShieldInstances++;
        m.enemyShieldPrevented += ev.prevented;
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
