// Damage / charge / cascade resolution. The heart of the combat rules:
//  - damage and charge are computed per SLICED PACKET over an explicit set
//    (never per Sync — shared tiles count exactly once, at their highest
//    qualifying multiplier),
//  - charge is flat per tile (no multipliers), owner-scoped, capped at each
//    Program's charge-pool capacity (Alpha: resolved from data, not tables),
//  - buff bonus applies once per STEP; buff/shield per-tile values come from
//    the magnitude stamped on each special tile at placement (Function data),
//  - bomb detonations slice their own data-defined footprint as normal tiles
//    (no chains, no charge),
//  - Alpha 0.6.0: coded PASSIVES from every active source (Hacker, System,
//    HOST, acquired UPGRADEs) trigger from qualifying Sync events scoped to the
//    resolution owner (§11-§19), the active Deck Function earns charge from
//    neutral Packets sliced in owned Sync resolution (§7.3), and row/column
//    clears qualify from the wave's COMBINED direct footprint (§9).

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  COLOR_COUNT,
  SHAPE_COUNT,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_HIGH_SHAPE,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_LOW_SHAPE,
  DAMAGE_PER_TILE_NEUTRAL,
  DECK_CHARGE_PER_NEUTRAL_TILE,
  MATCH_4_MULTIPLIER,
  isStrongColor,
  isStrongShape,
} from './constants';
import { AREA_PATTERNS, AreaPatternId } from './data/areas';
import type { EffectId } from './data/effects';
import { PassiveInstance, causeOf, chargeDampen, passivesAffecting, permanentShield } from './passive';
import {
  AxisResult,
  AxisTarget,
  GAIN_CHARGE_YES,
  DEAL_DAMAGE_YES,
  LINE_DIMENSION_COLUMN,
  LineSliceParams,
  SPECIALS_RETAIN_ALL,
  SPECIALS_RETAIN_OWN,
  TransformParams,
  deckById,
  hackerById,
  programById,
} from './data/content';
import { MatchCondition, Match, computeLineClears, detectMatches, matchMultiplier } from './match';
import { completesRun, hasAnyValidMove, randomTile, reshuffleBoard } from './board';
import {
  ChargeAssignment,
  ChargeStreamSource,
  Color,
  DamageSource,
  GameEvent,
  GameState,
  PassiveCause,
  Pt,
  Shape,
  Side,
  Tile,
  UnitState,
  gridViewOf,
  opponentOf,
  tileViewOf,
} from './types';

// Sum of the owner's LIVE buff-tile magnitudes (per-tile value from data).
//
// Alpha 0.5.0 §28.1 — a Buff overlay whose countdown is still positive is
// PENDING: it is on the board, it can be sliced away, but it contributes ZERO
// magnitude until delivery. That is the whole behavioral point of EBUFF, and
// enforcing it here (rather than at each damage site) means every existing
// consumer of buff magnitude gets it right for free.
export function isPendingSpecial(sp: { countdown?: number } | undefined): boolean {
  return !!sp && sp.countdown !== undefined && sp.countdown > 0;
}

export function buffBonus(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      const sp = t?.special;
      if (sp?.type === 'buff' && sp.owner === side && !isPendingSpecial(sp)) n += sp.magnitude ?? 0;
    }
  }
  return n;
}

// MK9.3/Alpha §9.5 — total active shield for a side: sum of the magnitudes of
// its shield tiles currently on the Datastream. Measured live at damage-
// application time, so a shield sliced away no longer protects the next
// instance.
// Alpha 0.6.0 §21 — PSV_PERM_SHIELD contributes NON-REMOVABLE Shield value on
// top of the Packet Shield, through this one function so every consumer (damage
// application, the HUD total, metrics) agrees. It is not a Packet: it cannot be
// sliced, blasted, or transformed away, and it lasts as long as the supplying
// instance is active.
export function packetShieldValue(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'shield' && t.special.owner === side) n += t.special.magnitude ?? 0;
    }
  }
  return n;
}

export function shieldValue(state: GameState, side: Side): number {
  return packetShieldValue(state, side) + permanentShield(state.identity, side);
}

// Per-Packet damage for COLLATERAL destruction — Bomb blasts and LineSlice
// rows/columns. Not a Sync, so there is no slicing axis to pay on: the Packet
// is valued on BOTH axes against the acting side's resolved strong sets and
// pays the higher tier (§5.4). Neutral Packets pay their flat value.
//
// DESIGNER OVERRIDE (2026-08-01), deviating from Alpha 0.4.0 §14.5's
// "preserve existing Bomb per-Packet collateral valuation": Alpha 0.3 valued
// blast collateral on COLOR alone. Both collateral Effects now share this one
// valuation so the two cannot drift, at the cost of a small Bomb buff to be
// revisited in a balance pass.
export function baseDamage(t: Tile, state: GameState, owner: Side): number {
  if (t.kind === 'neutral') return DAMAGE_PER_TILE_NEUTRAL;
  const byColor = isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
  const byShape = isStrongShape(state.config, owner, t.shape!) ? DAMAGE_PER_TILE_HIGH_SHAPE : DAMAGE_PER_TILE_LOW_SHAPE;
  return Math.max(byColor, byShape);
}

// MK6.1 — per-tile damage for SYNC destruction, resolved on the axis(es) that
// sliced the tile. Alpha 0.3.0: the former hardcoded Hacker Red bonus is GONE
// from this path — that behavior is now the Hacker's Skill records (§6.1), so
// there is exactly one authority for it.
function matchTileDamage(
  t: Tile,
  axes: Set<MatchCondition>,
  owner: Side,
  state: GameState,
): { v: number; axis: 'color' | 'shape' | 'neutral' } {
  if (t.kind === 'neutral') return { v: DAMAGE_PER_TILE_NEUTRAL, axis: 'neutral' };
  let v = 0;
  let axis: 'color' | 'shape' | 'neutral' = 'neutral';
  if (axes.has('color') || axes.has('neutral')) {
    v = isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
    axis = 'color';
  }
  if (axes.has('shape')) {
    const s = isStrongShape(state.config, owner, t.shape!) ? DAMAGE_PER_TILE_HIGH_SHAPE : DAMAGE_PER_TILE_LOW_SHAPE;
    if (s > v || v === 0) {
      v = s;
      axis = 'shape';
    }
  }
  return { v, axis };
}

// Charge cap = the unit's Program charge-pool capacity (resolved content),
// applied at the moment charge is added. Returns the discarded amount.
export function addUnitCharge(state: GameState, u: UnitState, amount: number): number {
  const before = u.charge;
  u.charge = Math.min(programById(u.programId).chargeCap, before + amount);
  return before + amount - u.charge;
}

// §7.2 — the active Deck Function's charge cap is that Function's cost.
export function deckChargeCap(state: GameState): number {
  return deckById(state.identity.deckId).fn.cost;
}

