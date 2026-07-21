// Turn structure and player/enemy actions (spec 1.6). Pure logic: every
// public method mutates state synchronously and returns the ordered event
// list the renderer replays.
//
// Alpha 0.1.0: Program firing executes the resolved Function's payload PLAN —
// an ordered list of validated leaf Effect operations — instead of switching
// on a hardcoded unit type. Effect behavior remains coded TypeScript (castOp),
// selected by the stable EffectId the data referenced.

import {
  BOARD_SHAKE_COST,
  BOARD_SHAKE_STARTS_CHARGED,
  ENEMY_TIMER_CHARGE_RATE,
} from './constants';
import { AreaPatternId } from './data/areas';
import { PlanOp, ResolvedProgram, planIsAllDrain, programById, programsFor, requiresTarget } from './data/content';
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
  UnitState,
  gridViewOf,
  opponentOf,
  tileViewOf,
} from './types';

export class Game {
  state: GameState;
  private logger: TurnLogger;
  private pendingTurnLogs: TurnLogEntry[] = [];

  // MK6.4: no more scenarios — the config (including starting HP) IS the
  // battle's identity. Unit slots are built from the resolved content model.
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
        player: programsFor('player').map((p) => ({ programId: p.id, charge: 0 })),
        enemy: programsFor('enemy').map((p) => ({ programId: p.id, charge: 0 })),
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

  // 1.7 as revised by MK2.2/MK7.9 — player-paid board-shake: a pure anti-lock
  // PERMUTATION reshuffle. Preserved unchanged in Alpha 0.1.0 (designer
  // ruling: keep as-is; it is engine behavior, not Program content).
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

  // 1.6.1.b — fire a charged Program during the pre-match window.
  // A Program whose plan leads with the player-targeted Drain op requires
  // `targetIdx` (which enemy slot to discharge); all others fire untargeted.
  fireProgram(idx: number, targetIdx?: number): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return events;
    const u = s.units.player[idx];
    if (!u) return events;
    const prog = programById(u.programId);
    if (u.charge < prog.cost) return events;
    if (requiresTarget(prog) && (targetIdx === undefined || !s.units.enemy[targetIdx])) return events;
    u.charge -= prog.cost;
    s.phase = 'resolving';
    this.castProgram('player', prog, events, targetIdx);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  // Execute one Program activation: pay-once (§7.2 — the caller already spent
  // the parent Function's cost; child costs are ignored), then resolve the
  // expanded payload plan left to right. A legal fizzle in one op never stops
  // later ops (§7.4). Unexpected exceptions propagate to the app failure
  // boundary — they are NOT converted into fizzles.
  private castProgram(owner: Side, prog: ResolvedProgram, events: GameEvent[], targetIdx?: number): void {
    events.push({ t: 'ability', side: owner, programId: prog.id, fn: prog.fn.id, name: prog.name });
    for (const op of prog.fn.plan) {
      if (this.state.winner) break;
      this.castOp(owner, prog, op, events, targetIdx);
    }
  }

