// MK4.3 — Logic-layer battle logging, fed by the SAME event stream the
// metrics collector consumes (Game.collect routes every batch through both;
// there is no second pipeline). Pure data in, pure data out — persistence is
// the platform adapter's job (src/storage.ts in the browser).
//
// Tier 1: one MetricLogEntry per completed battle (final metrics).
// Tier 2: one TurnLogEntry per game turn — the actions taken and their
//         outcome, enough to reconstruct the turn without a board snapshot.
// Tier 3 (full board snapshots): PARKED — deliberately not built.

import { BattleMetrics } from './metrics';
import { BattleConfig, GameEvent, GameState, Side, opponentOf } from './types';

// Version tag stamped on every log entry (designer-set; placeholder scheme).
// Older-version entries remain in the logs until explicitly cleared.
export const LOG_VERSION = 'mk6';

// Log-size caps — directly controlled here, comfortably under the ~5MB
// localStorage quota (entries are a few hundred bytes each). The storage
// adapter evicts oldest entries beyond these.
export const MAX_METRIC_LOG_ENTRIES = 500;
export const MAX_TURN_LOG_ENTRIES = 4000;

interface SideDamage {
  match: number;
  attacker: number;
  bomb: number;
  total: number;
}

export interface TurnLogEntry {
  v: string; // LOG_VERSION
  battleId: string;
  config: BattleConfig; // MK5.5 — active config; entries are uninterpretable without it
  turn: number;
  actions: string[]; // committed swaps, shakes, abilities fired (both sides)
  damage: Record<Side, SideDamage>; // dealt BY each side this turn
  detonations: number;
  reshuffles: number;
  hpAfter: Record<Side, number>;
  chargesAfter: { player: number[]; enemy: number[]; shake: number };
  thinkMs?: number; // MK6.6 — RAW think-time for this turn's committed move (no aggregation)
  result?: Side; // present on a battle's final entry: who won
}

export interface MetricLogEntry {
  v: string; // LOG_VERSION
  battleId: string;
  config: BattleConfig; // MK5.5 — active config stamp (HP included as of MK6.4)
  endedAt: string; // ISO timestamp
  winner: Side;
  wallClockMs?: number; // MK6.6 — total battle wall-clock (this session)
  metrics: BattleMetrics;
}

const freshDamage = (): Record<Side, SideDamage> => ({
  player: { match: 0, attacker: 0, bomb: 0, total: 0 },
  enemy: { match: 0, attacker: 0, bomb: 0, total: 0 },
});

export class TurnLogger {
  private current: TurnLogEntry | null = null;

  constructor(private battleId: string) {}

  private fresh(state: GameState): TurnLogEntry {
    return {
      v: LOG_VERSION,
      battleId: this.battleId,
      config: { ...state.config },
      turn: state.turn,
      actions: [],
      damage: freshDamage(),
      detonations: 0,
      reshuffles: 0,
      hpAfter: { player: 0, enemy: 0 },
      chargesAfter: { player: [], enemy: [], shake: 0 },
    };
  }

  // Consume one event batch; returns any turn entries finalized by it.
  // (The turn counter advances at the end of the enemy phase, so a batch's
  // events always belong to the entry opened before it.)
  consume(state: GameState, events: GameEvent[]): TurnLogEntry[] {
    if (!this.current) this.current = this.fresh(state);
    const e = this.current;
    for (const ev of events) {
      switch (ev.t) {
        case 'swap':
          e.actions.push(`swap (${ev.a.x},${ev.a.y})->(${ev.b.x},${ev.b.y})`);
          break;
        case 'shakeUsed':
          e.actions.push('player board-shake');
          break;
        case 'ability':
          e.actions.push(`${ev.side} fired ${ev.unit}${ev.drained !== undefined ? ` (drained ${ev.drained})` : ''}`);
          break;
        case 'detonate':
          e.detonations++;
          break;
        case 'autoReshuffle':
          e.reshuffles++;
          break;
        case 'damage': {
          const dealer = opponentOf(ev.target);
          e.damage[dealer][ev.source] += ev.amount;
          e.damage[dealer].total += ev.amount;
          break;
        }
        case 'thinkTime':
          e.thinkMs = ev.ms;
          break;
        default:
          break;
      }
    }
    const done: TurnLogEntry[] = [];
    if (state.turn !== e.turn || state.winner) {
      e.hpAfter = { player: Math.max(0, state.hp.player), enemy: Math.max(0, state.hp.enemy) };
      e.chargesAfter = {
        player: state.units.player.map((u) => u.charge),
        enemy: state.units.enemy.map((u) => u.charge),
        shake: state.shakeCharge,
      };
      if (state.winner) e.result = state.winner;
      done.push(e);
      this.current = state.winner ? null : this.fresh(state);
    }
    return done;
  }
}
