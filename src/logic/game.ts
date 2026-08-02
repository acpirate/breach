// Turn structure and Hacker/System actions (spec 1.6). Pure logic: every
// public method mutates state synchronously and returns the ordered event
// list the renderer replays.
//
// Alpha 0.1.0: Program firing executes the resolved Function's payload PLAN —
// an ordered list of validated leaf Effect operations — instead of switching
// on a hardcoded unit type. Effect behavior remains coded TypeScript (castOp),
// selected by the stable EffectId the data referenced.
//
// Alpha 0.3.0: the same activation path serves the DECK-owned Function, which
// carries its own independent charge pool and is identified as Deck-owned
// (never as a PRG_H_*) in runtime, save, targeting, metrics, and logs (§7.1).

import { BOARD_HEIGHT, BOARD_WIDTH, ENEMY_TIMER_CHARGE_RATE } from './constants';
import { AREA_PATTERNS, AreaPatternId } from './data/areas';
import type { TargetKind } from './data/effects';
import {
  PlanOp,
  ResolvedFunction,
  SHAKE_ALLOW_MATCHES,
  SHAKE_CASCADE_NONE,
  SHAKE_CASCADE_UNTIL_STABLE,
  TARGETING_TARGETED,
  deckById,
  functionTargetKind,
  planIsAllDrain,
  programById,
  targetKindOf,
} from './data/content';
import { generateInitialBoard, shakeBoard, swap } from './board';
import { pickBotMove } from './bot';
import { BattleEventEntry, TurnLogEntry, TurnLogger } from './logger';
import { detectMatches } from './match';
import { consumeEvents, createBattleMetrics } from './metrics';
import {
  addUnitCharge,
  buffBonus,
  dealDamage,
  detonateAt,
  resolveCascades,
  resolveDetonation,
  resolveLineSlice,
  settleAfterEffect,
} from './resolve';
import { makeRNG } from './rng';
import {
  ActivationTarget,
  BattleConfig,
  BattleIdentity,
  GameEvent,
  GameState,
  OwnerKind,
  Pt,
  Readiness,
  Side,
  TileView,
  UnitState,
  gridViewOf,
  opponentOf,
  tileViewOf,
} from './types';

// §17.4 — collision-resistant battle IDs. A per-process session token plus a
// monotonic counter: two battles constructed synchronously can never share an
// ID (the old timestamp-only scheme could), generation NEVER consumes gameplay
// RNG, and the value is pure non-gameplay identity that save/restore preserves.
const SESSION_TOKEN = ((): string => {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  const rand32 = (): number => Math.floor(Math.random() * 2 ** 32);
  if (g.crypto?.getRandomValues) {
    const a = new Uint32Array(2);
    g.crypto.getRandomValues(a);
    return `${a[0].toString(36)}${a[1].toString(36)}`;
  }
  return `${rand32().toString(36)}${rand32().toString(36)}`;
})();

let battleCounter = 0;

export function nextBattleId(): string {
  battleCounter += 1;
  return `b-${SESSION_TOKEN}-${battleCounter.toString(36)}`;
}

type OpEvent = Extract<GameEvent, { t: 'op' }>;

// What one immediately resolving coordinate deployment did, for §18.5 target
// logging and for deciding who settles the board afterwards.
interface Deployment {
  targetTile: TileView | null; // the target Packet BEFORE mutation
  dimension?: 'row' | 'column'; // LineSlice only
  sliced: Pt[];
  retained: Pt[];
  directDamage: number;
  directCharge?: number;
  // Bomb blasts settle themselves inside detonateAt; a LineSlice hands the
  // gravity/refill/cascade step back so its target log lands before the board
  // starts moving.
  settle: boolean;
  cause: 'bomb' | 'lineslice';
}

// One charge pool bound to a resolved Program by stable ID (§4.6 opens it at
// the Function's cost when startCharged is Y).
function unitFor(programId: string): UnitState {
  const p = programById(programId);
  return { programId: p.id, charge: p.fn.startCharged ? p.cost : 0 };
}

// The activation owner: a Program slot or the active Deck. Both pay a cost from
// their own charge pool and execute a resolved Function's plan; only the
// identity differs (§7.1).
interface Actor {
  kind: OwnerKind;
  id: string; // stable PRG_* or DEK_* ID
  name: string;
  fn: ResolvedFunction;
}

