// MK4.3 — Logic-layer battle logging, fed by the SAME event stream the
// metrics collector consumes (Game.collect routes every batch through both;
// there is no second pipeline). Pure data in, pure data out — persistence is
// the platform adapter's job (src/storage.ts in the browser).
//
// Tier 1: one MetricLogEntry per completed battle (final metrics + the
//         Alpha content-identity stamp, §13.2).
// Tier 2: one TurnLogEntry per game turn — the actions taken and their
//         outcome; stamps the content fingerprint so entries stay
//         attributable without duplicating the full content identity.

import { ContentStamp, GAME_VERSION, getContent } from './data/content';
import { BattleMetrics } from './metrics';
import {
  BattleConfig,
  BattleIdentity,
  GameEvent,
  GameState,
  Mode,
  NaturalOutcome,
  RunStep,
  SelectionSource,
  Side,
  WizardAction,
  opponentOf,
} from './types';

// Version tag stamped on every log entry. Alpha 0.1.0: no active output path
// may continue to emit a stale MK tag (§13.1).
export const LOG_VERSION = GAME_VERSION;

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

// Alpha 0.3.0 §21.2 — the selection/build identity every relevant record
// carries. Derived from the battle's own BattleIdentity so a log entry can
// never disagree with the battle it describes.
export interface IdentityStamp {
  hackerId: string;
  deckId: string;
  skillIds: string[];
  deckFunctionId: string;
  hackerPrograms: string[];
  systemPrograms: string[];
  selectionSource: SelectionSource;
}

export function identityStamp(id: BattleIdentity): IdentityStamp {
  return {
    hackerId: id.hackerId,
    deckId: id.deckId,
    skillIds: [...id.skillIds],
    deckFunctionId: id.deckFunctionId,
    hackerPrograms: [...id.hackerPrograms],
    systemPrograms: [...id.systemPrograms],
    selectionSource: id.selectionSource,
  };
}

export interface TurnLogEntry {
  v: string; // LOG_VERSION
  fp: string; // content fingerprint (§13.2 attribution, compact form)
  // Alpha 0.2.0 §13.2 — mode/Run context, stamped by the orchestrator at the
  // persistence boundary (the pure logger is mode-agnostic). Quick Match
  // entries carry no runStep (never fake Run values).
  mode?: Mode;
  runStep?: RunStep;
  battleId: string;
  config: BattleConfig; // MK5.5 — active config; entries are uninterpretable without it
  identity: IdentityStamp; // §21.2 — Hacker/Deck/Skill/build identity
  turn: number;
  actions: string[]; // committed swaps, Functions fired (both sides)
  damage: Record<Side, SideDamage>; // dealt BY each side this turn
  detonations: number;
  reshuffles: number;
  lineClears: number; // §9.5 — observable board churn under the B1 rule
  hpAfter: Record<Side, number>;
  chargesAfter: { player: number[]; enemy: number[]; deck: number };
  thinkMs?: number; // MK6.6 — RAW think-time for this turn's committed move
  hintShown?: boolean; // MK7.7
  result?: Side; // present on a battle's final entry: who won
}

export interface MetricLogEntry {
  v: string; // LOG_VERSION
  battleId: string;
  config: BattleConfig; // MK5.5 — active config stamp (HP included)
  content: ContentStamp; // §13.2 — loaded-content identity
  endedAt: string; // ISO timestamp
  winner: Side;
  // Alpha 0.2.0 §13.2/§5.4 — the battle's NATURAL outcome and its mode/Run
  // context. Wizard actions are recorded as separate WizardLogEntry records;
  // they never overwrite `natural`/`winner` here.
  natural: NaturalOutcome;
  mode: Mode;
  runStep?: RunStep; // RUN only
  encounterSystemHp?: number; // RUN only
  identity: IdentityStamp; // §21.2
  wallClockMs?: number; // MK6.6 — total battle wall-clock (this session)
  metrics: BattleMetrics;
}