// §7.3 — grant Deck Function charge to the side that owns the resolution.
// Only the Hacker side carries a Deck in Alpha 0.3 (§2.1 — the System has no
// Deck identity), so opponent-owned resolution charges nothing. Returns the
// amount discarded at the cap.
export function addDeckCharge(state: GameState, owner: Side, amount: number): number {
  if (owner !== 'player' || amount <= 0) return 0;
  const cap = deckChargeCap(state);
  const before = state.deckCharge;
  state.deckCharge = Math.min(cap, before + amount);
  return before + amount - state.deckCharge;
}

// Alpha 0.6.0 §11/§12 — owner scope is no longer "Hacker only". A qualifying
// Sync consults every ACTIVE PASSIVE instance that affects the RESOLUTION
// OWNER of that Sync, whichever source supplied it: the Hacker's own, the
// System's, the HOST's (which affect both agents, §13), and the Hacker's
// acquired UPGRADEs. The migrated Hacker Red rows behave exactly as they did,
// because HAK-supplied OWNER instances resolve to the same answer they always
// did — only the authority moved (§17).
function matchPassivesFor(
  state: GameState,
  owner: Side,
  effect: 'PSV_EXTRA_MATCH_DAMAGE' | 'PSV_EXTRA_MATCH_CHARGE',
): PassiveInstance[] {
  return passivesAffecting(state.identity, effect, owner);
}

// §17 — the qualifying match-event identity: a RESOLVED color-axis Sync of the
// PASSIVE's color. Same-axis runs the engine merged into one player-visible
// blob count ONCE; multiple distinct resolved blobs each qualify independently;
// a shape-axis Sync never qualifies (even when caused by moving a Packet of
// that color); and line-clear collateral, Bomb slices, and Function slices
// create no qualifying event because they are not detected Syncs.
function passiveQualifies(inst: PassiveInstance, match: Match): boolean {
  return match.condition === 'color' && (match.value as Color) === inst.passive.color;
}

export interface DamageInfo {
  source: DamageSource; // MK7.3/§15.3: the disjoint CAUSAL bucket
  label: string;
  programId?: string; // acting Program for Function-caused damage
  fnId?: string; // §15.3 — detailed attribution always carries FNC_ID…
  effectId?: EffectId; // …and EFFECT_ID
  critExtra?: number; // portion of `amount` added by the 1.5x multiplier (pre-floor)
  buffBonus?: number; // portion of `amount` contributed by buff tiles
  colorRaw?: number; // MK7.5: pre-floor damage paid via the color axis (Sync cause only)
  shapeRaw?: number; // MK7.5: pre-floor damage paid via the shape axis (Sync cause only)
  cascadeRaw?: number; // MK7.3: pre-floor damage from stochastic-only tiles
  passiveRaw?: number; // §17/§20: the PASSIVE portion of `amount` (its own bucket)
  cause?: PassiveCause; // §14: the PASSIVE that caused this damage, where one did
}

// Alpha 0.6.0 §20 — the damage buckets PSV_FUNCTION_DAMAGE_INCREASE qualifies
// against: direct damage a Function caused. A Transform-created Sync is
// deliberately NOT one of them — mechanically it is an ordinary Sync that the
// Alpha 0.5 ledger credits to the Effect (§20 "Function-originated DIRECT
// damage"), and match-triggered PASSIVEs already cover the Sync path.
const FUNCTION_DAMAGE_SOURCES: ReadonlyArray<DamageSource> = ['attacker', 'bomb', 'lineslice'];

export function dealDamage(state: GameState, target: Side, amount: number, info: DamageInfo, events: GameEvent[]): void {
  if (state.winner || amount <= 0) return;

  // §20 — applied to RAW Function damage BEFORE ordinary Buff/Shield defensive
  // processing, exactly as the match bonus joins raw Sync damage. Applied in
  // ONE place so every Function damage site (ATTACK, Bomb blasts, LineSlice)
  // gets it without three parallel implementations. The base event keeps its
  // original Function/Effect attribution and each instance's increment is
  // recorded separately (§48), so stacking PASSIVEs never collapse into an
  // unexplained aggregate.
  if (FUNCTION_DAMAGE_SOURCES.includes(info.source)) {
    const attacker = opponentOf(target);
    let added = 0;
    for (const inst of passivesAffecting(state.identity, 'PSV_FUNCTION_DAMAGE_INCREASE', attacker)) {
      const mag = inst.passive.magnitude ?? 0;
      if (mag <= 0) continue;
      added += mag;
      events.push({ t: 'passive', side: attacker, cause: causeOf(inst), effect: inst.passive.effectType, damage: mag });
    }
    if (added > 0) {
      amount += added;
      info = { ...info, passiveRaw: (info.passiveRaw ?? 0) + added };
    }
  }

  let finalAmount = amount;
  let buffFinal = info.buffBonus ?? 0;
  let critFinal = info.critExtra;
  let colorFinal = info.colorRaw;
  let shapeFinal = info.shapeRaw;
  let cascadeFinal = info.cascadeRaw;
  let passiveFinal = info.passiveRaw;

  // §3.1/§9.5: every separate damage instance is reduced by the DEFENDER's
  // live total shield (min 0), AFTER base+buff are computed (already folded
  // into `amount`) but BEFORE LINK/ICE is touched. Shield prevention is NOT
  // damage dealt — reported separately, never added to a damage-source bucket.
  // §21 — that total now includes permanent PASSIVE Shield.
  const shield = shieldValue(state, target);
  if (shield > 0) {
    const prevented = Math.min(amount, shield);
    finalAmount = amount - prevented;
    events.push({ t: 'shield', target, source: info.source, preShield: amount, shield, prevented, final: finalAmount });
    // §48 — report the permanent contribution to THIS prevention separately
    // from removable Packet Shield, so metrics can tell the two apart. The
    // permanent share is what the Packet Shield alone could not have stopped.
    const packet = packetShieldValue(state, target);
    const fromPassive = Math.max(0, prevented - Math.min(amount, packet));
    if (fromPassive > 0) {
      for (const inst of passivesAffecting(state.identity, 'PSV_PERM_SHIELD', target)) {
        events.push({ t: 'passive', side: target, cause: causeOf(inst), effect: inst.passive.effectType, shield: inst.passive.magnitude ?? 0 });
      }
    }
    // Shield eats the causal (base) portion first and the buff portion last,
    // so the disjoint metric buckets still sum exactly to the dealt amount.
    // Pre-floor analytical splits — including the PASSIVE portion — scale with it.
    const base = amount - (info.buffBonus ?? 0);
    buffFinal = Math.min(info.buffBonus ?? 0, finalAmount);
    const causalFinal = finalAmount - buffFinal;
    const scale = base > 0 ? causalFinal / base : 0;
    if (critFinal !== undefined) critFinal *= scale;
    if (colorFinal !== undefined) colorFinal *= scale;
    if (shapeFinal !== undefined) shapeFinal *= scale;
    if (cascadeFinal !== undefined) cascadeFinal *= scale;
    if (passiveFinal !== undefined) passiveFinal *= scale;
  }

  if (finalAmount <= 0) return; // fully absorbed: shield event emitted, nothing dealt

  state.hp[target] -= finalAmount;
  events.push({
    t: 'damage',
    target,
    amount: finalAmount,
    label: info.label,
    source: info.source,
    programId: info.programId,
    fnId: info.fnId,
    effectId: info.effectId,
    critExtra: critFinal,
    buffBonus: buffFinal,
    colorRaw: colorFinal,
    shapeRaw: shapeFinal,
    cascadeRaw: cascadeFinal,
    passiveRaw: passiveFinal,
    ...(info.cause ? { cause: info.cause } : {}),
  });
  if (state.hp[target] <= 0) {
    state.winner = opponentOf(target);
    state.phase = 'over';
    events.push({ t: 'over', winner: state.winner });
  }
}

