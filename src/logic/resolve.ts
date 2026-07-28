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
//  - Alpha 0.3.0: the selected Hacker's coded SKILLS trigger from qualifying
//    owner-scoped Sync events (§6), the active Deck Function earns charge from
//    neutral Packets sliced in owned Sync resolution (§7.3), and row/column
//    clears qualify from the wave's COMBINED direct footprint (§9).

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
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
import { AREA_PATTERNS } from './data/areas';
import { ResolvedSkill, deckById, hackerById, programById, programsFor } from './data/content';
import { MatchCondition, Match, computeLineClears, detectMatches, matchMultiplier } from './match';
import { completesRun, hasAnyValidMove, randomTile, reshuffleBoard } from './board';
import { Color, GameEvent, GameState, Pt, Side, Tile, UnitState, gridViewOf, opponentOf, tileViewOf } from './types';

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
// its shield tiles currently on the Datastream. Measured live at damage-
// application time, so a shield sliced away no longer protects the next
// instance.
export function shieldValue(state: GameState, side: Side): number {
  let n = 0;
  for (const row of state.board) {
    for (const t of row) {
      if (t?.special?.type === 'shield' && t.special.owner === side) n += t.special.magnitude ?? 0;
    }
  }
  return n;
}

// Per-tile damage for BLAST destruction (not a Sync — no axis): a tile's
// "own type's normal value" is its color tier / neutral value, resolved
// against the BOMB OWNER's strong colors (§5.4).
export function baseDamage(t: Tile, state: GameState, owner: Side): number {
  if (t.kind === 'neutral') return DAMAGE_PER_TILE_NEUTRAL;
  return isStrongColor(state.config, owner, t.color!) ? DAMAGE_PER_TILE_HIGH_COLOR : DAMAGE_PER_TILE_LOW_COLOR;
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

// §6.2 owner scope — a Hacker Skill triggers ONLY from a qualifying Sync event
// owned by the side using that Hacker. System-owned and environment-owned
// resolution never triggers Hacker Skills.
const NO_SKILLS: ReadonlyArray<ResolvedSkill> = [];
function skillsFor(state: GameState, owner: Side): ReadonlyArray<ResolvedSkill> {
  if (owner !== 'player') return NO_SKILLS;
  return hackerById(state.identity.hackerId).skills;
}

// §6.3 — the qualifying match-event identity for the current Skill contracts:
// a RESOLVED color-axis Sync of the Skill's color. Same-axis runs the engine
// merged into one player-visible blob count ONCE; multiple distinct resolved
// blobs each qualify independently; a shape-axis Sync never qualifies (even
// when caused by moving a Packet of that color); and line-clear collateral,
// Bomb slices, and Function slices create no qualifying event because they are
// not detected Syncs.
function skillQualifies(skill: ResolvedSkill, match: Match): boolean {
  return match.condition === 'color' && (match.value as Color) === skill.color;
}

export interface DamageInfo {
  source: 'match' | 'attacker' | 'bomb'; // MK7.3: the CAUSAL bucket
  label: string;
  programId?: string; // acting Program for Function-caused damage
  critExtra?: number; // portion of `amount` added by the 1.5x multiplier (pre-floor)
  buffBonus?: number; // portion of `amount` contributed by buff tiles
  colorRaw?: number; // MK7.5: pre-floor damage paid via the color axis (Sync cause only)
  shapeRaw?: number; // MK7.5: pre-floor damage paid via the shape axis (Sync cause only)
  cascadeRaw?: number; // MK7.3: pre-floor damage from stochastic-only tiles
  skillRaw?: number; // §6.4: the Hacker-Skill portion of `amount` (its own bucket)
}

export function dealDamage(state: GameState, target: Side, amount: number, info: DamageInfo, events: GameEvent[]): void {
  if (state.winner || amount <= 0) return;

  let finalAmount = amount;
  let buffFinal = info.buffBonus ?? 0;
  let critFinal = info.critExtra;
  let colorFinal = info.colorRaw;
  let shapeFinal = info.shapeRaw;
  let cascadeFinal = info.cascadeRaw;
  let skillFinal = info.skillRaw;

  // §3.1/§9.5: every separate damage instance is reduced by the DEFENDER's
  // live total shield (min 0), AFTER base+buff are computed (already folded
  // into `amount`) but BEFORE LINK/ICE is touched. Shield prevention is NOT
  // damage dealt — reported separately, never added to a damage-source bucket.
  const shield = shieldValue(state, target);
  if (shield > 0) {
    const prevented = Math.min(amount, shield);
    finalAmount = amount - prevented;
    events.push({ t: 'shield', target, source: info.source, preShield: amount, shield, prevented, final: finalAmount });
    // Shield eats the causal (base) portion first and the buff portion last,
    // so the disjoint metric buckets still sum exactly to the dealt amount.
    // Pre-floor analytical splits — including the Skill portion — scale with it.
    const base = amount - (info.buffBonus ?? 0);
    buffFinal = Math.min(info.buffBonus ?? 0, finalAmount);
    const causalFinal = finalAmount - buffFinal;
    const scale = base > 0 ? causalFinal / base : 0;
    if (critFinal !== undefined) critFinal *= scale;
    if (colorFinal !== undefined) colorFinal *= scale;
    if (shapeFinal !== undefined) shapeFinal *= scale;
    if (cascadeFinal !== undefined) cascadeFinal *= scale;
    if (skillFinal !== undefined) skillFinal *= scale;
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
    skillRaw: skillFinal,
  });
  if (state.hp[target] <= 0) {
    state.winner = opponentOf(target);
    state.phase = 'over';
    events.push({ t: 'over', winner: state.winner });
  }
}

