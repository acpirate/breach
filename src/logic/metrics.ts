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
}

export interface SideMetrics {
  totalDamage: number;
  matchDamage: number;
  attackerDamage: number;
  bombDamage: number;
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
  sides: Record<Side, SideMetrics>;
}

function emptySide(): SideMetrics {
  const units = {} as Record<UnitType, UnitMetrics>;
  for (const t of UNIT_ORDER) units[t] = { fires: 0, effect: 0, chargeWasted: 0 };
  return {
    totalDamage: 0,
    matchDamage: 0,
    attackerDamage: 0,
    bombDamage: 0,
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
    sides: { player: emptySide(), enemy: emptySide() },
  };
}

export function consumeEvents(m: BattleMetrics, events: GameEvent[]): void {
  for (const ev of events) {
    switch (ev.t) {
      case 'damage': {
        const side = opponentOf(ev.target); // damage is dealt BY the target's opponent
        const sm = m.sides[side];
        sm.totalDamage += ev.amount;
        if (ev.amount > sm.largestHit) sm.largestHit = ev.amount;
        if (ev.source === 'match') {
          sm.matchDamage += ev.amount;
          sm.critExtra += ev.critExtra ?? 0;
        } else if (ev.source === 'attacker') {
          sm.attackerDamage += ev.amount;
          sm.units.attacker.effect += ev.amount;
        } else {
          sm.bombDamage += ev.amount;
          sm.units.bomber.effect += ev.amount;
        }
        sm.units.buffer.effect += ev.buffBonus ?? 0;
        sm.bufferDamageAdded += ev.buffBonus ?? 0; // MK6.7 (== dealt − zero-buff dealt)
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
      default:
        break;
    }
  }
}