// ============================================================================
// Alpha 0.4.0 §10 — CHARGE STREAMS and TOP-TO-BOTTOM ROUTING
//
// Alpha 0.3 BROADCAST charge: every compatible Program gained from every
// qualifying Packet independently. Alpha 0.4 keeps generation identical and
// changes only ALLOCATION (§10.2): a stream of N charge on one axis token
// fills the topmost compatible non-full active Program, passes the remainder
// DOWN, and discards only when no compatible non-full Program remains.
//
// A STREAM is one (axis, token) pair within one resolution wave. Grouping by
// token rather than by Sync blob covers line-clear collateral (which belongs
// to no blob) and is outcome-identical to per-blob streams, because a greedy
// fill-from-the-top is associative: routing 3 then 3 lands exactly where
// routing 6 does. Ordering is fixed and RNG-free (§10.3): all color streams
// in enum order, then all shape streams in enum order.
// ============================================================================

export interface ChargeStream {
  axis: 'color' | 'shape';
  token: number;
  amount: number;
  source: ChargeStreamSource;
  sourceId?: string;
}

export type StreamMap = Map<string, ChargeStream>;

const streamKey = (axis: 'color' | 'shape', token: number): string => `${axis}:${token}`;

export function addStream(
  streams: StreamMap,
  axis: 'color' | 'shape',
  token: number,
  amount: number,
  source: ChargeStreamSource,
  sourceId?: string,
): void {
  if (amount <= 0) return;
  const k = streamKey(axis, token);
  const cur = streams.get(k);
  if (!cur) {
    streams.set(k, { axis, token, amount, source, sourceId });
    return;
  }
  cur.amount += amount;
  // §18 — a PASSIVE that inflates an existing qualifying stream re-labels it
  // rather than opening a second pool that charges every compatible Program.
  if (source === 'PASSIVE_MODIFIED_SYNC') {
    cur.source = source;
    cur.sourceId = sourceId;
  }
}

// Alpha 0.6.0 §19 — PSV_CHARGE_DAMPEN, applied to every qualifying stream AFTER
// all generation (Packets and any extra-charge PASSIVE) and BEFORE routing:
//
//   finalGenerated = max(0, baseGenerated + extra-charge bonuses - dampening)
//
// The formula is order-independent, which is why dampening is a single pass
// here rather than a subtraction interleaved with the bonuses. `ALL` covers
// every stream of the affected agent; a HOST instance dampens BOTH agents
// because affects() ignores its authored scope (§13).
function applyChargeDampen(state: GameState, owner: Side, streams: StreamMap, events: GameEvent[]): void {
  const instances = passivesAffecting(state.identity, 'PSV_CHARGE_DAMPEN', owner);
  if (!instances.length || !streams.size) return;
  const total = chargeDampen(state.identity, owner);
  if (total <= 0) return;
  for (const stream of streams.values()) {
    const before = stream.amount;
    stream.amount = Math.max(0, before - total);
    if (stream.amount === before) continue;
    stream.source = 'PASSIVE_MODIFIED_SYNC';
    // §47 — every contributing instance is recorded individually, so several
    // dampening PASSIVEs on one stream stay distinguishable.
    for (const inst of instances) {
      events.push({ t: 'passive', side: owner, cause: causeOf(inst), effect: inst.passive.effectType, charge: -(inst.passive.magnitude ?? 0) });
    }
  }
}

// §10.3 — deterministic wave order: color axis fully resolved before shape.
export function orderedStreams(streams: StreamMap): ChargeStream[] {
  return [...streams.values()].sort((a, b) =>
    a.axis === b.axis ? a.token - b.token : a.axis === 'color' ? -1 : 1,
  );
}

// Charge GENERATED by one sliced Packet. Unchanged from Alpha 0.3 in amount
// and in which axes pay (`singleAxisPayout` still gates them); the difference
// is that the charge now lands in a stream instead of in every Program at
// once. Neutral Packets pay the DECK, handled once per step by the caller
// (§7.3), and never generate Program charge.
export function accumulateTileCharge(
  state: GameState,
  t: Tile,
  axes: Set<MatchCondition>,
  streams: StreamMap,
  source: ChargeStreamSource,
  sourceId?: string,
): void {
  if (t.kind === 'neutral') return;
  const singleAxis = state.config.singleAxisPayout;
  if (!singleAxis || axes.has('color')) {
    addStream(streams, 'color', t.color!, CHARGE_PER_TILE_COLOR_MATCH, source, sourceId);
  }
  if (!singleAxis || axes.has('shape')) {
    addStream(streams, 'shape', t.shape!, CHARGE_PER_TILE_SHAPE_MATCH, source, sourceId);
  }
}

// §10.4 — route ONE stream through the owner's ordered active Program queue.
// Invariants enforced here: charge never flows upward, a compatible non-full
// Program is never skipped, no Program exceeds its Function cost, inactive
// Programs are structurally absent (state.units holds only the active build),
// the Deck Function is a separate pool entirely, and no RNG is consulted.
export function routeChargeStream(
  state: GameState,
  owner: Side,
  stream: ChargeStream,
  events: GameEvent[],
  waste: Map<string, number>,
): void {
  const units = state.units[owner];
  const order = units.map((u) => u.programId);
  const eligibleIdx: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const prog = programById(units[i].programId);
    const compatible =
      stream.axis === 'color' ? prog.colors.includes(stream.token) : prog.shapes.includes(stream.token);
    if (compatible) eligibleIdx.push(i);
  }

  let remaining = stream.amount;
  const assignments: ChargeAssignment[] = [];
  for (const i of eligibleIdx) {
    if (remaining <= 0) break;
    const u = units[i];
    const cap = programById(u.programId).chargeCap;
    const room = cap - u.charge;
    if (room <= 0) continue; // already at its Function cost — skip, keep flowing down
    const before = u.charge;
    const assigned = Math.min(room, remaining);
    u.charge = before + assigned;
    remaining -= assigned;
    assignments.push({ programId: u.programId, before, assigned, after: u.charge, overflowOut: remaining });
  }

  events.push({
    t: 'chargeRoute',
    side: owner,
    axis: stream.axis,
    token: stream.token,
    amount: stream.amount,
    streamSource: stream.source,
    ...(stream.sourceId ? { sourceId: stream.sourceId } : {}),
    order,
    eligible: eligibleIdx.map((i) => order[i]),
    assignments,
    discarded: remaining,
  });

  // Alpha 0.4.1 §8.4 — end-of-stream discard is NOT attributed to any Program.
  // Alpha 0.4 charged it to the bottom-most compatible Program, which reads as
  // "that Program wasted charge" when in fact the stream simply outran the
  // whole queue. It now aggregates into a battle-level total, collected by
  // metrics.ts straight off the routing event's `discarded` field above.
  void waste;
}