// Charge from one sliced Packet in a SYNC step. Owner-scoped: only the
// event-owning side's Programs gain. Cap overflow accumulates into `waste` per
// Program (MK2.3 metric). Bindings come from each unit's resolved Program (one
// or more colors and shapes per Program — a tile pays at most once per axis).
// Neutral Packets pay the DECK, handled once per step by the caller (§7.3).
function chargeFromDestroyedTile(
  state: GameState,
  owner: Side,
  t: Tile,
  axes: Set<MatchCondition>,
  waste: Map<string, number>,
): void {
  if (t.kind === 'neutral') return;
  const singleAxis = state.config.singleAxisPayout;
  const colorPays = !singleAxis || axes.has('color');
  const shapePays = !singleAxis || axes.has('shape');
  for (const u of state.units[owner]) {
    const prog = programById(u.programId);
    let w = 0;
    if (colorPays && prog.colors.includes(t.color!)) w += addUnitCharge(state, u, CHARGE_PER_TILE_COLOR_MATCH);
    if (shapePays && prog.shapes.includes(t.shape!)) w += addUnitCharge(state, u, CHARGE_PER_TILE_SHAPE_MATCH);
    if (w > 0) waste.set(u.programId, (waste.get(u.programId) ?? 0) + w);
  }
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
  cause: 'match' | 'bomb',
  freshIds: Set<number>,
  causeProgramId?: string, // the initiating bomb's Program (bomb cause only)
): { steps: number; stochasticRounds: number } {
  let steps = 0;
  let stochasticRounds = 0;
  const skills = skillsFor(state, owner);
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
    const oppColors = boundColors(opponentOf(owner));
    const oppShapes = boundShapes(opponentOf(owner));

    let raw = 0; // base Sync damage (pre-floor)
    let skillRaw = 0; // §6.4 Skill-originated damage (pre-floor)
    let critExtra = 0; // damage added by the 1.5x multiplier only (pre-floor)
    let contested = 0; // MK5.6: sliced tiles bound to the OPPOSING side's Programs
    let colorRaw = 0; // MK7.5: pre-floor damage paid via the color axis
    let shapeRaw = 0; // MK7.5: pre-floor damage paid via the shape axis
    let cascadeRaw = 0; // MK7.3: pre-floor damage from stochastic-only tiles
    let shieldsRemoved = 0; // MK9.3: shield tiles sliced away this step
    let neutralSliced = 0; // §7.3: neutral Packets sliced this step
    const destroyed: Pt[] = [];
    const waste = new Map<string, number>();
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
      chargeFromDestroyedTile(state, owner, t, axes, waste);
    }

    // ---- §6 Hacker Skills: owner-scoped, once per qualifying Sync event ----
    // Duplicate qualifying Skills stack additively simply by iterating the
    // Hacker's ordered Skill list (repeats are meaningful content, §6.4).
    for (const skill of skills) {
      for (const match of matches) {
        if (!skillQualifies(skill, match)) continue;
        const mult = matchMultiplier(match);
        switch (skill.effectType) {
          case 'SKL_EXTRA_MATCH_DAMAGE': {
            // §6.4 — the bonus joins RAW Sync damage BEFORE the critical
            // multiplier, flooring, Buffer addition, and Shield reduction, so
            // it participates in exactly the damage order the former inherent
            // passive did.
            const add = skill.magnitude * mult;
            skillRaw += add;
            if (mult > 1) critExtra += skill.magnitude * (mult - 1);
            events.push({ t: 'skill', side: owner, skillId: skill.id, effect: skill.effectType, damage: add });
            break;
          }
          case 'SKL_EXTRA_MATCH_CHARGE': {
            // §6.5 — increase this event's normal charge payout, then let the
            // EXISTING distribution rule place it: a color-axis payout reaches
            // every Program bound to that color. No separate universal pool.
            let granted = 0;
            for (const u of state.units[owner]) {
              const prog = programById(u.programId);
              if (!prog.colors.includes(skill.color)) continue;
              const w = addUnitCharge(state, u, skill.magnitude);
              if (w > 0) waste.set(u.programId, (waste.get(u.programId) ?? 0) + w);
              granted += skill.magnitude - w;
            }
            events.push({ t: 'skill', side: owner, skillId: skill.id, effect: skill.effectType, charge: granted });
            break;
          }
        }
      }
    }

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
    // both sides — but the Sync event still exists, so Skill-originated damage
    // still resolves and is attributed to its own metric bucket (§11.3).
    // Charge, destruction, contention, Deck charge, and cascading above are
    // untouched; bomb DETONATIONS are unaffected (resolveDetonation).
    // The buff bonus deliberately does NOT apply here: it amplifies base Sync
    // damage, which is exactly what this mode suppresses.
    const suppressBase = state.config.reinforcedConnection;
    const causalRaw = suppressBase ? skillRaw : raw + skillRaw;
    // Fractional crit sums are floored (documented in README). The Skill
    // portion is allocated as an integer so the disjoint metric buckets stay
    // exact and base Sync damage records as a clean zero under suppression.
    const total = Math.floor(causalRaw);
    const skillPortion = Math.min(total, Math.floor(skillRaw));
    if (total > 0 || (!suppressBase && bonus > 0)) {
      dealDamage(
        state,
        opponentOf(owner),
        total + (suppressBase ? 0 : bonus),
        {
          source: cause, // MK7.3: bucket = initiating cause, not mechanism
          label: owner === 'player' ? 'Hacker Sync' : 'System Sync',
          programId: cause === 'bomb' ? causeProgramId : undefined,
          // Under suppression the crit cross-cut reports 0: the multiplier's
          // contribution to BASE Sync damage is exactly what is suppressed, and
          // the surviving Skill contribution is reported in its own bucket. This
          // never over-reports crit against damage that was not dealt.
          critExtra: suppressBase ? 0 : critExtra,
          buffBonus: suppressBase ? 0 : bonus,
          colorRaw: cause === 'match' && !suppressBase ? colorRaw : undefined,
          shapeRaw: cause === 'match' && !suppressBase ? shapeRaw : undefined,
          cascadeRaw: suppressBase ? 0 : cascadeRaw,
          skillRaw: skillPortion,
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
    { source: 'bomb', label: owner === 'player' ? 'Hacker bomb' : 'System bomb', programId, buffBonus: bonus },
    events,
  );
  if (state.winner) return;

  // MK5.2: a detonation has no "initial Sync" — its entire cascade budget is
  // the cap itself, and at cap 0 even the blast's own refill is constrained.
  // MK7.3: everything descended from the blast carries the 'bomb' cause.
  const cap = state.config.maxCascadeSteps;
  const freshIds = new Set<number>();
  applyGravityAndRefill(state, events, cap !== null && cap <= 0, freshIds);
  resolveCascades(state, owner, events, cap, 'bomb', freshIds, programId);
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
