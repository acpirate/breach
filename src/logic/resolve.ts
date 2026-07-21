// Damage / charge / cascade resolution. The heart of the combat rules:
//  - damage and charge are computed per DESTROYED TILE over an explicit set
//    (never per match — shared tiles count exactly once, at their highest
//    qualifying multiplier),
//  - charge is flat per tile (no multipliers), owner-scoped, capped at each
//    Program's charge-pool capacity (Alpha: resolved from data, not tables),
//  - buff bonus applies once per STEP; buff/shield per-tile values come from
//    the magnitude stamped on each special tile at placement (Function data),
//  - bomb detonations destroy their own data-defined footprint as normal
//    tiles (no chains, no charge).

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOARD_SHAKE_COST,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_HIGH_SHAPE,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_LOW_SHAPE,
  DAMAGE_PER_TILE_NEUTRAL,
  HACKER_BONUS_CHARGE,
  HACKER_BONUS_COLOR,
  HACKER_BONUS_DAMAGE,
  SHAKE_CHARGE_PER_NEUTRAL_TILE,
  isStrongColor,
  isStrongShape,
} from './constants';
import { AREA_PATTERNS } from './data/areas';
import { programById, programsFor } from './data/content';
import { MatchCondition, detectMatches, matchClearsLine, matchMultiplier } from './match';
import { completesRun, hasAnyValidMove, randomTile, reshuffleBoard } from './board';
import { GameEvent, GameState, Pt, Side, Tile, UnitState, gridViewOf, opponentOf, tileViewOf } from './types';

// Sum of the owner's active buff-tile magnitudes (per-tile value from data).
export function buffBonus(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'buff' && t.special.owner === side) n += t.special.magnitude ?? 0;
    }
  }
  return n;
}

// MK9.3/Alpha §9.5 — total active shield for a side: sum of the magnitudes of
// its shield tiles currently on the board. Measured live at damage-application
// time, so a shield matched/blasted away no longer protects the next instance.
export function shieldValue(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'shield' && t.special.owner === side) n += t.special.magnitude ?? 0;
    }
  }
  return n;
}

// Per-tile damage for BLAST destruction (not a match — no axis): a tile's
// "own type's normal value" is its color tier / neutral value, resolved
// against the BOMB OWNER's strong colors (MK9.4).
export function baseDamage(t: Tile, state: GameState, owner: Side): number {
  if (t.kind === 'neutral') return DAMAGE_PER_TILE_NEUTRAL;
  return isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
}