// Route a whole wave's streams in the canonical order (§10.3).
export function routeStreams(
  state: GameState,
  owner: Side,
  streams: StreamMap,
  events: GameEvent[],
  waste: Map<string, number>,
): void {
  for (const stream of orderedStreams(streams)) routeChargeStream(state, owner, stream, events, waste);
}

// §10.7 — charge generated by EXPLICIT Effect destruction (a LineSlice row or
// a Bomb blast whose tuple says gainCharge=0). Each directly sliced Packet
// contributes standard owner-scoped charge from its own attributes; colors
// route before shapes. Returns the total charge that actually landed.
export function chargeFromEffectSlice(
  state: GameState,
  owner: Side,
  tiles: Tile[],
  events: GameEvent[],
): number {
  const streams: StreamMap = new Map();
  const bothAxes = new Set<MatchCondition>(['color', 'shape']);
  for (const t of tiles) accumulateTileCharge(state, t, bothAxes, streams, 'EFFECT_DESTRUCTION');
  const before = state.units[owner].reduce((n, u) => n + u.charge, 0);
  const waste = new Map<string, number>();
  routeStreams(state, owner, streams, events, waste);
  for (const [programId, amount] of waste) {
    events.push({ t: 'chargeWaste', side: owner, ownerKind: 'program', programId, amount });
  }
  return state.units[owner].reduce((n, u) => n + u.charge, 0) - before;
}

// MK5.2 cascade cap: when `constrained`, replacement Packets are rejection-
// rolled so that NO Sync on the settled Datastream contains a refill tile.
export function applyGravityAndRefill(state: GameState, events: GameEvent[], constrained = false, freshIds?: Set<number>): void {
  const moves: { from: Pt; to: Pt }[] = [];
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let write = BOARD_HEIGHT - 1;
    for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
      const t = state.board[y][x];
      if (!t) continue;
      if (y !== write) {
        state.board[write][x] = t;
        state.board[y][x] = null;
        moves.push({ from: { x, y }, to: { x, y: write } });
      }
      write--;
    }
  }
  if (moves.length) events.push({ t: 'fall', moves });

  const empty: Pt[] = [];
  for (let x = 0; x < BOARD_WIDTH; x++) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (!state.board[y][x]) empty.push({ x, y });
    }
  }
  if (!empty.length) return;

  if (constrained) {
    refillConstrained(state, empty);
  } else {
    for (const p of empty) state.board[p.y][p.x] = randomTile(state);
  }
  if (freshIds) for (const p of empty) freshIds.add(state.board[p.y][p.x]!.id);
  events.push({ t: 'spawn', tiles: empty.map((p) => ({ p, view: tileViewOf(state.board[p.y][p.x]!) })) });
}

function refillConstrained(state: GameState, cells: Pt[]): void {
  for (let attempt = 0; attempt < 200; attempt++) {
    // local left/up rejection biases away from Syncs cheaply; the full-board
    // check below is authoritative (covers right/below neighbors too)
    for (const p of cells) {
      let t = randomTile(state);
      let guard = 0;
      while (completesRun(state.board, p.x, p.y, t) && guard++ < 100) t = randomTile(state);
      state.board[p.y][p.x] = t;
    }
    const bad = detectMatches(state.board).some((m) =>
      m.cells.some((c) => cells.some((rc) => rc.x === c.x && rc.y === c.y)),
    );
    if (!bad) return;
    for (const p of cells) state.board[p.y][p.x] = null;
  }
  // practically unreachable at 37 tile types; accept an unconstrained fill
  for (const p of cells) state.board[p.y][p.x] = randomTile(state);
}

// Tiles bound to a side's ACTIVE Programs (color OR shape) — for the MK5.6
// contention metric. Alpha 0.4: read from the battle's own roster, so a
// Program sitting in the inventory but not in the build creates no contention
// (§5.8 — inactive Programs are excluded from every battle system).
function boundColors(state: GameState, side: Side): Set<number> {
  const out = new Set<number>();
  for (const u of state.units[side]) for (const c of programById(u.programId).colors) out.add(c);
  return out;
}
function boundShapes(state: GameState, side: Side): Set<number> {
  const out = new Set<number>();
  for (const u of state.units[side]) for (const s of programById(u.programId).shapes) out.add(s);
  return out;
}

const cellKey = (x: number, y: number): number => y * BOARD_WIDTH + x;

interface SliceInfo {
  p: Pt;
  m: number; // highest qualifying damage multiplier
  axes: Set<MatchCondition>; // the axis(es) that sliced this tile
  stochOnly: boolean; // every Sync that sliced it was stochastic (MK7.3)
}

