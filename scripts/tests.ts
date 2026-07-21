// Alpha 0.1.0 §15 — focused tests for the data-driven architecture: loader/
// schema validation (15.1), composition (15.2), area patterns (15.3), Effect
// regression (15.4), settings/persistence (15.5), and version stamps (15.6).
// Pure logic + the shared loader; no browser required. Run with `npm test`.

import { AREA_PATTERNS } from '../src/logic/data/areas';
import { getContent, setActiveContent } from '../src/logic/data/content';
import { DataFiles, loadContent } from '../src/logic/data/load';
import { DEFAULT_BATTLE_CONFIG } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { LOG_VERSION } from '../src/logic/logger';
import { SAVE_VERSION } from '../src/logic/save';
import { GameEvent, Tile } from '../src/logic/types';
import { nodeDataFiles } from './dataNode';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${msg}`);
    console.error(`FAIL ${name}: ${msg}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ---- fixtures ----

const real = nodeDataFiles();

function mutate(text: string, from: string, to: string): string {
  assert(text.includes(from), `fixture mutation target not found: ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

function files(over: Partial<Record<keyof DataFiles, string>>): DataFiles {
  return {
    hacker: { name: real.hacker.name, text: over.hacker ?? real.hacker.text },
    system: { name: real.system.name, text: over.system ?? real.system.text },
    functions: { name: real.functions.name, text: over.functions ?? real.functions.text },
  };
}

const fncRow = (fields: string[]): string => fields.join(',');

function expectErrors(over: Partial<Record<keyof DataFiles, string>>, reasonPart: string, label: string): void {
  const r = loadContent(files(over));
  assert(r.content === null, `${label}: expected load failure, got success`);
  assert(r.errors > 0, `${label}: expected error count > 0`);
  assert(
    r.issues.some((i) => i.severity === 'error' && i.reason.toLowerCase().includes(reasonPart.toLowerCase())),
    `${label}: no error containing ${JSON.stringify(reasonPart)}; got:\n${r.issues.map((i) => i.reason).join('\n')}`,
  );
}

// ---- 15.6 / §13.1 version stamps ----

test('version stamps are alpha-0.1.0', () => {
  assert(SAVE_VERSION === 'alpha-0.1.0', `SAVE_VERSION = ${SAVE_VERSION}`);
  assert(LOG_VERSION === 'alpha-0.1.0', `LOG_VERSION = ${LOG_VERSION}`);
});

// ---- 15.1 loader & schema ----

test('real datasets load with zero errors', () => {
  const r = loadContent(real);
  assert(r.content !== null, `errors: ${r.issues.map((i) => i.reason).join('; ')}`);
  assert(r.errors === 0, 'expected zero errors');
  const c = r.content;
  assert(c.hacker.length === 4 && c.system.length === 4, 'expected 4 programs per side');
  assert(c.functions.size === 9, `expected 9 functions, got ${c.functions.size}`);
  const costs: Record<string, number> = {};
  for (const f of c.functions.values()) costs[f.name] = f.cost;
  // §4.2 approved Alpha costs
  assert(costs.BOMB === 7 && costs.BUFF === 8 && costs.ATTACK === 10 && costs.DRAIN === 9, 'hacker fn costs');
  assert(costs.EBOMB === 7 && costs.SHIELD === 8, 'system fn costs');
});

test('fingerprint is deterministic and ignores notes/formatting (§14.3)', () => {
  const a = loadContent(real).content!;
  const b = loadContent(files({ functions: mutate(real.functions.text, 'player bomb', 'renamed note text') })).content!;
  assert(a.fingerprint === b.fingerprint, 'notes must not change the fingerprint');
  const c = loadContent(files({ functions: mutate(real.functions.text, 'FNC_001,BOMB,7', 'FNC_001,BOMB,8') })).content!;
  assert(a.fingerprint !== c.fingerprint, 'a cost change must change the fingerprint');
});

test('wrong Program side prefix fails', () => {
  const bad = real.hacker.text.trimEnd() + '\n' + 'PRG_S_099,IMP,MAG,DIA,FNC_001,';
  expectErrors({ hacker: bad }, 'wrong Program ID prefix', 'side prefix');
});

test('missing header column fails', () => {
  expectErrors(
    { functions: mutate(real.functions.text, ',magnitude,damage', ',magnitude') },
    'missing required header',
    'missing header',
  );
});

test('duplicate header column fails', () => {
  expectErrors(
    { hacker: mutate(real.hacker.text, 'PRG_ID,name,colors', 'PRG_ID,name,name,colors') },
    'duplicate header',
    'dup header',
  );
});

test('unknown header column fails', () => {
  expectErrors(
    { hacker: mutate(real.hacker.text, ',notes', ',memo') },
    'unknown header',
    'unknown header',
  );
});

test('duplicate IDs across datasets fail', () => {
  const dup = real.functions.text.trimEnd() + '\n' + fncRow(['FNC_001', 'CLONE', '5', 'EFFECT_ATTACK', '', '', '', '', '', '30']);
  expectErrors({ functions: dup }, 'duplicate ID', 'dup id');
});

test('duplicate display names warn but load', () => {
  const dup = real.functions.text.trimEnd() + '\n' + fncRow(['FNC_099', 'BOMB', '5', 'EFFECT_BOMB', '', '1', '2', 'AREA_SQUARE_3X3', '', '']);
  const r = loadContent(files({ functions: dup }));
  assert(r.content !== null, 'duplicate names must still load');
  assert(r.warnings > 0 && r.issues.some((i) => i.severity === 'warning' && i.reason.includes('duplicate display name')), 'expected a name warning');
});

test('unknown color/shape enum values fail', () => {
  expectErrors({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI', 'BOMBER,REX,TRI') }, 'unknown enum', 'unknown color');
  expectErrors({ system: mutate(real.system.text, 'SHIELDER,GRE,SQU', 'SHIELDER,GRE,SQX') }, 'unknown enum', 'unknown shape');
});

test('blank and duplicate colon-list tokens fail', () => {
  expectErrors({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI', 'BOMBER,RED:,TRI') }, 'blank token', 'blank token');
  expectErrors({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI', 'BOMBER,RED:RED,TRI') }, 'duplicate token', 'dup token');
});

test('broken Program→Function reference fails', () => {
  expectErrors({ hacker: mutate(real.hacker.text, 'TRI,FNC_001,', 'TRI,FNC_999,') }, 'unknown Function', 'broken prg ref');
});

test('broken payload reference fails', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_998:FNC_009') }, 'unknown Function ID', 'broken payload ref');
});

test('missing required Effect parameter fails', () => {
  // FNC_001 BOMB loses its quantity
  expectErrors(
    { functions: mutate(real.functions.text, 'player bomb,2,2,AREA_SQUARE_3X3', 'player bomb,,2,AREA_SQUARE_3X3') },
    'missing or invalid required parameter',
    'missing param',
  );
});

test('invalid numeric syntax and ranges fail', () => {
  for (const bad of ['x', '-5', '1.5', '1e3', '0']) {
    expectErrors({ functions: mutate(real.functions.text, 'FNC_001,BOMB,7', `FNC_001,BOMB,${bad}`) }, 'cost', `cost=${bad}`);
  }
  // quantity 0 (required positive) and countdown 0
  expectErrors(
    { functions: mutate(real.functions.text, 'player bomb,2,2,AREA_SQUARE_3X3', 'player bomb,0,2,AREA_SQUARE_3X3') },
    'parameter out of range',
    'quantity 0',
  );
  expectErrors(
    { functions: mutate(real.functions.text, 'player bomb,2,2,AREA_SQUARE_3X3', 'player bomb,2,0,AREA_SQUARE_3X3') },
    'parameter out of range',
    'countdown 0',
  );
});

test('populated unused parameters warn (including numeric 0)', () => {
  // ATTACK claims only damage; populate countdown=2 and magnitude=0
  const t = mutate(real.functions.text, ',direct damage to opponent,,,,,30', ',direct damage to opponent,,2,,0,30');
  const r = loadContent(files({ functions: t }));
  assert(r.content !== null, 'unused params must not block startup');
  const warns = r.issues.filter((i) => i.severity === 'warning' && i.reason.includes('unused'));
  assert(warns.length >= 2, `expected 2 unused-param warnings, got ${warns.length}`);
});

test('unknown Effect ID and unknown area pattern fail', () => {
  expectErrors({ functions: mutate(real.functions.text, 'EFFECT_ATTACK', 'EFFECT_BOOM') }, 'unknown Effect', 'unknown effect');
  expectErrors(
    { functions: mutate(real.functions.text, 'AREA_SQUARE_3X3_CARDINAL_2', 'AREA_MEGA') },
    'unknown area pattern',
    'unknown area',
  );
});

test('diagnostics carry source context (§10.3)', () => {
  const r = loadContent(files({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI', 'BOMBER,REX,TRI') }));
  const issue = r.issues.find((i) => i.severity === 'error');
  assert(issue, 'expected an error issue');
  assert(issue.dataset === 'hacker-programs', 'dataset identity');
  assert(issue.file === real.hacker.name, 'source filename');
  assert(typeof issue.row === 'number' && issue.row >= 2, 'one-based source row');
  assert(issue.field === 'colors', 'field');
  assert(issue.id === 'PRG_H_001', 'record id');
});

test('any error yields null content — no partial roster, no fallback (§10.2)', () => {
  const r = loadContent(files({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI', 'BOMBER,REX,TRI') }));
  assert(r.content === null, 'content must be null on any error');
});

test('required Alpha records must be present (§6.3/6.4)', () => {
  // drop the FNC_009 row entirely
  const lines = real.functions.text.trimEnd().split('\n');
  const t = lines.filter((l) => !l.startsWith('FNC_009')).join('\n');
  expectErrors({ functions: t }, 'required Alpha 0.1.0 record is missing', 'required records');
});

// ---- 15.2 composition (validation half) ----

test('mixed Effect/Function payloads fail', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'EFFECT_BOMB:FNC_009') }, 'may not mix', 'mixed payload');
});

test('self-reference fails', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_007') }, 'self-reference', 'self ref');
});

test('composite-to-composite nesting (and thus cycles) fails', () => {
  const t = real.functions.text.trimEnd() + '\n' + fncRow(['FNC_010', 'SHOWTWO', '9', 'FNC_007', '', '', '', '', '', '']);
  expectErrors({ functions: t }, 'may not reference another composite', 'composite nesting');
});

test('two Drain operations in one expanded payload fail', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_004:FNC_004') }, 'Drain', 'two drains');
});

test('non-random targeted operation after position one fails', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_008:FNC_004') }, 'first expanded operation', 'targeted order');
});

// ---- 15.3 area patterns ----

test('area patterns have the exact §8 coordinate sets', () => {
  const key = (o: { x: number; y: number }): string => `${o.x},${o.y}`;
  const setOf = (id: keyof typeof AREA_PATTERNS): Set<string> => new Set(AREA_PATTERNS[id].map(key));
  assert(AREA_PATTERNS.AREA_SELF.length === 1 && setOf('AREA_SELF').has('0,0'), 'AREA_SELF');
  assert(AREA_PATTERNS.AREA_CARDINAL_1.length === 5, 'AREA_CARDINAL_1 size');
  const sq = setOf('AREA_SQUARE_3X3');
  assert(AREA_PATTERNS.AREA_SQUARE_3X3.length === 9, 'AREA_SQUARE_3X3 size');
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) assert(sq.has(`${x},${y}`), `3x3 missing ${x},${y}`);
  const ext = setOf('AREA_SQUARE_3X3_CARDINAL_2');
  assert(AREA_PATTERNS.AREA_SQUARE_3X3_CARDINAL_2.length === 13, '13 cells at board center');
  for (const c of ['0,-2', '2,0', '0,2', '-2,0']) assert(ext.has(c), `extended missing ${c}`);
  for (const c of ['2,2', '-2,2', '2,-2', '-2,-2']) assert(!ext.has(c), `unintended distance-2 diagonal ${c}`);
  // no duplicates in any pattern (sets resolve at most once)
  for (const id of Object.keys(AREA_PATTERNS) as (keyof typeof AREA_PATTERNS)[]) {
    assert(new Set(AREA_PATTERNS[id].map(key)).size === AREA_PATTERNS[id].length, `${id} has duplicate coordinates`);
  }
});

// ---- gameplay fixtures ----

function install(over?: Partial<Record<keyof DataFiles, string>>): void {
  const r = loadContent(over ? files(over) : real);
  assert(r.content !== null, `fixture content failed to load: ${r.issues.map((i) => i.reason).join('; ')}`);
  setActiveContent(r.content);
}

function newGame(seed = 7, cfg = DEFAULT_BATTLE_CONFIG): Game {
  const g = new Game({ ...cfg }, seed);
  g.startPlayerPhase();
  return g;
}

function chargeSlot(g: Game, side: 'player' | 'enemy', idx: number): void {
  const u = g.state.units[side][idx];
  u.charge = getContent().programsById.get(u.programId)!.chargeCap;
}

function specialsOf(g: Game, type: 'bomb' | 'buff' | 'shield', owner: 'player' | 'enemy'): Tile[] {
  const out: Tile[] = [];
  for (const row of g.state.board) for (const t of row) if (t?.special?.type === type && t.special.owner === owner) out.push(t);
  return out;
}

function firstDamageAfterDetonate(events: GameEvent[]): Extract<GameEvent, { t: 'damage' }> | null {
  let seen = false;
  for (const ev of events) {
    if (ev.t === 'detonate') seen = true;
    else if (seen && ev.t === 'damage') return ev;
  }
  return null;
}

// place a special directly (test-state surgery; pure logic)
function plantSpecial(g: Game, x: number, y: number, special: Omit<Tile['special'] & object, 'seq'>): void {
  const t = g.state.board[y][x]!;
  t.kind = 'standard';
  t.color = t.color ?? 0;
  t.shape = t.shape ?? 0;
  t.special = { ...special, seq: g.state.nextSeq++ } as Tile['special'];
}

// ---- 15.4 Effect regression (real data) ----

install();

test('FNC_001: player Bomber costs 7, places two 2-turn AREA_SQUARE_3X3 bombs', () => {
  const g = newGame(11);
  chargeSlot(g, 'player', 0);
  const ev = g.fireProgram(0);
  assert(ev.some((e) => e.t === 'ability' && e.programId === 'PRG_H_001' && e.fn === 'FNC_001'), 'ability event');
  const placed = ev.find((e) => e.t === 'placed' && e.kind === 'bomb');
  assert(placed && placed.t === 'placed' && placed.count === 2, 'two bombs placed');
  assert(g.state.units.player[0].charge === 0, 'cost 7 spent from cap 7');
  const bombs = specialsOf(g, 'bomb', 'player');
  assert(bombs.length === 2, 'two bomb tiles on board');
  for (const b of bombs) {
    assert(b.special!.countdown === 2, `countdown ${b.special!.countdown} !== 2`);
    assert(b.special!.areaPattern === 'AREA_SQUARE_3X3', 'player bomb footprint');
    assert(b.special!.programId === 'PRG_H_001', 'bomb attribution');
  }
});

test('FNC_002: Buffer costs 8, places one magnitude-5 buff tile; buff adds to Attack', () => {
  const g = newGame(12);
  chargeSlot(g, 'player', 1);
  g.fireProgram(1);
  const buffs = specialsOf(g, 'buff', 'player');
  assert(buffs.length === 1 && buffs[0].special!.magnitude === 5, 'one magnitude-5 buff');
  chargeSlot(g, 'player', 2);
  const ev = g.fireProgram(2);
  const dmg = ev.find((e) => e.t === 'damage');
  assert(dmg && dmg.t === 'damage' && dmg.amount === 35 && dmg.buffBonus === 5, `attack+buff = 35, got ${JSON.stringify(dmg)}`);
});

test('FNC_003: Attack costs 10 and deals 30 base direct damage', () => {
  const g = newGame(13);
  chargeSlot(g, 'player', 2);
  const ev = g.fireProgram(2);
  const dmg = ev.find((e) => e.t === 'damage');
  assert(dmg && dmg.t === 'damage' && dmg.target === 'enemy' && dmg.source === 'attacker' && dmg.amount === 30, 'attack 30');
  assert(g.state.hp.enemy === DEFAULT_BATTLE_CONFIG.enemyHp - 30, 'enemy HP reduced');
  assert(g.state.units.player[2].charge === 0, 'cost 10 spent');
});

test('FNC_004: Hacker Drain uses the chosen target (valid even at 0 charge)', () => {
  const g = newGame(14);
  g.state.units.enemy[0].charge = 3;
  g.state.units.enemy[1].charge = 5;
  chargeSlot(g, 'player', 3);
  // untargeted fire must be rejected for a targeted Program
  assert(g.fireProgram(3).length === 0, 'targeted Program requires a target');
  const ev = g.fireProgram(3, 1);
  assert(g.state.units.enemy[1].charge === 0, 'chosen target drained');
  assert(g.state.units.enemy[0].charge === 3, 'other slots untouched');
  const op = ev.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN');
  assert(op && op.t === 'op' && op.drained === 5 && op.resolved, 'drain op event');
  // 0-charge target is still valid
  const g2 = newGame(15);
  chargeSlot(g2, 'player', 3);
  const ev2 = g2.fireProgram(3, 2);
  const op2 = ev2.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN');
  assert(op2 && op2.t === 'op' && op2.drained === 0 && op2.resolved, '0-charge target drains 0 but resolves');
});

test('System Drain: tier A prefers FULLY CHARGED over higher partial charge', () => {
  const g = newGame(16);
  chargeSlot(g, 'enemy', 3); // System DISABLER ready
  g.state.units.player[0].charge = 7; // BOMBER full (cap 7)
  g.state.units.player[3].charge = 8; // DISABLER partial (cap 9) — higher raw charge
  g.runEnemyPhase();
  assert(g.state.units.player[0].charge === 0, 'fully charged BOMBER drained (tier A)');
  assert(g.state.units.player[3].charge === 8, 'higher-partial DISABLER untouched');
});

test('System Drain: tier C falls back to highest partial charge', () => {
  const g = newGame(17);
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[1].charge = 6; // BUFFER partial (cap 8)
  g.state.units.player[2].charge = 4; // ATTACK partial
  g.runEnemyPhase();
  assert(g.state.units.player[1].charge === 0, 'highest partial drained');
  assert(g.state.units.player[2].charge === 4, 'lower partial untouched');
});

test('System Drain: residual charge tie breaks by highest cost', () => {
  const g = newGame(18);
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[0].charge = 5; // BOMBER cost 7
  g.state.units.player[3].charge = 5; // DISABLER cost 9 — higher cost wins
  g.runEnemyPhase();
  assert(g.state.units.player[3].charge === 0, 'higher-cost program drained on tie');
  assert(g.state.units.player[0].charge === 5, 'lower-cost program untouched');
});

test('System Drain WITHHOLD: no charged target → no activation, charge preserved', () => {
  const g = newGame(19);
  chargeSlot(g, 'enemy', 3); // DISABLER at cap 9
  // all player programs at 0 charge
  const ev = g.runEnemyPhase();
  assert(!ev.some((e) => e.t === 'ability' && e.side === 'enemy'), 'no System activation');
  assert(g.state.units.enemy[3].charge === 9, 'charge preserved, not spent on a no-op');
  assert(ev.some((e) => e.t === 'msg' && e.text.includes('holds')), 'withhold is surfaced in the log');
});

test('FNC_005: E-Bomb costs 7, places one 3-turn AREA_SQUARE_3X3_CARDINAL_2 bomb', () => {
  const g = newGame(20);
  chargeSlot(g, 'enemy', 0);
  const ev = g.runEnemyPhase();
  const placed = ev.find((e) => e.t === 'placed' && e.kind === 'bomb');
  assert(placed && placed.t === 'placed' && placed.count === 1, 'one bomb placed');
  const bombs = specialsOf(g, 'bomb', 'enemy');
  assert(bombs.length === 1, 'one enemy bomb');
  assert(bombs[0].special!.countdown === 3, 'countdown 3');
  assert(bombs[0].special!.areaPattern === 'AREA_SQUARE_3X3_CARDINAL_2', 'extended footprint');
});

test('FNC_006: Shielder costs 8, places two magnitude-2 shield tiles', () => {
  const g = newGame(21);
  chargeSlot(g, 'enemy', 1);
  const ev = g.runEnemyPhase();
  const placed = ev.find((e) => e.t === 'placed' && e.kind === 'shield');
  assert(placed && placed.t === 'placed' && placed.count === 2, 'two shields placed');
  const shields = specialsOf(g, 'shield', 'enemy');
  assert(shields.length === 2 && shields.every((s) => s.special!.magnitude === 2), 'two magnitude-2 shields');
});

test('shield reduces each separate incoming instance independently, min 0 (§9.5)', () => {
  const g = newGame(22);
  // 2 shields (4 points) via state surgery on non-special standard tiles
  let planted = 0;
  outer: for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const t = g.state.board[y][x]!;
      if (t.kind === 'standard' && !t.special) {
        plantSpecial(g, x, y, { type: 'shield', owner: 'enemy', magnitude: 2, programId: 'PRG_S_002' });
        if (++planted === 2) break outer;
      }
    }
  }
  chargeSlot(g, 'player', 2);
  const ev1 = g.fireProgram(2);
  const s1 = ev1.find((e) => e.t === 'shield');
  assert(s1 && s1.t === 'shield' && s1.preShield === 30 && s1.shield === 4 && s1.prevented === 4 && s1.final === 26, `first instance: ${JSON.stringify(s1)}`);
  const hpAfter1 = g.state.hp.enemy;
  assert(hpAfter1 === DEFAULT_BATTLE_CONFIG.enemyHp - 26, 'dealt 26');
  // second instance is reduced independently by the same live shield
  chargeSlot(g, 'player', 2);
  const ev2 = g.fireProgram(2);
  const s2 = ev2.find((e) => e.t === 'shield');
  assert(s2 && s2.t === 'shield' && s2.prevented === 4 && s2.final === 26, 'second instance reduced independently');
  // min 0: overwhelm with shields so 30 damage is fully absorbed
  for (let y = 0; y < 8 && shieldTotal(g) < 32; y++) {
    for (let x = 0; x < 8 && shieldTotal(g) < 32; x++) {
      const t = g.state.board[y][x]!;
      if (t.kind === 'standard' && !t.special) plantSpecial(g, x, y, { type: 'shield', owner: 'enemy', magnitude: 2, programId: 'PRG_S_002' });
    }
  }
  const hpBefore = g.state.hp.enemy;
  chargeSlot(g, 'player', 2);
  const ev3 = g.fireProgram(2);
  const s3 = ev3.find((e) => e.t === 'shield');
  assert(s3 && s3.t === 'shield' && s3.final === 0, 'fully absorbed instance reports final 0');
  assert(!ev3.some((e) => e.t === 'damage'), 'no damage event when fully absorbed');
  assert(g.state.hp.enemy === hpBefore, 'HP unchanged when fully absorbed');

  function shieldTotal(gg: Game): number {
    return specialsOf(gg, 'shield', 'enemy').reduce((a, t) => a + (t.special!.magnitude ?? 0), 0);
  }
});

test('detonation uses the bomb-owned footprint, clips at edges, owner strength applies', () => {
  // corner clip: 3x3 at (0,0) → exactly 4 in-bounds cells
  const g = newGame(23);
  plantSpecial(g, 0, 0, { type: 'bomb', owner: 'player', countdown: 1, areaPattern: 'AREA_SQUARE_3X3', programId: 'PRG_H_001' });
  const ev = g.startPlayerPhase();
  const det = ev.find((e) => e.t === 'detonate');
  assert(det && det.t === 'detonate', 'detonated');
  const cellKeys = new Set(det.cells.map((c) => `${c.x},${c.y}`));
  assert(det.cells.length === 4, `corner 3x3 clips to 4 cells, got ${det.cells.length}`);
  for (const k of ['0,0', '1,0', '0,1', '1,1']) assert(cellKeys.has(k), `missing ${k}`);

  // owner strength: 9 Red tiles under a player 3x3 bomb → 9×2=18 (Red is
  // player-strong); the same board under an enemy bomb → 9×1=9
  const strengths: Array<{ owner: 'player' | 'enemy'; expected: number }> = [
    { owner: 'player', expected: 18 },
    { owner: 'enemy', expected: 9 },
  ];
  for (const { owner, expected } of strengths) {
    const gg = newGame(24);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = gg.state.board[4 + dy][4 + dx]!;
        t.kind = 'standard';
        t.color = 0; // Red — HIGH for player, LOW for enemy (default strong sets)
        t.shape = ((dx + 1) + (dy + 1) * 3) % 6; // varied shapes, no shape runs
        t.special = undefined;
      }
    }
    plantSpecial(gg, 4, 4, { type: 'bomb', owner, countdown: 1, areaPattern: 'AREA_SQUARE_3X3', programId: owner === 'player' ? 'PRG_H_001' : 'PRG_S_001' });
    const evs = owner === 'player' ? gg.startPlayerPhase() : gg.runEnemyPhase();
    const dmg = firstDamageAfterDetonate(evs);
    assert(dmg, `${owner} blast produced damage`);
    assert(dmg.amount === expected, `${owner} blast: expected ${expected}, got ${dmg.amount}`);
    assert(dmg.source === 'bomb', 'bomb source bucket');
  }
});

test('E-Bomb footprint reaches distance-2 cardinals, no distance-2 diagonals (runtime)', () => {
  const g = newGame(25);
  plantSpecial(g, 4, 4, { type: 'bomb', owner: 'enemy', countdown: 1, areaPattern: 'AREA_SQUARE_3X3_CARDINAL_2', programId: 'PRG_S_001' });
  const ev = g.runEnemyPhase();
  const det = ev.find((e) => e.t === 'detonate');
  assert(det && det.t === 'detonate' && det.cells.length === 13, `13 cells at center, got ${det && det.t === 'detonate' ? det.cells.length : 'none'}`);
  const keys = new Set(det.cells.map((c) => `${c.x},${c.y}`));
  for (const k of ['4,2', '6,4', '4,6', '2,4']) assert(keys.has(k), `missing cardinal-2 cell ${k}`);
  for (const k of ['2,2', '6,6', '2,6', '6,2']) assert(!keys.has(k), `unintended diagonal-2 cell ${k}`);
});

// ---- 15.2 composition (execution half, synthetic content) ----

test('FNC_007: composite resolves children in order, pays cost 9 once (§7.2)', () => {
  install({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI,FNC_001', 'BOMBER,RED,TRI,FNC_007') });
  const g = newGame(30);
  chargeSlot(g, 'player', 0); // cap = SHOWCASE cost 9
  assert(g.state.units.player[0].charge === 9, 'cap follows the assigned Function cost');
  const ev = g.fireProgram(0);
  const abilities = ev.filter((e) => e.t === 'ability');
  assert(abilities.length === 1, 'exactly one parent activation');
  const ops = ev.filter((e) => e.t === 'op');
  assert(ops.length === 2, 'two child ops attempted');
  assert(ops[0].t === 'op' && ops[0].fnId === 'FNC_008' && ops[0].effectId === 'EFFECT_BOMB', 'FNC_008 first');
  assert(ops[1].t === 'op' && ops[1].fnId === 'FNC_009' && ops[1].effectId === 'EFFECT_SHIELD', 'FNC_009 second');
  const chargeAfter: number = g.state.units.player[0].charge; // fresh read (fireProgram mutated it)
  assert(chargeAfter === 0, 'parent cost 9 paid once; child costs (5+5) ignored');
  const bombs = specialsOf(g, 'bomb', 'player');
  assert(bombs.length === 1 && bombs[0].special!.countdown === 2 && bombs[0].special!.areaPattern === 'AREA_SQUARE_3X3', 'ONEBOMB params');
  const shields = specialsOf(g, 'shield', 'player');
  assert(shields.length === 1 && shields[0].special!.magnitude === 2, 'ONESHIELD params');
  const m = g.state.metrics.sides.player.units['PRG_H_001'];
  assert(m.fires === 1 && m.ops === 2 && m.fizzles === 0, 'composite metrics: 1 activation, 2 ops (§7.5)');
});

test('a legal fizzle in one child still attempts the next child (§7.4)', () => {
  install({ hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI,FNC_001', 'BOMBER,RED,TRI,FNC_007') });
  const g = newGame(31);
  // no valid placement targets anywhere: make every tile neutral
  for (const row of g.state.board) {
    for (const t of row) {
      t!.kind = 'neutral';
      t!.color = undefined;
      t!.shape = undefined;
      t!.special = undefined;
    }
  }
  chargeSlot(g, 'player', 0);
  const ev = g.fireProgram(0);
  const ops = ev.filter((e) => e.t === 'op');
  assert(ops.length === 2, 'both children attempted despite fizzles');
  assert(ops.every((o) => o.t === 'op' && !o.resolved), 'both ops legally fizzled');
  const m = g.state.metrics.sides.player.units['PRG_H_001'];
  assert(m.fires === 1 && m.fizzles === 2, 'fizzles recorded distinctly from activations');
  assert(g.state.units.player[0].charge === 0, 'cost still spent on legal fizzle');
});

test('repeated leaf IDs in a composite execute repeatedly (§7.2 rule 9)', () => {
  install({
    hacker: mutate(real.hacker.text, 'BOMBER,RED,TRI,FNC_001', 'BOMBER,RED,TRI,FNC_007'),
    functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_008:FNC_008'),
  });
  const g = newGame(32);
  chargeSlot(g, 'player', 0);
  const ev = g.fireProgram(0);
  const ops = ev.filter((e) => e.t === 'op' && e.effectId === 'EFFECT_BOMB');
  assert(ops.length === 2, 'repeated child executed twice');
  assert(specialsOf(g, 'bomb', 'player').length === 2, 'two bombs from two 1-bomb children');
});

// restore real content for anything after
install();

// ---- 15.5 settings & persistence (browser-storage migration, mocked) ----

await (async () => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const { loadMenuConfig } = await import('../src/storage');
  test('obsolete persisted cost settings are ignored without crashing (§4.5)', () => {
    store.set(
      'breach:config',
      JSON.stringify({
        enemyMatching: true,
        hackerBonusEnabled: false,
        singleAxisPayout: false,
        maxCascadeSteps: 0,
        noMatchDamage: false,
        playerHp: 150,
        enemyHp: 150,
        abilityCosts: { bomber: 7, buffer: 13, attacker: 19, disabler: 22 }, // obsolete
        flatAbilityCost: true, // obsolete
        hintEnabled: false,
        hintDelaySeconds: 7,
        nmdChargeAwareBot: true,
        strongColors: { player: [0, 1, 2], enemy: [3, 4, 5] },
        strongShapes: { player: [1, 5, 3], enemy: [2, 4, 0] },
        cfgV: 3,
      }),
    );
    const cfg = loadMenuConfig();
    assert(cfg.enemyMatching === true, 'surviving fields preserved');
    assert(!('abilityCosts' in cfg) && !('flatAbilityCost' in cfg), 'obsolete fields dropped');
    const resaved = JSON.parse(store.get('breach:config')!) as Record<string, unknown>;
    assert(resaved.cfgV === 4, 'config re-stamped to Alpha version');
    assert(!('abilityCosts' in resaved), 'obsolete fields not re-persisted');
  });
})();

// ---- summary ----

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
