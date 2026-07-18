// Damage / charge / cascade resolution. The heart of the combat rules:
//  - damage and charge are computed per DESTROYED TILE over an explicit set
//    (never per match — shared tiles count exactly once, at their highest
//    qualifying multiplier),
//  - charge is flat per tile (no multipliers), owner-scoped, capped at cost,
//  - buff bonus applies once per STEP,
//  - bomb detonations destroy neighbors as normal tiles (no chains, no charge).

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOARD_SHAKE_COST,
  BUFFER_DAMAGE_BONUS,
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
  SHIELD_POINTS_PER_TILE,
  blastOffsetsFor,
  effectiveCost,
  isStrongColor,
  isStrongShape,
  unitDefsFor,
} from './constants';
import { MatchCondition, detectMatches, matchClearsLine, matchMultiplier } from './match';
import { completesRun, hasAnyValidMove, randomTile, reshuffleBoard } from './board';
import { GameEvent, GameState, Pt, Side, Tile, UnitState, UnitType, gridViewOf, opponentOf, tileViewOf } from './types';

export function buffBonus(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'buff' && t.special.owner === side) n++;
    }
  }
  return n * BUFFER_DAMAGE_BONUS;
}

// MK9.3 — total active enemy shield: SHIELD_POINTS_PER_TILE for each shield
// tile of `side` currently on the board. Measured live at damage-application
// time, so a shield matched/blasted away no longer protects the next instance.
export function shieldValue(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'shield' && t.special.owner === side) n++;
    }
  }
  return n * SHIELD_POINTS_PER_TILE;
}

// Per-tile damage for BLAST destruction (not a match — no axis): a tile's
// "own type's normal value" is its color tier / neutral value, per Section 1.
// MK9.4: the color tier is resolved against the BOMB OWNER's strong colors
// (a player bomb hitting a player-strong-colored tile deals the HIGH value),
// documented deviation — MK9.4 names matches explicitly but blast damage uses
// the same per-side strength for consistency.
export function baseDamage(t: Tile, state: GameState, owner: Side): number {
  if (t.kind === 'neutral') return DAMAGE_PER_TILE_NEUTRAL;
  return isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
}

// MK6.1 — per-tile damage for MATCH destruction, resolved on the axis(es)
// that destroyed the tile: color-axis (and neutral-axis line sweeps hitting
// standard tiles, which have no shape/color stake in a neutral match — treated
// like blast destruction) pay the tile's COLOR tier; shape-axis pays its
// SHAPE tier. A tile destroyed via both axes is counted ONCE at the higher
// applicable value (mirror of the highest-multiplier-wins rule).
// The Hacker passive (+1 on Red, player match events, config-gated) rides the
// color-tier value.
// Returns the paid value AND which axis paid it (MK7.5 split): 'color' when
// the color tier paid (including neutral-sweep destruction of standard tiles,
// which uses the color tier; ties also go to color since color is the paid
// value there), 'shape' when the shape tier strictly exceeded it, 'neutral'
// for neutral tiles (axis-less for the behavioral split).
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
    // MK9.4: strong/weak resolved against the MATCH OWNER's strong colors
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

// Charge cap = activation cost (MK7.1: the EFFECTIVE cost from the battle
// config), applied at the moment charge is added. Returns the amount
// discarded at the cap (for the MK2.3 waste metric).
export function addUnitCharge(state: GameState, u: UnitState, amount: number): number {
  const before = u.charge;
  u.charge = Math.min(effectiveCost(state.config, u.type), before + amount);
  return before + amount - u.charge;
}

export function addShakeCharge(state: GameState, amount: number): void {
  state.shakeCharge = Math.min(BOARD_SHAKE_COST, state.shakeCharge + amount);
}

export interface DamageInfo {
  source: 'match' | 'attacker' | 'bomb'; // MK7.3: the CAUSAL bucket
  label: string;
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