// Resolve all Sync steps for one owner-side event until the Datastream settles.
// Each loop iteration is one "step" (spec 1.5): all simultaneous Syncs in the
// current board state resolve together, with a single buff application.
// See pre-Alpha history for the budget/cause/freshIds semantics (unchanged).
export function resolveCascades(
  state: GameState,
  owner: Side,
  events: GameEvent[],
  budget: number | null,
  // MK7.3/§15.3 — everything descended from an initiating action carries THAT
  // action's causal bucket, not the mechanism that finally dealt the damage.
  cause: 'match' | 'bomb' | 'lineslice' | 'transform',
  freshIds: Set<number>,
  causeProgramId?: string, // the initiating Function's Program (non-match causes)
  // Alpha 0.5.0 — labels the charge streams of the FIRST wave with the Effect
  // that caused it, so generation is attributable (§37.1). Later waves are
  // ordinary cascades and label themselves. Allocation is untouched: the
  // top-to-bottom queue rule does not consult this (§30.1).
  origin?: { streamSource: ChargeStreamSource; sourceId: string },
): { steps: number; stochasticRounds: number } {
  let steps = 0;
  let stochasticRounds = 0;
  const matchDamagePassives = matchPassivesFor(state, owner, 'PSV_EXTRA_MATCH_DAMAGE');
  const matchChargePassives = matchPassivesFor(state, owner, 'PSV_EXTRA_MATCH_CHARGE');
  while (!state.winner) {
    const matches = detectMatches(state.board);
    if (!matches.length) break;
    steps++;

    // classify each Sync BEFORE destruction (needs live board tiles)
    const stochastic = matches.map((match) =>
      match.cells.some((c) => {
        const t = state.board[c.y][c.x];
        return !!t && freshIds.has(t.id);
      }),
    );
    if (stochastic.some(Boolean)) stochasticRounds++;

    // Per sliced tile: highest multiplier (applied once), the set of Sync AXES
    // that sliced it (MK5.2 single-axis charge / MK7.5 split), and whether
    // EVERY Sync slicing it was stochastic (MK7.3 cascadeDamage — mixed
    // destruction counts as earned).
    const info = new Map<number, SliceInfo>();
    const bump = (x: number, y: number, m: number, axes: Iterable<MatchCondition>, stoch: boolean): void => {
      const k = cellKey(x, y);
      const cur = info.get(k);
      if (!cur) info.set(k, { p: { x, y }, m, axes: new Set(axes), stochOnly: stoch });
      else {
        if (m > cur.m) cur.m = m;
        for (const a of axes) cur.axes.add(a);
        cur.stochOnly = cur.stochOnly && stoch;
      }
    };

    // (1) DIRECT Sync footprints. §9.4 — constituent match groups remain the
    // authority for base damage, crit handling, charge, and Skill triggers.
    matches.forEach((match, mi) => {
      const m = matchMultiplier(match);
      for (const c of match.cells) bump(c.x, c.y, m, [match.condition], stochastic[mi]);
    });
    const direct = new Map(info); // snapshot before any collateral is added

    // (2) §9 line clears, qualified from the wave's COMBINED direct footprint.
    // Collateral cells are swept at the plain tier with NO crit (approved
    // decision: no single constituent group owns a combined line), and inherit
    // the axis set of the direct matches that actually formed that line so
    // charge attribution stays defined. Cells already sliced directly keep
    // their own multiplier and axes — intersections are therefore deduplicated
    // while both line-clear events survive for causal/logging purposes (§9.2).
    for (const line of computeLineClears(matches)) {
      const lineCells: Pt[] = [];
      if (line.orientation === 'h') {
        for (let x = 0; x < BOARD_WIDTH; x++) lineCells.push({ x, y: line.index });
      } else {
        for (let y = 0; y < BOARD_HEIGHT; y++) lineCells.push({ x: line.index, y });
      }
      const axes = new Set<MatchCondition>();
      let anyDirect = false;
      let allStoch = true;
      for (const p of lineCells) {
        const d = direct.get(cellKey(p.x, p.y));
        if (!d) continue;
        anyDirect = true;
        for (const a of d.axes) axes.add(a);
        allStoch = allStoch && d.stochOnly;
      }
      if (!anyDirect) continue; // defensive: a line always contains direct tiles
      events.push({ t: 'lineClear', side: owner, orientation: line.orientation, index: line.index });
      for (const p of lineCells) {
        if (direct.has(cellKey(p.x, p.y))) continue;
        bump(p.x, p.y, MATCH_4_MULTIPLIER, axes, allStoch);
      }
    }

    // Buff bonus: once per step, computed BEFORE removal so a same-side buff
    // sliced in this step still counts toward this step's damage.
    const bonus = buffBonus(state, owner);
    // MK5.6/§5.4: contention is tiles bound to the OPPONENT's Programs.
    const oppColors = boundColors(state, opponentOf(owner));
    const oppShapes = boundShapes(state, opponentOf(owner));

    let raw = 0; // base Sync damage (pre-floor)
    let passiveRaw = 0; // §17 PASSIVE-originated damage (pre-floor)
    let critExtra = 0; // damage added by the 1.5x multiplier only (pre-floor)
    let contested = 0; // MK5.6: sliced tiles bound to the OPPOSING side's Programs
    let colorRaw = 0; // MK7.5: pre-floor damage paid via the color axis
    let shapeRaw = 0; // MK7.5: pre-floor damage paid via the shape axis
    let cascadeRaw = 0; // MK7.3: pre-floor damage from stochastic-only tiles
    let shieldsRemoved = 0; // MK9.3: shield tiles sliced away this step
    let neutralSliced = 0; // §7.3: neutral Packets sliced this step
    const destroyed: Pt[] = [];
    const waste = new Map<string, number>();
    // §10.3/§10.5 — charge GENERATED this wave, gathered per axis token and
    // routed together below, after every PASSIVE has had its chance to inflate
    // or dampen a stream (§18/§19). A cascade wave is labelled for telemetry.
    const streams: StreamMap = new Map();
    const isCascadeWave = steps > 1 || stochastic.some(Boolean);
    const streamSource: ChargeStreamSource = isCascadeWave
      ? 'CASCADE'
      : (origin?.streamSource ?? 'SYNC');
    for (const { p, m, axes, stochOnly } of info.values()) {
      const t = state.board[p.y][p.x];
      if (!t) continue;
      destroyed.push(p);
      if (t.special?.type === 'shield') shieldsRemoved++;
      if (t.kind === 'neutral') neutralSliced++;
      const { v: base, axis } = matchTileDamage(t, axes, owner, state); // MK6.1/§5.4
      raw += base * m;
      if (m > 1) critExtra += base * (m - 1);
      if (axis === 'color') colorRaw += base * m;
      else if (axis === 'shape') shapeRaw += base * m;
      if (stochOnly) cascadeRaw += base * m;
      if (t.kind === 'standard' && (oppColors.has(t.color!) || oppShapes.has(t.shape!))) contested++;
      accumulateTileCharge(state, t, axes, streams, streamSource, isCascadeWave ? undefined : origin?.sourceId);
    }

    // ---- §11-§18 PASSIVES: scoped to the RESOLUTION OWNER, once per ----
    // ---- qualifying Sync event ----
    // Duplicate qualifying instances stack additively simply by iterating the
    // list: repeats across sources are meaningful content and are never
    // deduplicated by PASSIVE_ID (§11).
    for (const inst of matchDamagePassives) {
      for (const match of matches) {
        if (!passiveQualifies(inst, match)) continue;
        // §17 — the bonus joins RAW Sync damage BEFORE the critical multiplier,
        // flooring, Buffer addition, and Shield reduction, so it participates in
        // exactly the damage order the former inherent passive did.
        const magnitude = inst.passive.magnitude ?? 0;
        const mult = matchMultiplier(match);
        const add = magnitude * mult;
        passiveRaw += add;
        if (mult > 1) critExtra += magnitude * (mult - 1);
        events.push({ t: 'passive', side: owner, cause: causeOf(inst), effect: inst.passive.effectType, damage: add });
      }
    }
    for (const inst of matchChargePassives) {
      for (const match of matches) {
        if (!passiveQualifies(inst, match)) continue;
        // §18 — increase this event's normal qualifying color-axis stream
        // BEFORE it is routed, then let the ordinary top-to-bottom rule place
        // it. It does NOT open a separate pool that independently charges every
        // compatible Program.
        //
        // `charge` reports what the PASSIVE contributed to the stream. Where
        // that charge finally LANDS (and any discard) is recorded by the
        // chargeRoute event for this stream.
        const magnitude = inst.passive.magnitude ?? 0;
        addStream(streams, 'color', inst.passive.color!, magnitude, 'PASSIVE_MODIFIED_SYNC', inst.passive.id);
        events.push({ t: 'passive', side: owner, cause: causeOf(inst), effect: inst.passive.effectType, charge: magnitude });
      }
    }

    // §19 — dampening runs after ALL generation, so the order-independent
    // max(0, base + bonuses - dampening) formula holds however the content is
    // arranged.
    applyChargeDampen(state, owner, streams, events);

    // §10.3/§10.4 — all generation for this wave is complete (Packets, PASSIVE
    // inflation, PASSIVE dampening), so route the streams now: colors first,
    // then shapes, each top-to-bottom through the ordered active build.
    routeStreams(state, owner, streams, events, waste);

    // §7.3 — Deck Function charge from neutral Packets sliced anywhere in this
    // owned resolution: the direct footprint, qualifying line clears, and
    // same-side cascades all count (each cascade wave runs this loop again).
    // Bomb destruction never reaches here, so it grants nothing.
    if (neutralSliced > 0) {
      const gain = neutralSliced * DECK_CHARGE_PER_NEUTRAL_TILE;
      const wasted = addDeckCharge(state, owner, gain);
      if (owner === 'player') events.push({ t: 'deckCharge', side: owner, amount: gain - wasted, wasted });
    }

    for (const [programId, amount] of waste) {
      events.push({ t: 'chargeWaste', side: owner, ownerKind: 'program', programId, amount });
    }
    events.push({ t: 'tileStats', side: owner, destroyed: destroyed.length, contested });

    events.push({ t: 'destroy', cells: destroyed });
    for (const p of destroyed) state.board[p.y][p.x] = null;
    if (shieldsRemoved > 0) events.push({ t: 'shieldRemoved', count: shieldsRemoved });

    // §11.2 REINFORCED CONNECTION: ordinary BASE Sync damage is suppressed for
    // both sides — but the Sync event still exists, so match-triggered PASSIVE
    // damage still resolves and is attributed to its own metric bucket
    // (§11.3/§17). Charge, destruction, contention, Deck charge, and cascading
    // above are untouched; bomb DETONATIONS are unaffected (resolveDetonation).
    // The buff bonus deliberately does NOT apply here: it amplifies base Sync
    // damage, which is exactly what this mode suppresses.
    const suppressBase = state.config.reinforcedConnection;
    const causalRaw = suppressBase ? passiveRaw : raw + passiveRaw;
    // Fractional crit sums are floored (documented in README). The PASSIVE
    // portion is allocated as an integer so the disjoint metric buckets stay
    // exact and base Sync damage records as a clean zero under suppression.
    const total = Math.floor(causalRaw);
    const passivePortion = Math.min(total, Math.floor(passiveRaw));
    if (total > 0 || (!suppressBase && bonus > 0)) {
      dealDamage(
        state,
        opponentOf(owner),
        total + (suppressBase ? 0 : bonus),
        {
          source: cause, // MK7.3: bucket = initiating cause, not mechanism
          label: owner === 'player' ? 'Hacker Sync' : 'System Sync',
          programId: cause === 'match' ? undefined : causeProgramId,
          // Alpha 0.5.0 — a Transform-caused Sync carries the Function and
          // Effect that caused it, so the new `transform` damage bucket is
          // auditable back to the exact activation that produced it.
          ...(cause === 'transform'
            ? { fnId: origin?.sourceId, effectId: 'EFFECT_TRANSFORM' as const }
            : {}),
          // Under suppression the crit cross-cut reports 0: the multiplier's
          // contribution to BASE Sync damage is exactly what is suppressed, and
          // the surviving PASSIVE contribution is reported in its own bucket.
          // This never over-reports crit against damage that was not dealt.
          critExtra: suppressBase ? 0 : critExtra,
          buffBonus: suppressBase ? 0 : bonus,
          colorRaw: cause === 'match' && !suppressBase ? colorRaw : undefined,
          shapeRaw: cause === 'match' && !suppressBase ? shapeRaw : undefined,
          cascadeRaw: suppressBase ? 0 : cascadeRaw,
          passiveRaw: passivePortion,
        },
        events,
      );
    }
    applyGravityAndRefill(state, events, budget !== null && steps >= budget, freshIds);
  }
  // MK7.2: the cascade metric counts only stochastic-refill rounds
  if (stochasticRounds > 0) events.push({ t: 'cascadeDepth', side: owner, depth: stochasticRounds });
  if (!state.winner) ensureNoDeadlock(state, events);
  return { steps, stochasticRounds };
}

