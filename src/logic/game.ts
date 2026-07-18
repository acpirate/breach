// Turn structure and player/enemy actions (spec 1.6). Pure logic: every
// public method mutates state synchronously and returns the ordered event
// list the renderer replays.

import {
  ATTACKER_DAMAGE,
  BOARD_SHAKE_COST,
  BOARD_SHAKE_STARTS_CHARGED,
  BOMBER_COUNTDOWN_TURNS,
  E_BOMB_BOMBS,
  E_BOMB_COUNTDOWN,
  PLAYER_BOMBER_BOMBS,
  SHIELDER_TILES,
  UNIT_DEFS,
  effectiveCost,
  unitDefsFor,
  unitDisplayName,
} from './constants';
import { generateInitialBoard, reshuffleBoard, swap } from './board';
import { pickBotMove } from './bot';
import { TurnLogEntry, TurnLogger } from './logger';
import { detectMatches } from './match';
import { consumeEvents, createBattleMetrics } from './metrics';
import { addUnitCharge, buffBonus, dealDamage, resolveCascades, resolveDetonation } from './resolve';
import { makeRNG } from './rng';
import {
  BattleConfig,
  GameEvent,
  GameState,
  Pt,
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

  // MK6.4: no more scenarios — the config (including starting HP) IS the
  // battle's identity.
  constructor(config: BattleConfig, seed?: number) {
    const rng = makeRNG(seed);
    const gen = { rng, nextId: 1 };
    const board = generateInitialBoard(gen);
    const battleId = `b${Date.now().toString(36)}`;
    this.logger = new TurnLogger(battleId);
    this.state = {
      board,
      rng,
      nextId: gen.nextId,
      nextSeq: 1,
      hp: {
        player: config.playerHp,
        enemy: config.enemyHp,
      },
      units: {
        player: UNIT_ORDER.map((t) => ({ type: t, charge: 0 })),
        enemy: UNIT_ORDER.map((t) => ({ type: t, charge: 0 })),
      },
      shakeCharge: BOARD_SHAKE_STARTS_CHARGED ? BOARD_SHAKE_COST : 0,
      phase: 'playerPre',
      winner: null,
      turn: 1,
      metrics: createBattleMetrics(),
      battleId,
      // copied: the battle's config is immutable for its lifetime (MK5.4) —
      // later menu edits must not leak into a running battle
      config: { ...config },
    };
  }

  // MK5.2: allowed match steps before refills become constrained.
  // A swap-initiated resolution gets its initial match plus `cap` cascades.
  private matchBudget(): number | null {
    const cap = this.state.config.maxCascadeSteps;
    return cap === null ? null : cap + 1;
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
    const finalized = this.logger.consume(this.state, events);
    // MK7.6 — round metrics derive from the turn log's per-turn damage totals
    // (a "round" = one game turn), still the same single event stream.
    for (const entry of finalized) {
      for (const side of ['player', 'enemy'] as const) {
        const sm = this.state.metrics.sides[side];
        const total = entry.damage[side].total;
        if (total > sm.biggestRound) sm.biggestRound = total;
        if (total > 0) {
          sm.roundDamageSum += total;
          sm.roundDamageCount++;
        }
      }
    }
    this.pendingTurnLogs.push(...finalized);
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
    if (!u || u.charge < effectiveCost(s.config, u.type)) return events;
    if (u.type === 'disabler' && (targetIdx === undefined || !s.units.enemy[targetIdx])) return events;
    u.charge -= effectiveCost(s.config, u.type);
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
        // MK9.1/9.2: player Bomber drops 2 bombs; enemy "E-Bomb" drops 1 (wider,
        // longer-fused — the footprint/countdown difference lives in placement
        // and detonation). One cost, one activation either way.
        events.push({ t: 'ability', side: owner, unit: type, name: unitDisplayName(owner, type) });
        this.placeSpecials('bomb', owner, owner === 'player' ? PLAYER_BOMBER_BOMBS : E_BOMB_BOMBS, events);
        break;
      case 'buffer':
        // MK9.3: player Buffer places 1 buff tile; enemy "Shielder" places 2
        // shield tiles (inverse role — reduces incoming enemy damage).
        events.push({ t: 'ability', side: owner, unit: type, name: unitDisplayName(owner, type) });
        if (owner === 'enemy') this.placeSpecials('shield', owner, SHIELDER_TILES, events);
        else this.placeSpecials('buff', owner, 1, events);
        break;
      case 'attacker': {
        events.push({ t: 'ability', side: owner, unit: type, name: unitDisplayName(owner, type) });
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
            events.push({ t: 'ability', side: owner, unit: type, drained: 0, name: unitDisplayName(owner, type) });
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
        // Label the DRAINED unit using its own side's bindings (MK9.4: sides
        // diverge). Player Disabler drains an enemy unit → enemy label.
        const drainedLabel = unitDefsFor(opponentOf(owner))[pick.type].label;
        events.push({ t: 'ability', side: owner, unit: type, drained, name: unitDisplayName(owner, type) });
        events.push({ t: 'msg', text: `${who} fired Disabler — drained ${drainedLabel}` });
        break;
      }
    }
  }

  // SPECIAL TILE PLACEMENT (MK9.1/9.3 multi-placement): convert up to `count`
  // random existing non-neutral, non-special tiles into special tiles,
  // preserving each tile's color/shape. Candidates are drawn WITHOUT
  // replacement so two bombs/shields never land on the same tile. If fewer than
  // `count` valid targets exist, place as many as possible (never hang, retry,
  // or corrupt the board); the charge is still spent. Emits a `placed` event
  // with the number actually placed (metrics: bombs/shields per activation).
  private placeSpecials(type: 'bomb' | 'buff' | 'shield', owner: Side, count: number, events: GameEvent[]): void {
    const s = this.state;
    const candidates: Pt[] = [];
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        const t = s.board[y][x];
        if (t && t.kind === 'standard' && !t.special) candidates.push({ x, y });
      }
    }
    // player bombs keep the MK3.1 short fuse; enemy bombs (E-Bomb) use the
    // original longer countdown (MK9.2).
    const countdown = type === 'bomb' ? (owner === 'enemy' ? E_BOMB_COUNTDOWN : BOMBER_COUNTDOWN_TURNS) : undefined;
    const noun = type === 'bomb' ? 'bomb' : type === 'shield' ? 'shield' : 'buff';
    let placed = 0;
    for (let i = 0; i < count && candidates.length; i++) {
      const idx = s.rng.int(candidates.length);
      const p = candidates.splice(idx, 1)[0]; // draw without replacement
      const t = s.board[p.y][p.x]!;
      t.special = { type, owner, countdown, seq: s.nextSeq++ };
      events.push({ t: 'setTile', p, view: tileViewOf(t) });
      placed++;
    }
    // MK9.8 tracks bombs/shields placed per activation; buffs aren't in that set.
    if (type !== 'buff') events.push({ t: 'placed', side: owner, kind: type, count: placed });
    const who = owner === 'player' ? 'You' : 'Enemy';
    if (placed === 0) events.push({ t: 'msg', text: 'No valid tile — effect wasted' });
    else events.push({ t: 'msg', text: `${who} placed ${placed === 1 ? `a ${noun}` : `${placed} ${noun}s`}` });
  }

  // 1.6.1.c/d — the turn-ending match. A swap producing no match reverts and
  // does NOT consume the turn. `thinkMs` (MK6.6) is the orchestrator-measured
  // input-available -> move-committed delta, recorded only when the match
  // commits (invalid swaps leave the clock running upstream).
  attemptSwap(a: Pt, b: Pt, thinkMs?: number, hintShown?: boolean): { matched: boolean; events: GameEvent[] } {
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
    if (thinkMs !== undefined) events.push({ t: 'thinkTime', ms: Math.max(0, Math.round(thinkMs)) });
    if (hintShown) events.push({ t: 'hintShown' }); // MK7.7: excludable from think-time analysis
    s.phase = 'resolving'; // match committed — no further abilities this turn
    resolveCascades(s, 'player', events, this.matchBudget(), 'match', new Set());
    return { matched: true, events: this.collect(events) };
  }

  // 1.6.2 — enemy phase. Two modes (MK5.1):
  //  - ENEMY_MATCHING off (default): tick own countdowns, cast all charged
  //    minions in randomized order, then every minion gains its fixed charge
  //    rate (the original timer-clock enemy).
  //  - ENEMY_MATCHING on: a REAL turn, structurally identical to the
  //    player's — tick, fire charged abilities pre-match, then make exactly
  //    one match (existing bot heuristic) which resolves under all the same
  //    rules. The fixed charge clock is REMOVED; enemy units charge from
  //    matching only, via the same bindings as the player's programs.
  runEnemyPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'enemy';
    events.push({ t: 'msg', text: 'Enemy turn' });

    this.tickBombs('enemy', events);
    if (s.winner) return this.collect(events);

    const ready = s.units.enemy.filter((u) => u.charge >= effectiveCost(s.config, u.type));
    s.rng.shuffle(ready);
    for (const u of ready) {
      if (s.winner) break;
      u.charge -= effectiveCost(s.config, u.type);
      this.castUnit('enemy', u.type, events);
    }
    if (s.winner) return this.collect(events);

    if (s.config.enemyMatching) {
      // deadlock prevention guarantees a move after every settle; the guard
      // is defensive only. MK7.13: move selection is config-aware (charge-
      // seeking under NMD unless the sub-option disables it).
      const mv = pickBotMove(s.board, s.config, 'enemy'); // MK9.4: score against enemy bindings
      if (mv) {
        swap(s.board, mv.a, mv.b);
        events.push({ t: 'swap', a: mv.a, b: mv.b });
        resolveCascades(s, 'enemy', events, this.matchBudget(), 'match', new Set());
        if (s.winner) return this.collect(events);
      }
    } else {
      for (const u of s.units.enemy) {
        const wasted = addUnitCharge(s, u, UNIT_DEFS[u.type].enemyChargeRate);
        if (wasted > 0) events.push({ t: 'chargeWaste', side: 'enemy', unit: u.type, amount: wasted });
      }
    }
    s.turn += 1;
    return this.collect(events);
  }
}