// Alpha 0.3.0 §21.2 — one record per COMMITTED selection event. Mere
// preselection, screen viewing, and Back navigation are deliberately NOT
// logged as committed choices.
export interface SelectionLogEntry {
  v: string; // LOG_VERSION
  at: string; // ISO timestamp
  event: 'HACKER_SELECTED' | 'DECK_SELECTED' | 'RUN_CREATED' | 'QUICK_MATCH_CREATED';
  mode?: Mode;
  runStep?: RunStep;
  battleId?: string; // present once a battle exists
  fp: string; // content fingerprint
  identity: Partial<IdentityStamp>;
  hackerMaxLink?: number;
  systemMaxIce?: number;
}

// Alpha 0.2.0 §5.4/§13.4 — one record per explicit wizard invocation, kept
// DISTINCT from the natural battle outcome (both are preserved). Appended by
// the orchestrator through the same storage/log-sink path as other entries.
export interface WizardLogEntry {
  v: string; // LOG_VERSION
  battleId: string;
  mode: Mode;
  runStep?: RunStep; // RUN only
  natural: NaturalOutcome; // the result the wizard acted on
  action: WizardAction;
  at: string; // ISO timestamp
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
      fp: getContent().fingerprint,
      battleId: this.battleId,
      config: { ...state.config },
      identity: identityStamp(state.identity),
      turn: state.turn,
      actions: [],
      damage: freshDamage(),
      detonations: 0,
      reshuffles: 0,
      lineClears: 0,
      hpAfter: { player: 0, enemy: 0 },
      chargesAfter: { player: [], enemy: [], deck: 0 },
    };
  }

  // Consume one event batch; returns any turn entries finalized by it.
  consume(state: GameState, events: GameEvent[]): TurnLogEntry[] {
    if (!this.current) this.current = this.fresh(state);
    const e = this.current;
    for (const ev of events) {
      switch (ev.t) {
        case 'swap':
          e.actions.push(`swap (${ev.a.x},${ev.a.y})->(${ev.b.x},${ev.b.y})`);
          break;
        case 'ability':
          // One action per parent Function activation, by display name. §7.1:
          // the Deck-owned Function is identified as Deck-owned in logs.
          e.actions.push(`${ev.side} fired ${ev.name} [${ev.fn}]${ev.ownerKind === 'deck' ? ` (deck ${ev.programId})` : ''}`);
          break;
        case 'op':
          // §7.5: expanded ops log their outcome (drain amounts, fizzles).
          if (ev.drained !== undefined) e.actions.push(`${ev.side} ${ev.effectId} drained ${ev.drained}`);
          else if (!ev.resolved) e.actions.push(`${ev.side} ${ev.effectId} fizzled (${ev.fnId})`);
          break;
        case 'shake':
          // §21.3 — Shake attempts and legal fizzles stay visible in the turn log.
          e.actions.push(`${ev.side} EFFECT_SHAKE ${ev.resolved ? 'resolved' : 'fizzled (legal)'}`);
          break;
        case 'skill':
          e.actions.push(
            `${ev.side} skill ${ev.skillId} ${ev.effect}` +
              `${ev.damage !== undefined ? ` +${ev.damage} dmg` : ''}${ev.charge !== undefined ? ` +${ev.charge} charge` : ''}`,
          );
          break;
        case 'lineClear':
          e.lineClears++;
          break;
        case 'placed':
          if (ev.count > 0) e.actions.push(`${ev.side} placed ${ev.count} ${ev.kind}${ev.count === 1 ? '' : 's'}`);
          break;
        case 'shield':
          e.actions.push(`shield absorbed ${ev.prevented} of ${ev.preShield} (${ev.source})`);
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
        case 'hintShown':
          e.hintShown = true;
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
        deck: state.deckCharge,
      };
      if (state.winner) e.result = state.winner;
      done.push(e);
      this.current = state.winner ? null : this.fresh(state);
    }
    return done;
  }
}