// Bomb detonation (§9.1): slices the bomb's own data-defined footprint
// (edge-clipped, deduplicated by the pattern registry's set semantics) as
// NORMAL tiles — no chain detonations, no re-triggers. Per-tile damage to the
// owner's opponent (same-side buffs caught in the blast still count for this
// blast), NO charge granted at all — including no Deck charge for neutral
// Packets (§7.3) — then resulting falls/cascades resolve as owner-side steps
// carrying the 'bomb' cause.
export function resolveDetonation(state: GameState, p: Pt, events: GameEvent[]): void {
  const bomb = state.board[p.y][p.x];
  if (!bomb || bomb.special?.type !== 'bomb') return;
  const sp = bomb.special;
  // §14.2/§14.5 — the placing Function's typed selections travel with the
  // overlay, so a bomb that was armed three turns ago still resolves under
  // ITS OWN contract. Absent values mean the pre-parameterized default.
  detonateAt(state, p, {
    owner: sp.owner,
    areaPattern: sp.areaPattern ?? 'AREA_SQUARE_3X3',
    programId: sp.programId,
    fnId: sp.fnId,
    dealDamage: sp.dealDamage ?? DEAL_DAMAGE_YES,
    gainCharge: sp.gainCharge ?? GAIN_CHARGE_NO_DEFAULT,
  }, events);
}

// Pre-parameterization Bombs granted no charge at all, so an overlay saved
// without an explicit selection keeps that behavior.
const GAIN_CHARGE_NO_DEFAULT = 1;

export interface BlastSpec {
  owner: Side;
  areaPattern: AreaPatternId;
  programId?: string;
  fnId?: string;
  dealDamage: 0 | 1;
  gainCharge: 0 | 1;
}