// §8.6 — translate the resolved Shake cascade mode into a resolution budget.
// The mode matters only when matches are ALLOWED (startup warns otherwise).
function shakeBudget(mode: 0 | 1 | 2, configuredCap: number | null): number | null {
  if (mode === SHAKE_CASCADE_NONE) return 1; // initial post-Shake wave only
  if (mode === SHAKE_CASCADE_UNTIL_STABLE) return null; // existing infinite-settle safeguards
  return configuredCap === null ? null : configuredCap + 1; // the battle's saved limit
}

export class Game {
  state: GameState;
  private logger: TurnLogger;
  private pendingTurnLogs: TurnLogEntry[] = [];

  // MK6.4: no more scenarios — the config (including effective LINK/ICE) IS the
  // battle's identity, alongside the explicit Hacker/Deck identity (§5.1).
  // Program slots are built from the resolved content model.
  constructor(config: BattleConfig, identity: BattleIdentity, seed?: number) {
    const rng = makeRNG(seed);
    const gen = { rng, nextId: 1 };
    const board = generateInitialBoard(gen);
    const battleId = nextBattleId();
    this.logger = new TurnLogger(battleId);
    const deck = deckById(identity.deckId);
    this.state = {
      board,
      rng,
      nextId: gen.nextId,
      nextSeq: 1,
      hp: {
        player: config.playerHp,
        enemy: config.enemyHp,
      },
      // Alpha 0.4.0 §5.8 — instantiate EXACTLY the four active Programs of the
      // snapshotted ordered build, in build order. Inactive inventory Programs
      // get no charge pool, no UI presence, no targeting eligibility, and no
      // metrics slot: they are structurally absent from the battle.
      // §4.6 — `startCharged` applies UNIFORMLY to any directly assigned owner:
      // a Program's own charge pool opens at its Function cost when the data
      // says Y, exactly as the Deck's does below.
      units: {
        player: identity.hackerPrograms.map((id) => unitFor(id)),
        enemy: identity.systemPrograms.map((id) => unitFor(id)),
      },
      // §4.6/§7.2 — a directly assigned owner starts each battle with charge
      // equal to the Function cost when startCharged is Y, else zero. This
      // resets at EVERY battle start and never carries between Run encounters.
      deckCharge: deck.fn.startCharged ? deck.fn.cost : 0,
      identity: {
        ...identity,
        skillIds: [...identity.skillIds],
        hackerPrograms: [...identity.hackerPrograms],
        inventory: [...identity.inventory],
        systemPrograms: [...identity.systemPrograms],
      },
      phase: 'playerPre',
      winner: null,
      turn: 1,
      metrics: createBattleMetrics(identity.hackerPrograms, identity.systemPrograms),
      battleId,
      // copied: the battle's config is immutable for its lifetime (MK5.4) —
      // later menu edits must not leak into a running battle
      config: { ...config },
    };
  }

  // MK5.2: allowed Sync steps before refills become constrained.
  // A swap-initiated resolution gets its initial Sync plus `cap` cascades.
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
  // action and hands them to the platform storage adapter. Alpha 0.4.1 adds
  // the battle-event stream (routes/targeted/drains), which is written at
  // every logging level because BASIC keeps no turn records at all.
  drainTurnLogs(): TurnLogEntry[] {
    const out = this.pendingTurnLogs;
    this.pendingTurnLogs = [];
    return out;
  }