  // Coded Effect behavior, selected by the stable EffectId the data supplied.
  private castOp(owner: Side, prog: ResolvedProgram, op: PlanOp, events: GameEvent[], targetIdx?: number): void {
    const s = this.state;
    const who = owner === 'player' ? 'You' : 'Enemy';
    switch (op.effectId) {
      case 'EFFECT_BOMB': {
        const placed = this.placeSpecials({
          type: 'bomb',
          owner,
          count: op.params.quantity ?? 1,
          countdown: op.params.countdown,
          areaPattern: op.params.areaPattern,
          programId: prog.id,
        }, events);
        events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: placed > 0 });
        break;
      }
      case 'EFFECT_BUFF': {
        const placed = this.placeSpecials({
          type: 'buff',
          owner,
          count: op.params.quantity ?? 1,
          magnitude: op.params.magnitude,
          programId: prog.id,
        }, events);
        events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: placed > 0 });
        break;
      }
      case 'EFFECT_SHIELD': {
        const placed = this.placeSpecials({
          type: 'shield',
          owner,
          count: op.params.quantity ?? 1,
          magnitude: op.params.magnitude,
          programId: prog.id,
        }, events);
        events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: placed > 0 });
        break;
      }
      case 'EFFECT_ATTACK': {
        events.push({ t: 'msg', text: `${who} fired ${prog.name}` });
        const bonus = buffBonus(s, owner);
        dealDamage(
          s,
          opponentOf(owner),
          (op.params.damage ?? 0) + bonus,
          { source: 'attacker', label: `${owner} attack`, programId: prog.id, buffBonus: bonus },
          events,
        );
        events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: true });
        break;
      }
      case 'EFFECT_DRAIN': {
        // §9.4 + approved Alpha deviation (designer 2026-07-21):
        //  - HACKER Drain: player-chosen target (targetIdx), any System slot,
        //    valid even at 0 charge (preserved pre-Alpha behavior).
        //  - SYSTEM Drain: tiered algorithm — (A) restrict to FULLY CHARGED
        //    Hacker Programs; (B) highest raw charge among them; (C) if none
        //    fully charged, all Programs with charge > 0, highest raw charge;
        //    residual ties break by highest activation cost, then randomly.
        //    (D) "nothing charged at all" is normally handled by the WITHHOLD
        //    rule in runEnemyPhase (the activation never happens); reaching
        //    this op with no charged target — possible only inside a mixed
        //    composite — is a legal fizzle.
        let pick: UnitState | null = null;
        if (owner === 'player') {
          pick = s.units.enemy[targetIdx!];
        } else {
          const charged = s.units.player.filter((t) => t.charge > 0);
          if (charged.length) {
            const full = charged.filter((t) => t.charge >= programById(t.programId).chargeCap);
            let pool = full.length ? full : charged;
            const maxCharge = Math.max(...pool.map((t) => t.charge));
            pool = pool.filter((t) => t.charge === maxCharge);
            if (pool.length > 1) {
              const maxCost = Math.max(...pool.map((t) => programById(t.programId).cost));
              pool = pool.filter((t) => programById(t.programId).cost === maxCost);
            }
            pick = s.rng.pick(pool);
          }
        }
        if (!pick) {
          events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: false, drained: 0 });
          events.push({ t: 'msg', text: `${who} fired ${prog.name} — nothing to drain` });
          break;
        }
        const drained = pick.charge;
        pick.charge = 0;
        const drainedName = programById(pick.programId).name;
        events.push({ t: 'op', side: owner, programId: prog.id, fnId: op.fnId, effectId: op.effectId, resolved: true, drained });
        events.push({ t: 'msg', text: `${who} fired ${prog.name} — drained ${drainedName}` });
        break;
      }
    }
  }

  // SPECIAL TILE PLACEMENT (§9.1/9.2/9.5): convert up to `count` random
  // existing non-neutral, non-special tiles into special tiles, preserving
  // each tile's color/shape. Candidates are drawn WITHOUT replacement so two
  // deployments never land on the same tile. If fewer than `count` valid
  // targets exist, place as many as possible (never hang, retry, or corrupt
  // the board); the charge is still spent. Countdown/footprint/magnitude come
  // from the placing op's validated data. Returns the number actually placed.
  private placeSpecials(
    opts: {
      type: 'bomb' | 'buff' | 'shield';
      owner: Side;
      count: number;
      countdown?: number;
      areaPattern?: AreaPatternId;
      magnitude?: number;
      programId: string;
    },
    events: GameEvent[],
  ): number {
    const s = this.state;
    const candidates: Pt[] = [];
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        const t = s.board[y][x];
        if (t && t.kind === 'standard' && !t.special) candidates.push({ x, y });
      }
    }
    const noun = opts.type === 'bomb' ? 'bomb' : opts.type === 'shield' ? 'shield' : 'buff';
    let placed = 0;
    for (let i = 0; i < opts.count && candidates.length; i++) {
      const idx = s.rng.int(candidates.length);
      const p = candidates.splice(idx, 1)[0]; // draw without replacement
      const t = s.board[p.y][p.x]!;
      t.special = {
        type: opts.type,
        owner: opts.owner,
        countdown: opts.countdown,
        areaPattern: opts.areaPattern,
        magnitude: opts.magnitude,
        programId: opts.programId,
        seq: s.nextSeq++,
      };
      events.push({ t: 'setTile', p, view: tileViewOf(t) });
      placed++;
    }
    // MK9.8 tracks bombs/shields placed per activation; buffs aren't in that set.
    if (opts.type !== 'buff') events.push({ t: 'placed', side: opts.owner, kind: opts.type, count: placed, programId: opts.programId });
    const who = opts.owner === 'player' ? 'You' : 'Enemy';
    if (placed === 0) events.push({ t: 'msg', text: 'No valid tile — effect wasted' });
    else events.push({ t: 'msg', text: `${who} placed ${placed === 1 ? `a ${noun}` : `${placed} ${noun}s`}` });
    return placed;
  }

  // 1.6.1.c/d — the turn-ending match. A swap producing no match reverts and
  // does NOT consume the turn.
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
  //    Programs in randomized order, then every Program gains the flat
  //    ENEMY_TIMER_CHARGE_RATE (the original timer-clock enemy).
  //  - ENEMY_MATCHING on: a REAL turn, structurally identical to the
  //    player's — tick, fire charged abilities pre-match, then make exactly
  //    one match (existing bot heuristic) which resolves under the same rules.
  runEnemyPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'enemy';
    events.push({ t: 'msg', text: 'Enemy turn' });

    this.tickBombs('enemy', events);
    if (s.winner) return this.collect(events);

    const readyIdx = s.units.enemy
      .map((u, i) => ({ u, i }))
      .filter(({ u }) => u.charge >= programById(u.programId).cost)
      .map(({ i }) => i);
    s.rng.shuffle(readyIdx);
    for (const i of readyIdx) {
      if (s.winner) break;
      const u = s.units.enemy[i];
      const prog = programById(u.programId);
      if (u.charge < prog.cost) continue; // defensive (charge cannot drop mid-cast today)
      // Approved Alpha deviation — SYSTEM DRAIN WITHHOLD: a Function whose
      // expanded plan is entirely Drain ops does not activate when no Hacker
      // Program holds any charge. The charge is preserved (not spent on a
      // no-op) and the check re-runs next enemy turn. This is deliberately a
      // pre-payment check in the Cast step — the one exception to the
      // "fires and legally fizzles" pattern every other Effect follows.
      if (planIsAllDrain(prog) && !s.units.player.some((p) => p.charge > 0)) {
        events.push({ t: 'msg', text: `Enemy ${prog.name} holds — nothing to drain` });
        continue;
      }
      u.charge -= prog.cost;
      this.castProgram('enemy', prog, events);
    }
    if (s.winner) return this.collect(events);

    if (s.config.enemyMatching) {
      // deadlock prevention guarantees a move after every settle; the guard
      // is defensive only. MK7.13: move selection is config-aware.
      const mv = pickBotMove(s.board, s.config, 'enemy'); // MK9.4: score against enemy bindings
      if (mv) {
        swap(s.board, mv.a, mv.b);
        events.push({ t: 'swap', a: mv.a, b: mv.b });
        resolveCascades(s, 'enemy', events, this.matchBudget(), 'match', new Set());
        if (s.winner) return this.collect(events);
      }
    } else {
      // Alpha approved exception: one flat engine-wide timer rate for every
      // System Program (no per-Program hardcoded table).
      for (const u of s.units.enemy) {
        const wasted = addUnitCharge(s, u, ENEMY_TIMER_CHARGE_RATE);
        if (wasted > 0) events.push({ t: 'chargeWaste', side: 'enemy', programId: u.programId, amount: wasted });
      }
    }
    s.turn += 1;
    return this.collect(events);
  }
}