// §14 — the one Bomb blast implementation, shared by countdown detonations and
// by immediate (countdown-blank) resolutions such as PLINK. Footprint,
// clipping, settling, causal ownership, and chain behavior are unchanged; the
// tuple selects only whether the blast deals damage and whether directly
// sliced Packets charge.
// `settle` false leaves gravity/refill/cascades to the caller, so an
// immediately resolving Bomb can log its target BEFORE the board moves.
export function detonateAt(state: GameState, p: Pt, spec: BlastSpec, events: GameEvent[], settle = true): void {
  const owner = spec.owner;
  const programId = spec.programId;
  const offsets = AREA_PATTERNS[spec.areaPattern];

  const inBounds: Pt[] = [];
  const cells: Pt[] = [];
  for (const d of offsets) {
    const nx = p.x + d.x;
    const ny = p.y + d.y;
    if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT) {
      inBounds.push({ x: nx, y: ny });
      if (state.board[ny][nx]) cells.push({ x: nx, y: ny });
    }
  }
  events.push({ t: 'detonate', p, cells: inBounds });

  const bonus = buffBonus(state, owner);
  let raw = 0;
  let shieldsRemoved = 0; // MK9.3: shield tiles caught in this blast
  const sliced: Tile[] = [];
  for (const c of cells) {
    const t = state.board[c.y][c.x]!;
    if (t.special?.type === 'shield') shieldsRemoved++;
    sliced.push(t);
    raw += baseDamage(t, state, owner);
  }

  events.push({ t: 'destroy', cells });
  for (const c of cells) state.board[c.y][c.x] = null;
  if (shieldsRemoved > 0) events.push({ t: 'shieldRemoved', count: shieldsRemoved });

  // §14.6 — directly sliced blast Packets charge only when the tuple says so.
  // Current live Bomb content (including PLINK) grants none, preserving the
  // established rule that Bomb destruction does not charge.
  if (spec.gainCharge === GAIN_CHARGE_YES) chargeFromEffectSlice(state, owner, sliced, events);

  // §14.5 — dealDamage=1 mutates the board without dealing blast damage;
  // resulting refill Syncs still resolve normally either way.
  if (spec.dealDamage === DEAL_DAMAGE_YES) {
    dealDamage(
      state,
      opponentOf(owner),
      raw + bonus,
      {
        source: 'bomb',
        label: owner === 'player' ? 'Hacker bomb' : 'System bomb',
        programId,
        fnId: spec.fnId,
        effectId: 'EFFECT_BOMB',
        buffBonus: bonus,
      },
      events,
    );
  }
  if (state.winner || !settle) return;
  settleAfterEffect(state, owner, 'bomb', programId, events);
}

// MK5.2: an Effect-caused destruction has no "initial Sync" — its entire
// cascade budget is the cap itself, and at cap 0 even its own refill is
// constrained. MK7.3/§15.2: everything descended from it carries that
// Effect's causal bucket and belongs to the initiator.
export function settleAfterEffect(
  state: GameState,
  owner: Side,
  cause: 'bomb' | 'lineslice',
  causeProgramId: string | undefined,
  events: GameEvent[],
): void {
  const cap = state.config.maxCascadeSteps;
  const freshIds = new Set<number>();
  applyGravityAndRefill(state, events, cap !== null && cap <= 0, freshIds);
  resolveCascades(state, owner, events, cap, cause, freshIds, causeProgramId);
}

// ============================================================================
// Alpha 0.4.0 §13 — EFFECT_LINESLICE
// ============================================================================

export interface LineSliceSpec {
  owner: Side;
  params: LineSliceParams;
  programId: string;
  fnId: string;
}

export interface LineSliceOutcome {
  dimension: 'row' | 'column';
  sliced: Pt[];
  retained: Pt[];
  damage: number; // the combined direct Function-damage instance (pre-shield)
  charge: number; // direct charge that actually landed
}

// §13.3 — slice the whole row or column through `target`. The line is derived
// FROM the target coordinate; there is no separate row-target abstraction.
// Direct line-slice destruction is not a Sync: it never contributes to a B1
// footprint, never triggers color/shape match Skills, and never earns Deck
// neutral charge. Refill Syncs it causes do all of those normally (§15.2).
export function resolveLineSlice(
  state: GameState,
  target: Pt,
  spec: LineSliceSpec,
  events: GameEvent[],
): LineSliceOutcome {
  const { owner, params } = spec;
  const vertical = params.dimension === LINE_DIMENSION_COLUMN;
  const lineCells: Pt[] = [];
  if (vertical) {
    for (let y = 0; y < BOARD_HEIGHT; y++) lineCells.push({ x: target.x, y });
  } else {
    for (let x = 0; x < BOARD_WIDTH; x++) lineCells.push({ x, y: target.y });
  }

  // §13.2 — retention is decided BEFORE anything is sliced. A retained special
  // stays a complete tile/special object, is excluded from the direct slice,
  // and then settles normally (it is not pinned above empty space).
  const retained: Pt[] = [];
  const slicedPts: Pt[] = [];
  const slicedTiles: Tile[] = [];
  for (const c of lineCells) {
    const t = state.board[c.y][c.x];
    if (!t) continue; // out-of-play cell (a concluded board may hold gaps)
    const sp = t.special;
    const keep =
      !!sp &&
      (params.specialRetention === SPECIALS_RETAIN_ALL ||
        (params.specialRetention === SPECIALS_RETAIN_OWN && sp.owner === owner));
    if (keep) {
      retained.push(c);
      continue;
    }
    slicedPts.push(c);
    slicedTiles.push(t);
  }

  // §13.4 — one combined NONCRITICAL damage instance per deployment, valued
  // through the shared collateral valuation. Buff and Shield apply once, via
  // the ordinary damage pipeline. Retained specials and out-of-board cells
  // contribute nothing.
  let raw = 0;
  let shieldsRemoved = 0;
  for (const t of slicedTiles) {
    if (t.special?.type === 'shield') shieldsRemoved++;
    raw += baseDamage(t, state, owner);
  }

  events.push({ t: 'destroy', cells: slicedPts });
  for (const c of slicedPts) state.board[c.y][c.x] = null;
  if (shieldsRemoved > 0) events.push({ t: 'shieldRemoved', count: shieldsRemoved });

  // §13.5 — direct charge only when the tuple asks for it.
  const charge =
    params.gainCharge === GAIN_CHARGE_YES ? chargeFromEffectSlice(state, owner, slicedTiles, events) : 0;

  let damage = 0;
  if (params.dealDamage === DEAL_DAMAGE_YES) {
    const bonus = buffBonus(state, owner);
    damage = raw + bonus;
    // §13.4 — Function damage, so Reinforced Connection (which suppresses
    // BASE SYNC damage only) does not touch it.
    dealDamage(
      state,
      opponentOf(owner),
      damage,
      {
        source: 'lineslice',
        label: owner === 'player' ? 'Hacker line slice' : 'System line slice',
        programId: spec.programId,
        fnId: spec.fnId,
        effectId: 'EFFECT_LINESLICE',
        buffBonus: bonus,
      },
      events,
    );
  }

  return { dimension: vertical ? 'column' : 'row', sliced: slicedPts, retained, damage, charge };
}

// ============================================================================
// Alpha 0.5.0 §20-§26 — EFFECT_TRANSFORM
// ============================================================================

export interface TransformSpec {
  owner: Side;
  params: TransformParams;
  axisTarget: AxisTarget;
  axisResult: AxisResult;
  quantity: number;
  programId: string;
  fnId: string;
}

export interface TransformOutcome {
  candidates: number; // eligible Packets on the board at activation time
  cells: Pt[]; // what was actually transformed
  tier2Used: number; // how many came from the shares-one-axis fallback tier
  specialsRetained: number;
  specialsDestroyed: number;
}

// Alpha 0.6.0 §24 — does this Packet satisfy the authored `axisTarget`?
//   NEU  — the Packet is neutral.
//   ALL  — any Packet, neutral included.
//   AXIS — a STANDARD Packet matching every authored axis (intersection). A
//          neutral is never eligible here: it has no axis to match.
function matchesAxisTarget(t: Tile, target: AxisTarget): boolean {
  if (target.kind === 'NEU') return t.kind === 'neutral';
  if (target.kind === 'ALL') return true;
  if (t.kind === 'neutral') return false;
  if (target.color !== undefined && t.color !== target.color) return false;
  if (target.shape !== undefined && t.shape !== target.shape) return false;
  return true;
}