  drainEventLogs(): BattleEventEntry[] {
    return this.logger.drainEvents();
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

  // 1.6.1.a — Hacker phase start: tick Hacker-owned countdowns (oldest first,
  // each detonation fully resolving before the next tick), then open the
  // pre-Sync Function window.
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
    // Snapshot placement order up front; an earlier detonation may slice a
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
      if (!p) continue; // sliced earlier this tick
      const tile = s.board[p.y][p.x]!;
      tile.special!.countdown! -= 1;
      events.push({ t: 'countdown', p, value: tile.special!.countdown! });
      if (tile.special!.countdown! <= 0) resolveDetonation(s, p, events);
    }
  }

  // Alpha 0.3.0 §7 — activate the DECK-owned Function from its own charge pool.
  // This replaces the former hardcoded Board-Shake path entirely: cost,
  // ownership, parameters, and charge all come from resolved Deck/Function
  // content, and the Effect runs through the same registry-dispatched executor
  // every Program Function uses (§8.1 — one authoritative Shake behavior).
  // §12.2 — target validity is checked BEFORE any charge is spent, so invalid
  // target input never resolves the Function and never consumes the pool.
  private targetSatisfies(need: TargetKind | null, target?: ActivationTarget): boolean {
    if (need === null) return true;
    if (!target || target.kind !== need) return false;
    if (target.kind === 'unit') return !!this.state.units.enemy[target.idx];
    const { x, y } = target.p;
    if (x < 0 || x >= BOARD_WIDTH || y < 0 || y >= BOARD_HEIGHT) return false;
    // Any occupied Packet is a legal target, specials and neutrals included:
    // an immediately resolving Effect attaches no overlay, so the placement
    // restrictions that constrain countdown Bombs do not apply here.
    return !!this.state.board[y][x];
  }

  fireDeckFunction(target?: ActivationTarget): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return events;
    const deck = deckById(s.identity.deckId);
    if (s.deckCharge < deck.fn.cost) return events;
    if (!this.targetSatisfies(functionTargetKind(deck.fn), target)) return events;
    s.deckCharge -= deck.fn.cost;
    s.phase = 'resolving';
    this.castActor('player', { kind: 'deck', id: deck.id, name: deck.name, fn: deck.fn }, events, target);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  // 1.6.1.b — fire a charged Program during the pre-Sync window. A Program
  // whose plan leads with a targeted op requires the matching target: an
  // opposing Program slot for Drain, or one Packet coordinate for a targeted
  // LineSlice/Bomb. All others fire untargeted.
  fireProgram(idx: number, target?: ActivationTarget): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.phase !== 'playerPre') return events;
    const u = s.units.player[idx];
    if (!u) return events;
    const prog = programById(u.programId);
    if (u.charge < prog.cost) return events;
    if (!this.targetSatisfies(targetKindOf(prog), target)) return events;
    u.charge -= prog.cost;
    s.phase = 'resolving';
    this.castActor('player', { kind: 'program', id: prog.id, name: prog.name, fn: prog.fn }, events, target);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  // Execute one activation: pay-once (§7.2 — the caller already spent the
  // parent Function's cost; child costs are ignored), then resolve the expanded
  // payload plan left to right. A legal fizzle in one op never stops later ops
  // (§7.4). Unexpected exceptions propagate to the app failure boundary — they
  // are NOT converted into fizzles.
  private castActor(owner: Side, actor: Actor, events: GameEvent[], target?: ActivationTarget): void {
    events.push({ t: 'ability', side: owner, ownerKind: actor.kind, programId: actor.id, fn: actor.fn.id, name: actor.name });
    for (const op of actor.fn.plan) {
      if (this.state.winner) break;
      this.castOp(owner, actor, op, events, target);
    }
  }

  // Every currently occupied board coordinate — the candidate pool for an
  // immediately resolving targeted Effect's RANDOM mode (§14.2/§13.2), which
  // places no overlay and therefore accepts any Packet.
  private occupiedCells(exclude: Set<number>): Pt[] {
    const s = this.state;
    const out: Pt[] = [];
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        if (s.board[y][x] && !exclude.has(y * BOARD_WIDTH + x)) out.push({ x, y });
      }
    }
    return out;
  }

  // §12/§13.3/§14.3 — drive the `quantity` deployments of an IMMEDIATELY
  // resolving coordinate Effect (targeted LineSlice/Bomb, or their random
  // variants). One shared driver so targeting, the per-activation exclusion
  // rule, target logging, and post-slice settling cannot drift between the two
  // Effects. Returns how many deployments actually resolved.
  private resolveImmediateDeployments(
    owner: Side,
    actor: Actor,
    op: PlanOp,
    targeting: 0 | 1,
    target: ActivationTarget | undefined,
    events: GameEvent[],
    run: (p: Pt) => Deployment,
  ): number {
    const s = this.state;
    const quantity = op.params.quantity ?? 1;
    // §13.2/§14.2 — a RANDOM deployment never reuses a coordinate this same
    // activation already sliced.
    const used = new Set<number>();
    const logged = (
      p: Pt | null,
      d: Deployment | null,
      reason?: string,
    ): GameEvent => ({
      t: 'targeted',
      side: owner,
      ownerKind: actor.kind,
      programId: actor.id,
      fnId: op.fnId,
      effectId: op.effectId,
      target: p,
      targetTile: d?.targetTile ?? null,
      ...(d?.dimension ? { dimension: d.dimension } : {}),
      sliced: d?.sliced ?? [],
      retained: d?.retained ?? [],
      directDamage: d?.directDamage ?? 0,
      directCharge: d?.directCharge ?? 0,
      resolved: !!d,
      ...(reason ? { reason } : {}),
    });

    let resolved = 0;
    for (let i = 0; i < quantity; i++) {
      if (s.winner) break;
      let p: Pt | null = null;
      if (targeting === TARGETING_TARGETED) {
        // §12.3 pins targeted quantity at 1, and the coordinate was validated
        // before any charge was spent, so this is present and legal.
        p = target?.kind === 'packet' ? target.p : null;
      } else {
        const pool = this.occupiedCells(used);
        p = pool.length ? pool[s.rng.int(pool.length)] : null;
      }
      if (!p) {
        // §13.7 — a legal fizzle: no valid coordinate remains. The activation
        // cost is still spent and the attempt is recorded; this is not an
        // application error.
        events.push(logged(null, null, 'no valid target coordinate'));
        break;
      }
      used.add(p.y * BOARD_WIDTH + p.x);
      const d = run(p);
      for (const c of d.sliced) used.add(c.y * BOARD_WIDTH + c.x);
      resolved++;
      events.push(logged(p, d));
      if (d.settle && !s.winner) settleAfterEffect(s, owner, d.cause, actor.id, events);
    }
    return resolved;
  }

  // Coded Effect behavior, selected by the stable EffectId the data supplied.
  private castOp(owner: Side, actor: Actor, op: PlanOp, events: GameEvent[], target?: ActivationTarget): void {
    const s = this.state;
    const who = owner === 'player' ? 'Hacker' : 'System';
    const opEvent = (resolved: boolean, drained?: number): OpEvent => ({
      t: 'op',
      side: owner,
      ownerKind: actor.kind,
      programId: actor.id,
      fnId: op.fnId,
      effectId: op.effectId,
      resolved,
      ...(drained !== undefined ? { drained } : {}),
    });
    switch (op.effectId) {
      case 'EFFECT_BOMB': {
        const bp = op.params.bomb!;
        const countdown = op.params.countdown ?? 0;
        // §14.3 — a positive countdown deploys the established overlay; blank
        // or zero resolves the blast immediately with no overlay at all.
        if (countdown > 0) {
          const placed = this.placeSpecials({
            type: 'bomb',
            owner,
            count: op.params.quantity ?? 1,
            countdown,
            areaPattern: op.params.areaPattern,
            dealDamage: bp.dealDamage,
            gainCharge: bp.gainCharge,
            fnId: op.fnId,
            actor,
          }, events);
          events.push(opEvent(placed > 0));
          break;
        }
        const resolved = this.resolveImmediateDeployments(
          owner,
          actor,
          op,
          bp.targeting,
          target,
          events,
          (p) => {
            const before = s.board[p.y][p.x];
            const beforeView = before ? tileViewOf(before) : null;
            const cellsBefore = new Set<number>();
            for (const d of AREA_PATTERNS[op.params.areaPattern!]) {
              const nx = p.x + d.x;
              const ny = p.y + d.y;
              if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT && s.board[ny][nx]) {
                cellsBefore.add(ny * BOARD_WIDTH + nx);
              }
            }
            const hpBefore = s.hp[opponentOf(owner)];
            detonateAt(s, p, {
              owner,
              areaPattern: op.params.areaPattern!,
              programId: actor.id,
              fnId: op.fnId,
              dealDamage: bp.dealDamage,
              gainCharge: bp.gainCharge,
            }, events, false);
            return {
              targetTile: beforeView,
              sliced: [...cellsBefore].map((k) => ({ x: k % BOARD_WIDTH, y: Math.floor(k / BOARD_WIDTH) })),
              retained: [],
              directDamage: Math.max(0, hpBefore - s.hp[opponentOf(owner)]),
              settle: true,
              cause: 'bomb',
            };
          },
        );
        events.push(opEvent(resolved > 0));
        break;
      }
      // §13 — EFFECT_LINESLICE. The whole row or column through the resolved
      // coordinate is sliced as ONE direct operation, then the board settles
      // and any resulting Syncs cascade normally under the initiator.
      case 'EFFECT_LINESLICE': {
        const lp = op.params.line!;
        const resolved = this.resolveImmediateDeployments(
          owner,
          actor,
          op,
          lp.targeting,
          target,
          events,
          (p) => {
            const before = s.board[p.y][p.x];
            const beforeView = before ? tileViewOf(before) : null;
            const outcome = resolveLineSlice(s, p, { owner, params: lp, programId: actor.id, fnId: op.fnId }, events);
            return {
              targetTile: beforeView,
              dimension: outcome.dimension,
              sliced: outcome.sliced,
              retained: outcome.retained,
              directDamage: outcome.damage,
              directCharge: outcome.charge,
              settle: true,
              cause: 'lineslice',
            };
          },
        );
        events.push(opEvent(resolved > 0));
        break;
      }
      case 'EFFECT_BUFF': {
        const placed = this.placeSpecials({
          type: 'buff',
          owner,
          count: op.params.quantity ?? 1,
          magnitude: op.params.magnitude,
          actor,
        }, events);
        events.push(opEvent(placed > 0));
        break;
      }
      case 'EFFECT_SHIELD': {
        const placed = this.placeSpecials({
          type: 'shield',
          owner,
          count: op.params.quantity ?? 1,
          magnitude: op.params.magnitude,
          actor,
        }, events);
        events.push(opEvent(placed > 0));
        break;
      }
      case 'EFFECT_ATTACK': {
        events.push({ t: 'msg', text: `${who} fired ${actor.name}` });
        const bonus = buffBonus(s, owner);
        dealDamage(
          s,
          opponentOf(owner),
          (op.params.damage ?? 0) + bonus,
          { source: 'attacker', label: `${who} attack`, programId: actor.id, buffBonus: bonus },
          events,
        );
        events.push(opEvent(true));
        break;
      }
      case 'EFFECT_SHAKE': {
        // §8 — the formal Shake contract. Parameters were resolved and typed at
        // startup; nothing is parsed here.
        const params = op.params.shake!;
        const ok = shakeBoard(s, params);
        events.push({ t: 'shake', side: owner, resolved: ok });
        events.push(opEvent(ok));
        if (!ok) {
          // §8.7 — LEGAL FIZZLE: the Datastream is unchanged, the paid
          // activation cost is retained, and the attempt is recorded. This is
          // not an application error.
          events.push({ t: 'msg', text: `${who} ${actor.name} fizzled — Datastream unchanged` });
          break;
        }
        events.push({ t: 'msg', text: `${who} scrambled the Datastream` });
        events.push({ t: 'board', grid: gridViewOf(s.board) });
        if (params.matches === SHAKE_ALLOW_MATCHES) {
          // §8.5 — every Sync created by the final Shake board resolves
          // immediately and is OWNED BY THE INITIATOR (never hardcoded as
          // Hacker-owned), so owner-scoped damage, Program charge, Skill
          // triggers, Deck neutral charge, cascades, metrics, and causal
          // attribution all apply normally under the selected cascade mode.
          resolveCascades(s, owner, events, shakeBudget(params.cascades, s.config.maxCascadeSteps), 'match', new Set());
        }
        // matches PREVENTED: the completed arrangement already satisfies the
        // legal/stable post-generation invariants, so no Sync wave begins.
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
        // §7.4 — Drain targets PROGRAMS ONLY. The Deck Function's charge pool
        // lives outside state.units entirely, so it is structurally excluded
        // from both the Hacker's target list and System candidate selection,
        // and it never affects fully-charged/highest-charge/highest-cost
        // priority.
        // §16.1 — the eligible pool is the opposing side's ACTIVE Programs.
        // state.units holds exactly the active build, so inactive inventory
        // Programs and the Deck Function are structurally excluded rather than
        // filtered out here.
        let pick: UnitState | null = null;
        if (owner === 'player') {
          pick = target?.kind === 'unit' ? (s.units.enemy[target.idx] ?? null) : null;
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
          events.push(opEvent(false, 0));
          events.push({ t: 'msg', text: `${who} fired ${actor.name} — nothing to drain` });
          break;
        }
        // §16.4 — every actual activation records the target's stable ID, its
        // readiness at target resolution, the charge before and after, and the
        // Function cost that defines "ready". Readiness is auditable from
        // charge/cost rather than asserted.
        const targetProg = programById(pick.programId);
        const drained = pick.charge;
        const readiness: Readiness = drained >= targetProg.cost ? 'READY' : drained > 0 ? 'CHARGING' : 'EMPTY';
        pick.charge = 0;
        events.push({
          ...opEvent(true, drained),
          targetProgramId: pick.programId,
          targetReadiness: readiness,
          targetChargeBefore: drained,
          targetChargeAfter: 0,
          targetCost: targetProg.cost,
        });
        events.push({ t: 'msg', text: `${who} fired ${actor.name} — drained ${targetProg.name}` });
        break;
      }
    }
  }

  // SPECIAL TILE PLACEMENT (§9.1/9.2/9.5): convert up to `count` random
  // existing non-neutral, non-special Packets into special tiles, preserving
  // each tile's color/shape. Candidates are drawn WITHOUT replacement so two
  // deployments never land on the same tile. If fewer than `count` valid
  // targets exist, place as many as possible (never hang, retry, or corrupt
  // the Datastream); the charge is still spent. Countdown/footprint/magnitude
  // come from the placing op's validated data. Returns the number placed.
  private placeSpecials(
    opts: {
      type: 'bomb' | 'buff' | 'shield';
      owner: Side;
      count: number;
      countdown?: number;
      areaPattern?: AreaPatternId;
      magnitude?: number;
      // §14.2 — stamped onto each bomb overlay so a later detonation resolves
      // under the Function that armed it, not under current global behavior.
      dealDamage?: 0 | 1;
      gainCharge?: 0 | 1;
      fnId?: string;
      actor: Actor;
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
        programId: opts.actor.id,
        fnId: opts.fnId,
        dealDamage: opts.dealDamage,
        gainCharge: opts.gainCharge,
        seq: s.nextSeq++,
      };
      events.push({ t: 'setTile', p, view: tileViewOf(t) });
      placed++;
    }
    // MK9.8 tracks bombs/shields placed per activation; buffs aren't in that set.
    if (opts.type !== 'buff') {
      events.push({ t: 'placed', side: opts.owner, ownerKind: opts.actor.kind, kind: opts.type, count: placed, programId: opts.actor.id });
    }
    const who = opts.owner === 'player' ? 'Hacker' : 'System';
    if (placed === 0) events.push({ t: 'msg', text: 'No valid Packet — Effect wasted' });
    else events.push({ t: 'msg', text: `${who} placed ${placed === 1 ? `a ${noun}` : `${placed} ${noun}s`}` });
    return placed;
  }

  // 1.6.1.c/d — the turn-ending Sync. A swap producing no Sync reverts and
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
    s.phase = 'resolving'; // Sync committed — no further Functions this turn
    resolveCascades(s, 'player', events, this.matchBudget(), 'match', new Set());
    return { matched: true, events: this.collect(events) };
  }

  // 1.6.2 — System phase. Two modes (MK5.1):
  //  - ENEMY_MATCHING off (default): tick own countdowns, cast all charged
  //    Programs in randomized order, then every Program gains the flat
  //    ENEMY_TIMER_CHARGE_RATE (the original timer-clock System).
  //  - ENEMY_MATCHING on: a REAL turn, structurally identical to the
  //    Hacker's — tick, fire charged Functions pre-Sync, then make exactly
  //    one Sync which resolves under the same rules.
  runEnemyPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'enemy';
    events.push({ t: 'msg', text: 'System turn' });

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
      // no-op) and the check re-runs next System turn. This is deliberately a
      // pre-payment check in the Cast step — the one exception to the
      // "fires and legally fizzles" pattern every other Effect follows.
      if (planIsAllDrain(prog) && !s.units.player.some((p) => p.charge > 0)) {
        events.push({ t: 'msg', text: `System ${prog.name} holds — nothing to drain` });
        continue;
      }
      u.charge -= prog.cost;
      this.castActor('enemy', { kind: 'program', id: prog.id, name: prog.name, fn: prog.fn }, events);
    }
    if (s.winner) return this.collect(events);

    if (s.config.enemyMatching) {
      // deadlock prevention guarantees a move after every settle; the guard
      // is defensive only. MK7.13: move selection is config-aware.
      const mv = pickBotMove(s.board, s.config, 'enemy'); // §5.4: score against System bindings
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
        if (wasted > 0) events.push({ t: 'chargeWaste', side: 'enemy', ownerKind: 'program', programId: u.programId, amount: wasted });
      }
    }
    s.turn += 1;
    return this.collect(events);
  }
}
