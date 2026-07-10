// Turn structure and player/enemy actions (spec 1.6). Pure logic: every
// public method mutates state synchronously and returns the ordered event
// list the renderer replays.

import {
  ATTACKER_DAMAGE,
  BOARD_SHAKE_COST,
  BOARD_SHAKE_STARTS_CHARGED,
  BOMBER_COUNTDOWN_TURNS,
  STARTING_HP_ENEMY,
  STARTING_HP_PLAYER_LOW_SCENARIO,
  STARTING_HP_PLAYER_NORMAL,
  UNIT_DEFS,
} from './constants';
import { generateInitialBoard, reshuffleBoard, swap } from './board';
import { TurnLogEntry, TurnLogger } from './logger';
import { detectMatches } from './match';
import { consumeEvents, createBattleMetrics } from './metrics';
import { addUnitCharge, buffBonus, dealDamage, resolveCascades, resolveDetonation } from './resolve';
import { makeRNG } from './rng';
import {
  GameEvent,
  GameState,
  Pt,
  Scenario,
  Side,
  UNIT_ORDER,
  UnitState,
  UnitType,
  gridViewOf,
  opponentOf,
  tileViewOf,
} from './types';

export class Game {
  state: GameState;
  private logger: TurnLogger;
  private pendingTurnLogs: TurnLogEntry[] = [];

  constructor(scenario: Scenario, seed?: number) {
    const rng = makeRNG(seed);
    const gen = { rng, nextId: 1 };
    const board = generateInitialBoard(gen);
    const battleId = `b${Date.now().toString(36)}-${scenario}`;
    this.logger = new TurnLogger(battleId);
    this.state = {
      board,
      rng,
      nextId: gen.nextId,
      nextSeq: 1,
      hp: {
        player: scenario === 'normal' ? STARTING_HP_PLAYER_NORMAL : STARTING_HP_PLAYER_LOW_SCENARIO,
        enemy: STARTING_HP_ENEMY,
      },
      units: {
        player: UNIT_ORDER.map((t) => ({ type: t, charge: 0 })),
        enemy: UNIT_ORDER.map((t) => ({ type: t, charge: 0 })),
      },
      shakeCharge: BOARD_SHAKE_STARTS_CHARGED ? BOARD_SHAKE_COST : 0,
      phase: 'playerPre',
      winner: null,
      scenario,
      turn: 1,
      metrics: createBattleMetrics(),
      battleId,
    };
  }

  // MK4.1 — rebuild a Game from a deserialized (already validated) state.
  // Bypasses the constructor's board generation; the turn logger resumes
  // under the same battleId (the interrupted turn's partial entry is lost,
  // which is acceptable for Tier 2).
  static restore(state: GameState): Game {
    const g = Object.create(Game.prototype) as Game;
    g.state = state;
    g.logger = new TurnLogger(state.battleId);
    g.pendingTurnLogs = [];
    return g;
  }

  // MK4.3 — the orchestrator drains finalized per-turn log entries after each
  // action and hands them to the platform storage adapter.
  drainTurnLogs(): TurnLogEntry[] {
    const out = this.pendingTurnLogs;
    this.pendingTurnLogs = [];
    return out;
  }

  // MK2.3/MK4.3 — every event batch a public action produces is routed
  // through the logic-layer metrics collector AND the turn logger (same
  // stream, no parallel pipeline) before being handed to the renderer.
  private collect(events: GameEvent[]): GameEvent[] {
    consumeEvents(this.state.metrics, events);
    this.state.metrics.turns = this.state.turn;
    this.state.metrics.winner = this.state.winner;
    this.pendingTurnLogs.push(...this.logger.consume(this.state, events));
    return events;
  }