// §24 (director ruling 2026-08-11) — how many axes of the RESULT this Packet
// already has. A Packet sharing every result axis is a pure no-op and is never
// a valid target; one sharing exactly one axis of a two-axis result is the
// FALLBACK tier, used only to top up after the clean tier is exhausted.
function sharedResultAxes(t: Tile, result: AxisResult): number {
  if (result.neutral) return t.kind === 'neutral' ? 1 : 0;
  if (t.kind === 'neutral') return 0; // a neutral shares no color or shape
  let n = 0;
  if (result.color !== undefined && t.color === result.color) n++;
  if (result.shape !== undefined && t.shape === result.shape) n++;
  return n;
}

const resultAxisCount = (result: AxisResult): number =>
  result.neutral ? 1 : (result.color !== undefined ? 1 : 0) + (result.shape !== undefined ? 1 : 0);

// §24 — the eligible pool, split into the two tiers. Tier 1 is Packets sharing
// NO result axis; tier 2 is Packets sharing exactly one axis of a TWO-axis
// result. Anything matching every result axis is excluded outright, so
// `quantity` always means "up to this many real transformations".
export interface TransformCandidates {
  tier1: Pt[];
  tier2: Pt[];
}

export function transformCandidates(state: GameState, spec: { axisTarget: AxisTarget; axisResult: AxisResult }): TransformCandidates {
  const tier1: Pt[] = [];
  const tier2: Pt[] = [];
  const axes = resultAxisCount(spec.axisResult);
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const t = state.board[y][x];
      if (!t || !matchesAxisTarget(t, spec.axisTarget)) continue;
      const shared = sharedResultAxes(t, spec.axisResult);
      if (shared === 0) tier1.push({ x, y });
      else if (axes === 2 && shared === 1) tier2.push({ x, y });
      // shared === axes: already identical on every result axis — never valid.
    }
  }
  return { tier1, tier2 };
}

// The total eligible count, for valid-target gating (§19.4 withhold checks).
export function transformCandidateCount(state: GameState, spec: { axisTarget: AxisTarget; axisResult: AxisResult }): number {
  const { tier1, tier2 } = transformCandidates(state, spec);
  return tier1.length + tier2.length;
}

// §24 — ATOMIC transformation. Every selected Packet changes BEFORE any Sync
// detection runs, so arbitrary target-iteration order can never become
// mechanically significant (transform one, resolve, refill, transform the next
// would make it so, and would not match the player's mental model).
//
// This function performs ONLY the board mutation and returns what it did; the
// caller runs the resulting Sync wave. Splitting it that way keeps the "all
// transforms, then detection" ordering impossible to get wrong.
export function applyTransform(state: GameState, spec: TransformSpec, events: GameEvent[]): TransformOutcome {
  const { tier1, tier2 } = transformCandidates(state, spec);
  const outcome: TransformOutcome = {
    candidates: tier1.length + tier2.length,
    cells: [],
    tier2Used: 0,
    specialsRetained: 0,
    specialsDestroyed: 0,
  };
  if (!outcome.candidates) return outcome;

  // §23.1 — up to `quantity` distinct targets, drawn without replacement.
  // When every eligible Packet in a tier will be transformed anyway, the
  // selection is a complete set and its order is irrelevant, so NO gameplay RNG
  // is consumed merely to permute it (§45.13). RNG is only gameplay-affecting
  // when the choice actually excludes something.
  //
  // §24 — tier 1 is drawn first and tier 2 TOPS UP whatever quantity remains
  // (director ruling 2026-08-11), so a Function never converts fewer Packets
  // than it could merely because the clean pool ran short.
  const draw = (pool: Pt[], want: number): Pt[] => {
    if (want <= 0 || !pool.length) return [];
    if (pool.length <= want) return [...pool];
    const rest = [...pool];
    const out: Pt[] = [];
    for (let i = 0; i < want; i++) out.push(rest.splice(state.rng.int(rest.length), 1)[0]);
    return out;
  };
  const fromTier1 = draw(tier1, spec.quantity);
  const fromTier2 = draw(tier2, spec.quantity - fromTier1.length);
  outcome.tier2Used = fromTier2.length;
  const chosen = [...fromTier1, ...fromTier2];

  for (const p of chosen) {
    const t = state.board[p.y][p.x]!;
    // §23.2 — special-overlay treatment, sharing the established SPECIALS_*
    // enum. Retaining preserves the overlay's ownership and Effect-specific
    // state (countdown, magnitude, attribution) while the UNDERLYING Packet
    // changes identity (§22.3). Alpha 0.6.0 makes this LIVE behavior for the
    // first time: with axis-specific and ALL targeting, an overlay-carrying
    // standard Packet is now reachable, where NEU-only targeting could never
    // select one.
    if (t.special) {
      // A neutral RESULT is the exception: a neutral tile structurally cannot
      // carry an overlay, so retention is impossible whatever the tuple says.
      // The loader warns about that authoring; here it simply always destroys.
      const keep =
        !spec.axisResult.neutral &&
        (spec.params.specialPacketTreatment === SPECIALS_RETAIN_ALL ||
          (spec.params.specialPacketTreatment === SPECIALS_RETAIN_OWN && t.special.owner === spec.owner));
      if (keep) outcome.specialsRetained++;
      else {
        delete t.special;
        outcome.specialsDestroyed++;
      }
    }
    if (spec.axisResult.neutral) {
      t.kind = 'neutral';
      delete t.color;
      delete t.shape;
    } else {
      // §24 — a single-axis result PRESERVES the other axis. A neutral target
      // has no axis to preserve, so the unauthored one is randomized per Packet
      // from the battle's gameplay RNG (director ruling 2026-08-11).
      const wasNeutral = t.kind === 'neutral';
      t.kind = 'standard';
      if (spec.axisResult.color !== undefined) t.color = spec.axisResult.color;
      else if (wasNeutral) t.color = state.rng.int(COLOR_COUNT) as Color;
      if (spec.axisResult.shape !== undefined) t.shape = spec.axisResult.shape;
      else if (wasNeutral) t.shape = state.rng.int(SHAPE_COUNT) as Shape;
    }
    outcome.cells.push(p);
    events.push({ t: 'setTile', p, view: tileViewOf(t) });
  }
  return outcome;
}

// Run after every settle: if the Datastream has no valid moves, the automatic
// deadlock reshuffle triggers (guaranteed >=1 move, no pre-existing Sync).
export function ensureNoDeadlock(state: GameState, events: GameEvent[]): void {
  if (hasAnyValidMove(state.board)) return;
  reshuffleBoard(state);
  events.push({ t: 'autoReshuffle' }); // MK2.3 match-lock metric
  events.push({ t: 'msg', text: 'No moves left — Datastream reshuffled' });
  events.push({ t: 'board', grid: gridViewOf(state.board) });
}