// MK6.1 — per-tile damage for MATCH destruction, resolved on the axis(es)
// that destroyed the tile (see pre-Alpha history for the full rationale).
function matchTileDamage(
  t: Tile,
  axes: Set<MatchCondition>,
  owner: Side,
  state: GameState,
  hackerOn: boolean,
): { v: number; axis: 'color' | 'shape' | 'neutral' } {
  if (t.kind === 'neutral') return { v: DAMAGE_PER_TILE_NEUTRAL, axis: 'neutral' };
  let v = 0;
  let axis: 'color' | 'shape' | 'neutral' = 'neutral';
  if (axes.has('color') || axes.has('neutral')) {
    let c = isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
    if (hackerOn && owner === 'player' && t.color === HACKER_BONUS_COLOR) c += HACKER_BONUS_DAMAGE;
    v = c;
    axis = 'color';
  }
  if (axes.has('shape')) {
    const s = isStrongShape(state.config, owner, t.shape!) ? DAMAGE_PER_TILE_HIGH_SHAPE : DAMAGE_PER_TILE_LOW_SHAPE;
    if (s > v) {
      v = s;
      axis = 'shape';
    } else if (v === 0) {
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

export function addShakeCharge(state: GameState, amount: number): void {
  state.shakeCharge = Math.min(BOARD_SHAKE_COST, state.shakeCharge + amount);
}

export interface DamageInfo {
  source: 'match' | 'attacker' | 'bomb'; // MK7.3: the CAUSAL bucket
  label: string;
  programId?: string; // acting Program for ability-caused damage
  critExtra?: number; // portion of `amount` added by the 1.5x multiplier (pre-floor)
  buffBonus?: number; // portion of `amount` contributed by buff tiles
  colorRaw?: number; // MK7.5: pre-floor damage paid via the color axis (match cause only)
  shapeRaw?: number; // MK7.5: pre-floor damage paid via the shape axis (match cause only)
  cascadeRaw?: number; // MK7.3: pre-floor damage from stochastic-only tiles
}

export function dealDamage(state: GameState, target: Side, amount: number, info: DamageInfo, events: GameEvent[]): void {
  if (state.winner || amount <= 0) return;

  let finalAmount = amount;
  let buffFinal = info.buffBonus ?? 0;
  let critFinal = info.critExtra;
  let colorFinal = info.colorRaw;
  let shapeFinal = info.shapeRaw;
  let cascadeFinal = info.cascadeRaw;

  // §3.1/§9.5: every separate damage instance is reduced by the DEFENDER's
  // live total shield (min 0), AFTER base+buff are computed (already folded
  // into `amount`) but BEFORE HP is touched. Shield prevention is NOT damage
  // dealt — reported separately, never added to a damage-source bucket.
  const shield = shieldValue(state, target);
  if (shield > 0) {
    const prevented = Math.min(amount, shield);
    finalAmount = amount - prevented;
    events.push({ t: 'shield', target, source: info.source, preShield: amount, shield, prevented, final: finalAmount });
    // Shield eats the causal (base) portion first and the buff portion last,
    // so the disjoint metric buckets (base bucket + buffer bucket) still sum
    // exactly to the dealt amount. Pre-floor analytical splits scale with it.
    const base = amount - (info.buffBonus ?? 0);
    buffFinal = Math.min(info.buffBonus ?? 0, finalAmount);
    const causalFinal = finalAmount - buffFinal;
    const scale = base > 0 ? causalFinal / base : 0;
    if (critFinal !== undefined) critFinal *= scale;
    if (colorFinal !== undefined) colorFinal *= scale;
    if (shapeFinal !== undefined) shapeFinal *= scale;
    if (cascadeFinal !== undefined) cascadeFinal *= scale;
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
    critExtra: critFinal,
    buffBonus: buffFinal,
    colorRaw: colorFinal,
    shapeRaw: shapeFinal,
    cascadeRaw: cascadeFinal,
  });
  if (state.hp[target] <= 0) {
    state.winner = opponentOf(target);
    state.phase = 'over';
    events.push({ t: 'over', winner: state.winner });
  }
}

// Charge from one destroyed tile in a MATCH step. Owner-scoped: only the
// event-owning side's units (and, for the player, the shake meter) gain.
// Cap overflow is accumulated into `waste` per Program (MK2.3 metric).
// Bindings come from each unit's resolved Program (one or more colors and
// shapes per Program as of Alpha 0.1.0 — a tile pays at most once per axis).
function chargeFromDestroyedTile(
  state: GameState,
  owner: Side,
  t: Tile,
  axes: Set<MatchCondition>,
  waste: Map<string, number>,
): void {
  const singleAxis = state.config.singleAxisPayout;
  if (t.kind === 'neutral') {
    // shake replenishment is the neutral axis's payout
    if (owner === 'player' && (!singleAxis || axes.has('neutral'))) {
      addShakeCharge(state, SHAKE_CHARGE_PER_NEUTRAL_TILE);
    }
    return;
  }
  const colorPays = !singleAxis || axes.has('color');
  const shapePays = !singleAxis || axes.has('shape');
  for (const u of state.units[owner]) {
    const prog = programById(u.programId);
    let w = 0;
    if (colorPays && prog.colors.includes(t.color!)) {
      let c = CHARGE_PER_TILE_COLOR_MATCH;
      if (state.config.hackerBonusEnabled && owner === 'player' && t.color === HACKER_BONUS_COLOR) {
        c += HACKER_BONUS_CHARGE;
      }
      w += addUnitCharge(state, u, c);
    }
    if (shapePays && prog.shapes.includes(t.shape!)) w += addUnitCharge(state, u, CHARGE_PER_TILE_SHAPE_MATCH);
    if (w > 0) waste.set(u.programId, (waste.get(u.programId) ?? 0) + w);
  }
}

// MK5.2 cascade cap: when `constrained`, replacement tiles are rejection-
// rolled so that NO match on the settled board contains a refill tile.
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
    // local left/up rejection biases away from matches cheaply; the full-board
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

// Tiles bound to a side's Programs (color OR shape) — for the MK5.6
// contention metric, resolved against the loaded content.
function boundColors(side: Side): Set<number> {
  const out = new Set<number>();
  for (const p of programsFor(side)) for (const c of p.colors) out.add(c);
  return out;
}
function boundShapes(side: Side): Set<number> {
  const out = new Set<number>();
  for (const p of programsFor(side)) for (const s of p.shapes) out.add(s);
  return out;
}

// Resolve all match steps for one owner-side event until the board settles.
// Each loop iteration is one "step" (spec 1.5): all simultaneous matches in
// the current board state resolve together, with a single buff application.
// See pre-Alpha history for the budget/cause/freshIds semantics (unchanged).
export function resolveCascades(
  state: GameState,
  owner: Side,
  events: GameEvent[],
  budget: number | null,
  cause: 'match' | 'bomb',
  freshIds: Set<number>,
  causeProgramId?: string, // the initiating bomb's Program (bomb cause only)
): { steps: number; stochasticRounds: number } {
  let steps = 0;
  let stochasticRounds = 0;
  while (!state.winner) {
    const matches = detectMatches(state.board);
    if (!matches.length) break;
    steps++;

    // classify each match BEFORE destruction (needs live board tiles)
    const stochastic = matches.map((match) =>
      match.cells.some((c) => {
        const t = state.board[c.y][c.x];
        return !!t && freshIds.has(t.id);
      }),
    );
    if (stochastic.some(Boolean)) stochasticRounds++;

    // Per destroyed tile: highest multiplier (applied once), the set of match
    // AXES that destroyed it (MK5.2 single-axis charge / MK7.5 split), and
    // whether EVERY match destroying it was stochastic (MK7.3 cascadeDamage —
    // mixed destruction counts as earned).
    const info = new Map<number, { p: Pt; m: number; axes: Set<MatchCondition>; stochOnly: boolean }>();
    const bump = (x: number, y: number, m: number, axis: MatchCondition, stoch: boolean): void => {
      const k = y * BOARD_WIDTH + x;
      const cur = info.get(k);
      if (!cur) info.set(k, { p: { x, y }, m, axes: new Set([axis]), stochOnly: stoch });
      else {
        if (m > cur.m) cur.m = m;
        cur.axes.add(axis);
        cur.stochOnly = cur.stochOnly && stoch;
      }
    };
    matches.forEach((match, mi) => {
      const m = matchMultiplier(match);
      const st = stochastic[mi];
      for (const c of match.cells) bump(c.x, c.y, m, match.condition, st);
      if (matchClearsLine(match)) {
        // straight-line 4/5+: the entire row/column is cleared at this
        // match's multiplier; swept tiles carry the sweeping match's axis
        if (match.orientation === 'h') {
          const y = match.cells[0].y;
          for (let x = 0; x < BOARD_WIDTH; x++) bump(x, y, m, match.condition, st);
        } else {
          const x = match.cells[0].x;
          for (let y = 0; y < BOARD_HEIGHT; y++) bump(x, y, m, match.condition, st);
        }
      }
    });

    // Buff bonus: once per step, computed BEFORE removal so a same-side buff
    // destroyed in this step still counts toward this step's damage.
    const bonus = buffBonus(state, owner);
    const hackerOn = state.config.hackerBonusEnabled;
    // MK5.6/MK9.4: contention is tiles bound to the OPPONENT's units.
    const oppColors = boundColors(opponentOf(owner));
    const oppShapes = boundShapes(opponentOf(owner));

    let raw = 0;
    let critExtra = 0; // damage added by the 1.5x multiplier only (pre-floor)
    let contested = 0; // MK5.6: destroyed tiles bound to the OPPOSING side's units
    let colorRaw = 0; // MK7.5: pre-floor damage paid via the color axis
    let shapeRaw = 0; // MK7.5: pre-floor damage paid via the shape axis
    let cascadeRaw = 0; // MK7.3: pre-floor damage from stochastic-only tiles
    let shieldsRemoved = 0; // MK9.3: shield tiles matched/cascaded away this step
    const destroyed: Pt[] = [];
    const waste = new Map<string, number>();
    for (const { p, m, axes, stochOnly } of info.values()) {
      const t = state.board[p.y][p.x];
      if (!t) continue;
      destroyed.push(p);
      if (t.special?.type === 'shield') shieldsRemoved++;
      const { v: base, axis } = matchTileDamage(t, axes, owner, state, hackerOn); // MK6.1/MK9.4: axis+side-resolved
      raw += base * m;
      if (m > 1) critExtra += base * (m - 1);
      if (axis === 'color') colorRaw += base * m;
      else if (axis === 'shape') shapeRaw += base * m;
      if (stochOnly) cascadeRaw += base * m;
      if (t.kind === 'standard' && (oppColors.has(t.color!) || oppShapes.has(t.shape!))) contested++;
      chargeFromDestroyedTile(state, owner, t, axes, waste);
    }
    for (const [programId, amount] of waste) {
      events.push({ t: 'chargeWaste', side: owner, programId, amount });
    }
    events.push({ t: 'tileStats', side: owner, destroyed: destroyed.length, contested });

    events.push({ t: 'destroy', cells: destroyed });
    for (const p of destroyed) state.board[p.y][p.x] = null;
    if (shieldsRemoved > 0) events.push({ t: 'shieldRemoved', count: shieldsRemoved });

    // MK6.2 NO_MATCH_DAMAGE: matches deal ZERO damage — no damage event at
    // all (the buff bonus must not leak through on a zero base). Charge,
    // destruction, contention, and cascading above are untouched; bomb
    // DETONATIONS are unaffected (they resolve in resolveDetonation).
    if (!state.config.noMatchDamage) {
      // Fractional crit sums are floored (documented in README).
      dealDamage(
        state,
        opponentOf(owner),
        Math.floor(raw) + bonus,
        {
          source: cause, // MK7.3: bucket = initiating cause, not mechanism
          label: owner === 'player' ? 'match' : 'enemy match',
          programId: cause === 'bomb' ? causeProgramId : undefined,
          critExtra,
          buffBonus: bonus,
          colorRaw: cause === 'match' ? colorRaw : undefined,
          shapeRaw: cause === 'match' ? shapeRaw : undefined,
          cascadeRaw,
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

// Bomb detonation (§9.1): destroys the bomb's own data-defined footprint
// (edge-clipped, deduplicated by the pattern registry's set semantics) as
// NORMAL tiles — no chain detonations, no re-triggers. Per-tile damage to the
// owner's opponent (same-side buffs caught in the blast still count for this
// blast), NO charge granted, then resulting falls/cascades resolve as
// owner-side steps carrying the 'bomb' cause.
export function resolveDetonation(state: GameState, p: Pt, events: GameEvent[]): void {
  const bomb = state.board[p.y][p.x];
  if (!bomb || bomb.special?.type !== 'bomb') return;
  const owner = bomb.special.owner;
  const programId = bomb.special.programId;
  const offsets = AREA_PATTERNS[bomb.special.areaPattern ?? 'AREA_SQUARE_3X3'];

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
  for (const c of cells) {
    const t = state.board[c.y][c.x]!;
    if (t.special?.type === 'shield') shieldsRemoved++;
    raw += baseDamage(t, state, owner);
  }

  events.push({ t: 'destroy', cells });
  for (const c of cells) state.board[c.y][c.x] = null;
  if (shieldsRemoved > 0) events.push({ t: 'shieldRemoved', count: shieldsRemoved });

  dealDamage(
    state,
    opponentOf(owner),
    raw + bonus,
    { source: 'bomb', label: owner === 'player' ? 'your bomb' : 'enemy bomb', programId, buffBonus: bonus },
    events,
  );
  if (state.winner) return;

  // MK5.2: a detonation has no "initial match" — its entire cascade budget is
  // the cap itself, and at cap 0 even the blast's own refill is constrained.
  // MK7.3: everything descended from the blast carries the 'bomb' cause.
  const cap = state.config.maxCascadeSteps;
  const freshIds = new Set<number>();
  applyGravityAndRefill(state, events, cap !== null && cap <= 0, freshIds);
  resolveCascades(state, owner, events, cap, 'bomb', freshIds, programId);
}

// Run after every settle: if the board has no valid moves, the automatic
// deadlock reshuffle triggers (guaranteed >=1 move, no pre-existing match).
export function ensureNoDeadlock(state: GameState, events: GameEvent[]): void {
  if (hasAnyValidMove(state.board)) return;
  reshuffleBoard(state);
  events.push({ t: 'autoReshuffle' }); // MK2.3 match-lock metric
  events.push({ t: 'msg', text: 'No moves left — board reshuffled' });
  events.push({ t: 'board', grid: gridViewOf(state.board) });
}