  // MK9.3 Shielder: every separate player->enemy damage instance is reduced by
  // the total active enemy shield (min 0), AFTER base+buff are computed (they
  // are already folded into `amount`) but BEFORE HP is touched. Shield
  // prevention is NOT damage dealt — it is reported separately and never added
  // to any damage-source bucket.
  if (target === 'enemy') {
    const shield = shieldValue(state, 'enemy');
    if (shield > 0) {
      const prevented = Math.min(amount, shield);
      finalAmount = amount - prevented;
      events.push({ t: 'shield', source: info.source, preShield: amount, shield, prevented, final: finalAmount });
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
  }

  if (finalAmount <= 0) return; // fully absorbed: shield event emitted, nothing dealt

  state.hp[target] -= finalAmount;
  events.push({
    t: 'damage',
    target,
    amount: finalAmount,
    label: info.label,
    source: info.source,
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
// Cap overflow is accumulated into `waste` per unit (MK2.3 metric).
//
// MK5.2 SINGLE_AXIS_PAYOUT: when on, a match grants charge only on its own
// axis — `axes` is the set of match conditions that destroyed this tile
// (line-clear sweeps carry the sweeping match's axis). A tile in both a
// color-match and a shape-match pays out on BOTH axes (the flag restricts
// payout per MATCH, not per tile — required ruling, do not collapse).
// Damage is unaffected by the flag (designer ruling Q1b: shape-axis matches
// still deal color-based damage).
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
  const defs = unitDefsFor(owner); // MK9.4: per-side bindings
  for (const u of state.units[owner]) {
    const def = defs[u.type];
    let w = 0;
    if (colorPays && def.color === t.color) {
      let c = CHARGE_PER_TILE_COLOR_MATCH;
      if (state.config.hackerBonusEnabled && owner === 'player' && t.color === HACKER_BONUS_COLOR) {
        c += HACKER_BONUS_CHARGE;
      }
      w += addUnitCharge(state, u, c);
    }
    if (shapePays && def.shape === t.shape) w += addUnitCharge(state, u, CHARGE_PER_TILE_SHAPE_MATCH);
    if (w > 0) waste.set(u.type, (waste.get(u.type) ?? 0) + w);
  }
}

// MK5.2 cascade cap: when `constrained`, replacement tiles are rejection-
// rolled so that NO match on the settled board contains a refill tile.
// Matches formed purely by EXISTING tiles falling together cannot be
// prevented by tile generation and still resolve (designer ruling) — each
// such step gets another constrained refill until the board settles clean.
// `freshIds` (MK7.2): ids of tiles spawned by refill within the CURRENT
// resolution chain — the stochastic ones. Anything on the board when the
// chain started was visible to the player and is deterministic.
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

// Tiles bound to a side's units (color OR shape) — for the MK5.6 contention
// metric. MK9.4: bindings now differ per side, so this is resolved against the
// actual opposing-side defs at use.
function boundColors(side: Side): Set<number> {
  return new Set(Object.values(unitDefsFor(side)).map((d) => d.color));
}
function boundShapes(side: Side): Set<number> {
  return new Set(Object.values(unitDefsFor(side)).map((d) => d.shape));
}

// Resolve all match steps for one owner-side event until the board settles.
// Each loop iteration is one "step" (spec 1.5): all simultaneous matches in
// the current board state resolve together, with a single buff application.
//
// MK5.2 `budget`: how many match steps may resolve before refills become
// CONSTRAINED (no refill tile may complete a match) — null = never (infinite
// cascades). Matches are always resolved when present (they never sit on the
// board); the cap throttles generation, not resolution.
//
// MK7.3 `cause`: the action that INITIATED this chain ('match' = player/enemy
// swap, 'bomb' = detonation). Every damage event the chain emits — including
// deterministic settling and stochastic refill cascades descended from it —
// inherits this cause as its bucket. The mechanism does not determine the
// bucket; the cause does.
//
// MK7.2 `freshIds`: tile ids spawned by refill within THIS chain. A match is
// STOCHASTIC iff it contains a fresh tile; matches formed purely by existing
// tiles falling are deterministic settling (visible to a skilled player, part
// of the chosen move) and are NOT cascades.
//
// Returns steps resolved and how many rounds contained a stochastic match
// (the corrected cascade-depth metric).
export function resolveCascades(
  state: GameState,
  owner: Side,
  events: GameEvent[],
  budget: number | null,
  cause: 'match' | 'bomb',
  freshIds: Set<number>,
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
    // MK5.6/MK9.4: contention is tiles bound to the OPPONENT's (now distinct) units.
    const oppColors = boundColors(opponentOf(owner));
    const oppShapes = boundShapes(opponentOf(owner));

    let raw = 0;
    let critExtra = 0; // damage added by the 1.5x multiplier only (pre-floor)
    let contested = 0; // MK5.6: destroyed tiles bound to the OPPOSING side's units
    let colorRaw = 0; // MK7.5: pre-floor damage paid via the color axis
    let shapeRaw = 0; // MK7.5: pre-floor damage paid via the shape axis
    let cascadeRaw = 0; // MK7.3: pre-floor damage from stochastic-only tiles
    let shieldsRemoved = 0; // MK9.3: enemy shield tiles matched/cascaded away this step
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
    for (const [unit, amount] of waste) {
      events.push({ t: 'chargeWaste', side: owner, unit: unit as UnitType, amount });
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

// Bomb detonation: destroys the bomb + its 4 orthogonal neighbors as NORMAL
// tiles (no chain detonations, no re-triggers), deals per-tile damage to the
// owner's opponent (same-side buffs caught in the blast still count for this
// blast), grants NO charge, then resolves resulting cascades as owner-side
// match steps.
export function resolveDetonation(state: GameState, p: Pt, events: GameEvent[]): void {
  const bomb = state.board[p.y][p.x];
  if (!bomb || bomb.special?.type !== 'bomb') return;
  const owner = bomb.special.owner;

  events.push({ t: 'detonate', p });
  // MK3.1 base 3x3; MK9.2 enemy bombs (E-Bomb) use the cardinal-extended
  // footprint. Edge-clipped either way.
  const cells: Pt[] = [];
  for (const d of blastOffsetsFor(owner)) {
    const nx = p.x + d.x;
    const ny = p.y + d.y;
    if (nx >= 0 && nx < BOARD_WIDTH && ny >= 0 && ny < BOARD_HEIGHT && state.board[ny][nx]) {
      cells.push({ x: nx, y: ny });
    }
  }

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
    { source: 'bomb', label: owner === 'player' ? 'your bomb' : 'enemy bomb', buffBonus: bonus },
    events,
  );
  if (state.winner) return;

  // MK5.2: a detonation has no "initial match" — its entire cascade budget is
  // the cap itself, and at cap 0 even the blast's own refill is constrained.
  // MK7.3: everything descended from the blast carries the 'bomb' cause, so
  // bomb-caused cascade damage now correctly credits to the bomb bucket.
  // MK7.2: the chain's own cascadeDepth event (stochastic rounds only) is
  // emitted inside resolveCascades — the blast itself is not a cascade.
  const cap = state.config.maxCascadeSteps;
  const freshIds = new Set<number>();
  applyGravityAndRefill(state, events, cap !== null && cap <= 0, freshIds);
  resolveCascades(state, owner, events, cap, 'bomb', freshIds);
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
