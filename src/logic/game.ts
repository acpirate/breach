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
import { detectMatches } from './match';
import { addUnitCharge, buffBonus, dealDamage, resolveCascades, resolveDetonation } from './resolve';
import { makeRNG } from './rng';
import {
  GameEvent,
  GameState,
  Pt,
  Scenario,
  Side,
  UNIT_ORDER,
  UnitType,
  gridViewOf,
  opponentOf,
  tileViewOf,
} from './types';

export class Game {
  state: GameState;

  constructor(scenario: Scenario, seed?: number) {
    const rng = makeRNG(seed);
    const gen = { rng, nextId: 1 };
    const board = generateInitialBoard(gen);
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
    };
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
    return events;
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

  // 1.7 — player-paid board-shake: does not end the turn; result MAY contain
  // matches (intentional cascade payoff), which resolve as player-owned steps.
  fireShake(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre' || s.shakeCharge < BOARD_SHAKE_COST) return events;
    s.shakeCharge -= BOARD_SHAKE_COST;
    reshuffleBoard(s, true);
    events.push({ t: 'msg', text: 'Board shake!' });
    events.push({ t: 'board', grid: gridViewOf(s.board) });
    s.phase = 'resolving';
    resolveCascades(s, 'player', events);
    if (!s.winner) s.phase = 'playerPre';
    return events;
  }

  // 1.6.1.b — fire a charged program during the pre-match window.
  fireProgram(idx: number): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return events;
    const u = s.units.player[idx];
    if (!u || u.charge < UNIT_DEFS[u.type].cost) return events;
    u.charge -= UNIT_DEFS[u.type].cost;
    s.phase = 'resolving';
    this.castUnit('player', u.type, events);
    if (!s.winner) s.phase = 'playerPre';
    return events;
  }

  private castUnit(owner: Side, type: UnitType, events: GameEvent[]): void {
    const s = this.state;
    const who = owner === 'player' ? 'You' : 'Enemy';
    switch (type) {
      case 'bomber':
        this.placeSpecial('bomb', owner, events);
        break;
      case 'buffer':
        this.placeSpecial('buff', owner, events);
        break;
      case 'attacker':
        events.push({ t: 'msg', text: `${who} fired Attacker` });
        dealDamage(s, opponentOf(owner), ATTACKER_DAMAGE + buffBonus(s, owner), `${owner} attacker`, events);
        break;
      case 'disabler': {
        // Highest RAW charge among the opponent's 4 units; ties broken randomly.
        const targets = s.units[opponentOf(owner)];
        const max = Math.max(...targets.map((t) => t.charge));
        const pick = s.rng.pick(targets.filter((t) => t.charge === max));
        pick.charge = 0;
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
    return { matched: true, events };
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
    if (s.winner) return events;

    const ready = s.units.enemy.filter((u) => u.charge >= UNIT_DEFS[u.type].cost);
    s.rng.shuffle(ready);
    for (const u of ready) {
      if (s.winner) break;
      u.charge -= UNIT_DEFS[u.type].cost;
      this.castUnit('enemy', u.type, events);
    }
    if (s.winner) return events;

    for (const u of s.units.enemy) addUnitCharge(u, UNIT_DEFS[u.type].enemyChargeRate);
    s.turn += 1;
    return events;
  }
}