  // 1.6.1.a — player phase start: tick player-owned countdowns (oldest first,
  // each detonation fully resolving before the next tick), then open the
  // pre-match ability window.
  startPlayerPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'resolving';
    events.push({ t: 'msg', text: `Turn ${s.turn} — your move` });
    this.tickBombs('player', events);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  private findBySeq(seq: number): Pt | null {
    const s = this.state;
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        if (s.board[y][x]?.special?.seq === seq) return { x, y };
      }
    }
    return null;
  }

  private tickBombs(owner: Side, events: GameEvent[]): void {
    const s = this.state;
    // Snapshot placement order up front; an earlier detonation may destroy a
    // later bomb outright (as a normal tile), in which case it is skipped.
    const seqs: number[] = [];
    for (const row of s.board) {
      for (const t of row) {
        if (t?.special?.type === 'bomb' && t.special.owner === owner) seqs.push(t.special.seq);
      }
    }
    seqs.sort((a, b) => a - b);
    for (const seq of seqs) {
      if (s.winner) break;
      const p = this.findBySeq(seq);
      if (!p) continue; // destroyed earlier this tick
      const tile = s.board[p.y][p.x]!;
      tile.special!.countdown! -= 1;
      events.push({ t: 'countdown', p, value: tile.special!.countdown! });
      if (tile.special!.countdown! <= 0) resolveDetonation(s, p, events);
    }
  }

  // 1.7 as revised by MK2.2 — player-paid board-shake is now a PURE anti-lock
  // reshuffle, identical to the automatic deadlock reshuffle: guaranteed >=1
  // valid move, NO pre-existing match, therefore no damage, no charge, no
  // cascades. Does not end the turn. Cost / starts-charged / neutral-match
  // replenishment are unchanged.
  fireShake(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre' || s.shakeCharge < BOARD_SHAKE_COST) return events;
    s.shakeCharge -= BOARD_SHAKE_COST;
    reshuffleBoard(s);
    events.push({ t: 'shakeUsed' }); // logging-only marker (MK4.3)
    events.push({ t: 'msg', text: 'Board shake!' });
    events.push({ t: 'board', grid: gridViewOf(s.board) });
    return this.collect(events);
  }

  // 1.6.1.b — fire a charged program during the pre-match window.
  // MK3.2: the player's Disabler is player-TARGETABLE — `targetIdx` selects
  // which of the 4 enemy minions to discharge, and is required for it.
  fireProgram(idx: number, targetIdx?: number): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return events;
    const u = s.units.player[idx];
    if (!u || u.charge < UNIT_DEFS[u.type].cost) return events;
    if (u.type === 'disabler' && (targetIdx === undefined || !s.units.enemy[targetIdx])) return events;
    u.charge -= UNIT_DEFS[u.type].cost;
    s.phase = 'resolving';
    this.castUnit('player', u.type, events, targetIdx);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  private castUnit(owner: Side, type: UnitType, events: GameEvent[], targetIdx?: number): void {
    const s = this.state;
    const who = owner === 'player' ? 'You' : 'Enemy';
    switch (type) {
      case 'bomber':
        events.push({ t: 'ability', side: owner, unit: type });
        this.placeSpecial('bomb', owner, events);
        break;
      case 'buffer':
        events.push({ t: 'ability', side: owner, unit: type });
        this.placeSpecial('buff', owner, events);
        break;
      case 'attacker': {
        events.push({ t: 'ability', side: owner, unit: type });
        events.push({ t: 'msg', text: `${who} fired Attacker` });
        const bonus = buffBonus(s, owner);
        dealDamage(
          s,
          opponentOf(owner),
          ATTACKER_DAMAGE + bonus,
          { source: 'attacker', label: `${owner} attacker`, buffBonus: bonus },
          events,
        );
        break;
      }
      case 'disabler': {
        // MK3.2 targeting rules (supersede the old highest-raw-charge rule):
        //  - PLAYER Disabler: player-chosen target (targetIdx), any minion.
        //  - ENEMY Disabler: fixed, predictable — the player's HIGHEST-COST
        //    program that currently has any charge (>0), tie-broken by highest
        //    raw charge, then randomly (cost ties are impossible with distinct
        //    costs; stated for completeness). If NO player program has any
        //    charge, it still fires and fizzles (drains nothing).
        let pick: UnitState | null;
        if (owner === 'player') {
          pick = s.units.enemy[targetIdx!];
        } else {
          const charged = s.units.player.filter((t) => t.charge > 0);
          if (!charged.length) {
            events.push({ t: 'ability', side: owner, unit: type, drained: 0 });
            events.push({ t: 'msg', text: 'Enemy Disabler fizzled — nothing to drain' });
            break;
          }
          const maxCost = Math.max(...charged.map((t) => UNIT_DEFS[t.type].cost));
          let pool = charged.filter((t) => UNIT_DEFS[t.type].cost === maxCost);
          const maxCharge = Math.max(...pool.map((t) => t.charge));
          pool = pool.filter((t) => t.charge === maxCharge);
          pick = s.rng.pick(pool);
        }
        const drained = pick.charge;
        pick.charge = 0;
        events.push({ t: 'ability', side: owner, unit: type, drained });
        events.push({ t: 'msg', text: `${who} fired Disabler — drained ${UNIT_DEFS[pick.type].label}` });
        break;
      }
    }
  }

  // SPECIAL TILE PLACEMENT: convert a random existing non-neutral, non-special
  // tile, preserving its color and shape. If no valid target exists, the
  // charge is still spent and the placement is wasted (no error).
  private placeSpecial(type: 'bomb' | 'buff', owner: Side, events: GameEvent[]): void {
    const s = this.state;
    const candidates: Pt[] = [];
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        const t = s.board[y][x];
        if (t && t.kind === 'standard' && !t.special) candidates.push({ x, y });
      }
    }
    if (!candidates.length) {
      events.push({ t: 'msg', text: 'No valid tile — effect wasted' });
      return;
    }
    const p = s.rng.pick(candidates);
    const t = s.board[p.y][p.x]!;
    t.special = {
      type,
      owner,
      countdown: type === 'bomb' ? BOMBER_COUNTDOWN_TURNS : undefined,
      seq: s.nextSeq++,
    };
    events.push({ t: 'setTile', p, view: tileViewOf(t) });
    events.push({ t: 'msg', text: `${owner === 'player' ? 'You' : 'Enemy'} placed a ${type === 'bomb' ? 'bomb' : 'buff'}` });
  }

  // 1.6.1.c/d — the turn-ending match. A swap producing no match reverts and
  // does NOT consume the turn.
  attemptSwap(a: Pt, b: Pt): { matched: boolean; events: GameEvent[] } {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return { matched: false, events };
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return { matched: false, events };

    swap(s.board, a, b);
    events.push({ t: 'swap', a, b });
    if (detectMatches(s.board).length === 0) {
      swap(s.board, a, b);
      events.push({ t: 'revert', a, b });
      events.push({ t: 'noMatch' });
      return { matched: false, events };
    }
    s.phase = 'resolving'; // match committed — no further abilities this turn
    resolveCascades(s, 'player', events);
    return { matched: true, events: this.collect(events) };
  }

  // 1.6.2 — enemy phase: tick own countdowns, cast all charged minions in
  // randomized order, then every minion gains its fixed charge rate.
  runEnemyPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'enemy';
    events.push({ t: 'msg', text: 'Enemy turn' });

    this.tickBombs('enemy', events);
    if (s.winner) return this.collect(events);

    const ready = s.units.enemy.filter((u) => u.charge >= UNIT_DEFS[u.type].cost);
    s.rng.shuffle(ready);
    for (const u of ready) {
      if (s.winner) break;
      u.charge -= UNIT_DEFS[u.type].cost;
      this.castUnit('enemy', u.type, events);
    }
    if (s.winner) return this.collect(events);

    for (const u of s.units.enemy) {
      const wasted = addUnitCharge(u, UNIT_DEFS[u.type].enemyChargeRate);
      if (wasted > 0) events.push({ t: 'chargeWaste', side: 'enemy', unit: u.type, amount: wasted });
    }
    s.turn += 1;
    return this.collect(events);
  }
}
