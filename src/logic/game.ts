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
import { AREA_PATTERNS, AreaPatternId, advanceAreaPattern } from './data/areas';
import type { TargetKind } from './data/effects';
import {
  ActivationEligibility,
  BOSS_MECHANIC_BOSS_ID,
  FN_CODESHATTER,
  FN_DATABEND,
  FN_REBOOT,
  OVERRIDE_DATABEND_RETRY_LIMIT,
  OVERRIDE_PLACEMENT_COUNT,
  OVERRIDE_THRESHOLD,
  PlanOp,
  ResolvedFunction,
  ResolvedProgram,
  SHAKE_ALLOW_MATCHES,
  SHAKE_CASCADE_NONE,
  SHAKE_CASCADE_UNTIL_STABLE,
  TARGETING_TARGETED,
  deckById,
  functionTargetKind,
  getContent,
  planIsAllDrain,
  programById,
  targetKindOf,
} from './data/content';
import { causeOf, passivesAffecting, startOfTurnPassives } from './passive';
import { generateInitialBoard, shakeBoard, swap } from './board';
import { pickBotMove } from './bot';
import { BattleEventEntry, TurnLogEntry, TurnLogger } from './logger';
import { detectMatches } from './match';
import { consumeEvents, createBattleMetrics } from './metrics';
import {
  addUnitCharge,
  applyTransform,
  buffBonus,
  dealDamage,
  detonateAt,
  resolveCascades,
  resolveDetonation,
  resolveLineSlice,
  settleAfterEffect,
  transformCandidateCount,
} from './resolve';
import { makeRNG } from './rng';
import {
  ActivationTarget,
  BattleConfig,
  BattleIdentity,
  GameEvent,
  GameState,
  OwnerKind,
  PassiveCause,
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
  id: string; // stable PRG_*, DEK_*, or (Alpha 0.6.0 §23) PSV_* ID
  name: string;
  fn: ResolvedFunction;
  // §14/§16 — set only for a PASSIVE-triggered activation: the causal source,
  // carried alongside the resolution owner so both survive into every event
  // this activation emits. Its presence is also what makes the activation
  // cost-free — the caller never debits a pool for one (§16).
  cause?: PassiveCause;
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
        passiveIds: [...identity.passiveIds],
        upgradeIds: [...identity.upgradeIds],
        hackerPrograms: [...identity.hackerPrograms],
        inventory: [...identity.inventory],
        systemPrograms: [...identity.systemPrograms],
      },
      phase: 'playerPre',
      winner: null,
      turn: 1,
      // Alpha 0.7.0 §42 — Boss aggregates exist only in a Boss battle.
      metrics: createBattleMetrics(
        identity.hackerPrograms,
        identity.systemPrograms,
        identity.opponentKind === 'BOS' ? identity.opponentId : undefined,
      ),
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

  // 1.6.1.a — Hacker phase start: resolve START_OF_TURN PASSIVEs, then tick
  // Hacker-owned countdowns (oldest first, each detonation fully resolving
  // before the next tick), then open the pre-Sync Function window.
  startPlayerPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'resolving';
    events.push({ t: 'msg', text: `Turn ${s.turn} — your move` });
    this.runStartOfTurnPassives('player', events);
    if (!s.winner) this.tickCountdowns('player', events);
    if (!s.winner) s.phase = 'playerPre';
    return this.collect(events);
  }

  // Alpha 0.6.0 §15 — START_OF_TURN PASSIVEs, in the one authoritative order:
  // HOST, then the active agent's identity, then the Hacker's UPGRADEs in
  // acquisition order (Hacker turns only), each source's own list in authored
  // order. passive.ts owns that ordering; this owns WHEN it happens, which is
  // strictly BEFORE countdown ticking (§15.5).
  //
  // Each triggered Function resolves COMPLETELY — Effect resolution, immediate
  // Syncs, cascades, damage, charge — before the next PASSIVE begins (§15).
  // If a battle reaches its terminal state part-way through, the established
  // terminal rules win and nothing further mutates a finished battle (§15).
  private runStartOfTurnPassives(active: Side, events: GameEvent[]): void {
    const s = this.state;
    for (const inst of startOfTurnPassives(s.identity, active)) {
      if (s.winner) break;
      if (inst.passive.effectType !== 'PSV_CARRIER') continue;
      const fn = getContent().functions.get(inst.passive.functionId!);
      if (!fn) continue; // the loader guarantees resolution; defensive only
      // §14 — the ACTIVE agent is the resolution owner even when a HOST caused
      // the trigger, so damage profile, charge routing, and owner-scoped
      // PASSIVEs all follow the agent whose turn is beginning. `cause` carries
      // the causal fact (which HOST, which PASSIVE) alongside it.
      this.castActor(
        active,
        { kind: 'passive', id: inst.passive.id, name: fn.name, fn, cause: causeOf(inst) },
        events,
      );
    }
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

  // Alpha 0.5.0 §27/§28.2 — ONE countdown tick for every armed overlay this
  // side owns, in placement order. Alpha 0.4 ticked bombs only; the loop now
  // selects on "has a countdown" and dispatches on what the overlay DELIVERS,
  // so EBUFF reuses the established timing rather than getting a second
  // scheduler (§28.5). Bomb countdown timing is unchanged (§28.2).
  private tickCountdowns(owner: Side, events: GameEvent[]): void {
    const s = this.state;
    // Snapshot placement order up front; an earlier detonation may slice a
    // later overlay outright (as a normal tile), in which case it is skipped.
    const seqs: number[] = [];
    for (const row of s.board) {
      for (const t of row) {
        const sp = t?.special;
        if (sp && sp.countdown !== undefined && sp.owner === owner) seqs.push(sp.seq);
      }
    }
    seqs.sort((a, b) => a - b);
    for (const seq of seqs) {
      if (s.winner) break;
      const p = this.findBySeq(seq);
      if (!p) continue; // sliced earlier this tick
      const tile = s.board[p.y][p.x]!;
      const sp = tile.special!;
      sp.countdown! -= 1;
      events.push({ t: 'countdown', p, value: sp.countdown! });
      if (sp.countdown! > 0) continue;
      this.deliverCountdown(p, events);
    }
  }

  // §27.2 — deliver an expired overlay's payload, using the parameters STAMPED
  // on it when it was armed. Adding a future delayed Effect means adding one
  // branch here; it does not mean a new countdown framework (§27.1).
  private deliverCountdown(p: Pt, events: GameEvent[]): void {
    const s = this.state;
    const tile = s.board[p.y][p.x];
    const sp = tile?.special;
    if (!sp) return;
    // An overlay armed before `delivers` existed can only have been a bomb.
    switch (sp.delivers ?? 'EFFECT_BOMB') {
      case 'EFFECT_BUFF': {
        // §28.3 — the countdown BECOMES a live Buff on the SAME Packet, using
        // the magnitude the arming Function stamped. Clearing `countdown` is
        // exactly what makes it live: buffBonus() counts it from this moment,
        // so it contributes to every subsequent damage instance (§28.3).
        delete sp.countdown;
        delete sp.delivers;
        events.push({ t: 'setTile', p, view: tileViewOf(tile!) });
        events.push({
          t: 'countdownDelivered',
          side: sp.owner,
          p,
          effectId: 'EFFECT_BUFF',
          programId: sp.programId,
          fnId: sp.fnId,
          magnitude: sp.magnitude,
        });
        events.push({ t: 'msg', text: `${sp.owner === 'player' ? 'Hacker' : 'System'} buff came online` });
        break;
      }
      default:
        // Bombs already carry their own detonation telemetry.
        resolveDetonation(s, p, events);
        break;
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
    events.push({
      t: 'ability', side: owner, ownerKind: actor.kind, programId: actor.id, fn: actor.fn.id, name: actor.name,
      ...(actor.cause ? { cause: actor.cause } : {}),
    });
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
      ...(actor.cause ? { cause: actor.cause } : {}),
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

  // Alpha 0.6.0 §22 — the effective Bomb footprint after PSV_BIGGER_BOMB.
  // Each active instance affecting `owner` advances ONE named step along the
  // area registry's canonical order, saturating at the largest registered
  // pattern. Edge clipping is irrelevant to the step count: this operates on
  // NAMES, not on how many cells survive the board bounds (§22.1).
  private effectiveBombArea(owner: Side, authored: AreaPatternId, events: GameEvent[]): AreaPatternId {
    const instances = passivesAffecting(this.state.identity, 'PSV_BIGGER_BOMB', owner);
    if (!instances.length) return authored;
    const upgraded = advanceAreaPattern(authored, instances.length);
    if (upgraded === authored) return authored; // already saturated
    for (const inst of instances) {
      events.push({ t: 'passive', side: owner, cause: causeOf(inst), effect: inst.passive.effectType, steps: 1 });
    }
    return upgraded;
  }

  // Coded Effect behavior, selected by the stable EffectId the data supplied.
  private castOp(owner: Side, actor: Actor, op: PlanOp, events: GameEvent[], target?: ActivationTarget): void {
    const s = this.state;
    const who = owner === 'player' ? 'Hacker' : 'System';
    const opEvent = (resolved: boolean, drained?: number): OpEvent => ({
      t: 'op',
      side: owner,
      ownerKind: actor.kind,
      ...(actor.cause ? { cause: actor.cause } : {}),
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
        // Alpha 0.6.0 §22 — PSV_BIGGER_BOMB advances the effective named area
        // pattern for EVERY qualifying EFFECT_BOMB, whichever Function invoked
        // it, resolved ONCE here so both the immediate and the delayed branch
        // use the same answer. It changes area only: quantity, countdown,
        // damage, targeting, and the charge tuple are untouched.
        const effectiveArea = this.effectiveBombArea(owner, op.params.areaPattern!, events);
        // §14.3 — a positive countdown deploys the established overlay; blank
        // or zero resolves the blast immediately with no overlay at all.
        if (countdown > 0) {
          // §22.2 — the UPGRADED pattern is stamped on the delayed object at
          // ARMING time through the established delayed-payload contract, so a
          // save/resume and a later detonation stay deterministic even if the
          // supplying PASSIVE were to change in between.
          const placed = this.placeSpecials({
            type: 'bomb',
            owner,
            count: op.params.quantity ?? 1,
            countdown,
            areaPattern: effectiveArea,
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
            for (const d of AREA_PATTERNS[effectiveArea]) {
              const nx = p.x + d.x;
              const ny = p.y + d.y;
              if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT && s.board[ny][nx]) {
                cellsBefore.add(ny * BOARD_WIDTH + nx);
              }
            }
            const hpBefore = s.hp[opponentOf(owner)];
            detonateAt(s, p, {
              owner,
              areaPattern: effectiveArea,
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
        // Alpha 0.5.0 §28 — a positive countdown ARMS the Buff instead of
        // placing it live: the overlay sits on the Packet contributing nothing
        // (§28.1) and becomes the authored Buff on that SAME Packet at expiry
        // (§28.3). Blank/zero keeps the established immediate behavior. The
        // placement rules, candidate pool, and quantity semantics are shared
        // with every other placement Effect — only the arming differs.
        const countdown = op.params.countdown ?? 0;
        const placed = this.placeSpecials({
          type: 'buff',
          owner,
          count: op.params.quantity ?? 1,
          magnitude: op.params.magnitude,
          ...(countdown > 0 ? { countdown, delivers: 'EFFECT_BUFF' as const } : {}),
          fnId: op.fnId,
          actor,
        }, events);
        events.push(opEvent(placed > 0));
        break;
      }
      // Alpha 0.5.0 §20-§26 — EFFECT_TRANSFORM. The Effect changes the
      // underlying identity of Packets and deals NO damage and grants NO charge
      // of its own (§25); everything that follows comes from the Syncs the new
      // board state creates, resolved through the ordinary pipeline.
      case 'EFFECT_TRANSFORM': {
        const tp = op.params.transform!;
        const outcome = applyTransform(
          s,
          {
            owner,
            params: tp,
            axisTarget: op.params.axisTarget!,
            axisResult: op.params.axisResult!,
            quantity: op.params.quantity ?? 1,
            programId: actor.id,
            fnId: op.fnId,
          },
          events,
        );
        events.push({
          t: 'transform',
          side: owner,
          ownerKind: actor.kind,
          ...(actor.cause ? { cause: actor.cause } : {}),
          programId: actor.id,
          fnId: op.fnId,
          axisTarget: op.params.axisTarget!.token,
          axisResult: op.params.axisResult!.token,
          resultColor: op.params.axisResult!.color,
          resultShape: op.params.axisResult!.shape,
          tier2Used: outcome.tier2Used,
          requested: op.params.quantity ?? 1,
          converted: outcome.cells.length,
          candidates: outcome.candidates,
          specialsRetained: outcome.specialsRetained,
          specialsDestroyed: outcome.specialsDestroyed,
          cells: outcome.cells,
          resolved: outcome.cells.length > 0,
        });
        if (!outcome.cells.length) {
          // §26 — normal System preflight withholds a Transform with no valid
          // targets, so reaching here means a mixed composite or a targeted
          // player activation: the established legal-fizzle semantics apply
          // rather than a second rollback model.
          events.push(opEvent(false));
          events.push({ t: 'msg', text: `${who} ${actor.name} found nothing to transform` });
          break;
        }
        events.push(opEvent(true));
        events.push({ t: 'msg', text: `${who} ${actor.name} transformed ${outcome.cells.length} Packet${outcome.cells.length === 1 ? '' : 's'}` });
        // §24/§25 — detection runs only AFTER every selected Packet has
        // changed. Any Sync this creates is owned by the activating side and
        // resolves through the normal owner-scoped pipeline: normal strong/weak
        // damage from that side's profile, normal B1 qualification, normal
        // charge routed top-to-bottom through its ordered Programs, normal
        // cascades. Budget matches an ordinary Sync (initial wave + the
        // configured cascade cap) because the created Sync IS the initial wave.
        //
        // The `transform` cause credits the resulting damage to this Function
        // (director ruling, 2026-08-07) without changing any of the mechanics
        // above — see DamageSource in types.ts.
        resolveCascades(
          s,
          owner,
          events,
          this.matchBudget(),
          'transform',
          new Set(),
          actor.id,
          { streamSource: 'EFFECT_TRANSFORM', sourceId: op.fnId },
        );
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
          {
            source: 'attacker',
            label: `${who} attack`,
            // Alpha 0.7.0 §42 — a `boss` actor owns no Program slot, so crediting
            // its ID here would invent a phantom per-Program metrics row keyed by
            // BOS_01. The damage still lands in the ordinary Function-damage
            // bucket; §41/§53.86 attribution comes from `fnId` below.
            ...(actor.kind === 'boss' ? {} : { programId: actor.id }),
            // §41 — naming the Function makes CODESHATTER attributable through
            // the EXISTING Function-damage events rather than a Boss-only stream.
            fnId: op.fnId,
            buffBonus: bonus,
          },
          events,
        );
        events.push(opEvent(true));
        break;
      }
      case 'EFFECT_SHAKE': {
        // §8 — the formal Shake contract. Parameters were resolved and typed at
        // startup; nothing is parsed here.
        const params = op.params.shake!;
        // §7.1 — the activating side decides whose overlays specialGems mode 2
        // clears; modes 0 and 1 ignore it.
        const ok = shakeBoard(s, params, owner);
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
      // §14.2 / Alpha 0.5.0 §27.2 — stamped onto each armed overlay so a later
      // delivery resolves under the Function that armed it, not under whatever
      // is firing at delivery time.
      delivers?: 'EFFECT_BOMB' | 'EFFECT_BUFF';
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
        // §27.2 — an overlay is ARMED iff it carries a countdown, and then it
        // must say what it delivers. Bombs default to their own detonation.
        ...(opts.countdown !== undefined && opts.countdown > 0
          ? { delivers: opts.delivers ?? ('EFFECT_BOMB' as const) }
          : {}),
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
    // §28.1 — an armed overlay is not yet doing anything, so the player-facing
    // line says so rather than claiming a live Buff was placed.
    const verb = opts.countdown !== undefined && opts.countdown > 0 && opts.type === 'buff' ? 'armed' : 'placed';
    if (placed === 0) events.push({ t: 'msg', text: 'No valid Packet — Effect wasted' });
    else events.push({ t: 'msg', text: `${who} ${verb} ${placed === 1 ? `a ${noun}` : `${placed} ${noun}s`}` });
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

  // ==========================================================================
  // Alpha 0.5.0 §19 — THE DYNAMIC SYSTEM FUNCTION PHASE
  //
  // Alpha 0.4 snapshotted readiness once at phase start and fired that list.
  // Readiness is now recomputed after every FULLY resolved Function, so charge
  // a Function creates (an Effect-made Sync, a SPAM detonation, a cascade) can
  // make another Program ready and let it act in the SAME phase (§19.1).
  //
  // Termination is guaranteed by `activatedThisPhase`, not by an iteration
  // budget: each active Program may activate at most once per phase, so the
  // loop can run at most once per Program however much charge is generated
  // (§19.2). A Program that fires, is recharged, and fills again waits for the
  // next System turn.
  // ==========================================================================

  // §19.4 — "a ready Function that currently has no valid target must not be
  // selected and must not spend charge". Director ruling (2026-08-07): this
  // applies to EVERY Effect, not just Drain, and is re-evaluated per charged
  // Program after each activation, because a previous Function may have changed
  // the Datastream and thus the answer.
  //
  // It answers ONLY for effects whose validity is cheaply and exactly knowable
  // before paying. An Effect not named here is always eligible and keeps the
  // established "fires, then legally fizzles" behavior.
  private activationEligibility(prog: ResolvedProgram): ActivationEligibility {
    const s = this.state;
    // A composite mixing drain with other work still fires: only the fully
    // useless case is withheld (the established Alpha 0.4 rule, kept).
    if (planIsAllDrain(prog)) {
      return s.units.player.some((p) => p.charge > 0)
        ? { eligible: true }
        : { eligible: false, reason: 'no charged Hacker Program to drain' };
    }
    for (const op of prog.fn.plan) {
      switch (op.effectId) {
        case 'EFFECT_TRANSFORM':
          // §26 — a Transform with zero eligible Packets keeps its charge and
          // mutates nothing. Alpha 0.6.0: eligibility is the ROW's own
          // target/result grammar, including the §24 exclusion rule, so a
          // Function whose only reachable Packets already match its result is
          // correctly withheld rather than fizzling.
          if (transformCandidateCount(s, { axisTarget: op.params.axisTarget!, axisResult: op.params.axisResult! }) === 0) {
            return { eligible: false, reason: 'no valid Packet to transform' };
          }
          break;
        case 'EFFECT_BUFF':
        case 'EFFECT_SHIELD':
          // §19.4 — a placement Function with zero legal deployment locations.
          // Deliberate change from Alpha 0.4.1, where these fired into a full
          // board and legally fizzled with the charge already spent.
          if (this.placementCandidateCount() === 0) {
            return { eligible: false, reason: 'no valid Packet for placement' };
          }
          break;
        case 'EFFECT_BOMB':
          // Countdown Bombs need a placeable Packet; immediate Bombs only need
          // an occupied coordinate, which a live board always has.
          if ((op.params.countdown ?? 0) > 0 && this.placementCandidateCount() === 0) {
            return { eligible: false, reason: 'no valid Packet for placement' };
          }
          break;
        default:
          break;
      }
    }
    return { eligible: true };
  }

  // The placement pool shared by placeSpecials: standard, non-special Packets.
  // Kept in one place so eligibility and placement can never disagree.
  private placementCandidateCount(): number {
    const s = this.state;
    let n = 0;
    for (const row of s.board) {
      for (const t of row) {
        if (t && t.kind === 'standard' && !t.special) n++;
      }
    }
    return n;
  }

  private runSystemFunctionPhase(events: GameEvent[]): void {
    const s = this.state;
    const activatedThisPhase = new Set<number>();
    // Bounded by construction: every iteration either activates a Program
    // (permanently consuming its one activation) or ends the phase.
    for (;;) {
      if (s.winner) return;
      // §19.3 — readiness, validity, and the unfired set are ALL recomputed
      // here, after the previous Function resolved completely (its Effects, its
      // Effect-created Syncs, its B1 clears and cascades, its damage, and its
      // charge routing have all already happened).
      const choices: { u: UnitState; i: number }[] = [];
      const withheld: GameEvent[] = [];
      s.units.enemy.forEach((u, i) => {
        if (activatedThisPhase.has(i)) return; // §19.2 at-most-once
        const prog = programById(u.programId);
        if (u.charge < prog.cost) return; // not ready — not a withhold
        const verdict = this.activationEligibility(prog);
        if (verdict.eligible) choices.push({ u, i });
        // §19.4 — ready but with nothing to act on: the charge is PRESERVED,
        // not spent on a no-op. §37.2 — recorded as an aggregate count rather
        // than a per-turn event, so a Program blocked for many turns cannot
        // flood the logs.
        else withheld.push({ t: 'withhold', side: 'enemy', programId: prog.id, fnId: prog.fn.id, reason: verdict.reason ?? 'no valid target' });
      });
      // §19.4 — no ready AND valid unfired Program remains: the phase ends.
      // The withholds are reported only on the final pass, so a Program that
      // was blocked early and became eligible later is not counted as withheld.
      if (!choices.length) {
        events.push(...withheld);
        return;
      }

      // §19.5 — the Alpha 0.4.1 activation-choice policy is preserved: pick at
      // random among the currently eligible. PRG_SET order is charge-routing
      // priority and must NOT acquire implicit activation priority (§2.11), so
      // this deliberately does not take the first eligible Program.
      const pick = choices[s.rng.int(choices.length)];
      const prog = programById(pick.u.programId);
      activatedThisPhase.add(pick.i);
      pick.u.charge -= prog.cost;
      this.castActor('enemy', { kind: 'program', id: prog.id, name: prog.name, fn: prog.fn }, events);
    }
  }

  // ==========================================================================
  // Alpha 0.7.0 §21-§28 — THE ODANSHAY OVERRIDE MECHANIC
  //
  // Deliberately a SMALL handler keyed to BOS_01 (§21), not a generalized boss
  // scripting engine, a mechanic DSL, a trigger table, or a new PASSIVE type.
  // It reuses the existing board-overlay, Function, Effect, turn-order,
  // source-attribution, save, and event systems throughout (§21).
  // ==========================================================================

  // Is THIS battle the ODANSHAY encounter? Everything below is inert otherwise,
  // so a normal System battle pays only this check per turn.
  private get odanshay(): boolean {
    const id = this.state.identity;
    return id.opponentKind === 'BOS' && id.opponentId === BOSS_MECHANIC_BOSS_ID;
  }

  // §22/§25 — how many Boss-owned Overrides are currently on the Datastream.
  // Derived from the board every time rather than cached in a counter: the board
  // is the authority, so a save/reload cannot desynchronize the count and §35's
  // "no Overrides disappear or duplicate on reload" holds by construction.
  private overrideCount(): number {
    let n = 0;
    for (const row of this.state.board) {
      for (const t of row) if (t?.special?.type === 'override') n++;
    }
    return n;
  }

  // §23 — the valid Override target set. A target is an occupied normal
  // axis-bearing Packet that does not already carry a BOSS-owned special. A
  // Hacker-owned special does NOT make a Packet invalid (§23): the Override
  // replaces it. Boss-owned specials — existing Overrides, Boss Bombs, Boss
  // Shields — are excluded and are never silently overwritten by placement.
  private overrideTargets(): Pt[] {
    const s = this.state;
    const out: Pt[] = [];
    for (let y = 0; y < s.board.length; y++) {
      for (let x = 0; x < s.board[y].length; x++) {
        const t = s.board[y][x];
        if (!t || t.kind !== 'standard') continue; // §23 — neutrals have no axes
        if (t.special && t.special.owner === 'enemy') continue;
        out.push({ x, y });
      }
    }
    return out;
  }

  // §24 — place exactly the chosen Overrides as ONE mechanic resolution. Axes
  // are unchanged, so no Sync is created and none is resolved (§22/§24).
  private placeOverrides(cells: Pt[], events: GameEvent[]): number {
    const s = this.state;
    let overwrote = 0;
    for (const p of cells) {
      const t = s.board[p.y][p.x];
      if (!t) continue;
      // §23 — installing over a Hacker-owned special destroys/replaces it
      // through the ordinary special-overlay replacement semantics, while the
      // underlying Packet's axes are RETAINED.
      if (t.special) overwrote++;
      t.special = { type: 'override', owner: 'enemy', seq: s.nextSeq++ };
      events.push({ t: 'setTile', p, view: tileViewOf(t) });
    }
    return overwrote;
  }

  // §21/§28 — invoke a mechanic payload Function at NO charge cost, attributed
  // to the Boss. The actor kind is `boss` and the actor ID is the Boss itself,
  // so every event the payload emits carries Boss causal identity rather than a
  // fake Program, a fake PASSIVE, or a fake System (§28).
  private castBossMechanic(fnId: string, events: GameEvent[]): void {
    const fn = getContent().functions.get(fnId);
    if (!fn) return; // the loader guarantees resolution; defensive only
    this.castActor(
      'enemy',
      { kind: 'boss', id: this.state.identity.opponentId, name: fn.name, fn },
      events,
    );
  }

  // §24 — THE FINAL ACTION OF EVERY NON-TERMINAL ODANSHAY TURN: attempt to
  // place exactly three new Overrides.
  //
  //  1. compute the valid target set;
  //  2. with at least three valid distinct targets, choose three using the
  //     GAMEPLAY RNG, choose all three BEFORE mutating the board, and place them
  //     as one batch;
  //  3. with fewer than three, place NONE (never a partial one or two), invoke
  //     DATABEND at zero cost, resolve it completely including its Syncs,
  //     cascades, damage and charge, check for a terminal state, and retry.
  //
  // The retry is hard-capped (director ruling 2026-08-17, overriding §24's
  // unbounded loop) so an unreachable board cannot hang the turn.
  private placeEndOfTurnOverrides(events: GameEvent[]): void {
    const s = this.state;
    const bossId = s.identity.opponentId;
    for (let attempt = 0; attempt <= OVERRIDE_DATABEND_RETRY_LIMIT; attempt++) {
      if (s.winner) return;
      const targets = this.overrideTargets();
      const before = this.overrideCount();
      if (targets.length >= OVERRIDE_PLACEMENT_COUNT) {
        // §24.2/§50.48/§50.50 — three DISTINCT targets, chosen from the
        // GAMEPLAY stream (never route/setup RNG, §24), all selected before any
        // mutation so no placement can influence a later choice.
        const pool = [...targets];
        s.rng.shuffle(pool);
        const cells = pool.slice(0, OVERRIDE_PLACEMENT_COUNT);
        const overwrote = this.placeOverrides(cells, events);
        events.push({
          t: 'bossMechanic',
          bossId,
          kind: 'OVERRIDE_PLACED',
          countBefore: before,
          countAfter: this.overrideCount(),
          placed: cells.length,
          cells,
          overwrote,
        });
        return;
      }
      // §24.3 — insufficient capacity. Place NOTHING, then DATABEND.
      events.push({
        t: 'bossMechanic',
        bossId,
        kind: 'INSUFFICIENT_TARGETS',
        countBefore: before,
        countAfter: before,
        available: targets.length,
        attempt: attempt + 1,
      });
      if (attempt === OVERRIDE_DATABEND_RETRY_LIMIT) {
        // Director ruling — the cap is reached: place none and let the turn
        // continue normally. Recorded so the condition is visible if it ever
        // fires; with current content it realistically never does.
        events.push({
          t: 'bossMechanic',
          bossId,
          kind: 'PLACEMENT_ABANDONED',
          countBefore: before,
          countAfter: before,
          available: targets.length,
          attempt: attempt + 1,
        });
        return;
      }
      // §24.3 — DATABEND resolves COMPLETELY (its authored tuple allows Syncs
      // and unlimited cascades, so damage and charge follow through the normal
      // pipeline), and a terminal state stops the mechanic immediately.
      this.castBossMechanic(FN_DATABEND, events);
      if (s.winner) return;
    }
  }

  // §25/§27 — the start-of-turn threshold. Trigger at 15 OR MORE on-board
  // Overrides (§25 — never "exactly 15"), then CODESHATTER, a survival check,
  // and REBOOT. A check that finds nothing emits no event at all, preserving the
  // Alpha 0.4.1/0.6 log-compactness goal (§41).
  private resolveOverrideThreshold(events: GameEvent[]): void {
    const s = this.state;
    const count = this.overrideCount();
    if (count < OVERRIDE_THRESHOLD) return;
    events.push({
      t: 'bossMechanic',
      bossId: s.identity.opponentId,
      kind: 'THRESHOLD',
      countBefore: count,
      countAfter: count,
    });
    // §27.1/§27.2 — CODESHATTER is ordinary Function damage: it takes the normal
    // Function-damage modifiers, is reduced by Packet and permanent Shield under
    // the current ordering, and is NOT suppressed by Reinforced Connection,
    // which suppresses base Sync damage only.
    this.castBossMechanic(FN_CODESHATTER, events);
    // §27.3/§27.4 — terminal check. If the Hacker is defeated the battle ends
    // immediately: REBOOT does not fire and no further Boss-turn action runs.
    if (s.winner) return;
    // §27.5/§27.6 — REBOOT wipes the Datastream as if a new battle started. Its
    // authored `1:1:0:0` regenerates every Packet, removes every overlay (the
    // accumulated Overrides with them, §27), and suppresses post-shake Syncs and
    // cascades. §27.7 — the turn then continues from the countdown stage.
    this.castBossMechanic(FN_REBOOT, events);
  }

  // 1.6.2 — System phase. Two modes (MK5.1). Alpha 0.5.0 §18 keeps this OUTER
  // order exactly as it was; only readiness handling INSIDE the Function phase
  // changed (§19).
  //  - ENEMY_MATCHING off (default): tick own countdowns, run the dynamic
  //    Function phase, then every Program gains the flat
  //    ENEMY_TIMER_CHARGE_RATE (the original timer-clock System).
  //  - ENEMY_MATCHING on: a REAL turn, structurally identical to the
  //    Hacker's — tick, run the Function phase, then make exactly one Sync
  //    which resolves under the same rules.
  // §19.6 — charge from that turn-ending Sync (or from the flat timer) does NOT
  // reopen the Function phase: both happen after it has returned, so the charge
  // is available on the NEXT System turn. This mirrors the Hacker lifecycle,
  // where Functions are used before the turn-ending match.
  runEnemyPhase(): GameEvent[] {
    const s = this.state;
    const events: GameEvent[] = [];
    if (s.winner) return events;
    s.phase = 'enemy';
    events.push({ t: 'msg', text: 'System turn' });

    // §15 — the same ordering the Hacker's turn uses: HOST and identity
    // START_OF_TURN PASSIVEs resolve fully, THEN countdowns tick. A HOST
    // carrier fires at the start of BOTH agents' turns (§13); the resolution
    // owner here is the System.
    //
    // Alpha 0.7.0 §26 — the ODANSHAY turn-start order, extending Alpha 0.6's:
    //   1. HOST START_OF_TURN PASSIVEs                (below)
    //   2. a Boss identity PASSIVE layer WOULD sit here — Alpha 0.7 BOS data has
    //      no PASSIVES field and §26.2 forbids adding one to populate this step
    //   3. the Override threshold                     (below)
    //   4. CODESHATTER -> survival check -> REBOOT     (inside the threshold)
    //   5. countdown ticking                          (below)
    //   6. the normal enemy Function phase            (below)
    //   7. the rest of the established enemy turn     (below)
    //   8. the three-Override placement, as the final non-terminal action
    this.runStartOfTurnPassives('enemy', events);
    if (s.winner) return this.collect(events);

    // §26.3/§26.4 — strictly AFTER HOST start-of-turn effects and strictly
    // BEFORE countdown ticking.
    if (this.odanshay) {
      this.resolveOverrideThreshold(events);
      if (s.winner) return this.collect(events);
    }

    this.tickCountdowns('enemy', events);
    if (s.winner) return this.collect(events);

    this.runSystemFunctionPhase(events);
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
    // Alpha 0.7.0 §24/§26.8 — the FINAL action of every non-terminal ODANSHAY
    // turn, after ALL normal Boss-turn resolution: the Function phase, the
    // match/timer behavior, their cascades, damage, charge, and countdown
    // consequences have all already happened in their established places.
    if (this.odanshay && !s.winner) this.placeEndOfTurnOverrides(events);
    if (s.winner) return this.collect(events);
    s.turn += 1;
    return this.collect(events);
  }
}
