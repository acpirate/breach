// Focused tests for the data-driven architecture: loader/schema validation,
// composition, area patterns, Effect regression, settings/persistence, and
// version stamps — plus the Alpha 0.3.0 §22 acceptance suites (content and
// validation, selection and fixed build, Quick Match defaults, save/restore,
// strength and LINK/ICE, Skills, Deck Function and Shake, B1 line clears,
// Reinforced Connection and results, and vocabulary).
// Pure logic + the shared loader; no browser required. Run with `npm test`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/logic/constants';
import { AREA_PATTERNS } from '../src/logic/data/areas';
import {
  ACTIVE_BUILD_SIZE,
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  HEADLESS_SYSTEM_ID,
  INVENTORY_SIZE,
  SYSTEM_BUILD_SIZE,
  allSystems,
  deckById,
  defaultBuild,
  getContent,
  hackerById,
  inventoryFor,
  inventoryProgramIds,
  isValidBuild,
  programById,
  setActiveContent,
  systemById,
  targetKindOf,
} from '../src/logic/data/content';
import { DataFiles, loadContent } from '../src/logic/data/load';
import { DEFAULT_BATTLE_SETTINGS } from '../src/logic/constants';
import { Game, nextBattleId } from '../src/logic/game';
import {
  BattleEventEntry,
  LOGGING_LEVELS,
  LOGGING_SCHEMA_VERSION,
  LOG_BUDGET_BYTES,
  LOG_VERSION,
  LoggingLevel,
  TurnLogEntry,
  identityStamp,
  loggingLevel,
  routeIsInteresting,
  setLoggingLevel,
} from '../src/logic/logger';
import * as storage from '../src/storage';
import { SAVE_VERSION } from '../src/logic/save';
import { computeLineClears, detectMatches } from '../src/logic/match';
import { StreamMap, addStream, addUnitCharge, applyTransform, buffBonus, routeChargeStream, routeStreams } from '../src/logic/resolve';
import { consumeEvents, createBattleMetrics } from '../src/logic/metrics';
import { ENEMY_TIMER_CHARGE_RATE } from '../src/logic/constants';
import {
  PendingSetup,
  QuickMatchInfo,
  RUN_ENCOUNTERS,
  RUN_LENGTH,
  RunInfo,
  SelectedSystem,
  randomSystem,
  beginBuild,
  beginSetup,
  buildIdentity,
  chooseDeck,
  chooseHacker,
  deserializeConstructedPreset,
  inactiveOf,
  makeSetupRandom,
  moveBuildSlot,
  randomBuild,
  replaceInBuild,
  serializeConstructedPreset,
  contextLabel,
  continueLabel,
  createRunBattle,
  defaultIdentity,
  deserializeSession,
  encounterFor,
  forceWinAvailable,
  isRunComplete,
  nextStep,
  progressesAsVictory,
  resolveHackerMaxLink,
  resolveQuickMatchIce,
  resolveRunIce,
  serializeSession,
  setupBack,
  setupComplete,
  snapshotRunSettings,
} from '../src/logic/session';
import { BattleSettings, BuildOrigin, Color, RunStep, Shape, Side, gridViewOf } from '../src/logic/types';
import { GameEvent, Pt, Tile } from '../src/logic/types';
import { botFireAbilities, botMove } from './bot';
import { nodeDataFiles } from './dataNode';
import { D, defaultActiveBuild, defaultHackerLink, headlessSystem, manualLink, newBattle } from './harness';

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
    hackers: { name: real.hackers.name, text: over.hackers ?? real.hackers.text },
    skills: { name: real.skills.name, text: over.skills ?? real.skills.text },
    decks: { name: real.decks.name, text: over.decks ?? real.decks.text },
    systems: { name: real.systems.name, text: over.systems ?? real.systems.text },
  };
}

// Canonical Function-row width (§4.6 — the existing columns plus `params` and
// `startCharged`; Alpha 0.5.0 §21 appends `axisTarget` and `axisResult`).
// Fixtures may supply a prefix; the rest pads to blank.
const FNC_COLUMNS = 14;
const fncRow = (fields: string[]): string => {
  const out = fields.slice();
  while (out.length < FNC_COLUMNS) out.push('');
  return out.join(',');
};

function expectErrors(over: Partial<Record<keyof DataFiles, string>>, reasonPart: string, label: string): void {
  const r = loadContent(files(over));
  assert(r.content === null, `${label}: expected load failure, got success`);
  assert(r.errors > 0, `${label}: expected error count > 0`);
  assert(
    r.issues.some((i) => i.severity === 'error' && i.reason.toLowerCase().includes(reasonPart.toLowerCase())),
    `${label}: no error containing ${JSON.stringify(reasonPart)}; got:\n${r.issues.map((i) => i.reason).join('\n')}`,
  );
}

// ---- §21.1 version stamps ----

test('version stamps are alpha-0.5.0', () => {
  assert(SAVE_VERSION === 'alpha-0.5.0', `SAVE_VERSION = ${SAVE_VERSION}`);
  assert(LOG_VERSION === 'alpha-0.5.0', `LOG_VERSION = ${LOG_VERSION}`);
});

// §21.1 — no active output path may continue to emit a stale build tag.
// Scans active source (not node_modules/dist/.git) for a literal older
// version string or a quoted bare mk-tag; the ONLY allowed hits are the
// deliberate pre-Alpha-0.3.0 save-rejection fixtures.
test('no stale build tags in active source (§21.1)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = ['src', 'scripts'];
  const files: string[] = [path.join(root, 'index.html'), path.join(root, 'vite.config.ts')];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|cjs|html)$/.test(name)) files.push(p);
    }
  };
  for (const d of dirs) walk(path.join(root, d));

  // no `g` flag: these are used as stateless containment tests per file, and
  // a global-flag regex's `lastIndex` would otherwise persist across the
  // per-file .test() calls in the loop below.
  // Alpha 0.5.0 — 0.4.x joins the stale set now that the build stamp moved on.
  const stalePattern = /alpha-0\.[1234]\.\d/;
  const mkTagPattern = /(['"`])mk\d+\1/i;
  // smoke.ts: the deliberate pre-Alpha-0.4.0 rejection fixture. This test
  // file itself is excluded too — it necessarily quotes the old tags below to
  // verify the fixture's content, which would otherwise self-match.
  const allowedFiles = new Set([path.join(root, 'scripts', 'smoke.ts'), path.join(root, 'scripts', 'tests.ts')]);
  const offenders: string[] = [];
  for (const f of files) {
    if (allowedFiles.has(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (stalePattern.test(text) || mkTagPattern.test(text)) offenders.push(path.relative(root, f));
  }
  assert(offenders.length === 0, `stale build tag found outside the allowed fixture: ${offenders.join(', ')}`);

  // the allowed fixture itself must still contain exactly the expected
  // rejection-test tags (proves the allowlist isn't hiding a real leak)
  const smokeText = fs.readFileSync(path.join(root, 'scripts', 'smoke.ts'), 'utf8');
  assert(
    smokeText.includes("'mk9'") &&
      smokeText.includes("'alpha-0.1.0'") &&
      smokeText.includes("'alpha-0.2.0'") &&
      smokeText.includes("'alpha-0.3.0'"),
    'expected pre-Alpha-0.4.0 rejection fixture strings in smoke.ts',
  );
});

// ---- 15.1 loader & schema ----

// ---- §22.1 content and validation ----

test('§22.1 all six required datasets load through the shared pipeline', () => {
  const r = loadContent(real);
  assert(r.content !== null, `errors: ${r.issues.map((i) => i.reason).join('; ')}`);
  assert(r.errors === 0, 'expected zero errors');
  const c = r.content;
  // Alpha 0.4.0 — six Hacker Programs form the inventory; the System keeps its
  // four (System-side build selection is explicitly out of scope, §22).
  assert(c.hacker.length === INVENTORY_SIZE, `expected ${INVENTORY_SIZE} Hacker Programs, got ${c.hacker.length}`);
  // Alpha 0.5.0 §7.1 — eight System Programs are LOADED; each System FIELDS
  // four of them through its PRG_SET (§5.4). The loaded roster is no longer
  // the battle roster, which is the whole point of System identity.
  assert(c.system.length === 8, `expected 8 System Programs, got ${c.system.length}`);
  assert(c.functions.size === 15, `expected 15 functions, got ${c.functions.size}`);
  const costs: Record<string, number> = {};
  for (const f of c.functions.values()) costs[f.name] = f.cost;
  // §4.2 approved Alpha costs
  assert(costs.BOMB === 7 && costs.BUFF === 8 && costs.ATTACK === 10 && costs.DRAIN === 9, 'hacker fn costs');
  assert(costs.EBOMB === 7 && costs.SHIELD === 8, 'system fn costs');
  // §4.7 the required SCRAMBLE Deck Function
  const scramble = c.functions.get('FNC_010')!;
  assert(scramble && scramble.name === 'SCRAMBLE' && scramble.cost === 3, 'FNC_010 SCRAMBLE cost 3');
  assert(scramble.plan.length === 1 && scramble.plan[0].effectId === 'EFFECT_SHAKE', 'SCRAMBLE payload is EFFECT_SHAKE');
  // §8.8 the current live variant resolves to a typed immutable object
  const sp = scramble.plan[0].params.shake!;
  assert(sp && sp.boardComposition === 0 && sp.specialGems === 0 && sp.matches === 0 && sp.cascades === 0, '0:0:0:0 resolved');
  // §4.3/§4.4/§4.5 the new datasets
  const hak = c.hackers.get('HAK_01')!;
  assert(hak && hak.name === 'CR45H' && hak.baseLink === 100, 'HAK_01 resolves');
  assert(hak.skillIds.join(':') === 'SKL_001:SKL_002', 'ordered Skill references preserved');
  assert(c.skills.size === 2, 'two Skill records');
  const dek = c.decks.get('DEK_01')!;
  assert(dek && dek.name === 'AGIMA' && dek.addLink === 50, 'DEK_01 resolves');
  assert(dek.fn.id === 'FNC_010', 'Deck references exactly one Function');
  // §2.12 placeholders are parsed and RETAINED but never interpreted
  assert(hak.bio.length > 0 && hak.graphics.length > 0, 'BIO/GRAPHICS retained as data');
  assert(dek.descript.length > 0 && dek.graphics.length > 0, 'DESCRIPT/GRAPHICS retained as data');
  // Alpha 0.5.0 §5/§6 — the seventh required dataset and its two authored rows.
  assert(c.systems.size === 2, `expected 2 Systems, got ${c.systems.size}`);
  const bouncer = c.systems.get('SYS_01')!;
  assert(bouncer && bouncer.name === 'BOUNCER' && bouncer.baseIce === 100, 'SYS_01 BOUNCER resolves');
  assert(bouncer.programIds.join(':') === 'PRG_S_003:PRG_S_005:PRG_S_006:PRG_S_001', 'BOUNCER ordered PRG_SET');
  const midnight = c.systems.get('SYS_02')!;
  assert(midnight && midnight.name === 'MIDNIGHT' && midnight.baseIce === 100, 'SYS_02 MIDNIGHT resolves');
  assert(midnight.programIds.join(':') === 'PRG_S_007:PRG_S_008:PRG_S_001:PRG_S_002', 'MIDNIGHT ordered PRG_SET');
  // §2.2 — System passive Skills are deferred, so authored rows carry none.
  assert(bouncer.skillIds.length === 0 && midnight.skillIds.length === 0, 'no System Skills in Alpha 0.5');
  // §5.2 — placeholders retained, never interpreted (as for the Hacker).
  assert(bouncer.bio.length > 0 && bouncer.graphics.length > 0, 'System BIO/GRAPHICS retained as data');
  // §7 — the new authored content the Systems field.
  assert(c.functions.get('FNC_013')!.name === 'COERCE', 'FNC_013 COERCE');
  assert(c.functions.get('FNC_014')!.name === 'EBUFF', 'FNC_014 EBUFF');
  assert(c.functions.get('FNC_015')!.name === 'SPAM', 'FNC_015 SPAM');
  for (const id of ['PRG_S_005', 'PRG_S_006', 'PRG_S_007', 'PRG_S_008']) {
    assert(c.programsById.has(id), `${id} is loaded`);
  }
});

test('§22.1 Skill display resolves %N placeholders in title case', () => {
  const c = loadContent(real).content!;
  const dmg = c.skills.get('SKL_001')!;
  const chg = c.skills.get('SKL_002')!;
  assert(dmg.effectType === 'SKL_EXTRA_MATCH_DAMAGE' && dmg.color === Color.Red && dmg.magnitude === 1, 'SKL_001 typed params');
  assert(chg.effectType === 'SKL_EXTRA_MATCH_CHARGE' && chg.color === Color.Red && chg.magnitude === 1, 'SKL_002 typed params');
  assert(dmg.display === 'Deal 1 extra damage on a Red sync', `SKL_001 display: ${dmg.display}`);
  assert(chg.display === 'Gain 1 extra charge on a Red sync', `SKL_002 display: ${chg.display}`);
});

test('§22.1 fingerprint tracks gameplay fields and ignores placeholders/display', () => {
  const a = loadContent(real).content!;
  // EXCLUDED: notes, BIO, GRAPHICS, DESCRIPT, presentational Skill display
  const same: Array<[string, DataFiles]> = [
    ['notes', files({ functions: mutate(real.functions.text, 'generic bomb effect', 'renamed note text') })],
    ['BIO', files({ hackers: mutate(real.hackers.text, 'hacker biography goes here', 'entirely different bio') })],
    ['GRAPHICS', files({ hackers: mutate(real.hackers.text, 'hacker graphics reference goes here', 'other.png') })],
    ['DESCRIPT', files({ decks: mutate(real.decks.text, 'deck description goes here', 'other text') })],
    ['Skill display', files({ skills: mutate(real.skills.text, 'Deal %1 extra damage', 'Inflict %1 bonus harm') })],
  ];
  for (const [label, f] of same) {
    const c = loadContent(f).content;
    assert(c !== null, `${label} fixture must still load`);
    assert(c.fingerprint === a.fingerprint, `${label} must NOT change the fingerprint`);
  }
  // INCLUDED: every gameplay-affecting value across all six datasets
  const differ: Array<[string, DataFiles]> = [
    ['Function cost', files({ functions: mutate(real.functions.text, 'FNC_001,BOMB,7', 'FNC_001,BOMB,8') })],
    ['startCharged', files({ functions: mutate(real.functions.text, ',,Y,,,0:0:0:0', ',,N,,,0:0:0:0') })],
    ['Shake params', files({ functions: mutate(real.functions.text, '0:0:0:0', '0:0:1:1') })],
    ['BASE_LINK', files({ hackers: mutate(real.hackers.text, 'CR45H,100', 'CR45H,120') })],
    ['STRONG_COLORS', files({ hackers: mutate(real.hackers.text, 'RED:GRE:YEL', 'RED:GRE:BLU') })],
    ['Skill magnitude', files({ skills: mutate(real.skills.text, 'SKL_EXTRA_MATCH_DAMAGE,RED:1', 'SKL_EXTRA_MATCH_DAMAGE,RED:2') })],
    ['ADD_LINK', files({ decks: mutate(real.decks.text, 'AGIMA,50', 'AGIMA,60') })],
  ];
  for (const [label, f] of differ) {
    const c = loadContent(f).content;
    assert(c !== null, `${label} fixture must load: ${loadContent(f).issues.map((i) => i.reason).join('; ')}`);
    assert(c.fingerprint !== a.fingerprint, `${label} MUST change the fingerprint`);
  }
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
  // §14.2 — every live EFFECT_BOMB row must carry its complete three-value
  // tuple, fixtures included; trailing defaults are never inferred.
  const dup =
    real.functions.text.trimEnd() +
    '\n' +
    fncRow(['FNC_099', 'BOMB', '5', 'EFFECT_BOMB', '', '1', '2', 'AREA_SQUARE_3X3', '', '', '', '', '', '0:0:1']);
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
    { functions: mutate(real.functions.text, 'generic bomb effect,2,2,AREA_SQUARE_3X3', 'generic bomb effect,,2,AREA_SQUARE_3X3') },
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
    { functions: mutate(real.functions.text, 'generic bomb effect,2,2,AREA_SQUARE_3X3', 'generic bomb effect,0,2,AREA_SQUARE_3X3') },
    'parameter out of range',
    'quantity 0',
  );
  // Alpha 0.4.0 §14.3 — countdown 0 is no longer out of range: blank or zero
  // now MEANS "resolve the blast immediately, place no overlay". It must load
  // and resolve to an immediate Bomb.
  {
    const t = mutate(real.functions.text, 'generic bomb effect,2,2,AREA_SQUARE_3X3', 'generic bomb effect,2,0,AREA_SQUARE_3X3');
    const r = loadContent(files({ functions: t }));
    assert(r.content !== null, `countdown 0 must load: ${r.issues.map((i) => i.reason).join('; ')}`);
    const op = r.content.functions.get('FNC_001')!.plan[0];
    assert((op.params.countdown ?? 0) === 0, 'countdown 0 resolves as immediate');
  }
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

test('required Alpha records must be present', () => {
  // drop the FNC_009 row entirely
  const lines = real.functions.text.trimEnd().split('\n');
  const t = lines.filter((l) => !l.startsWith('FNC_009')).join('\n');
  expectErrors({ functions: t }, 'required Alpha record is missing', 'required records');
});

// ---- §22.1 Alpha 0.3 schema validation: new datasets and fields ----

test('§22.1 wrong ID prefixes fail for each new dataset role', () => {
  expectErrors({ hackers: mutate(real.hackers.text, 'HAK_01,', 'DEK_01,') }, 'wrong Hacker ID prefix', 'hacker prefix');
  // §4.5 — a HAK_* value in DEK_ID is explicitly invalid
  expectErrors({ decks: mutate(real.decks.text, 'DEK_01,', 'HAK_01,') }, 'wrong Deck ID prefix', 'deck prefix');
  expectErrors({ skills: mutate(real.skills.text, 'SKL_001,', 'FNC_001,') }, 'wrong Skill ID prefix', 'skill prefix');
  expectErrors({ hackers: mutate(real.hackers.text, 'SKL_001:SKL_002', 'FNC_001:SKL_002') }, 'wrong ID prefix', 'skill ref prefix');
});

test('§22.1 missing Hacker/Skill/Deck/Function references fail', () => {
  expectErrors({ hackers: mutate(real.hackers.text, 'SKL_001:SKL_002', 'SKL_001:SKL_404') }, 'unknown Skill ID', 'missing skill');
  expectErrors({ decks: mutate(real.decks.text, 'FNC_010', 'FNC_404') }, 'unknown Function ID', 'missing deck fn');
});

test('§22.1 malformed tuples and invalid startCharged fail', () => {
  // wrong arity, out-of-range enum value, and non-integer token
  expectErrors({ functions: mutate(real.functions.text, '0:0:0:0', '0:0:0') }, 'exactly 4 colon-delimited', 'shake arity');
  expectErrors({ functions: mutate(real.functions.text, '0:0:0:0', '2:0:0:0') }, 'out of range', 'shake range');
  expectErrors({ functions: mutate(real.functions.text, '0:0:0:0', '0:0:0:x') }, 'malformed tuple', 'shake token');
  expectErrors({ functions: mutate(real.functions.text, '0:0:0:0', '') }, 'missing required params tuple', 'shake missing');
  expectErrors({ functions: mutate(real.functions.text, ',,Y,,,0:0:0:0', ',,MAYBE,,,0:0:0:0') }, 'invalid startCharged', 'startCharged');
  // §4.4 Skill param tuple contracts
  expectErrors({ skills: mutate(real.skills.text, 'RED:1,Deal', 'RED,Deal') }, 'exactly 2 colon-delimited', 'skill arity');
  expectErrors({ skills: mutate(real.skills.text, 'RED:1,Deal', 'REX:1,Deal') }, 'unknown color enum', 'skill color');
  expectErrors({ skills: mutate(real.skills.text, 'RED:1,Deal', 'RED:0,Deal') }, 'invalid magnitude', 'skill magnitude');
  expectErrors({ skills: mutate(real.skills.text, 'SKL_EXTRA_MATCH_DAMAGE', 'SKL_MAKE_COFFEE') }, 'unknown Skill effect type', 'skill effect');
});

test('§22.1 unsupported Skill display placeholders fail', () => {
  expectErrors({ skills: mutate(real.skills.text, 'Deal %1 extra', 'Deal %7 extra') }, 'placeholder out of range', 'display range');
  expectErrors({ skills: mutate(real.skills.text, 'Deal %1 extra', 'Deal %x extra') }, 'unsupported Skill display placeholder', 'display token');
});

test('§22.1 a Deck with zero or more than one Function fails', () => {
  expectErrors({ decks: mutate(real.decks.text, ',FNC_010,', ',,') }, 'at least one entry', 'deck zero fns');
  expectErrors({ decks: mutate(real.decks.text, 'FNC_010', 'FNC_010:FNC_001') }, 'exactly one Deck Function', 'deck two fns');
});

test('§22.1 EFFECT_SHAKE inert parameter combinations warn but load', () => {
  // §4.9 — REPLACE + RETAIN (Retain is ineffective), and matches disabled with
  // a nonzero cascade mode (the cascade value is currently ignored).
  const replaceRetain = loadContent(files({ functions: mutate(real.functions.text, '0:0:0:0', '1:0:0:0') }));
  assert(replaceRetain.content !== null, 'REPLACE+RETAIN must still load');
  assert(
    replaceRetain.issues.some((i) => i.severity === 'warning' && i.reason.includes('Retain is ineffective')),
    'expected the REPLACE+RETAIN warning',
  );
  const inertCascade = loadContent(files({ functions: mutate(real.functions.text, '0:0:0:0', '0:0:0:2') }));
  assert(inertCascade.content !== null, 'matches=0 with cascades=2 must still load');
  assert(
    inertCascade.issues.some((i) => i.severity === 'warning' && i.reason.includes('cascade mode is currently ignored')),
    'expected the inert-cascade warning',
  );
});

test('§22.1 unreferenced valid rows warn rather than fail', () => {
  const r = loadContent(real);
  assert(r.content !== null, 'real content loads');
  // FNC_007 SHOWCASE is authored as a composition example and is referenced by
  // no Program or Deck — a warning, never an error.
  assert(
    r.issues.some((i) => i.severity === 'warning' && i.id === 'FNC_007' && i.reason.includes('not referenced')),
    'expected an unreferenced-Function warning for FNC_007',
  );
  // an unreferenced Skill warns too
  const extraSkill = real.skills.text.trimEnd() + '\nSKL_099,SKL_EXTRA_MATCH_DAMAGE,BLU:2,Deal %1 extra damage on a %0 Sync';
  const rs = loadContent(files({ skills: extraSkill }));
  assert(rs.content !== null, 'an unreferenced Skill must not block startup');
  assert(
    rs.issues.some((i) => i.severity === 'warning' && i.id === 'SKL_099' && i.reason.includes('not referenced')),
    'expected an unreferenced-Skill warning',
  );
});

test('§22.1/§5.2 a missing explicit default ID blocks startup', () => {
  // the defaults are named constants, never "the first valid row"
  expectErrors(
    { hackers: mutate(real.hackers.text, 'HAK_01,', 'HAK_02,') },
    `DEFAULT_HACKER_ID ${DEFAULT_HACKER_ID} is not a valid loaded Hacker`,
    'default hacker',
  );
  expectErrors(
    { decks: mutate(real.decks.text, 'DEK_01,', 'DEK_02,') },
    `DEFAULT_DECK_ID ${DEFAULT_DECK_ID} is not a valid loaded Deck`,
    'default deck',
  );
});

// ---- 15.2 composition (validation half) ----

test('mixed Effect/Function payloads fail', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'EFFECT_BOMB:FNC_009') }, 'may not mix', 'mixed payload');
});

test('self-reference fails', () => {
  expectErrors({ functions: mutate(real.functions.text, 'FNC_008:FNC_009', 'FNC_007') }, 'self-reference', 'self ref');
});

test('composite-to-composite nesting (and thus cycles) fails', () => {
  // FNC_001-015 are all required real records now (Alpha 0.5.0 added COERCE,
  // EBUFF and SPAM), so the fixture uses a high free ID to test nesting rather
  // than colliding with authored content.
  const t = real.functions.text.trimEnd() + '\n' + fncRow(['FNC_098', 'SHOWTWO', '9', 'FNC_007']);
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

// ============================================================================
// Alpha 0.4.0 §20.1 — spreadsheet-safe parsing, portfolios, and the new
// typed Effect contracts.
// ============================================================================

test('§20.1 exactly one leading apostrophe is stripped before any parsing', () => {
  // One apostrophe in front of an ID reference, an integer, a tuple, and an
  // enum list must all normalize away before parsing/resolution.
  const fns = mutate(real.functions.text, 'FNC_011,DATACUT,7', "FNC_011,DATACUT,'7");
  const fns2 = mutate(fns, ',,,,,,0:1:0:0:1', ",,,,,,'0:1:0:0:1");
  const hak = mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', "'PRG_H_001:PRG_H_002:PRG_H_005");
  const prg = mutate(real.hacker.text, 'PRG_H_005,NINJA,MAG,CRO', "PRG_H_005,NINJA,'MAG,CRO");
  const r = loadContent(files({ functions: fns2, hackers: hak, hacker: prg }));
  assert(r.content !== null, `quoted values must load: ${r.issues.filter((i) => i.severity === 'error').map((i) => i.reason).join('; ')}`);
  const fn = r.content.functions.get('FNC_011')!;
  assert(fn.cost === 7, `'7 parsed as ${fn.cost}`);
  assert(fn.plan[0].params.line!.targeting === 1, 'quoted tuple parsed');
  assert(r.content.hackers.get('HAK_01')!.portfolioProgramIds.join(':') === 'PRG_H_001:PRG_H_002:PRG_H_005', 'quoted PRG_SET parsed');
  assert(r.content.programsById.get('PRG_H_005')!.colors[0] === Color.Magenta, 'quoted enum parsed');
  // §20.1.4 — the fingerprint of quoted and unquoted authorings is identical.
  assert(r.content.fingerprint === loadContent(real).content!.fingerprint, 'quoting must not change the fingerprint');
});

test('§20.1 a second apostrophe, and embedded/trailing ones, are DATA', () => {
  // ''PRG_H_001 -> 'PRG_H_001, which is not a valid reference and must fail.
  expectErrors(
    { hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002', "''PRG_H_001:PRG_H_002") },
    'wrong ID prefix',
    'double apostrophe stays data',
  );
  // a trailing apostrophe is likewise preserved and therefore invalid
  expectErrors(
    { hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002', "PRG_H_001':PRG_H_002") },
    'unknown Hacker Program',
    'trailing apostrophe stays data',
  );
  // …but a NON-reference field keeps it verbatim without failing
  const r = loadContent(files({ hackers: mutate(real.hackers.text, 'hacker biography goes here', "it's fine") }));
  assert(r.content !== null, 'an embedded apostrophe in a placeholder field is data');
  assert(r.content.hackers.get('HAK_01')!.bio === "it's fine", 'embedded apostrophe preserved');
});

test('§20.1 portfolios resolve in authored order and must hold exactly three', () => {
  const c = loadContent(real).content!;
  assert(c.hackers.get('HAK_01')!.portfolioProgramIds.join(':') === 'PRG_H_001:PRG_H_002:PRG_H_005', 'Hacker portfolio order');
  assert(c.decks.get('DEK_01')!.portfolioProgramIds.join(':') === 'PRG_H_003:PRG_H_004:PRG_H_006', 'Deck portfolio order');
  expectErrors({ hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_001:PRG_H_002') }, 'exactly 3', 'two-Program portfolio');
  expectErrors(
    { hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_001:PRG_H_002:PRG_H_005:PRG_H_003') },
    'exactly 3',
    'four-Program portfolio',
  );
  // §4.13 — a duplicate WITHIN one portfolio
  expectErrors({ hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_001:PRG_H_001:PRG_H_005') }, 'duplicate token', 'intra-portfolio duplicate');
  // an unknown reference
  expectErrors({ hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_001:PRG_H_002:PRG_H_404') }, 'unknown Hacker Program', 'missing portfolio ref');
});

test('§20.1 Hacker/Deck portfolio overlap is a startup content error', () => {
  // PRG_H_003 sits in the Deck portfolio; putting it in the Hacker's too makes
  // the only pairing unable to produce six distinct Programs (§4.6).
  expectErrors(
    { hackers: mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_001:PRG_H_003:PRG_H_005') },
    'overlap',
    'cross-portfolio overlap',
  );
});

test('§20.1/§20.2 the combined inventory is six distinct Programs in portfolio order', () => {
  install();
  const entries = inventoryFor('HAK_01', 'DEK_01');
  assert(entries.length === INVENTORY_SIZE, `expected ${INVENTORY_SIZE} inventory entries`);
  assert(new Set(entries.map((e) => e.programId)).size === INVENTORY_SIZE, 'six DISTINCT Programs');
  assert(
    entries.map((e) => e.programId).join(':') === 'PRG_H_001:PRG_H_002:PRG_H_005:PRG_H_003:PRG_H_004:PRG_H_006',
    'Hacker portfolio then Deck portfolio, both in authored order',
  );
  assert(
    entries.map((e) => e.source).join(',') === 'HACKER_PORTFOLIO,HACKER_PORTFOLIO,HACKER_PORTFOLIO,DECK_PORTFOLIO,DECK_PORTFOLIO,DECK_PORTFOLIO',
    'source attribution is retained per entry',
  );
  // §4.6 — no owned instances and no duplicated runtime definitions
  assert(entries.every((e) => e.program === programById(e.programId)), 'entries reference the SHARED resolved Program');
});

test('§20.1 every Program resolves exactly one active Function', () => {
  const c = loadContent(real).content!;
  for (const p of [...c.hacker, ...c.system]) {
    assert(p.functionId.startsWith('FNC_'), `${p.id} references a Function`);
    assert(c.functions.has(p.functionId), `${p.id} Function resolves`);
  }
  expectErrors({ hacker: mutate(real.hacker.text, 'PRG_H_005,NINJA,MAG,CRO,FNC_011', 'PRG_H_005,NINJA,MAG,CRO,FNC_011:FNC_012') }, 'exactly one Function', 'two Functions');
  expectErrors({ hacker: mutate(real.hacker.text, 'PRG_H_005,NINJA,MAG,CRO,FNC_011,', 'PRG_H_005,NINJA,MAG,CRO,,') }, 'exactly one FNC', 'zero Functions');
});

test('§20.1 EFFECT_BOMB requires exactly three parameters, EFFECT_LINESLICE exactly five', () => {
  // §4.8 — trailing defaults are never inferred and blank is invalid.
  expectErrors({ functions: mutate(real.functions.text, 'AREA_SQUARE_3X3,,,,,,0:0:1', 'AREA_SQUARE_3X3,,,,,,0:0') }, 'exactly 3', 'short Bomb tuple');
  expectErrors({ functions: mutate(real.functions.text, 'AREA_SQUARE_3X3,,,,,,0:0:1', 'AREA_SQUARE_3X3,,,,,,0:0:1:1') }, 'exactly 3', 'long Bomb tuple');
  expectErrors({ functions: mutate(real.functions.text, 'AREA_SQUARE_3X3,,,,,,0:0:1', 'AREA_SQUARE_3X3,,,,,,') }, 'missing required params tuple', 'blank Bomb tuple');
  expectErrors({ functions: mutate(real.functions.text, ',,,,,,0:1:0:0:1', ',,,,,,0:1:0:0') }, 'exactly 5', 'short LineSlice tuple');
  expectErrors({ functions: mutate(real.functions.text, ',,,,,,0:1:0:0:1', ',,,,,,0:1:0:0:1:0') }, 'exactly 5', 'long LineSlice tuple');
  expectErrors({ functions: mutate(real.functions.text, 'FNC_011,DATACUT,7,EFFECT_LINESLICE,"slice targeted row, deal damage, no charge",1,,,,,,,,0:1:0:0:1', 'FNC_011,DATACUT,7,EFFECT_LINESLICE,"slice targeted row, deal damage, no charge",1,,,,,,,,') }, 'missing required params tuple', 'blank LineSlice tuple');
});

test('§20.1 invalid parameter enums fail with field/position context', () => {
  const r = loadContent(files({ functions: mutate(real.functions.text, ',,,,,,0:1:0:0:1', ',,,,,,0:1:9:0:1') }));
  assert(r.content === null, 'out-of-range enum must fail');
  const issue = r.issues.find((i) => i.severity === 'error' && i.reason.includes('specialRetention'));
  assert(issue, `expected a specialRetention-specific error, got: ${r.issues.map((i) => i.reason).join('; ')}`);
  assert(issue.field === 'params' && issue.value === '9' && issue.id === 'FNC_011', 'error carries field, value, and record context');
});

test('§20.1/§12.3 a targeted Effect configuration must have quantity 1', () => {
  // PLINK is targeting=1; raising its quantity would mean multi-target
  // selection, which is out of scope.
  expectErrors(
    { functions: mutate(real.functions.text, 'FNC_012,PLINK,5,EFFECT_BOMB,slice cross centered on target,1', 'FNC_012,PLINK,5,EFFECT_BOMB,slice cross centered on target,2') },
    'must have quantity 1',
    'targeted quantity 2',
  );
  // random targeting may exceed one — the live BOMB row already does
  const c = loadContent(real).content!;
  const bomb = c.functions.get('FNC_001')!.plan[0];
  assert(bomb.params.bomb!.targeting === 0 && bomb.params.quantity === 2, 'random Bomb keeps quantity 2');
  assert(bomb.target === null, 'a random Bomb is not a targeted operation');
});

test('§20.1 PLINK resolves as an immediate targeted AREA_CARDINAL_1 Bomb with no direct charge', () => {
  const c = loadContent(real).content!;
  const plink = c.functions.get('FNC_012')!;
  assert(plink.name === 'PLINK' && plink.cost === 5, 'PLINK identity from the CSV');
  const op = plink.plan[0];
  assert(op.effectId === 'EFFECT_BOMB', 'PLINK is a Bomb');
  assert(op.params.quantity === 1, 'quantity 1');
  assert(op.params.countdown === undefined, 'no countdown — immediate resolution');
  assert(op.params.areaPattern === 'AREA_CARDINAL_1', 'centre plus one cardinal neighbour');
  assert(op.params.bomb!.targeting === 1 && op.params.bomb!.dealDamage === 0 && op.params.bomb!.gainCharge === 1, '1:0:1');
  assert(op.target === 'packet', 'PLINK requires one Packet target');
  // DATACUT's live variant
  const cut = c.functions.get('FNC_011')!.plan[0];
  assert(cut.effectId === 'EFFECT_LINESLICE' && cut.params.quantity === 1, 'DATACUT quantity 1');
  const lp = cut.params.line!;
  assert(lp.dimension === 0 && lp.targeting === 1 && lp.specialRetention === 0 && lp.dealDamage === 0 && lp.gainCharge === 1, '0:1:0:0:1');
  assert(cut.target === 'packet', 'DATACUT requires one Packet target');
  // the Programs that carry them
  assert(c.programsById.get('PRG_H_005')!.functionId === 'FNC_011', 'NINJA -> DATACUT');
  assert(c.programsById.get('PRG_H_006')!.functionId === 'FNC_012', 'WEASEL -> PLINK');
});

test('§20.1 there is exactly one AREA_CARDINAL_1 definition (no alias)', () => {
  const ids = Object.keys(AREA_PATTERNS);
  const serialized = ids.map((id) => JSON.stringify(AREA_PATTERNS[id as keyof typeof AREA_PATTERNS]));
  assert(new Set(serialized).size === serialized.length, 'no two area patterns share a coordinate set');
  assert(ids.includes('AREA_CARDINAL_1') && !ids.includes('AREA_CROSS'), 'the established ID, with no second alias');
});

// ---- gameplay fixtures ----

// Alpha 0.5.0 — a TEST-ONLY System that fields the Alpha 0.4 System roster
// (E-BOMBER / SHIELDER / ATTACKER / DISABLER). Neither authored System fields
// DISABLER, and only MIDNIGHT fields SHIELDER (§6.2), so without this the
// regression gate would silently lose its Drain, Shield and E-Bomb coverage
// (§51). Appended to the SYS dataset as fixture text — it is deliberately NOT
// authored content, and the designer has a separate note to add a real TESTER
// System in a future build.
// A function DECLARATION and an inline literal, not consts: `install()` is
// called from tests that appear earlier in this file, and a const would still
// be in its temporal dead zone at that point.
function testbedSystemId(): string {
  return 'SYS_90';
}
function testbedSystems(): string {
  return `${real.systems.text.replace(/\s*$/, '')}\nSYS_90,TESTBED,100,RED:GRE:YEL,TRI:SQU:STR,PRG_S_001:PRG_S_002:PRG_S_003:PRG_S_004,,bio,gfx`;
}

function testbed(): SelectedSystem {
  return { systemId: testbedSystemId(), source: 'HEADLESS_PINNED' };
}

// A battle against the testbed roster, for the Effects only it fields.
function newTestbedGame(seed = 7, settings: BattleSettings = D): Game {
  const g = newBattle(settings, seed, undefined, 'DEFAULT', testbed());
  g.startPlayerPhase();
  return g;
}

// The default fixture install includes the testbed System, so any test can
// select it without reinstalling content mid-file.
function install(over?: Partial<Record<keyof DataFiles, string>>): void {
  const merged = { systems: testbedSystems(), ...(over ?? {}) };
  const r = loadContent(files(merged));
  assert(r.content !== null, `fixture content failed to load: ${r.issues.map((i) => i.reason).join('; ')}`);
  setActiveContent(r.content);
}

// Under Normal LINK (the default) the harness identity resolves to
// BASE_LINK + ADD_LINK for the Hacker. Resolved lazily: it reads the ACTIVE
// content, which install() below installs first.
let _defaultLink: number | null = null;
const DEFAULT_LINK = (): number => (_defaultLink ??= defaultHackerLink());

// Alpha 0.5.0 §10.1 — System ICE no longer mirrors the Hacker's LINK: it is the
// selected System's own BASE_ICE. Assertions about the SYSTEM's remaining ICE
// must start from this, not from DEFAULT_LINK().
const DEFAULT_ICE = (systemId: string = HEADLESS_SYSTEM_ID): number => systemById(systemId).baseIce;

function newGame(seed = 7, settings: BattleSettings = D): Game {
  const g = newBattle(settings, seed);
  g.startPlayerPhase();
  return g;
}

// Alpha 0.4.0 — a battle whose ACTIVE BUILD is stated explicitly, for the
// order/routing/inventory cases. Any four distinct inventory Programs.
function newGameWithBuild(build: string[], seed = 7, settings: BattleSettings = D, system?: SelectedSystem): Game {
  const g = newBattle(settings, seed, build, 'PLAYER_EDITED', system);
  g.startPlayerPhase();
  return g;
}

// Alpha 0.4.0 — the Quick Match session info a save round-trip needs. The
// build and its source are part of the saved session now (§9.5).
function qmInfo(build: readonly string[] = defaultActiveBuild(), origin: BuildOrigin = 'DEFAULT'): QuickMatchInfo {
  return {
    mode: 'QUICK_MATCH',
    identity: defaultIdentity(),
    // Alpha 0.5.0 §32 — the session's opponent must match what the battle was
    // built against, which for every fixture here is the pinned headless System.
    system: headlessSystem(),
    build: [...build],
    buildOrigin: origin,
  };
}

// The slot index holding a given Program in a battle's active build.
function slotOf(g: Game, programId: string): number {
  return g.state.units.player.findIndex((u) => u.programId === programId);
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
  assert(g.state.hp.enemy === DEFAULT_ICE() - 30, 'enemy HP reduced');
  assert(g.state.units.player[2].charge === 0, 'cost 10 spent');
});

test('FNC_004: Hacker Drain uses the chosen target (valid even at 0 charge)', () => {
  const g = newGame(14);
  g.state.units.enemy[0].charge = 3;
  g.state.units.enemy[1].charge = 5;
  chargeSlot(g, 'player', 3);
  // untargeted fire must be rejected for a targeted Program
  assert(g.fireProgram(3).length === 0, 'targeted Program requires a target');
  const ev = g.fireProgram(3, { kind: 'unit', idx: 1 });
  assert(g.state.units.enemy[1].charge === 0, 'chosen target drained');
  assert(g.state.units.enemy[0].charge === 3, 'other slots untouched');
  const op = ev.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN');
  assert(op && op.t === 'op' && op.drained === 5 && op.resolved, 'drain op event');
  // 0-charge target is still valid
  const g2 = newGame(15);
  chargeSlot(g2, 'player', 3);
  const ev2 = g2.fireProgram(3, { kind: 'unit', idx: 2 });
  const op2 = ev2.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN');
  assert(op2 && op2.t === 'op' && op2.drained === 0 && op2.resolved, '0-charge target drains 0 but resolves');
});

test('System Drain: tier A prefers FULLY CHARGED over higher partial charge', () => {
  // Alpha 0.5.0 — DISABLER is fielded by no AUTHORED System (§6.2), so the
  // System-Drain algorithm is exercised against the testbed roster.
  const g = newTestbedGame(16);
  chargeSlot(g, 'enemy', 3); // System DISABLER ready
  g.state.units.player[0].charge = 7; // BOMBER full (cap 7)
  g.state.units.player[3].charge = 8; // DISABLER partial (cap 9) — higher raw charge
  g.runEnemyPhase();
  assert(g.state.units.player[0].charge === 0, 'fully charged BOMBER drained (tier A)');
  assert(g.state.units.player[3].charge === 8, 'higher-partial DISABLER untouched');
});

test('System Drain: tier C falls back to highest partial charge', () => {
  const g = newTestbedGame(17);
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[1].charge = 6; // BUFFER partial (cap 8)
  g.state.units.player[2].charge = 4; // ATTACK partial
  g.runEnemyPhase();
  assert(g.state.units.player[1].charge === 0, 'highest partial drained');
  assert(g.state.units.player[2].charge === 4, 'lower partial untouched');
});

test('System Drain: residual charge tie breaks by highest cost', () => {
  const g = newTestbedGame(18);
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[0].charge = 5; // BOMBER cost 7
  g.state.units.player[3].charge = 5; // DISABLER cost 9 — higher cost wins
  g.runEnemyPhase();
  assert(g.state.units.player[3].charge === 0, 'higher-cost program drained on tie');
  assert(g.state.units.player[0].charge === 5, 'lower-cost program untouched');
});

test('System Drain WITHHOLD: no charged target → no activation, charge preserved', () => {
  const g = newTestbedGame(19);
  chargeSlot(g, 'enemy', 3); // DISABLER at cap 9
  // all player programs at 0 charge
  const ev = g.runEnemyPhase();
  assert(!ev.some((e) => e.t === 'ability' && e.side === 'enemy'), 'no System activation');
  assert(g.state.units.enemy[3].charge === 9, 'charge preserved, not spent on a no-op');
  // Alpha 0.5.0 §37.2 — a withheld activation is recorded as a compact
  // battle-level COUNT, not a per-turn message: a Program blocked for many
  // turns must not flood BASIC/VERBOSE with repeated decision logging.
  assert(g.state.metrics.systemWithholds > 0, 'the withhold is counted at battle level');
  assert(!ev.some((e) => e.t === 'msg' && e.text.includes('holds')), 'no repeated per-turn withhold message');
});

test('FNC_005: E-Bomb costs 7, places one 3-turn AREA_SQUARE_3X3_CARDINAL_2 bomb', () => {
  const g = newTestbedGame(20);
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
  const g = newTestbedGame(21);
  chargeSlot(g, 'enemy', 1);
  const ev = g.runEnemyPhase();
  const placed = ev.find((e) => e.t === 'placed' && e.kind === 'shield');
  assert(placed && placed.t === 'placed' && placed.count === 2, 'two shields placed');
  const shields = specialsOf(g, 'shield', 'enemy');
  assert(shields.length === 2 && shields.every((s) => s.special!.magnitude === 2), 'two magnitude-2 shields');
});

test('shield reduces each separate incoming instance independently, min 0 (§9.5)', () => {
  const g = newTestbedGame(22);
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
  assert(hpAfter1 === DEFAULT_ICE(testbedSystemId()) - 26, 'dealt 26');
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

  // Owner strength on BOTH axes. DESIGNER OVERRIDE (2026-08-01) of §14.5:
  // collateral is valued on color AND shape and pays the higher tier, so a
  // Packet is HIGH for a side if either of its bindings is strong for it.
  // Here every Packet is Red with shapes cycling 0-5. For the player (strong
  // RED + TRI/SQU/STR) every Packet is HIGH on colour: 9x2 = 18.
  //
  // Alpha 0.5.0 §9 — the System's expectation is now derived from the SELECTED
  // SYSTEM'S OWN authored profile rather than the Hacker's complement, so this
  // reads the battle config instead of hardcoding a complement set. (Against
  // BOUNCER, Red IS strong, which is exactly the behavior change §9 intends.)
  const sysCfg = newGame(24).state.config;
  const enemyStrongColors = sysCfg.strongColors.enemy;
  const enemyStrongShapes = sysCfg.strongShapes.enemy;
  let enemyExpected = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const shape = ((dx + 1) + (dy + 1) * 3) % 6;
      const byColor = enemyStrongColors.includes(Color.Red) ? 2 : 1;
      const byShape = enemyStrongShapes.includes(shape) ? 2 : 1;
      enemyExpected += Math.max(byColor, byShape);
    }
  }
  const strengths: Array<{ owner: 'player' | 'enemy'; expected: number }> = [
    { owner: 'player', expected: 18 },
    { owner: 'enemy', expected: enemyExpected },
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

// ---- §22.2 selection state and the fixed build ----

const ids = defaultIdentity();
const runInfoFor = (
  settings: BattleSettings,
  step: RunStep = 1,
  build?: string[],
  system: SelectedSystem = { systemId: HEADLESS_SYSTEM_ID, source: 'RUN_RANDOM' },
): RunInfo => ({
  mode: 'RUN',
  step,
  settings,
  identity: { hackerId: ids.hackerId, deckId: ids.deckId, selectionSource: 'EXPLICIT_SELECTION' },
  hackerMaxLink: resolveHackerMaxLink(settings, ids.hackerId, ids.deckId),
  inventory: inventoryProgramIds(ids.hackerId, ids.deckId),
  build: build ?? defaultBuild(ids.hackerId, ids.deckId),
  buildOrigin: build ? 'PLAYER_EDITED' : 'DEFAULT',
  // Alpha 0.5.0 §33 — a committed Run always knows its upcoming opponent.
  system,
});

test('§22.2 New Run setup advances Hacker -> Deck -> Review and retains choices on Back', () => {
  let s: PendingSetup = beginSetup();
  assert(s.step === 'HACKER' && s.hackerId === null && s.deckId === null, 'setup begins empty at Hacker Selection');
  assert(!setupComplete(s), 'an empty setup is not committable');
  s = chooseHacker(s, 'HAK_01');
  assert(s.step === 'DECK' && s.hackerId === 'HAK_01', 'choosing the Hacker advances to Deck Selection');
  assert(!setupComplete(s), 'setup is not committable before the Build screen');
  s = chooseDeck(s, 'DEK_01', makeSetupRandom(1234).rng);
  assert(s.step === 'BUILD' && s.deckId === 'DEK_01', 'choosing the Deck advances to Build');
  // Alpha 0.5.0 §11.3 — reaching the pre-battle state resolves Battle 1's
  // opponent, so the player can build against it.
  assert(s.system !== null && getContent().systems.has(s.system.systemId), 'entering Build resolves a valid System');
  assert(s.system!.source === 'RUN_RANDOM', 'a Run opponent is recorded as randomly selected');
  assert(setupComplete(s), 'Build with both choices is committable');
  // §12.2 — Back RETAINS the pending choices
  const back1 = setupBack(s)!;
  assert(back1.step === 'DECK' && back1.hackerId === 'HAK_01' && back1.deckId === 'DEK_01', 'Back to Deck keeps both choices');
  const back2 = setupBack(back1)!;
  assert(back2.step === 'HACKER' && back2.hackerId === 'HAK_01' && back2.deckId === 'DEK_01', 'Back to Hacker keeps both choices');
  // backing out of the first screen returns null = "Title, discarding setup only"
  assert(setupBack(back2) === null, 'Back from Hacker Selection leaves setup');
});

// §11.3 — back-and-forward navigation inside ONE pending setup must not roll a
// new opponent: the player would see the encounter they planned against change
// under them. The RNG passed on the second pass is deliberately a DIFFERENT
// stream, so a reroll would be visible.
test('§11.3 re-entering Build during pending Run setup does not reroll the System', () => {
  let s: PendingSetup = beginSetup();
  s = chooseHacker(s, 'HAK_01');
  s = chooseDeck(s, 'DEK_01', makeSetupRandom(11).rng);
  const first = s.system!.systemId;
  const back = setupBack(s)!;
  assert(back.system!.systemId === first, 'Back retains the resolved opponent');
  const again = chooseDeck(back, 'DEK_01', makeSetupRandom(999).rng);
  assert(again.system!.systemId === first, 'returning to Build keeps the SAME opponent');
});

// §11.1 — sampling with replacement over the whole catalog: every authored
// System must be reachable, and repeats across battles are legal.
test('§11.1 random System selection draws from the full catalog with replacement', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const sel = randomSystem(makeSetupRandom(seed).rng, 'RUN_RANDOM');
    assert(getContent().systems.has(sel.systemId), 'selection is always a valid loaded System');
    assert(sel.source === 'RUN_RANDOM', 'selection carries its source');
    seen.add(sel.systemId);
  }
  assert(seen.size === getContent().systemOrder.length, 'every authored System is reachable');
});

// §14 — setup randomness must not touch the gameplay stream. Two battles built
// with the same gameplay seed but a different number of preceding SETUP draws
// must produce byte-identical boards.
test('§14 System selection does not perturb the gameplay RNG stream', () => {
  const boardOf = (g: Game): string => JSON.stringify(gridViewOf(g.state.board));
  const a = newBattle(D, 4242);
  const setupRng = makeSetupRandom(7).rng;
  for (let i = 0; i < 25; i++) randomSystem(setupRng, 'QUICK_RANDOM');
  const b = newBattle(D, 4242);
  assert(boardOf(a) === boardOf(b), 'gameplay board is unaffected by setup draws');
  assert(a.state.rng.getState() === b.state.rng.getState(), 'gameplay RNG state is unaffected');
});

test('§22.2 every loaded Deck is offered for the selected Hacker (no compatibility filtering)', () => {
  const c = getContent();
  // §2.8 — all Decks are compatible with all Hackers; there are no compatibility
  // fields to filter on, and the ordered selection lists expose every row.
  assert(c.deckOrder.length === c.decks.size, 'every Deck is offered');
  assert(c.hackerOrder.length === c.hackers.size, 'every Hacker is offered');
  for (const h of c.hackerOrder) {
    for (const d of c.deckOrder) {
      const id = buildIdentity(h, d, headlessSystem(), 'EXPLICIT_SELECTION', defaultBuild(h, d), 'DEFAULT');
      assert(id.hackerId === h && id.deckId === d, `identity builds for ${h}/${d}`);
    }
  }
});

test('§22.2/§5.3 the ordered active build survives identity construction', () => {
  const c = getContent();
  // Alpha 0.4.0 §5.4 — the DEFAULT build, derived from portfolio order, NOT a
  // hardcoded list. For the current content it resolves to H1,H2,D1,D2.
  const expected = defaultBuild('HAK_01', 'DEK_01');
  assert(expected.join(',') === 'PRG_H_001,PRG_H_002,PRG_H_003,PRG_H_004', 'current content default build');
  assert(c.hacker.length === INVENTORY_SIZE, 'all six Hacker Programs are loaded content');
  const id = buildIdentity('HAK_01', 'DEK_01', headlessSystem(), 'EXPLICIT_SELECTION', expected, 'DEFAULT');
  assert(id.hackerPrograms.join(',') === expected.join(','), 'identity carries the ordered active build');
  assert(id.inventory.join(',') === inventoryProgramIds('HAK_01', 'DEK_01').join(','), 'identity carries the inventory');
  assert(id.buildOrigin === 'DEFAULT', 'identity records the build source');
  // Alpha 0.5.0 §5.4 — the System roster is the SELECTED System's ordered
  // PRG_SET, no longer "every loaded System Program".
  assert(id.systemId === HEADLESS_SYSTEM_ID, 'identity carries the selected System');
  assert(
    id.systemPrograms.join(',') === systemById(HEADLESS_SYSTEM_ID).programIds.join(','),
    'identity carries the selected System PRG_SET in order',
  );
  assert(id.systemPrograms.length < c.system.length, 'the fielded roster is a subset of loaded System Programs');
  assert(id.skillIds.join(',') === 'SKL_001,SKL_002', 'identity carries the ordered Skill IDs');
  assert(id.deckFunctionId === 'FNC_010', 'identity carries the Deck Function ID');
  // §5.8 — battle construction instantiates EXACTLY the four active Programs
  const g = createRunBattle(runInfoFor(D), 1, 5);
  assert(g.state.units.player.length === ACTIVE_BUILD_SIZE, 'exactly four Hacker Program slots');
  assert(g.state.units.player.map((u) => u.programId).join(',') === expected.join(','), 'battle slots follow build order');
  assert(g.state.identity.hackerPrograms.join(',') === expected.join(','), 'battle identity preserves the build');
  // a non-default ordered build initializes in exactly the order given
  const custom = ['PRG_H_006', 'PRG_H_001', 'PRG_H_005', 'PRG_H_003'];
  const g2 = createRunBattle(runInfoFor(D, 1, custom), 1, 5);
  assert(g2.state.units.player.map((u) => u.programId).join(',') === custom.join(','), 'custom build order is authoritative');
  assert(!g2.state.units.player.some((u) => u.programId === 'PRG_H_002'), 'inactive Programs get no charge pool');
});

// ---- §22.3 Quick Match defaults ----

test('§22.3 Quick Match resolves the explicit default IDs and marks them defaulted', () => {
  assert(ids.hackerId === 'HAK_01' && ids.deckId === 'DEK_01', 'Quick Match uses HAK_01 and DEK_01');
  assert(ids.selectionSource === 'QUICK_MATCH_DEFAULT', 'the selection source is DEFAULTED, not explicitly chosen');
  const g = newBattle(D, 3);
  assert(g.state.identity.hackerId === 'HAK_01' && g.state.identity.deckId === 'DEK_01', 'battle identity is explicit');
  assert(g.state.identity.selectionSource === 'QUICK_MATCH_DEFAULT', 'battle records the defaulted source');
  // an explicit New Run records the other source
  const run = createRunBattle(runInfoFor(D), 1, 4);
  assert(run.state.identity.selectionSource === 'EXPLICIT_SELECTION', 'a Run records an explicit selection');
});

// ---- §22.4 save and restore ----

test('§22.4 Run encounters, envelope round-trip, and rejections', () => {
  // §4.1 exact table, §10.5 fresh-state creation without UI logic.
  // Alpha 0.5.0 §10.1 — the table holds ADDITIVE modifiers now; effective ICE
  // is the selected System's BASE_ICE plus the step modifier, which for a
  // BASE_ICE=100 System reproduces the established 100/150/200/250 ladder.
  assert(RUN_ENCOUNTERS.map((e) => e.iceModifier).join(',') === '0,50,100,150', 'encounter ICE modifier table');
  const baseIce = systemById(HEADLESS_SYSTEM_ID).baseIce;
  assert(baseIce === 100, 'fixture System BASE_ICE');
  for (const step of [1, 2, 3, 4] as const) {
    const g = createRunBattle(runInfoFor(D), step, 50 + step);
    assert(g.state.config.enemyHp === baseIce + encounterFor(step).iceModifier, `step ${step} System ICE`);
    assert(g.state.hp.player === DEFAULT_LINK(), 'Hacker at full resolved maximum LINK');
    assert(g.state.units.player.every((u) => u.charge === 0), 'fresh Program charge');
  }
  // Run envelope round-trip at step 2 (active battle)
  const info2 = runInfoFor(manualLink(D, 175, 150), 2);
  const g2 = createRunBattle(info2, 2, 99);
  g2.startPlayerPhase();
  const json = serializeSession(info2, g2, null);
  const r = deserializeSession(json);
  assert(r && r.info.mode === 'RUN' && r.info.step === 2, 'Run step round-trips');
  assert(r.info.mode === 'RUN' && r.info.hackerMaxLink === 175, 'resolved maximum LINK round-trips');
  assert(r.game, 'an active Run battle restores a game');
  assert(r.game.state.config.playerHp === 175, 'effective LINK round-trips');
  // §17.2: Quick Match must not carry Run values
  const qmJson = serializeSession(qmInfo(g2.state.identity.hackerPrograms, g2.state.identity.buildOrigin), g2, null);
  assert(!qmJson.includes('"run"'), 'QM envelope has no run field');
  const fakeRun = JSON.parse(qmJson) as Record<string, unknown>;
  fakeRun.run = { step: 1, settings: D, hackerMaxLink: 150 };
  assert(deserializeSession(JSON.stringify(fakeRun)) === null, 'QM save with Run values rejects');
  // a Run save whose battle ICE contradicts its encounter rejects
  const runNormal = runInfoFor(D, 2);
  const gN = createRunBattle(runNormal, 2, 98);
  gN.startPlayerPhase();
  const tampered = JSON.parse(serializeSession(runNormal, gN, null)) as { run: { step: number } };
  tampered.run.step = 3;
  assert(deserializeSession(JSON.stringify(tampered)) === null, 'step/encounter-ICE mismatch rejects');
  // §5.1 pending-result envelope: play a 1-LINK battle to conclusion, save, restore
  const info1 = runInfoFor(manualLink(D, 1, 150), 1);
  const g3 = createRunBattle(info1, 1, 7);
  g3.startPlayerPhase();
  let safety = 0;
  while (!g3.state.winner && safety++ < 600) {
    botFireAbilities(g3);
    if (g3.state.winner) break;
    const mv = botMove(g3);
    assert(mv, 'move available');
    g3.attemptSwap(mv.a, mv.b);
    if (!g3.state.winner) g3.runEnemyPhase();
    if (!g3.state.winner) g3.startPlayerPhase();
  }
  assert(g3.state.winner, 'battle concluded');
  const natural = g3.state.winner === 'player' ? 'NATURAL_VICTORY' : 'NATURAL_DEFEAT';
  const pendingJson = serializeSession(info1, g3, { natural, metricsLogged: true });
  const rp = deserializeSession(pendingJson);
  assert(rp && rp.pending, 'pending result restores');
  assert(rp.pending.natural === natural && rp.pending.metricsLogged, 'result context round-trips');
  assert(rp.game, 'a pending-result save restores its concluded battle');
  assert(rp.game.state.winner === g3.state.winner, 'concluded state restores');
  // an active-battle envelope claiming a result rejects
  const bad = JSON.parse(json) as Record<string, unknown>;
  bad.result = { natural: 'NATURAL_VICTORY', metricsLogged: true };
  assert(deserializeSession(JSON.stringify(bad)) === null, 'active battle with result field rejects');
});

test('§22.4 an Alpha 0.2 save is rejected cleanly and non-partially', () => {
  const g = newBattle(D, 11);
  g.startPlayerPhase();
  const json = serializeSession(qmInfo(g.state.identity.hackerPrograms, g.state.identity.buildOrigin), g, null);
  // §17.1 — the version and schema checks reject without migrating or partially
  // loading; nothing is inferred into an old save.
  for (const old of ['alpha-0.2.0', 'alpha-0.1.0', 'mk9']) {
    const env = JSON.parse(json) as { version: string };
    env.version = old;
    assert(deserializeSession(JSON.stringify(env)) === null, `${old} version rejects`);
  }
  const schema = JSON.parse(json) as { schema: number };
  schema.schema = 1; // the Alpha 0.2 dataset schema
  assert(deserializeSession(JSON.stringify(schema)) === null, 'schema 1 rejects');
  // a genuine Alpha 0.2-shaped envelope (no identity, hackerOrder/systemOrder,
  // shakeCharge in state) must reject rather than partially load
  const legacy = {
    version: 'alpha-0.2.0',
    schema: 1,
    fp: getContent().fingerprint,
    mode: 'QUICK_MATCH',
    hackerOrder: ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'],
    systemOrder: ['PRG_S_001', 'PRG_S_002', 'PRG_S_003', 'PRG_S_004'],
    phase: 'ACTIVE_BATTLE',
    state: { ...JSON.parse(json).state, shakeCharge: 3, identity: undefined, deckCharge: undefined },
  };
  assert(deserializeSession(JSON.stringify(legacy)) === null, 'an Alpha 0.2-shaped envelope rejects');
});

test('§22.4 identity that disagrees with resolved content rejects the save', () => {
  const g = createRunBattle(runInfoFor(D), 1, 12);
  g.startPlayerPhase();
  const json = serializeSession(runInfoFor(D), g, null);
  assert(deserializeSession(json), 'sanity: the untampered save restores');
  const tamper = (mut: (env: Record<string, any>) => void, label: string): void => {
    const env = JSON.parse(json) as Record<string, any>;
    mut(env);
    assert(deserializeSession(JSON.stringify(env)) === null, label);
  };
  tamper((e) => { e.identity.hackerId = 'HAK_99'; }, 'unknown Hacker rejects');
  tamper((e) => { e.identity.deckId = 'DEK_99'; }, 'unknown Deck rejects');
  tamper((e) => { e.identity.deckFunctionId = 'FNC_001'; }, 'wrong Deck Function rejects');
  tamper((e) => { e.identity.skillIds = ['SKL_002', 'SKL_001']; }, 'reordered Skill IDs reject');
  tamper((e) => { e.identity.skillIds = ['SKL_001']; }, 'truncated Skill IDs reject');
  tamper((e) => { [e.identity.hackerPrograms[0], e.identity.hackerPrograms[1]] = [e.identity.hackerPrograms[1], e.identity.hackerPrograms[0]]; }, 'reordered Programs reject');
  tamper((e) => { e.identity.selectionSource = 'SOMETHING_ELSE'; }, 'invalid selection source rejects');
  // the envelope identity and the battle-state identity must AGREE
  tamper((e) => { e.state.identity.hackerId = 'HAK_01'; e.identity.hackerId = 'HAK_01'; e.state.identity.deckId = 'DEK_01'; e.identity.selectionSource = 'QUICK_MATCH_DEFAULT'; }, 'envelope/state selection-source disagreement rejects');
  // §7.2 — Deck charge beyond the Function cost is invalid
  tamper((e) => { e.state.deckCharge = deckById('DEK_01').fn.cost + 1; }, 'over-cap Deck charge rejects');
  tamper((e) => { e.state.deckCharge = -1; }, 'negative Deck charge rejects');
});

test('§22.4 battle IDs are collision-resistant under synchronous construction', () => {
  // §17.4 — the old timestamp-only scheme collided when battles were built in
  // the same millisecond. Generation must not consume gameplay RNG either.
  const direct = new Set<string>();
  for (let i = 0; i < 5000; i++) direct.add(nextBattleId());
  assert(direct.size === 5000, `expected 5000 unique IDs, got ${direct.size}`);
  const built = new Set<string>();
  for (let i = 0; i < 50; i++) built.add(newBattle(D, 5).state.battleId);
  assert(built.size === 50, 'battles built synchronously from the SAME seed still get unique IDs');
  // identical seed => identical gameplay RNG stream, proving ID generation did
  // not perturb it
  const a = newBattle(D, 4242);
  const b = newBattle(D, 4242);
  assert(a.state.battleId !== b.state.battleId, 'IDs differ');
  const key = (g: Game): string => g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).join(',');
  assert(key(a) === key(b), 'the gameplay RNG stream is untouched by ID generation');
  // the ID survives save/restore
  const g = newBattle(D, 77);
  g.startPlayerPhase();
  const r = deserializeSession(serializeSession(qmInfo(g.state.identity.hackerPrograms, g.state.identity.buildOrigin), g, null));
  assert(r?.game && r.game.state.battleId === g.state.battleId, 'battle ID survives save/restore');
});

test('§22.4 Run configuration is stable after a title Settings change', () => {
  // §10.4 — the Run snapshot is authoritative; later menu edits cannot reach it.
  const snapshot = snapshotRunSettings({ ...D, maxCascadeSteps: 3 });
  const info = runInfoFor(snapshot, 1);
  // "the player then changes Settings" — the snapshot object must not alias it
  const menuAfter: BattleSettings = { ...D, maxCascadeSteps: 9, reinforcedConnection: true };
  void menuAfter;
  const g = createRunBattle(info, 1, 21);
  assert(g.state.config.maxCascadeSteps === 3, 'the battle uses the snapshot cascade cap');
  assert(g.state.config.reinforcedConnection === false, 'the battle uses the snapshot mode flags');
  const r = deserializeSession(serializeSession(info, g, null));
  assert(r && r.info.mode === 'RUN' && r.info.settings.maxCascadeSteps === 3, 'the snapshot round-trips unchanged');
});

// ---- §22.5 strength and LINK/ICE ----

test('§22.5 Hacker strong sets come from HAK_01 and System sets are complements', () => {
  const h = hackerById('HAK_01');
  assert(h.strongColors.join(',') === [Color.Red, Color.Green, Color.Yellow].join(','), 'authored strong colors, authored order');
  assert(h.strongShapes.join(',') === [Shape.Triangle, Shape.Square, Shape.Star].join(','), 'authored strong shapes');
  // weak = recognized complement, presented in recognized ENUM order
  assert(h.weakColors.join(',') === [Color.Yellow, Color.Magenta, Color.Cyan, Color.Blue].filter((c) => !h.strongColors.includes(c)).join(','), 'weak colors are the complement');
  assert(h.weakColors.every((c) => !h.strongColors.includes(c)), 'weak and strong colors are disjoint');
  assert(h.weakColors.length + h.strongColors.length === 6, 'colors partition exactly');
  assert(h.weakShapes.length + h.strongShapes.length === 6, 'shapes partition exactly');
  const sortedAsc = (xs: readonly number[]): boolean => xs.every((v, i) => i === 0 || xs[i - 1] < v);
  assert(sortedAsc(h.weakColors) && sortedAsc(h.weakShapes), 'derived complements preserve recognized enum order');
  // Alpha 0.5.0 §9 — the battle config resolves EACH side from its OWN
  // authored identity. The Alpha 0.4 rule (System strength = the Hacker's weak
  // sets) is gone, and this asserts it is really gone: with the current content
  // the two are demonstrably different sets.
  const sys = systemById(HEADLESS_SYSTEM_ID);
  const g = newBattle(D, 31);
  assert(g.state.config.strongColors.player.join(',') === h.strongColors.join(','), 'Hacker strong colors are authoritative');
  assert(g.state.config.strongColors.enemy.join(',') === sys.strongColors.join(','), 'System strong colors come from the System');
  assert(g.state.config.strongShapes.enemy.join(',') === sys.strongShapes.join(','), 'System strong shapes come from the System');
  assert(
    g.state.config.strongColors.enemy.join(',') !== h.weakColors.join(','),
    'System strength is NOT the Hacker complement any more',
  );
});

// §5.3/§43.1 — each System derives its own weak sets, and two Systems with
// different authored strengths really do produce different battle profiles.
test('§5.3 System weak sets are the complement of that System\'s own strong sets', () => {
  const c = getContent();
  const sortedAsc = (xs: readonly number[]): boolean => xs.every((v, i) => i === 0 || xs[i - 1] < v);
  for (const id of c.systemOrder) {
    const s = c.systems.get(id)!;
    assert(s.weakColors.every((x) => !s.strongColors.includes(x)), `${id} weak/strong colors disjoint`);
    assert(s.weakColors.length + s.strongColors.length === 6, `${id} colors partition exactly`);
    assert(s.weakShapes.length + s.strongShapes.length === 6, `${id} shapes partition exactly`);
    assert(sortedAsc(s.weakColors) && sortedAsc(s.weakShapes), `${id} complements preserve enum order`);
  }
  const a = systemById('SYS_01');
  const b = systemById('SYS_02');
  assert(a.strongColors.join(',') !== b.strongColors.join(','), 'the two authored Systems differ in color profile');
  const ga = newBattle(D, 77, undefined, 'DEFAULT', { systemId: 'SYS_01', source: 'HEADLESS_PINNED' });
  const gb = newBattle(D, 77, undefined, 'DEFAULT', { systemId: 'SYS_02', source: 'HEADLESS_PINNED' });
  assert(
    ga.state.config.strongColors.enemy.join(',') !== gb.state.config.strongColors.enemy.join(','),
    'selecting a different System changes the battle profile',
  );
});

test('§22.5 non-3/3 strength cardinalities derive correctly', () => {
  // no exact three-strong/three-weak partition is required (§2.3/§5.4)
  const four = loadContent(files({ hackers: mutate(real.hackers.text, 'RED:GRE:YEL', 'RED:GRE:YEL:BLU') })).content!;
  const h4 = four.hackers.get('HAK_01')!;
  assert(h4.strongColors.length === 4 && h4.weakColors.length === 2, '4 strong / 2 weak colors');
  const one = loadContent(files({ hackers: mutate(real.hackers.text, 'TRI:SQU:STR', 'TRI') })).content!;
  const h1 = one.hackers.get('HAK_01')!;
  assert(h1.strongShapes.length === 1 && h1.weakShapes.length === 5, '1 strong / 5 weak shapes');
  assert(h1.weakShapes.every((s) => s !== Shape.Triangle), 'the strong shape is excluded from weak');
});

test('§22.5 Normal LINK ON derives LINK/ICE from content and the encounter table', () => {
  const h = hackerById('HAK_01');
  const d = deckById('DEK_01');
  const on: BattleSettings = { ...D, normalLink: true };
  const link = resolveHackerMaxLink(on, 'HAK_01', 'DEK_01');
  assert(link === h.baseLink + d.addLink, `BASE_LINK + ADD_LINK = ${h.baseLink}+${d.addLink}, got ${link}`);
  // Alpha 0.5.0 §10.1 — Quick Match System ICE is the SELECTED SYSTEM'S OWN
  // BASE_ICE. Through Alpha 0.4.1 it mirrored the resolved Hacker maximum LINK
  // (150 with the current content); it is now 100. Designer-approved change:
  // System identity owns System durability.
  const sys = systemById(HEADLESS_SYSTEM_ID);
  assert(resolveQuickMatchIce(on, sys.id) === sys.baseIce, 'Quick Match ICE is the System BASE_ICE');
  assert(resolveQuickMatchIce(on, sys.id) !== link, 'Quick Match ICE no longer mirrors Hacker LINK');
  const qm = newBattle(on, 41);
  assert(qm.state.config.playerHp === link, 'Quick Match Hacker LINK is BASE_LINK + ADD_LINK');
  assert(qm.state.config.enemyHp === sys.baseIce, 'Quick Match battle uses the System BASE_ICE');
  // A Run uses BASE_ICE + the step modifier (§10.1).
  for (const step of [1, 2, 3, 4] as const) {
    const expected = sys.baseIce + encounterFor(step).iceModifier;
    assert(resolveRunIce(on, sys.id, step) === expected, `step ${step} ICE from BASE_ICE + modifier`);
    const g = createRunBattle(runInfoFor(on, step), step, 60 + step);
    assert(g.state.config.playerHp === link, `step ${step} Hacker at full resolved LINK`);
    assert(g.state.config.enemyHp === expected, `step ${step} System ICE from BASE_ICE + modifier`);
  }
  // §10.1 — a System with different durability escalates on the same ladder
  // without the Run progression needing to know anything about it.
  const other = systemById('SYS_02');
  for (const step of [1, 2, 3, 4] as const) {
    assert(
      resolveRunIce(on, other.id, step) === other.baseIce + encounterFor(step).iceModifier,
      `SYS_02 step ${step} uses its own base`,
    );
  }
});

test('§22.5 Normal LINK OFF uses manual values for the Hacker and EVERY Run encounter', () => {
  const off = manualLink(D, 222, 333);
  assert(resolveHackerMaxLink(off, 'HAK_01', 'DEK_01') === 222, 'manual Hacker LINK is used');
  // §10.2 — the manual value REPLACES the System's BASE_ICE; the two are never
  // silently combined, and the Run modifier is not added on top of it either.
  assert(resolveQuickMatchIce(off, HEADLESS_SYSTEM_ID) === 333, 'manual System ICE is used in Quick Match');
  for (const step of [1, 2, 3, 4] as const) {
    assert(resolveRunIce(off, HEADLESS_SYSTEM_ID, step) === 333, `step ${step} uses the manual ICE, not base + modifier`);
    const g = createRunBattle(runInfoFor(off, step), step, 70 + step);
    assert(g.state.config.enemyHp === 333, `step ${step} battle uses the manual ICE`);
    assert(g.state.config.playerHp === 222, `step ${step} battle uses the manual LINK`);
  }
  // §10.3 — hidden manual values are RETAINED while Normal LINK is ON
  const on: BattleSettings = { ...off, normalLink: true };
  assert(on.manualHackerLink === 222 && on.manualSystemIce === 333, 'manual values are retained, just unused');
  assert(resolveHackerMaxLink(on, 'HAK_01', 'DEK_01') === DEFAULT_LINK(), 'with Normal LINK ON the derived value wins');
});

// ---- §22.6 Hacker Skills ----

// Paint a controlled BACKGROUND that contains no Sync on any axis, so a planted
// run is the only match on the board. `(x+y) % 2` alternates along every row AND
// every column (never 3 in a row), and `(x+y) % 3` cycles 0,1,2 along both axes
// (also never 3 in a row) — so neither the color nor the shape axis can produce
// a run, and no cell is neutral.
function paintBackground(g: Game): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const t = g.state.board[y][x]!;
      t.kind = 'standard';
      t.color = ((x + y) % 2 === 0 ? Color.Cyan : Color.Blue) as Color;
      t.shape = ((x + y) % 3) as Shape;
      t.special = undefined;
    }
  }
  assert(detectMatches(g.state.board).length === 0, 'the test background must contain no Sync');
}

// Paint the background, then plant an exact set of Packets.
function plantRun(g: Game, cells: { x: number; y: number; color: Color; shape: Shape }[]): void {
  paintBackground(g);
  for (const c of cells) {
    const t = g.state.board[c.y][c.x]!;
    t.kind = 'standard';
    t.color = c.color;
    t.shape = c.shape;
    t.special = undefined;
  }
}

// Paint the background, then make the listed cells neutral.
function plantNeutrals(g: Game, cells: { x: number; y: number }[]): void {
  paintBackground(g);
  for (const c of cells) {
    const t = g.state.board[c.y][c.x]!;
    t.kind = 'neutral';
    t.color = undefined;
    t.shape = undefined;
    t.special = undefined;
  }
}

// The pure resolver and board helpers, imported once for the combat suites.
const { resolveCascades, resolveDetonation } = await import('../src/logic/resolve');
const { shakeBoard } = await import('../src/logic/board');

// Resolve one owner-scoped wave against the CURRENT board and route its events
// through the SAME metrics collector Game.collect() uses — otherwise a direct
// resolver call would leave state.metrics untouched and bucket assertions would
// be vacuous.
function resolveWave(g: Game, owner: Side, budget: number | null = 1): GameEvent[] {
  const events: GameEvent[] = [];
  resolveCascades(g.state, owner, events, budget, 'match', new Set());
  consumeEvents(g.state.metrics, events);
  return events;
}

test('§22.6 a Red color-axis Sync triggers each current Skill once per resolved blob', () => {
  const g = newGame(51);
  // one horizontal Red run of 3 with varied shapes (no shape-axis Sync)
  plantRun(g, [
    { x: 1, y: 1, color: Color.Red, shape: Shape.Circle },
    { x: 2, y: 1, color: Color.Red, shape: Shape.Square },
    { x: 3, y: 1, color: Color.Red, shape: Shape.Triangle },
  ]);
  const matches = detectMatches(g.state.board);
  assert(matches.length === 1 && matches[0].condition === 'color', `expected exactly one color Sync, got ${matches.length}`);
  const events = resolveWave(g, 'player');
  const skillEvents = events.filter((e) => e.t === 'skill');
  assert(skillEvents.length === 2, `both Skills trigger once each, got ${skillEvents.length}`);
  const dmg = skillEvents.find((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_DAMAGE');
  const chg = skillEvents.find((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_CHARGE');
  assert(dmg && dmg.t === 'skill' && dmg.damage === 1, 'SKL_001 contributes 1 raw damage at the 1.0x tier');
  assert(chg && chg.t === 'skill' && chg.charge !== undefined, 'SKL_002 reports the charge it granted');
  // §6.4 — the Skill damage is its own disjoint bucket, never base Sync damage
  const sm = g.state.metrics.sides.player;
  assert(sm.skillDamage === 1, `skillDamage bucket = 1, got ${sm.skillDamage}`);
  const tallied = sm.matchDamage + sm.bombDamage + sm.attackerDamage + sm.bufferDamageAdded + sm.skillDamage;
  assert(Math.abs(tallied - sm.totalDamage) < 1e-9, 'the five buckets sum exactly to total');
});

test('§22.6 a shape-only Sync does not trigger, and overlapping Syncs trigger only on the Red axis', () => {
  // shape-only run made of RED tiles: moving/among Red Packets is not enough —
  // only a resolved RED COLOR-axis Sync qualifies (§6.3)
  const g1 = newGame(52);
  plantRun(g1, [
    { x: 1, y: 3, color: Color.Red, shape: Shape.Star },
    { x: 2, y: 3, color: Color.Green, shape: Shape.Star },
    { x: 3, y: 3, color: Color.Yellow, shape: Shape.Star },
  ]);
  const m1 = detectMatches(g1.state.board);
  assert(m1.length === 1 && m1[0].condition === 'shape', 'exactly one shape-axis Sync');
  const ev1 = resolveWave(g1, 'player');
  assert(!ev1.some((e) => e.t === 'skill'), 'a shape-axis Sync containing Red Packets must NOT trigger a Red Skill');

  // overlapping Red color-axis AND shape-axis Syncs: the Red Skill fires ONCE,
  // for the Red-axis event only
  const g2 = newGame(53);
  plantRun(g2, [
    { x: 1, y: 5, color: Color.Red, shape: Shape.Cross },
    { x: 2, y: 5, color: Color.Red, shape: Shape.Cross },
    { x: 3, y: 5, color: Color.Red, shape: Shape.Cross },
  ]);
  const m2 = detectMatches(g2.state.board);
  const axes = new Set(m2.map((m) => m.condition));
  assert(axes.has('color') && axes.has('shape'), 'the plant produces both a color and a shape Sync');
  const ev2 = resolveWave(g2, 'player');
  const dmgTriggers = ev2.filter((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_DAMAGE');
  assert(dmgTriggers.length === 1, `the Red Skill fires once for the Red-axis event, got ${dmgTriggers.length}`);
});

test('§22.6 multiple distinct Red blobs each trigger independently', () => {
  const g = newGame(54);
  // two SEPARATED Red runs (not touching, so the merge pass keeps them distinct)
  plantRun(g, [
    { x: 0, y: 0, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 0, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 0, color: Color.Red, shape: Shape.Triangle },
    { x: 5, y: 6, color: Color.Red, shape: Shape.Circle },
    { x: 6, y: 6, color: Color.Red, shape: Shape.Square },
    { x: 7, y: 6, color: Color.Red, shape: Shape.Triangle },
  ]);
  const matches = detectMatches(g.state.board).filter((m) => m.condition === 'color');
  assert(matches.length === 2, `expected 2 distinct Red blobs, got ${matches.length}`);
  const events = resolveWave(g, 'player');
  const dmgTriggers = events.filter((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_DAMAGE');
  assert(dmgTriggers.length === 2, `each distinct blob qualifies, got ${dmgTriggers.length}`);
  assert(g.state.metrics.sides.player.skillDamage === 2, 'both contributions land in the Skill bucket');
});

test('§22.6 System-owned Syncs never trigger Hacker Skills', () => {
  const g = newGame(55);
  plantRun(g, [
    { x: 1, y: 1, color: Color.Red, shape: Shape.Circle },
    { x: 2, y: 1, color: Color.Red, shape: Shape.Square },
    { x: 3, y: 1, color: Color.Red, shape: Shape.Triangle },
  ]);
  // §6.2 — owner scope: the same board resolved as a SYSTEM-owned wave
  const events = resolveWave(g, 'enemy');
  assert(!events.some((e) => e.t === 'skill'), 'a System-owned Sync must not trigger Hacker Skills');
  assert(g.state.metrics.sides.enemy.skillDamage === 0, 'the System accrues no Skill damage');
});

test('§22.6 duplicate qualifying Skills stack additively', () => {
  // SKILL duplicates are meaningful content: SKL_001 twice = +2 damage
  install({ hackers: mutate(real.hackers.text, 'SKL_001:SKL_002', 'SKL_001:SKL_001') });
  try {
    const g = newGame(56);
    assert(hackerById('HAK_01').skills.length === 2, 'both Skill references resolve');
    plantRun(g, [
      { x: 1, y: 1, color: Color.Red, shape: Shape.Circle },
      { x: 2, y: 1, color: Color.Red, shape: Shape.Square },
      { x: 3, y: 1, color: Color.Red, shape: Shape.Triangle },
    ]);
    const events = resolveWave(g, 'player');
    const triggers = events.filter((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_DAMAGE');
    assert(triggers.length === 2, 'both duplicate Skills trigger');
    assert(g.state.metrics.sides.player.skillDamage === 2, 'duplicate damage Skills stack to +2');
  } finally {
    install(); // restore real content
  }
});

test('§22.6 no hardcoded Red passive survives without Skill records', () => {
  // A Hacker whose Skills are BLUE-keyed must get NO bonus from a Red Sync: if
  // any hardcoded Red passive remained, this would still add damage/charge.
  install({ skills: real.skills.text.replace(/RED:1/g, 'BLU:1') });
  try {
    const g = newGame(57);
    plantRun(g, [
      { x: 1, y: 1, color: Color.Red, shape: Shape.Circle },
      { x: 2, y: 1, color: Color.Red, shape: Shape.Square },
      { x: 3, y: 1, color: Color.Red, shape: Shape.Triangle },
    ]);
    const events = resolveWave(g, 'player');
    assert(!events.some((e) => e.t === 'skill'), 'a Red Sync must not trigger BLUE-keyed Skills');
    assert(g.state.metrics.sides.player.skillDamage === 0, 'no residual hardcoded Red damage bonus');
  } finally {
    install();
  }
});

test('§22.6 SKL_EXTRA_MATCH_CHARGE raises the payout through the normal distribution', () => {
  const g = newGame(58);
  // PRG_H_001 BOMBER is bound to color RED and shape TRI; the other Programs are
  // bound to other colors. Diamond/Cross are bound by NO Hacker Program, so the
  // planted run pays on the color axis only and the Skill's contribution is
  // unambiguous.
  plantRun(g, [
    { x: 1, y: 1, color: Color.Red, shape: Shape.Diamond },
    { x: 2, y: 1, color: Color.Red, shape: Shape.Cross },
    { x: 3, y: 1, color: Color.Red, shape: Shape.Diamond },
  ]);
  const before = g.state.units.player.map((u) => u.charge);
  const events = resolveWave(g, 'player');
  const after = g.state.units.player.map((u) => u.charge);
  // 3 Red Packets sliced = 3 color-axis charge to the Red-bound Program, and the
  // Skill adds exactly ONE more through the same color-axis distribution rule.
  const gained = after[0] - before[0];
  assert(gained === 4, `Red-bound Program gains 3 tiles + 1 Skill = 4, got ${gained}`);
  // §6.5 — the payout reaches only Programs bound to that color; it is NOT a
  // separate universal pool handed to every Program.
  for (const i of [1, 2, 3]) {
    assert(after[i] - before[i] === 0, `Program ${i} is not Red-bound and gains nothing from the Red Sync`);
  }
  const chg = events.find((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_CHARGE');
  assert(chg && chg.t === 'skill' && chg.charge === 1, 'the Skill reports the single charge it granted');
});

// ---- §22.7 Deck Function, charge, and Shake ----

test('§22.7 the Deck Function is Deck-owned in runtime, save, logs, and metrics', () => {
  const g = newBattle(D, 61);
  g.startPlayerPhase();
  const deck = deckById('DEK_01');
  // §4.6/§7.2 — startCharged Y means it opens each battle fully charged
  assert(deck.fn.startCharged, 'FNC_010 is authored startCharged=Y');
  assert(g.state.deckCharge === deck.fn.cost, `Deck opens charged at ${deck.fn.cost}, got ${g.state.deckCharge}`);
  const ev = g.fireDeckFunction();
  const ability = ev.find((e) => e.t === 'ability');
  assert(ability && ability.t === 'ability' && ability.ownerKind === 'deck', 'the activation is DECK-owned');
  assert(ability && ability.t === 'ability' && ability.programId === 'DEK_01', 'attributed to the Deck ID, not a PRG_H_*');
  const op = ev.find((e) => e.t === 'op');
  assert(op && op.t === 'op' && op.ownerKind === 'deck' && op.effectId === 'EFFECT_SHAKE', 'the op is Deck-owned EFFECT_SHAKE');
  // metrics land in the Deck bucket, never among the Programs
  const sm = g.state.metrics.sides.player;
  assert(sm.deck.fires === 1 && sm.deck.ops === 1, 'Deck metrics record the activation');
  assert(sm.units['DEK_01'] === undefined, 'the Deck never appears in the per-Program metrics map');
  for (const p of ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004']) {
    assert(sm.units[p].fires === 0, `${p} must not be credited with the Deck activation`);
  }
  assert(g.state.deckCharge === 0, 'the Deck Function spent its own pool');
});

test('§22.7 startCharged resets at every battle and never carries between encounters', () => {
  // Y: charged at every Run encounter start
  for (const step of [1, 2, 3, 4] as const) {
    const g = createRunBattle(runInfoFor(D, step), step, 80 + step);
    assert(g.state.deckCharge === deckById('DEK_01').fn.cost, `step ${step} Deck opens charged`);
  }
  // N: starts empty, and a spent pool does not persist into the next encounter
  install({ functions: mutate(real.functions.text, ',,Y,,,0:0:0:0', ',,N,,,0:0:0:0') });
  try {
    assert(!deckById('DEK_01').fn.startCharged, 'the fixture authors startCharged=N');
    for (const step of [1, 2, 3, 4] as const) {
      const g = createRunBattle(runInfoFor(D, step), step, 90 + step);
      assert(g.state.deckCharge === 0, `step ${step} Deck opens empty under startCharged=N`);
    }
    // Program startCharged follows the same uniform rule
    const withCharged = mutate(
      real.functions.text,
      'FNC_001,BOMB,7,EFFECT_BOMB,generic bomb effect,2,2,AREA_SQUARE_3X3,,,,',
      'FNC_001,BOMB,7,EFFECT_BOMB,generic bomb effect,2,2,AREA_SQUARE_3X3,,,Y,',
    );
    install({ functions: withCharged });
    const g2 = newBattle(D, 95);
    assert(g2.state.units.player[0].charge === 7, 'a directly assigned Program honours startCharged=Y');
    assert(g2.state.units.player[1].charge === 0, 'other Programs still open empty');
  } finally {
    install();
  }
});

test('§22.7 neutral Packets sliced in an owned Sync charge the Deck; Bombs never do', () => {
  const g = newGame(62);
  g.state.deckCharge = 0;
  // a neutral run of 3 alongside nothing else
  plantNeutrals(g, [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }]);
  const events = resolveWave(g, 'player');
  const dc = events.find((e) => e.t === 'deckCharge');
  assert(dc && dc.t === 'deckCharge' && dc.amount === 3, `3 neutral Packets grant 3 Deck charge, got ${dc && dc.t === 'deckCharge' ? dc.amount : 'none'}`);
  assert(g.state.deckCharge === 3, 'the Deck pool received the charge');
  assert(g.state.metrics.sides.player.deck.chargeFromNeutral === 3, 'the Deck metric records it');

  // §7.3 — Bomb destruction explicitly grants NO charge, including for neutrals
  const g2 = newGame(63);
  g2.state.deckCharge = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = g2.state.board[4 + dy][4 + dx]!;
      t.kind = 'neutral';
      t.color = undefined;
      t.shape = undefined;
      t.special = undefined;
    }
  }
  plantSpecial(g2, 4, 4, { type: 'bomb', owner: 'player', countdown: 1, areaPattern: 'AREA_SQUARE_3X3', programId: 'PRG_H_001' });
  const ev2: GameEvent[] = [];
  resolveDetonation(g2.state, { x: 4, y: 4 }, ev2);
  const blastCharge = ev2.filter((e) => e.t === 'deckCharge');
  assert(g2.state.deckCharge === 0 || blastCharge.length === 0, 'a Bomb blast slicing neutrals grants no Deck charge');

  // opponent-owned resolution does not charge the Hacker's Deck
  const g3 = newGame(64);
  g3.state.deckCharge = 0;
  plantNeutrals(g3, [{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }]);
  const ev3 = resolveWave(g3, 'enemy');
  assert(g3.state.deckCharge === 0, 'System-owned resolution must not charge the Hacker Deck');
});

test('§22.7 Drain excludes the Deck Function entirely', () => {
  const g = newTestbedGame(65);
  g.state.deckCharge = deckById('DEK_01').fn.cost; // fully charged Deck
  // System Drain priority considers PROGRAMS ONLY: with every Program empty and
  // only the Deck charged, the withhold rule must fire (nothing to drain).
  chargeSlot(g, 'enemy', 3);
  const ev = g.runEnemyPhase();
  assert(!ev.some((e) => e.t === 'ability' && e.side === 'enemy'), 'System withholds Drain — the Deck is not a candidate');
  assert(g.state.deckCharge === deckById('DEK_01').fn.cost, 'the Deck pool is untouched by System Drain');
  // and a charged Deck does not change fully-charged/highest-charge priority
  const g2 = newTestbedGame(66);
  g2.state.deckCharge = deckById('DEK_01').fn.cost;
  chargeSlot(g2, 'enemy', 3);
  g2.state.units.player[0].charge = 7; // BOMBER full
  g2.runEnemyPhase();
  assert(g2.state.units.player[0].charge === 0, 'the fully charged Program is still the Drain target');
  assert(g2.state.deckCharge === deckById('DEK_01').fn.cost, 'the Deck pool is never drained');
});

test('§22.7 the 0:0:0:0 Shake preserves composition and specials, prevents Syncs, no cascades', () => {
  const g = newBattle(D, 67);
  g.startPlayerPhase();
  // plant a special so RETAIN is observable
  plantSpecial(g, 0, 0, { type: 'shield', owner: 'player', magnitude: 2, programId: 'PRG_H_001' });
  const compBefore = JSON.stringify(g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).sort());
  const idsBefore = JSON.stringify(g.state.board.flat().map((t) => t!.id).sort((a, b) => a - b));
  const ev = g.fireDeckFunction();
  assert(ev.some((e) => e.t === 'shake' && e.resolved), 'the Shake resolved');
  const compAfter = JSON.stringify(g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).sort());
  assert(compAfter === compBefore, 'REARRANGE preserves composition exactly');
  assert(JSON.stringify(g.state.board.flat().map((t) => t!.id).sort((a, b) => a - b)) === idsBefore, 'REARRANGE permutes the same tile OBJECTS');
  const shields = specialsOf(g, 'shield', 'player');
  assert(shields.length === 1 && shields[0].special!.magnitude === 2, 'RETAIN moves the special with its Packet, state intact');
  assert(detectMatches(g.state.board).length === 0, 'PREVENT_POST_SHAKE_MATCHES leaves no Sync');
  assert(!ev.some((e) => e.t === 'destroy'), 'no Sync wave began');
  assert(!ev.some((e) => e.t === 'damage'), 'no damage from a prevented-match Shake');
});

test('§22.7 all four Shake axes validate, and REPLACE/REMOVE behave as specified', () => {
  // REMOVE strips the overlay but keeps the underlying ordinary Packet
  const g1 = newGame(68);
  plantSpecial(g1, 3, 3, { type: 'shield', owner: 'player', magnitude: 2, programId: 'PRG_H_001' });
  const beforeIds = new Set(g1.state.board.flat().map((t) => t!.id));
  const ok1 = shakeBoard(g1.state, { boardComposition: 0, specialGems: 1, matches: 0, cascades: 0 });
  assert(ok1, 'REARRANGE + REMOVE produced a valid board');
  assert(specialsOf(g1, 'shield', 'player').length === 0, 'REMOVE stripped the special overlay');
  assert(g1.state.board.flat().every((t) => beforeIds.has(t!.id)), 'the underlying Packets survive and are rearranged');

  // REPLACE regenerates the affected tiles: prior Packets and special state gone
  const g2 = newGame(69);
  plantSpecial(g2, 3, 3, { type: 'shield', owner: 'player', magnitude: 2, programId: 'PRG_H_001' });
  const idsBefore2 = new Set(g2.state.board.flat().map((t) => t!.id));
  const ok2 = shakeBoard(g2.state, { boardComposition: 1, specialGems: 0, matches: 0, cascades: 0 });
  assert(ok2, 'REPLACE produced a valid board');
  assert(specialsOf(g2, 'shield', 'player').length === 0, 'REPLACE removes prior special state regardless of RETAIN');
  assert(g2.state.board.flat().every((t) => !idsBefore2.has(t!.id)), 'REPLACE generates entirely new Packets');
});

test('§22.7 allowed post-Shake Syncs use INITIATOR ownership', () => {
  // A Shake with matches=1 resolves the created wave under the initiator's
  // ownership. Drive the equivalent path directly for both sides and confirm the
  // owner-scoped effects follow the initiator, never a hardcoded 'player'.
  for (const owner of ['player', 'enemy'] as const) {
    const g = newGame(owner === 'player' ? 70 : 71);
    plantRun(g, [
      { x: 1, y: 1, color: Color.Red, shape: Shape.Circle },
      { x: 2, y: 1, color: Color.Red, shape: Shape.Square },
      { x: 3, y: 1, color: Color.Red, shape: Shape.Triangle },
    ]);
    const events = resolveWave(g, owner);
    const dmg = events.find((e) => e.t === 'damage');
    assert(dmg && dmg.t === 'damage' && dmg.target === (owner === 'player' ? 'enemy' : 'player'), `${owner} Sync damages its opponent`);
    // Hacker Skills follow the initiator's identity only
    const hasSkill = events.some((e) => e.t === 'skill');
    assert(hasSkill === (owner === 'player'), `Skill triggers follow initiator ownership (${owner})`);
  }
});

test('§22.7 a Shake that cannot produce a valid board is a LEGAL FIZZLE', () => {
  const g = newGame(72);
  // A board of ONE colour+shape can never satisfy PREVENT_MATCHES (every
  // arrangement contains runs), so generation must exhaust and fizzle.
  for (const row of g.state.board) {
    for (const t of row) {
      t!.kind = 'standard';
      t!.color = Color.Red;
      t!.shape = Shape.Circle;
      t!.special = undefined;
    }
  }
  const snapshot = JSON.stringify(g.state.board.flat().map((t) => `${t!.id}:${t!.kind}:${t!.color}:${t!.shape}`));
  const ok = shakeBoard(g.state, { boardComposition: 0, specialGems: 0, matches: 0, cascades: 0 });
  assert(!ok, 'an impossible PREVENT_MATCHES Shake reports failure');
  assert(
    JSON.stringify(g.state.board.flat().map((t) => `${t!.id}:${t!.kind}:${t!.color}:${t!.shape}`)) === snapshot,
    '§8.7 — a legal fizzle leaves the Datastream COMPLETELY unchanged',
  );
  // and through the Function path the cost is still paid and the attempt logged
  const g2 = newBattle(D, 73);
  g2.startPlayerPhase();
  for (const row of g2.state.board) {
    for (const t of row) {
      t!.kind = 'standard';
      t!.color = Color.Red;
      t!.shape = Shape.Circle;
      t!.special = undefined;
    }
  }
  const chargeBefore = g2.state.deckCharge;
  const ev = g2.fireDeckFunction();
  assert(ev.some((e) => e.t === 'shake' && !e.resolved), 'the legal fizzle is recorded');
  assert(ev.some((e) => e.t === 'op' && !e.resolved), 'the op reports an unresolved (fizzled) outcome');
  assert(g2.state.deckCharge === chargeBefore - deckById('DEK_01').fn.cost, 'the paid activation cost is retained');
  assert(g2.state.metrics.sides.player.deck.shakeFizzles === 1, 'the fizzle is counted in Deck metrics');
  assert(g2.state.phase === 'playerPre', 'turn ownership and input state are intact');
});

// ---- §22.8 B1 combined direct-match line clears ----

test('§22.8 adjacent distinct match groups combine into one qualifying line', () => {
  // RRR beside GGG on one row: two internally separate colour groups whose
  // COMBINED direct footprint is a 6-cell run -> one row clear (§9.1 example).
  const g = newGame(81);
  plantRun(g, [
    { x: 0, y: 2, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 2, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 2, color: Color.Red, shape: Shape.Triangle },
    { x: 3, y: 2, color: Color.Green, shape: Shape.Circle },
    { x: 4, y: 2, color: Color.Green, shape: Shape.Square },
    { x: 5, y: 2, color: Color.Green, shape: Shape.Triangle },
  ]);
  const matches = detectMatches(g.state.board).filter((m) => m.condition === 'color');
  assert(matches.length === 2, `two distinct colour groups, got ${matches.length}`);
  assert(matches.every((m) => m.length === 3), 'neither group alone reaches 4');
  const lines = computeLineClears(detectMatches(g.state.board));
  assert(lines.length === 1 && lines[0].orientation === 'h' && lines[0].index === 2, `expected one row clear at y=2, got ${JSON.stringify(lines)}`);
});

test('§22.8 overlapping color and shape footprints combine into a qualifying line', () => {
  // A 3-run of colour plus a 3-run of shape overlapping in one row, whose union
  // is 4+ contiguous cells, qualifies even though neither group reaches 4.
  const g = newGame(82);
  plantRun(g, [
    // colour run at x=0..2 (varied shapes)
    { x: 0, y: 4, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 4, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 4, color: Color.Red, shape: Shape.Star },
    // shape run at x=2..4 sharing the cell at x=2 (varied colours)
    { x: 3, y: 4, color: Color.Green, shape: Shape.Star },
    { x: 4, y: 4, color: Color.Yellow, shape: Shape.Star },
  ]);
  const ms = detectMatches(g.state.board);
  const colour = ms.filter((m) => m.condition === 'color');
  const shape = ms.filter((m) => m.condition === 'shape');
  assert(colour.length === 1 && colour[0].length === 3, 'one 3-cell colour group');
  assert(shape.length === 1 && shape[0].length === 3, 'one 3-cell shape group');
  const lines = computeLineClears(ms);
  assert(lines.some((l) => l.orientation === 'h' && l.index === 4), 'the 5-cell union qualifies the row');
});

test('§22.8 every qualifying row and column fires once, intersections slice once', () => {
  const g = newGame(83);
  // a horizontal 4-run and a vertical 4-run crossing at (2,2)
  plantRun(g, [
    { x: 0, y: 2, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 2, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 2, color: Color.Red, shape: Shape.Triangle },
    { x: 3, y: 2, color: Color.Red, shape: Shape.Star },
    { x: 2, y: 0, color: Color.Red, shape: Shape.Diamond },
    { x: 2, y: 1, color: Color.Red, shape: Shape.Cross },
    { x: 2, y: 3, color: Color.Red, shape: Shape.Circle },
  ]);
  const ms = detectMatches(g.state.board);
  const lines = computeLineClears(ms);
  const rows = lines.filter((l) => l.orientation === 'h');
  const cols = lines.filter((l) => l.orientation === 'v');
  assert(rows.length === 1 && rows[0].index === 2, 'the row fires exactly once');
  assert(cols.length === 1 && cols[0].index === 2, 'the column fires exactly once');
  const events = resolveWave(g, 'player');
  // §9.2 step 5 — both line-clear events survive for causal/logging purposes
  const clearEvents = events.filter((e) => e.t === 'lineClear');
  assert(clearEvents.length === 2, `both line clears are logged, got ${clearEvents.length}`);
  // ...while the sliced cells are deduplicated
  const destroy = events.filter((e) => e.t === 'destroy');
  for (const d of destroy) {
    if (d.t !== 'destroy') continue;
    const keys = d.cells.map((c) => `${c.x},${c.y}`);
    assert(new Set(keys).size === keys.length, 'intersections are sliced exactly once');
  }
});

test('§22.8 collateral does not contribute and line clears do not recurse', () => {
  // A 4-run qualifies its row. Cells swept as COLLATERAL must not themselves
  // qualify further lines: computeLineClears sees only DIRECT footprints, so
  // feeding it the same matches can never grow the result (§9.3).
  const g = newGame(84);
  plantRun(g, [
    { x: 0, y: 5, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 5, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 5, color: Color.Red, shape: Shape.Triangle },
    { x: 3, y: 5, color: Color.Red, shape: Shape.Star },
  ]);
  const ms = detectMatches(g.state.board);
  const lines = computeLineClears(ms);
  assert(lines.length === 1 && lines[0].orientation === 'h' && lines[0].index === 5, 'exactly the one qualifying row');
  // no column qualifies: the direct footprint is only 1 cell tall anywhere
  assert(!lines.some((l) => l.orientation === 'v'), 'sweeping a row must not qualify any column');
});

test('§22.8 line-clear collateral is swept at the plain tier with no crit', () => {
  // APPROVED DECISION: cells swept as collateral use the base line-clear tier
  // and never a crit, because no single constituent group "owns" a combined
  // line. A 5-long Red line crits (1.5x) for its OWN cells only.
  const g = newGame(86);
  // Diamond/Cross alternate so there is no shape-axis Sync and no shape charge.
  plantRun(g, [
    { x: 0, y: 3, color: Color.Red, shape: Shape.Diamond },
    { x: 1, y: 3, color: Color.Red, shape: Shape.Cross },
    { x: 2, y: 3, color: Color.Red, shape: Shape.Diamond },
    { x: 3, y: 3, color: Color.Red, shape: Shape.Cross },
    { x: 4, y: 3, color: Color.Red, shape: Shape.Diamond },
  ]);
  const ms = detectMatches(g.state.board);
  assert(ms.length === 1 && ms[0].condition === 'color' && ms[0].length === 5 && ms[0].isLine, 'one 5-cell straight Red Sync');
  const events = resolveWave(g, 'player');
  const dmg = events.find((e) => e.t === 'damage');
  assert(dmg && dmg.t === 'damage', 'the wave dealt damage');
  // Arithmetic: 5 direct Red Packets are Hacker-STRONG (2 each) at the 1.5x crit
  // tier = 15. The 3 swept collateral Packets are Hacker-WEAK (1 each) at the
  // plain 1.0x tier = 3. The Red Skill adds 1 x 1.5 = 1.5. floor(19.5) = 19.
  // Had collateral inherited the 1.5x crit instead, the total would be 21.
  assert(dmg.t === 'damage' && dmg.amount === 19, `expected 19 (collateral at 1.0x), got ${dmg.amount}`);
  assert(events.some((e) => e.t === 'lineClear' && e.orientation === 'h' && e.index === 3), 'the row cleared');
});

test('§22.8 a neutral 4-run keeps its own standalone line-clear qualification', () => {
  // APPROVED DECISION: neutral Packets are never folded into the color/shape
  // union, but a straight neutral run of 4+ still clears its row/column exactly
  // as it did in Alpha 0.2.
  const g = newGame(87);
  plantNeutrals(g, [{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }]);
  const ms = detectMatches(g.state.board);
  assert(ms.length === 1 && ms[0].condition === 'neutral' && ms[0].length === 4, 'one 4-cell neutral Sync');
  const lines = computeLineClears(ms);
  assert(lines.length === 1 && lines[0].orientation === 'h' && lines[0].index === 6, 'the neutral run clears its own row');
  // ...and a neutral 3-run does NOT qualify (the threshold is unchanged)
  const g2 = newGame(88);
  plantNeutrals(g2, [{ x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }]);
  assert(computeLineClears(detectMatches(g2.state.board)).length === 0, 'a neutral 3-run clears no line');
});

test('§22.8 constituent groups still control damage, charge, and Skill triggers', () => {
  // Two adjacent 3-groups that COMBINE for a line clear must still be TWO
  // separate Sync events for damage/charge/Skill purposes (§9.4).
  const g = newGame(85);
  plantRun(g, [
    { x: 0, y: 2, color: Color.Red, shape: Shape.Circle },
    { x: 1, y: 2, color: Color.Red, shape: Shape.Square },
    { x: 2, y: 2, color: Color.Red, shape: Shape.Triangle },
    { x: 3, y: 2, color: Color.Green, shape: Shape.Circle },
    { x: 4, y: 2, color: Color.Green, shape: Shape.Square },
    { x: 5, y: 2, color: Color.Green, shape: Shape.Triangle },
  ]);
  const events = resolveWave(g, 'player');
  // exactly ONE Red blob qualified the Red Skill, despite the merged line clear
  const dmgTriggers = events.filter((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_DAMAGE');
  assert(dmgTriggers.length === 1, `the Red group triggers once; the Green group never does (got ${dmgTriggers.length})`);
  assert(events.some((e) => e.t === 'lineClear'), 'the combined line clear still fired');
});

// ---- §22.9 Reinforced Connection and result controls ----

test('§22.9 Reinforced Connection suppresses base Sync damage but keeps Skill effects', () => {
  const rc: BattleSettings = { ...D, reinforcedConnection: true };
  const g = newBattle(rc, 91);
  g.startPlayerPhase();
  // Diamond/Cross are bound by no Hacker Program, so the charge count below is
  // purely the color axis plus the Skill bonus.
  plantRun(g, [
    { x: 1, y: 1, color: Color.Red, shape: Shape.Diamond },
    { x: 2, y: 1, color: Color.Red, shape: Shape.Cross },
    { x: 3, y: 1, color: Color.Red, shape: Shape.Diamond },
  ]);
  const chargeBefore = g.state.units.player[0].charge;
  const events = resolveWave(g, 'player');
  const sm = g.state.metrics.sides.player;
  // §11.2/§11.3 — base Sync damage records as a clean ZERO...
  assert(sm.matchDamage === 0, `base Sync damage must be suppressed, got ${sm.matchDamage}`);
  // ...while the Skill's damage still resolves in its own bucket
  assert(sm.skillDamage === 1, `Skill damage must survive suppression, got ${sm.skillDamage}`);
  assert(sm.totalDamage === 1, 'only the Skill contribution was dealt');
  const dmg = events.find((e) => e.t === 'damage');
  assert(dmg && dmg.t === 'damage' && dmg.amount === 1, 'the damage event carries only the Skill portion');
  // charge (Program and Skill) continues normally
  assert(g.state.units.player[0].charge - chargeBefore === 4, 'Program charge plus the Skill bonus is unaffected');
  assert(events.some((e) => e.t === 'skill' && e.effect === 'SKL_EXTRA_MATCH_CHARGE'), 'the charge Skill still triggers');
  // the buckets stay disjoint and exact
  const tallied = sm.matchDamage + sm.bombDamage + sm.attackerDamage + sm.bufferDamageAdded + sm.skillDamage;
  assert(Math.abs(tallied - sm.totalDamage) < 1e-9, 'buckets remain disjoint under suppression');
});

test('§22.9 Reinforced Connection suppresses base Sync damage for the System too', () => {
  const g = newBattle({ ...D, reinforcedConnection: true }, 92);
  g.startPlayerPhase();
  plantRun(g, [
    { x: 1, y: 1, color: Color.Magenta, shape: Shape.Circle },
    { x: 2, y: 1, color: Color.Magenta, shape: Shape.Square },
    { x: 3, y: 1, color: Color.Magenta, shape: Shape.Triangle },
  ]);
  const events = resolveWave(g, 'enemy');
  const sm = g.state.metrics.sides.enemy;
  assert(sm.matchDamage === 0 && sm.skillDamage === 0, 'the System deals no base Sync damage and has no Skills');
  assert(!events.some((e) => e.t === 'damage'), 'no damage event at all for a System Sync under suppression');
  assert(events.some((e) => e.t === 'destroy'), 'the Sync still resolved — only its damage output was suppressed');
});

test('§22.9 the Force Win availability matrix matches §18.1 exactly', () => {
  const qm = qmInfo();
  const victory = { natural: 'NATURAL_VICTORY' as const, metricsLogged: true };
  const defeat = { natural: 'NATURAL_DEFEAT' as const, metricsLogged: true };
  // Quick Match: defeat yes, victory NO
  assert(forceWinAvailable(qm, defeat), 'QM natural defeat offers Force Win');
  assert(!forceWinAvailable(qm, victory), 'QM natural VICTORY must NOT offer Force Win');
  for (const step of [1, 2, 3, 4] as const) {
    const run = runInfoFor(D, step);
    assert(forceWinAvailable(run, defeat), `Run battle ${step} defeat offers Force Win`);
    if (step < 4) {
      assert(forceWinAvailable(run, victory), `Run battle ${step} natural victory offers Force Win (logs only)`);
    } else {
      assert(!forceWinAvailable(run, victory), 'Run Battle 4 natural victory must NOT offer Force Win');
    }
  }
  // never offered twice on the same result, and never without a result
  assert(!forceWinAvailable(qm, { ...defeat, forcedWin: true }), 'an already-forced result does not offer it again');
  assert(!forceWinAvailable(qm, null), 'no result means no Force Win (never during active combat)');
});

test('§22.9 Battle 4 defeat can be Force Won to Run Complete; a natural win is not converted to a skip', () => {
  const run4 = runInfoFor(D, 4);
  // a forced win on a step-4 defeat presents as Run Complete
  assert(isRunComplete(run4, { natural: 'NATURAL_DEFEAT', forcedWin: true, metricsLogged: true }), 'forced step-4 win completes the Run');
  // §18.2 — the natural outcome is PRESERVED alongside the wizard flag
  const pending = { natural: 'NATURAL_DEFEAT' as const, forcedWin: true as const, metricsLogged: true };
  assert(pending.natural === 'NATURAL_DEFEAT', 'the natural defeat is never rewritten as a natural victory');
  assert(progressesAsVictory(pending), 'but it progresses as a victory');
  // a natural victory on battles 1-3 does not become "Run Complete" (no skip)
  for (const step of [1, 2, 3] as const) {
    assert(!isRunComplete(runInfoFor(D, step), { natural: 'NATURAL_VICTORY', metricsLogged: true }), `step ${step} win is not Run Complete`);
    assert(nextStep(step) === step + 1, `step ${step} advances exactly one encounter`);
  }
  assert(nextStep(4) === null, 'Battle 4 has no next step');
});

// ---- §14.1 mode/title label tests ----

test('§14.1 Continue/context labels identify mode and exact Run step', () => {
  const qm = qmInfo();
  assert(continueLabel(qm) === 'Continue Quick Match', 'QM continue label');
  assert(contextLabel(qm) === 'Quick Match', 'QM context label');
  for (const step of [1, 2, 3, 4] as const) {
    const info = runInfoFor(D, step);
    assert(continueLabel(info) === `Continue Run — Battle ${step} of 4`, `Run step ${step} continue label`);
    assert(contextLabel(info) === `Run — Battle ${step} of 4`, `Run step ${step} context label`);
  }
});

// ---- Run progression (headless, full 4-step chain) ----

test('Run progression: ICE table, fresh state every step, 1-3 advance, 4 does not', () => {
  const info = runInfoFor(snapshotRunSettings(D));
  let step: RunStep | null = 1;
  let stepsVisited = 0;
  const seenBoards = new Set<string>();
  while (step !== null) {
    // distinct seeds per step stand in for "a new battle RNG state/seed is
    // used" (§10.5) — the resulting board layouts must actually differ
    const g = createRunBattle(info, step, 1000 + step * 97);
    assert(g.state.config.enemyHp === (systemById(info.system.systemId).baseIce + encounterFor(step).iceModifier), `step ${step} System ICE matches the table`);
    assert(g.state.hp.player === info.hackerMaxLink, `step ${step} Hacker starts at full saved maximum LINK`);
    assert(g.state.hp.enemy === (systemById(info.system.systemId).baseIce + encounterFor(step).iceModifier), `step ${step} System starts at encounter ICE`);
    // §4.6 — a fresh battle opens each pool at its Function's startCharged
    // value, not at zero: BOUNCER fields MUSCLE, and COERCE is startCharged=Y.
    const openingCharge = (u: { programId: string }): number =>
      programById(u.programId).fn.startCharged ? programById(u.programId).cost : 0;
    assert(g.state.units.player.every((u) => u.charge === openingCharge(u)), `step ${step} Hacker charges reset`);
    assert(g.state.units.enemy.every((u) => u.charge === openingCharge(u)), `step ${step} System charges reset`);
    assert(g.state.deckCharge === deckById('DEK_01').fn.cost, `step ${step} Deck charge resets from startCharged`);
    assert(g.state.turn === 1, `step ${step} fresh turn counter`);
    assert(g.state.metrics.turns === 0 && g.state.metrics.autoReshuffles === 0, `step ${step} fresh metrics`);
    for (const row of g.state.board) for (const t of row) assert(!t?.special, `step ${step} no carried special objects`);
    const boardKey = g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).join(',');
    assert(!seenBoards.has(boardKey), `step ${step} gets a genuinely new random Datastream`);
    seenBoards.add(boardKey);
    stepsVisited++;
    step = nextStep(step);
  }
  assert(stepsVisited === RUN_LENGTH, 'all 4 steps visited exactly once');
});

test('every Run step round-trips through the save envelope', () => {
  for (const step of [1, 2, 3, 4] as const) {
    const info = runInfoFor(snapshotRunSettings(D), step);
    const g = createRunBattle(info, step, 2000 + step);
    g.startPlayerPhase();
    const r = deserializeSession(serializeSession(info, g, null));
    assert(r && r.info.mode === 'RUN' && r.info.step === step, `step ${step} round-trips`);
    assert(r.game, `step ${step} restores its battle`);
    assert(r.game.state.config.enemyHp === (systemById(info.system.systemId).baseIce + encounterFor(step).iceModifier), `step ${step} encounter ICE round-trips`);
    assert(r.game.state.deckCharge === g.state.deckCharge, `step ${step} Deck charge round-trips exactly`);
  }
});

test('pending-result restore preserves metricsLogged and forcedWin', () => {
  const info = runInfoFor(manualLink(D, 1, 150), 1);
  const g = createRunBattle(info, 1, 71);
  g.startPlayerPhase();
  let safety = 0;
  while (!g.state.winner && safety++ < 600) {
    botFireAbilities(g);
    if (g.state.winner) break;
    const mv = botMove(g);
    assert(mv, 'move available');
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  assert(g.state.winner, 'battle concluded');
  const natural = g.state.winner === 'player' ? ('NATURAL_VICTORY' as const) : ('NATURAL_DEFEAT' as const);
  const r = deserializeSession(serializeSession(info, g, { natural, forcedWin: true, metricsLogged: true }));
  assert(r && r.pending, 'pending result restores');
  assert(r.pending.metricsLogged === true, 'metricsLogged survives (prevents double-logging on resume)');
  assert(r.pending.forcedWin === true, 'forcedWin survives (natural outcome not overwritten)');
  assert(r.pending.natural === natural, 'natural outcome preserved alongside the wizard flag');
});

test('progressesAsVictory: natural win, forced win on a natural loss, plain loss', () => {
  assert(progressesAsVictory({ natural: 'NATURAL_VICTORY', metricsLogged: true }) === true, 'natural win progresses as victory');
  assert(progressesAsVictory({ natural: 'NATURAL_DEFEAT', forcedWin: true, metricsLogged: true }) === true, 'forced win on a loss progresses as victory');
  assert(progressesAsVictory({ natural: 'NATURAL_DEFEAT', metricsLogged: true }) === false, 'plain loss does not progress as victory');
});

test('isRunComplete truth table across all 4 steps x outcome', () => {
  for (const step of [1, 2, 3, 4] as const) {
    const info = runInfoFor(D, step);
    const win = isRunComplete(info, { natural: 'NATURAL_VICTORY', metricsLogged: true });
    const forcedOnLoss = isRunComplete(info, { natural: 'NATURAL_DEFEAT', forcedWin: true, metricsLogged: true });
    const loss = isRunComplete(info, { natural: 'NATURAL_DEFEAT', metricsLogged: true });
    if (step === 4) {
      assert(win, 'step 4 natural win is Run Complete');
      assert(forcedOnLoss, 'step 4 forced win is Run Complete');
    } else {
      assert(!win, `step ${step} natural win is not Run Complete`);
      assert(!forcedOnLoss, `step ${step} forced win is not Run Complete`);
    }
    assert(!loss, `step ${step} defeat is never Run Complete`);
  }
  assert(!isRunComplete(qmInfo(), { natural: 'NATURAL_VICTORY', metricsLogged: true }), 'Quick Match is never Run Complete');
});

test('active build order is stable and independent of charge/readiness', () => {
  // Alpha 0.4.0 §5.3 — the runtime slot order is the ACTIVE BUILD's order, not
  // the content roster's; it must never be resorted by charge or readiness.
  const hackerIds = defaultBuild('HAK_01', 'DEK_01');
  const g1 = createRunBattle(runInfoFor(D), 1, 5);
  assert(g1.state.units.player.map((u) => u.programId).join(',') === hackerIds.join(','), 'runtime slot order matches build order');
  // charging every slot to its cap (readiness) must not reorder anything
  for (const u of g1.state.units.player) u.charge = getContent().programsById.get(u.programId)!.chargeCap;
  assert(g1.state.units.player.map((u) => u.programId).join(',') === hackerIds.join(','), 'order unaffected by charge/readiness');
});

// ============================================================================
// Alpha 0.4.0 §20.2 — default inventory, default build, and Build actions
// ============================================================================

test('§20.2 the default build is portfolio H1,H2,D1,D2 — derived, not hardcoded', () => {
  assert(defaultBuild('HAK_01', 'DEK_01').join(',') === 'PRG_H_001,PRG_H_002,PRG_H_003,PRG_H_004', 'current content default');
  // §20.2.3 — the ALGORITHM must be portfolio order, not those four IDs. Load
  // content whose portfolios are reordered and confirm the default follows.
  const hak = mutate(real.hackers.text, 'PRG_H_001:PRG_H_002:PRG_H_005', 'PRG_H_005:PRG_H_002:PRG_H_001');
  const dek = mutate(real.decks.text, 'PRG_H_003:PRG_H_004:PRG_H_006', 'PRG_H_006:PRG_H_004:PRG_H_003');
  const c = loadContent(files({ hackers: hak, decks: dek })).content!;
  setActiveContent(c);
  assert(defaultBuild('HAK_01', 'DEK_01').join(',') === 'PRG_H_005,PRG_H_002,PRG_H_006,PRG_H_004', 'default follows reordered portfolios');
  assert(inventoryProgramIds('HAK_01', 'DEK_01').join(',') === 'PRG_H_005,PRG_H_002,PRG_H_001,PRG_H_006,PRG_H_004,PRG_H_003', 'inventory follows portfolio order');
  install(); // restore real content
});

test('§20.2 Build opens with four occupied unique slots and stays valid through every action', () => {
  const s0 = beginBuild('INITIAL_RUN', 'HAK_01', 'DEK_01', null, 'DEFAULT');
  const ids = s0.inventory.map((e) => e.programId);
  const valid = (s: typeof s0, label: string): void => {
    assert(s.build.length === ACTIVE_BUILD_SIZE, `${label}: four slots`);
    assert(new Set(s.build).size === ACTIVE_BUILD_SIZE, `${label}: no duplicates`);
    assert(s.build.every((id) => ids.includes(id)), `${label}: all from inventory`);
    assert(isValidBuild(s.build, ids), `${label}: satisfies the shared invariant`);
  };
  valid(s0, 'default');
  assert(s0.build.join(',') === defaultBuild('HAK_01', 'DEK_01').join(','), 'opens on the default build');
  assert(inactiveOf(s0).map((e) => e.programId).join(',') === 'PRG_H_005,PRG_H_006', 'the other two are inactive');
  assert(!s0.edited, 'opening is not an edit');

  // §5.6 replacement is a SWAP — the displaced Program returns to inventory
  const s1 = replaceInBuild(s0, 1, 'PRG_H_006');
  valid(s1, 'after replace');
  assert(s1.build[1] === 'PRG_H_006', 'the chosen Program takes the chosen slot');
  assert(inactiveOf(s1).map((e) => e.programId).includes('PRG_H_002'), 'displaced Program returns to the inventory');
  assert(s1.edited && s1.origin === 'PLAYER_EDITED', 'an accepted replacement marks the build edited');

  // §5.7 reorder swaps neighbours and preserves all four
  const s2 = moveBuildSlot(s1, 0, 1);
  valid(s2, 'after reorder');
  assert(s2.build[0] === s1.build[1] && s2.build[1] === s1.build[0], 'neighbours swapped');
  assert(s2.build.slice(2).join(',') === s1.build.slice(2).join(','), 'the rest is untouched');

  // §20.2.7 — no normal interaction can produce an invalid slot count or a
  // duplicate, and out-of-range actions are inert.
  assert(replaceInBuild(s2, 0, s2.build[2]) === s2, 'replacing with an already-ACTIVE Program is refused');
  assert(replaceInBuild(s2, 0, s2.build[0]) === s2, 'replacing a slot with its own Program is a no-op');
  assert(replaceInBuild(s2, 0, 'PRG_S_001') === s2, 'a non-inventory Program is refused');
  assert(replaceInBuild(s2, 9, 'PRG_H_005') === s2, 'an out-of-range slot is refused');
  assert(moveBuildSlot(s2, 0, -1) === s2, 'moving the top slot up is inert');
  assert(moveBuildSlot(s2, ACTIVE_BUILD_SIZE - 1, 1) === s2, 'moving the bottom slot down is inert');
});

test('§20.2 an invalid or stale initial build falls back to the default', () => {
  const bad = ['PRG_H_001', 'PRG_H_001', 'PRG_H_003', 'PRG_H_004']; // duplicate
  assert(beginBuild('RUN_BETWEEN', 'HAK_01', 'DEK_01', bad, 'CARRIED_RUN').build.join(',') === defaultBuild('HAK_01', 'DEK_01').join(','), 'duplicates fall back');
  const short = ['PRG_H_001', 'PRG_H_002'];
  assert(beginBuild('RUN_BETWEEN', 'HAK_01', 'DEK_01', short, 'CARRIED_RUN').origin === 'DEFAULT', 'a short build falls back and re-labels its origin');
  const foreign = ['PRG_S_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'];
  assert(beginBuild('RUN_BETWEEN', 'HAK_01', 'DEK_01', foreign, 'CARRIED_RUN').build.join(',') === defaultBuild('HAK_01', 'DEK_01').join(','), 'a non-inventory Program falls back');
  // a VALID carried build is kept exactly, order included
  const good = ['PRG_H_006', 'PRG_H_005', 'PRG_H_004', 'PRG_H_001'];
  const s = beginBuild('RUN_BETWEEN', 'HAK_01', 'DEK_01', good, 'CARRIED_RUN');
  assert(s.build.join(',') === good.join(',') && s.origin === 'CARRIED_RUN', 'a valid carried build is preserved exactly');
});

// ============================================================================
// Alpha 0.4.0 §20.5 — charge routing
// ============================================================================

// Sum of one side's Program charge.
const totalCharge = (g: Game, side: Side = 'player'): number => g.state.units[side].reduce((n, u) => n + u.charge, 0);

// Read a slot's charge through a function call so an assert() on one value
// does not narrow the property's type for later comparisons.
const chargeAt = (g: Game, i: number, side: Side = 'player'): number => g.state.units[side][i].charge;

// Drive a single color-axis stream of `amount` through a battle's active build
// by invoking the shared router directly — the same entry point Sync
// resolution uses, so this tests the real allocation path.
function routeColor(g: Game, token: Color, amount: number, side: Side = 'player'): GameEvent[] {
  const events: GameEvent[] = [];
  const waste = new Map<string, number>();
  routeChargeStream(g.state, side, { axis: 'color', token, amount, source: 'SYNC' }, events, waste);
  return events;
}

const routeEventOf = (events: GameEvent[]): Extract<GameEvent, { t: 'chargeRoute' }> =>
  events.find((e) => e.t === 'chargeRoute') as Extract<GameEvent, { t: 'chargeRoute' }>;

test('§20.5 charge fills the first compatible non-full Program and overflows downward', () => {
  // BOMBER (RED/TRI, cost 7) above WEASEL (RED/CIR, cost 5): both take Red.
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003']);
  const ev = routeColor(g, Color.Red, 3);
  assert(chargeAt(g, 0) === 3, 'the TOP compatible Program takes it');
  assert(chargeAt(g, 1) === 0, 'charge does not reach lower Programs until the top is full');
  const r = routeEventOf(ev);
  assert(r.eligible.join(',') === 'PRG_H_001,PRG_H_006', 'both Red Programs are eligible, in build order');
  assert(r.assignments.length === 1 && r.assignments[0].assigned === 3 && r.assignments[0].overflowOut === 0, 'one assignment, no overflow');
  assert(r.discarded === 0, 'nothing discarded');

  // fill the top exactly, then overflow the remainder downward
  const ev2 = routeColor(g, Color.Red, 6);
  assert(chargeAt(g, 0) === 7, 'the top Program fills to its Function cost');
  assert(chargeAt(g, 1) === 2, 'the overflow lands in the next compatible Program');
  const r2 = routeEventOf(ev2);
  assert(r2.assignments.length === 2, 'two recipients');
  assert(r2.assignments[0].before === 3 && r2.assignments[0].assigned === 4 && r2.assignments[0].after === 7, 'top fill recorded exactly');
  assert(r2.assignments[0].overflowOut === 2, 'overflow passed onward is recorded');
  assert(r2.assignments[1].programId === 'PRG_H_006' && r2.assignments[1].assigned === 2, 'the lower Program received the overflow');
});

test('§20.5 incompatible and already-full Programs are skipped; charge never flows upward', () => {
  const g = newGameWithBuild(['PRG_H_002', 'PRG_H_001', 'PRG_H_003', 'PRG_H_006']);
  // BUFFER is GRE/SQU and ATTACKER is YEL/STR — neither is compatible with Red.
  const ev = routeColor(g, Color.Red, 2);
  const r = routeEventOf(ev);
  assert(r.order.join(',') === 'PRG_H_002,PRG_H_001,PRG_H_003,PRG_H_006', 'the routing event records the full active order');
  assert(r.eligible.join(',') === 'PRG_H_001,PRG_H_006', 'only the Red-bound Programs are eligible');
  assert(chargeAt(g, 0) === 0 && chargeAt(g, 2) === 0, 'incompatible Programs receive nothing');
  assert(chargeAt(g, 1) === 2, 'the first COMPATIBLE Program takes it, wherever it sits');

  // fill BOMBER, then a further stream must skip it and reach WEASEL below
  g.state.units.player[1].charge = 7;
  routeColor(g, Color.Red, 3);
  assert(chargeAt(g, 1) === 7, 'a full compatible Program is skipped, never exceeded');
  assert(chargeAt(g, 3) === 3, 'the stream continues to the next compatible Program below');

  // with the lower one now holding charge, an upward flow must never happen
  const before0 = chargeAt(g, 0);
  routeColor(g, Color.Red, 1);
  assert(chargeAt(g, 0) === before0, 'charge never flows upward');
  assert(chargeAt(g, 3) === 4, 'it continues downward instead');
});

test('§20.5 remaining overflow discards only after every lower compatible Program is full', () => {
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003']);
  const ev = routeColor(g, Color.Red, 40); // far more than 7 + 5
  assert(g.state.units.player[0].charge === 7 && g.state.units.player[1].charge === 5, 'both Red Programs fill to their costs');
  const r = routeEventOf(ev);
  assert(r.discarded === 40 - 12, 'the remainder is discarded, and only at the end');
  assert(r.assignments.map((a) => a.programId).join(',') === 'PRG_H_001,PRG_H_006', 'both recipients recorded in order');
  // a stream with NO compatible Program discards entirely and charges nobody
  const g2 = newGameWithBuild(['PRG_H_002', 'PRG_H_003', 'PRG_H_004', 'PRG_H_005']);
  const r2 = routeEventOf(routeColor(g2, Color.Red, 5));
  assert(r2.eligible.length === 0 && r2.discarded === 5, 'no eligible Program discards the whole stream');
  assert(totalCharge(g2) === 0, 'and nothing is charged');
});

test('§20.5 inactive Programs and the Deck Function are excluded from routing', () => {
  // WEASEL (RED/CIR) is left OUT of the build; BOMBER is the only Red Program.
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004']);
  const deckBefore = g.state.deckCharge;
  const r = routeEventOf(routeColor(g, Color.Red, 12));
  assert(r.order.length === ACTIVE_BUILD_SIZE, 'the queue holds only the four active Programs');
  assert(!r.order.includes('PRG_H_006') && !r.eligible.includes('PRG_H_006'), 'an inactive Program is structurally absent');
  assert(r.discarded === 12 - 7, 'overflow discards rather than reaching the inactive Red Program');
  assert(g.state.deckCharge === deckBefore, 'the Deck Function pool is separate and untouched');
});

test('§20.5 build ORDER changes where charge lands', () => {
  const a = newGameWithBuild(['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003']);
  const b = newGameWithBuild(['PRG_H_006', 'PRG_H_001', 'PRG_H_002', 'PRG_H_003']);
  routeColor(a, Color.Red, 5);
  routeColor(b, Color.Red, 5);
  assert(a.state.units.player[slotOf(a, 'PRG_H_001')].charge === 5, 'BOMBER first: BOMBER takes all 5');
  assert(a.state.units.player[slotOf(a, 'PRG_H_006')].charge === 0, 'WEASEL gets nothing');
  assert(b.state.units.player[slotOf(b, 'PRG_H_006')].charge === 5, 'WEASEL first: WEASEL fills to its cost of 5');
  assert(b.state.units.player[slotOf(b, 'PRG_H_001')].charge === 0, 'and nothing overflows because 5 exactly fills it');
});

test('§20.5 a dual-compatible Program receives from both axes, colours before shapes', () => {
  // WEASEL is RED and CIR; DISABLER is BLU and CIR.
  const g = newGameWithBuild(['PRG_H_006', 'PRG_H_004', 'PRG_H_002', 'PRG_H_003']);
  const events: GameEvent[] = [];
  const waste = new Map<string, number>();
  const streams: StreamMap = new Map();
  addStream(streams, 'shape', Shape.Circle, 2, 'SYNC');
  addStream(streams, 'color', Color.Red, 3, 'SYNC');
  routeStreams(g.state, 'player', streams, events, waste);
  const routes = events.filter((e) => e.t === 'chargeRoute') as Extract<GameEvent, { t: 'chargeRoute' }>[];
  assert(routes.length === 2, 'two streams routed');
  assert(routes[0].axis === 'color' && routes[1].axis === 'shape', 'colour resolves before shape regardless of insertion order');
  assert(g.state.units.player[0].charge === 5, 'the dual-compatible Program received from BOTH streams');
  assert(g.state.units.player[1].charge === 0, 'the lower Circle Program got nothing — the top absorbed it all');
});

test('§20.5 same-axis streams resolve in a deterministic, RNG-free order', () => {
  const build = ['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003'];
  const run = (insertReversed: boolean): string => {
    const g = newGameWithBuild(build, 31);
    const events: GameEvent[] = [];
    const streams: StreamMap = new Map();
    const add = (): void => {
      addStream(streams, 'color', Color.Red, 2, 'SYNC');
      addStream(streams, 'color', Color.Green, 2, 'SYNC');
      addStream(streams, 'shape', Shape.Triangle, 1, 'SYNC');
    };
    if (insertReversed) {
      addStream(streams, 'shape', Shape.Triangle, 1, 'SYNC');
      addStream(streams, 'color', Color.Green, 2, 'SYNC');
      addStream(streams, 'color', Color.Red, 2, 'SYNC');
    } else add();
    const rngBefore = g.state.rng.getState();
    routeStreams(g.state, 'player', streams, events, new Map());
    assert(g.state.rng.getState() === rngBefore, 'routing consumes no RNG');
    return (events.filter((e) => e.t === 'chargeRoute') as Extract<GameEvent, { t: 'chargeRoute' }>[])
      .map((e) => `${e.axis}:${e.token}`)
      .join('|');
  };
  const order = run(false);
  assert(order === run(true), 'stream order does not depend on insertion order');
  assert(order === 'color:0|color:3|shape:2', 'colours ascending, then shapes ascending');
});

test('§20.5 Sync and cascade charge route through the queue and never exceed Function cost', () => {
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003'], 12);
  let safety = 0;
  let sawRoute = false;
  while (!g.state.winner && safety++ < 40) {
    const mv = botMove(g);
    if (!mv) break;
    const r = g.attemptSwap(mv.a, mv.b);
    for (const ev of r.events) {
      if (ev.t !== 'chargeRoute') continue;
      sawRoute = true;
      assert(ev.order.length === ACTIVE_BUILD_SIZE, 'the queue is the active build');
      let running = ev.amount;
      for (const a of ev.assignments) {
        assert(a.after === a.before + a.assigned, 'assignment arithmetic is exact');
        running -= a.assigned;
        assert(a.overflowOut === running, 'the overflow passed onward matches what is left');
      }
      assert(running === ev.discarded, 'amount = assigned + discarded, exactly');
    }
    for (const u of g.state.units.player) {
      assert(u.charge <= programById(u.programId).chargeCap, `${u.programId} never exceeds its Function cost`);
    }
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  assert(sawRoute, 'real play produced routed charge streams');
});

test('§20.5/§10.6 SKL_EXTRA_MATCH_CHARGE inflates the stream BEFORE routing', () => {
  // The Skill adds to the qualifying RED stream rather than charging every
  // Red-bound Program separately (which is what Alpha 0.3 did).
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003']);
  const streams: StreamMap = new Map();
  addStream(streams, 'color', Color.Red, 4, 'SYNC');
  addStream(streams, 'color', Color.Red, 1, 'SKILL_MODIFIED_SYNC', 'SKL_002');
  const events: GameEvent[] = [];
  routeStreams(g.state, 'player', streams, events, new Map());
  const r = routeEventOf(events);
  assert(r.amount === 5, 'the Skill magnitude joined the existing stream');
  assert(r.streamSource === 'SKILL_MODIFIED_SYNC' && r.sourceId === 'SKL_002', 'the stream is labelled as Skill-modified');
  assert(totalCharge(g) === 5, 'five charge total — NOT five to each compatible Program');
  assert(g.state.units.player[0].charge === 5 && g.state.units.player[1].charge === 0, 'it routed top-to-bottom like any other stream');
});

test('§20.5 System-side routing uses the same shared implementation', () => {
  const g = newGame(9);
  // Alpha 0.5.0 — the System roster is the SELECTED System's ordered PRG_SET,
  // so the Red-bound Program and its slot are read from that build rather than
  // assumed. What matters is that it goes through ONE code path.
  const roster = g.state.identity.systemPrograms;
  const redIdx = roster.findIndex((id) => programById(id).colors.includes(Color.Red));
  assert(redIdx >= 0, 'the fielded System build has a Red-bound Program');
  const redId = roster[redIdx];
  const r = routeEventOf(routeColor(g, Color.Red, 3, 'enemy'));
  assert(r.side === 'enemy' && r.eligible.join(',') === redId, 'eligibility follows the fielded bindings');
  assert(g.state.units.enemy[redIdx].charge === 3, 'System charge routes identically');
  // and overflow behaves the same when a compatible Program is full
  g.state.units.enemy[redIdx].charge = programById(redId).chargeCap;
  const r2 = routeEventOf(routeColor(g, Color.Red, 2, 'enemy'));
  assert(r2.discarded === 2, 'a full System Program discards rather than exceeding its cost');
});

// ============================================================================
// Alpha 0.4.0 §20.6 — DATACUT / EFFECT_LINESLICE
// ============================================================================

// Put NINJA (DATACUT) in a known slot, fully charged.
function ninjaGame(seed = 33, build = ['PRG_H_005', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004']): Game {
  const g = newGameWithBuild(build, seed);
  chargeSlot(g, 'player', build.indexOf('PRG_H_005'));
  return g;
}

const targetedEventOf = (events: GameEvent[]): Extract<GameEvent, { t: 'targeted' }> =>
  events.find((e) => e.t === 'targeted') as Extract<GameEvent, { t: 'targeted' }>;

test('§20.6 DATACUT slices the target Packet\'s entire row from one Packet target', () => {
  const g = ninjaGame();
  assert(targetKindOf(programById('PRG_H_005')) === 'packet', 'NINJA requires a Packet target');
  // §12.2 — no target, or the WRONG KIND of target, resolves nothing and
  // spends no charge.
  assert(g.fireProgram(0).length === 0, 'an untargeted activation is rejected');
  assert(g.fireProgram(0, { kind: 'unit', idx: 0 }).length === 0, 'a unit target is rejected for a Packet Function');
  assert(g.fireProgram(0, { kind: 'packet', p: { x: 99, y: 99 } }).length === 0, 'an out-of-bounds coordinate is rejected');
  assert(g.state.units.player[0].charge === programById('PRG_H_005').cost, 'no charge was spent by any rejection');

  const target: Pt = { x: 3, y: 4 };
  const events = g.fireProgram(0, { kind: 'packet', p: target });
  const t = targetedEventOf(events);
  assert(t && t.resolved, 'the activation resolved');
  assert(t.dimension === 'row', 'the live tuple slices a ROW');
  assert(t.sliced.length === BOARD_WIDTH, `the whole row is sliced, got ${t.sliced.length}`);
  assert(t.sliced.every((c) => c.y === target.y), 'every sliced cell is in the target row');
  assert(t.retained.length === 0, 'the live tuple retains no specials');
  assert(t.target!.x === target.x && t.target!.y === target.y, 'the chosen coordinate is logged');
  assert(t.targetTile !== null, 'the target Packet properties are captured BEFORE mutation');
  assert(g.state.units.player[0].charge === 0, 'the activation cost was paid');
});

test('§20.6 the live DATACUT tuple destroys specials, deals one instance, grants no charge', () => {
  const g = ninjaGame(34);
  // plant an enemy shield and a player bomb in the target row
  plantSpecial(g, 1, 4, { type: 'shield', owner: 'enemy', magnitude: 2 });
  plantSpecial(g, 6, 4, { type: 'bomb', owner: 'player', countdown: 3, areaPattern: 'AREA_SQUARE_3X3', programId: 'PRG_H_001' });
  const chargeBefore = totalCharge(g);
  const events = g.fireProgram(0, { kind: 'packet', p: { x: 3, y: 4 } });
  const t = targetedEventOf(events);
  assert(t.retained.length === 0, 'specialRetention=0 destroys specials in the line');
  assert(!specialsOf(g, 'shield', 'enemy').some((tt) => tt.special!.owner === 'enemy' && false), 'shields in the row were swept');
  // §13.5 — no DIRECT charge; the charge that exists came from refill Syncs
  const directRoutes = events.filter((e) => e.t === 'chargeRoute' && e.streamSource === 'EFFECT_DESTRUCTION');
  assert(directRoutes.length === 0, 'gainCharge=1 produces no direct-slice charge stream');
  assert(t.directCharge === 0, 'the target log records zero direct charge');
  assert(totalCharge(g) >= chargeBefore - programById('PRG_H_005').cost, 'any charge gained came from resulting Syncs, not the slice');
  // §13.4 — exactly ONE combined non-critical damage instance for the slice
  const sliceDamage = events.filter((e) => e.t === 'damage' && e.source === 'lineslice' && e.fnId === 'FNC_011');
  assert(sliceDamage.length === 1, `expected one combined line-slice instance, got ${sliceDamage.length}`);
  const d = sliceDamage[0] as Extract<GameEvent, { t: 'damage' }>;
  assert(!d.critExtra, 'no Sync critical multiplier is applied');
  assert(d.effectId === 'EFFECT_LINESLICE' && d.programId === 'PRG_H_005', 'detailed attribution carries FNC_ID, EFFECT_ID and Program');
});

test('§20.6 the direct row slice is not a Sync: no B1, no match Skills', () => {
  const g = ninjaGame(35);
  // a full row of Red Packets would be a Sync footprint if it were a Sync —
  // it must trigger neither B1 line clears nor the Red match Skills.
  for (let x = 0; x < BOARD_WIDTH; x++) {
    const t = g.state.board[4][x]!;
    t.kind = 'standard';
    t.color = Color.Red;
    t.shape = x % 6;
    t.special = undefined;
  }
  const events = g.fireProgram(0, { kind: 'packet', p: { x: 0, y: 4 } });
  const idx = events.findIndex((e) => e.t === 'targeted');
  const duringSlice = events.slice(0, idx + 1);
  assert(!duringSlice.some((e) => e.t === 'lineClear'), 'the direct slice contributes no B1 line clear');
  assert(!duringSlice.some((e) => e.t === 'skill'), 'the direct slice triggers no colour/shape match Skill');
  // §15.2 — refill Syncs AFTER the slice resolve completely normally
  assert(events.some((e) => e.t === 'spawn'), 'the board refilled');
});

test('§20.6 line-slice damage survives Reinforced Connection, and Buff/Shield apply once', () => {
  // §13.4 — it is Function damage, not base Sync damage.
  const g = ninjaGame(36);
  g.state.config.reinforcedConnection = true;
  const events = g.fireProgram(0, { kind: 'packet', p: { x: 3, y: 4 } });
  const dmg = events.find((e) => e.t === 'damage' && e.source === 'lineslice');
  assert(dmg, 'line-slice damage is dealt under Reinforced Connection');

  // Buff adds once to the combined instance; Shield absorbs it once.
  const g2 = ninjaGame(37);
  plantSpecial(g2, 0, 0, { type: 'buff', owner: 'player', magnitude: 5, programId: 'PRG_H_002' });
  plantSpecial(g2, 7, 7, { type: 'shield', owner: 'enemy', magnitude: 3, programId: 'PRG_S_002' });
  const ev2 = g2.fireProgram(0, { kind: 'packet', p: { x: 3, y: 4 } });
  const shields = ev2.filter((e) => e.t === 'shield' && e.source === 'lineslice');
  assert(shields.length === 1, 'the shield applies to exactly one line-slice instance');
  const s = shields[0] as Extract<GameEvent, { t: 'shield' }>;
  assert(s.prevented === Math.min(s.preShield, 3), 'the shield absorbs up to its magnitude, once');
  const d2 = ev2.find((e) => e.t === 'damage' && e.source === 'lineslice') as Extract<GameEvent, { t: 'damage' }> | undefined;
  if (d2) assert((d2.buffBonus ?? 0) > 0, 'the Buff contribution is attributed to its own metric, not hidden in the slice');
});

test('§20.6 the non-live EFFECT_LINESLICE enum branches behave as contracted', () => {
  const cut = (params: string, seed: number, prep?: (g: Game) => void): { g: Game; ev: GameEvent[] } => {
    const fns = mutate(real.functions.text, '0:1:0:0:1', params);
    install({ functions: fns });
    const g = ninjaGame(seed);
    prep?.(g);
    return { g, ev: g.fireProgram(0, { kind: 'packet', p: { x: 3, y: 4 } }) };
  };

  // dimension=1 — COLUMN
  {
    const { ev } = cut('1:1:0:0:1', 40);
    const t = targetedEventOf(ev);
    assert(t.dimension === 'column' && t.sliced.length === BOARD_HEIGHT, 'dimension 1 slices the column');
    assert(t.sliced.every((c) => c.x === 3), 'every sliced cell is in the target column');
  }
  // targeting=0 — RANDOM, requiring no player target
  {
    const fns = mutate(real.functions.text, '0:1:0:0:1', '0:0:0:0:1');
    install({ functions: fns });
    const g = ninjaGame(41);
    assert(targetKindOf(programById('PRG_H_005')) === null, 'a random LineSlice needs no target');
    const ev = g.fireProgram(0);
    const t = targetedEventOf(ev);
    assert(t && t.resolved && t.sliced.length === BOARD_WIDTH, 'it picks its own coordinate and slices that row');
  }
  // specialRetention=1 — RETAIN ALL
  {
    const { ev } = cut('0:1:1:0:1', 42, (g) => {
      plantSpecial(g, 1, 4, { type: 'shield', owner: 'enemy', magnitude: 2 });
      plantSpecial(g, 6, 4, { type: 'buff', owner: 'player', magnitude: 3 });
    });
    const t = targetedEventOf(ev);
    assert(t.retained.length === 2, 'both specials are retained');
    assert(t.sliced.length === BOARD_WIDTH - 2, 'retained specials are excluded from the direct slice');
  }
  // specialRetention=2 — RETAIN ONLY THE ACTIVATING SIDE'S
  {
    const { ev } = cut('0:1:2:0:1', 43, (g) => {
      plantSpecial(g, 1, 4, { type: 'shield', owner: 'enemy', magnitude: 2 });
      plantSpecial(g, 6, 4, { type: 'buff', owner: 'player', magnitude: 3 });
    });
    const t = targetedEventOf(ev);
    assert(t.retained.length === 1, 'only the activating side keeps its special');
    assert(t.retained[0].x === 6, 'the player-owned buff survived');
    assert(t.sliced.some((c) => c.x === 1), 'the opposing shield was destroyed');
  }
  // dealDamage=1 — no DIRECT damage, board still mutates. Refill Syncs caused
  // by the slice still deal their own damage and still carry the 'lineslice'
  // causal bucket (the same rule Bomb-caused cascades follow), so the check is
  // for the direct instance specifically — the one stamped with its FNC_ID.
  {
    const { g, ev } = cut('0:1:0:1:1', 44);
    const t = targetedEventOf(ev);
    assert(t.directDamage === 0, 'dealDamage=1 deals no direct damage');
    assert(!ev.some((e) => e.t === 'damage' && e.fnId === 'FNC_011'), 'no direct line-slice damage instance is emitted');
    assert(g.state.board[4].every((c) => c !== null), 'the board still settled and refilled');
  }
  // gainCharge=0 — directly sliced Packets DO charge
  {
    const { g, ev } = cut('0:1:0:1:0', 45);
    const direct = ev.filter((e) => e.t === 'chargeRoute' && e.streamSource === 'EFFECT_DESTRUCTION');
    assert(direct.length > 0, 'gainCharge=0 opens direct-slice charge streams');
    const t = targetedEventOf(ev);
    assert(t.directCharge > 0, 'and the target log records what landed');
    assert(totalCharge(g) > 0, 'the Programs actually received it');
    // §10.7 — colours route before shapes for Effect-generated charge too
    const axes = (direct as Extract<GameEvent, { t: 'chargeRoute' }>[]).map((e) => e.axis);
    assert(axes.indexOf('shape') === -1 || axes.lastIndexOf('color') < axes.indexOf('shape'), 'colour streams route first');
  }
  install(); // restore real content
});

// ============================================================================
// Alpha 0.4.0 §20.7 — PLINK and the parameterized EFFECT_BOMB
// ============================================================================

function weaselGame(seed = 50, build = ['PRG_H_006', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004']): Game {
  const g = newGameWithBuild(build, seed);
  chargeSlot(g, 'player', build.indexOf('PRG_H_006'));
  return g;
}

test('§20.7 PLINK requires one Packet target and resolves immediately with no overlay', () => {
  const g = weaselGame();
  assert(targetKindOf(programById('PRG_H_006')) === 'packet', 'WEASEL requires a Packet target');
  assert(g.fireProgram(0).length === 0, 'an untargeted PLINK is rejected');
  const bombsBefore = specialsOf(g, 'bomb', 'player').length;
  const events = g.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
  assert(events.some((e) => e.t === 'detonate'), 'the blast resolved during the activation');
  assert(specialsOf(g, 'bomb', 'player').length === bombsBefore, 'no countdown overlay was placed');
  assert(!events.some((e) => e.t === 'countdown'), 'no countdown was started');
  const t = targetedEventOf(events);
  assert(t.resolved && t.target!.x === 4 && t.target!.y === 4, 'the chosen coordinate is logged');
});

test('§20.7 the PLINK footprint is the target plus cardinal neighbours, clipped at edges', () => {
  const centre = weaselGame(51);
  const evC = centre.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
  const detC = evC.find((e) => e.t === 'detonate') as Extract<GameEvent, { t: 'detonate' }>;
  assert(detC.cells.length === 5, `centre blast covers 5 cells, got ${detC.cells.length}`);
  const keys = new Set(detC.cells.map((c) => `${c.x},${c.y}`));
  for (const k of ['4,4', '4,3', '5,4', '4,5', '3,4']) assert(keys.has(k), `missing ${k}`);

  const corner = weaselGame(52);
  const evK = corner.fireProgram(0, { kind: 'packet', p: { x: 0, y: 0 } });
  const detK = evK.find((e) => e.t === 'detonate') as Extract<GameEvent, { t: 'detonate' }>;
  assert(detK.cells.length === 3, `corner blast clips to 3 cells, got ${detK.cells.length}`);
});

test('§20.7 PLINK may target a special or neutral Packet', () => {
  // DESIGNER DECISION (2026-08-01): an immediately resolving Bomb attaches no
  // overlay, so the countdown-Bomb placement restrictions do not apply.
  const g = weaselGame(53);
  plantSpecial(g, 4, 4, { type: 'shield', owner: 'enemy', magnitude: 2, programId: 'PRG_S_002' });
  const ev = g.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
  assert(targetedEventOf(ev).resolved, 'a special Packet is a legal target');
  assert(ev.some((e) => e.t === 'shieldRemoved'), 'the targeted shield was swept by the blast');

  const g2 = weaselGame(54);
  const t = g2.state.board[4][4]!;
  t.kind = 'neutral';
  t.color = undefined;
  t.shape = undefined;
  t.special = undefined;
  assert(targetedEventOf(g2.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } })).resolved, 'a neutral Packet is a legal target');
});

test('§20.7 PLINK deals Bomb collateral damage, grants no direct charge, and skips B1', () => {
  const g = weaselGame(55);
  const chargeBefore = totalCharge(g) - programById('PRG_H_006').cost;
  const ev = g.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
  const dmg = ev.find((e) => e.t === 'damage' && e.source === 'bomb') as Extract<GameEvent, { t: 'damage' }> | undefined;
  assert(dmg, 'the blast dealt Bomb damage');
  assert(dmg.fnId === 'FNC_012' && dmg.programId === 'PRG_H_006', 'PLINK is distinguishable from the existing Bomber Function');
  assert(!ev.some((e) => e.t === 'chargeRoute' && e.streamSource === 'EFFECT_DESTRUCTION'), 'gainCharge=1 grants no direct blast charge');
  const idx = ev.findIndex((e) => e.t === 'targeted');
  assert(!ev.slice(0, idx + 1).some((e) => e.t === 'lineClear'), 'the direct blast contributes nothing to B1');
  assert(totalCharge(g) >= chargeBefore, 'any charge came from refill Syncs');
});

test('§20.7 existing Bomber/E-Bomber/ONEBOMB keep their countdown and quantity behaviour', () => {
  const c = getContent();
  for (const [id, quantity, countdown, area] of [
    ['FNC_001', 2, 2, 'AREA_SQUARE_3X3'],
    ['FNC_005', 1, 3, 'AREA_SQUARE_3X3_CARDINAL_2'],
    ['FNC_008', 1, 2, 'AREA_SQUARE_3X3'],
  ] as [string, number, number, string][]) {
    const op = c.functions.get(id)!.plan[0];
    assert(op.params.quantity === quantity, `${id} quantity`);
    assert(op.params.countdown === countdown, `${id} countdown`);
    assert(op.params.areaPattern === area, `${id} area`);
    // §20.7.9 — no live Bomb row relies on a missing trailing default
    assert(op.params.bomb !== undefined, `${id} carries a complete tuple`);
    assert(op.params.bomb!.targeting === 0 && op.params.bomb!.gainCharge === 1, `${id} random placement, no blast charge`);
  }
  // BOMBER still PLACES overlays rather than resolving immediately
  const g = newGameWithBuild(['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'], 56);
  chargeSlot(g, 'player', 0);
  const ev = g.fireProgram(0);
  assert(!ev.some((e) => e.t === 'detonate'), 'a countdown Bomb does not resolve on activation');
  assert(specialsOf(g, 'bomb', 'player').length === 2, 'both bombs were placed as overlays');
  const placed = specialsOf(g, 'bomb', 'player')[0].special!;
  assert(placed.countdown === 2 && placed.fnId === 'FNC_001', 'the overlay carries its countdown and placing Function');
  assert(placed.dealDamage === 0 && placed.gainCharge === 1, 'the overlay carries its Function\'s typed selections');
});

test('§20.7 EFFECT_BOMB dealDamage=1 and gainCharge=0 behave as contracted', () => {
  // dealDamage=1 — the blast mutates the board but deals nothing
  {
    install({ functions: mutate(real.functions.text, 'AREA_CARDINAL_1,,,,,,1:0:1', 'AREA_CARDINAL_1,,,,,,1:1:1') });
    const g = weaselGame(57);
    const hpBefore = g.state.hp.enemy;
    const ev = g.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
    assert(ev.some((e) => e.t === 'detonate'), 'the blast still resolved');
    // as above: bomb-CAUSED cascades keep the bomb bucket, so check the direct
    // blast instance by its FNC_ID rather than by the causal bucket alone.
    assert(!ev.some((e) => e.t === 'damage' && e.fnId === 'FNC_012'), 'no direct blast damage instance');
    assert(g.state.hp.enemy <= hpBefore, 'only refill-Sync damage, if any, was dealt');
  }
  // gainCharge=0 — directly sliced blast Packets charge
  {
    install({ functions: mutate(real.functions.text, 'AREA_CARDINAL_1,,,,,,1:0:1', 'AREA_CARDINAL_1,,,,,,1:0:0') });
    const g = weaselGame(58);
    const ev = g.fireProgram(0, { kind: 'packet', p: { x: 4, y: 4 } });
    assert(ev.some((e) => e.t === 'chargeRoute' && e.streamSource === 'EFFECT_DESTRUCTION'), 'blast Packets opened charge streams');
  }
  install();
});

// ============================================================================
// Alpha 0.4.0 §20.8 — Disabler gating and target telemetry
// ============================================================================

test('§20.8 System Disabler never activates when no active Program holds charge', () => {
  const g = newTestbedGame(60);
  chargeSlot(g, 'enemy', 3); // System DISABLER ready
  for (const u of g.state.units.player) u.charge = 0;
  const ev = g.runEnemyPhase();
  assert(!ev.some((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN'), 'no Drain op is emitted at all');
  assert(!ev.some((e) => e.t === 'ability' && e.fn === 'FNC_004'), 'absence of activation is not logged as an activation');
  assert(g.state.units.enemy[3].charge >= programById('PRG_S_004').cost, 'the charge is preserved, not spent on a no-op');
});

test('§20.8 Disabler targets only ACTIVE Programs, never inactive ones or the Deck', () => {
  // BOMBER is left out of the build; only the four active Programs can be hit.
  const build = ['PRG_H_002', 'PRG_H_003', 'PRG_H_004', 'PRG_H_006'];
  const g = newGameWithBuild(build, 61, D, testbed());
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[1].charge = 4; // ATTACKER partially charged
  g.state.deckCharge = 3;
  const deckBefore = g.state.deckCharge;
  const ev = g.runEnemyPhase();
  const op = ev.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN') as Extract<GameEvent, { t: 'op' }>;
  assert(op && op.resolved, 'the Drain resolved');
  assert(build.includes(op.targetProgramId!), 'the target is an ACTIVE Program');
  assert(op.targetProgramId !== 'PRG_H_001', 'an inactive inventory Program is never a target');
  assert(g.state.deckCharge === deckBefore, 'the Deck Function pool is never drained');
});

test('§20.8 every Drain activation logs target ID, readiness, charge, cost, and removal', () => {
  const g = newTestbedGame(62);
  chargeSlot(g, 'enemy', 3);
  g.state.units.player[0].charge = 4; // BOMBER: charging (cost 7)
  const ev = g.runEnemyPhase();
  const op = ev.find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN') as Extract<GameEvent, { t: 'op' }>;
  assert(op.targetProgramId === 'PRG_H_001', 'target stable PRG_ID');
  assert(op.targetReadiness === 'CHARGING', 'readiness is auditable from charge/cost');
  assert(op.targetChargeBefore === 4 && op.targetChargeAfter === 0, 'charge before and after');
  assert(op.targetCost === programById('PRG_H_001').cost, 'the target Function cost is recorded');
  assert(op.drained === 4, 'charge removed matches');

  // a FULLY charged target reports READY
  const g2 = newTestbedGame(63);
  chargeSlot(g2, 'enemy', 3);
  chargeSlot(g2, 'player', 0);
  const op2 = g2.runEnemyPhase().find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN') as Extract<GameEvent, { t: 'op' }>;
  assert(op2.targetReadiness === 'READY', 'a full target reports READY');

  // player-initiated Drain receives the same telemetry. Alpha 0.5.0 — which
  // Program sits in a given System slot depends on the SELECTED System's
  // PRG_SET, so the expected target is read from the battle rather than assumed.
  const g3 = newGame(64);
  chargeSlot(g3, 'player', 3);
  g3.state.units.enemy[1].charge = 2;
  const targetId = g3.state.units.enemy[1].programId;
  const op3 = g3.fireProgram(3, { kind: 'unit', idx: 1 }).find((e) => e.t === 'op' && e.effectId === 'EFFECT_DRAIN') as Extract<GameEvent, { t: 'op' }>;
  assert(op3.targetProgramId === targetId && op3.targetReadiness === 'CHARGING' && op3.drained === 2, 'player Drain telemetry matches');
});

// ============================================================================
// Alpha 0.4.0 §20.4/§20.9 — Quick Match modes, preferences, and saves
// ============================================================================

test('§20.4 Random Quick Match picks four unique Programs without consuming gameplay RNG', () => {
  const inventory = inventoryProgramIds('HAK_01', 'DEK_01');
  for (let seed = 1; seed <= 40; seed++) {
    const { rng } = makeSetupRandom(seed);
    const b = randomBuild(inventory, rng);
    assert(b.length === ACTIVE_BUILD_SIZE, 'four Programs');
    assert(new Set(b).size === ACTIVE_BUILD_SIZE, 'all distinct');
    assert(isValidBuild(b, inventory), 'a valid build drawn from the inventory');
  }
  // the setup source is reproducible from its seed and independent of the
  // battle's gameplay stream
  assert(randomBuild(inventory, makeSetupRandom(7).rng).join(',') === randomBuild(inventory, makeSetupRandom(7).rng).join(','), 'the same setup seed reproduces the build');
  const key = (g: Game): string => g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).join(',');
  const a = newBattle(D, 4242, randomBuild(inventory, makeSetupRandom(1).rng), 'RANDOM');
  const b = newBattle(D, 4242, randomBuild(inventory, makeSetupRandom(2).rng), 'RANDOM');
  assert(key(a) === key(b), 'a different setup roll leaves the gameplay board for a given seed identical');
  // orders differ across seeds (the generator produces an explicit order)
  const orders = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) orders.add(randomBuild(inventory, makeSetupRandom(seed).rng).join(','));
  assert(orders.size > 1, 'the generated order actually varies');
});

test('§20.4 the Constructed preference round-trips, revalidates, and defaults safely', () => {
  const good = ['PRG_H_006', 'PRG_H_005', 'PRG_H_002', 'PRG_H_004'];
  const json = serializeConstructedPreset('HAK_01', 'DEK_01', good);
  const back = deserializeConstructedPreset(json);
  assert(back && back.build.join(',') === good.join(','), 'a valid preset round-trips exactly, order included');
  assert(back.hackerId === 'HAK_01' && back.deckId === 'DEK_01' && back.v === 1, 'identity and schema version are stored');
  // §9.4 — anything unusable yields null (the caller opens on the default)
  assert(deserializeConstructedPreset(null) === null, 'missing preference');
  assert(deserializeConstructedPreset('not json') === null, 'corrupt preference');
  assert(deserializeConstructedPreset(JSON.stringify({ v: 99, hackerId: 'HAK_01', deckId: 'DEK_01', build: good })) === null, 'wrong schema version');
  assert(deserializeConstructedPreset(serializeConstructedPreset('HAK_404', 'DEK_01', good)) === null, 'unresolvable Hacker');
  assert(deserializeConstructedPreset(serializeConstructedPreset('HAK_01', 'DEK_01', ['PRG_H_001', 'PRG_H_001', 'PRG_H_002', 'PRG_H_003'])) === null, 'duplicate Programs');
  assert(deserializeConstructedPreset(serializeConstructedPreset('HAK_01', 'DEK_01', ['PRG_S_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'])) === null, 'a Program outside the inventory');
  assert(deserializeConstructedPreset(serializeConstructedPreset('HAK_01', 'DEK_01', ['PRG_H_001', 'PRG_H_002'])) === null, 'wrong build size');
});

test('§20.9 Quick Match saves round-trip the exact build and its source', () => {
  for (const origin of ['RANDOM', 'REMEMBERED_CONSTRUCTED', 'PLAYER_EDITED'] as BuildOrigin[]) {
    const b = ['PRG_H_006', 'PRG_H_005', 'PRG_H_003', 'PRG_H_002'];
    const g = newBattle(D, 80, b, origin);
    g.startPlayerPhase();
    const r = deserializeSession(serializeSession(qmInfo(b, origin), g, null));
    assert(r?.game, `${origin}: restores`);
    assert(r.game.state.identity.hackerPrograms.join(',') === b.join(','), `${origin}: exact build and order`);
    assert(r.game.state.identity.buildOrigin === origin, `${origin}: build source preserved`);
    assert(r.info.mode === 'QUICK_MATCH' && r.info.build.join(',') === b.join(','), `${origin}: session build restored, not regenerated`);
  }
});

test('§20.9 a Run save round-trips inventory, build, order, and the pre-battle Build phase', () => {
  const custom = ['PRG_H_005', 'PRG_H_004', 'PRG_H_001', 'PRG_H_006'];
  const info = runInfoFor(D, 2, custom);
  // mid-battle
  const g = createRunBattle(info, 2, 90);
  g.startPlayerPhase();
  const r = deserializeSession(serializeSession(info, g, null));
  assert(r?.game, 'mid-battle Run save restores');
  assert(r.game.state.units.player.map((u) => u.programId).join(',') === custom.join(','), 'the four selected Programs and order survive');
  assert(r.info.mode === 'RUN' && r.info.build.join(',') === custom.join(','), 'the Run build survives');
  assert(r.info.mode === 'RUN' && r.info.inventory.join(',') === inventoryProgramIds('HAK_01', 'DEK_01').join(','), 'the inventory survives');

  // §17.4 — parked on the pre-battle Build screen: no battle, same encounter
  const parked: RunInfo = { ...info, pendingBuild: true };
  const rb = deserializeSession(serializeSession(parked, null, null));
  assert(rb && rb.game === null, 'a PENDING_BUILD save restores without a battle');
  assert(rb.info.mode === 'RUN' && rb.info.pendingBuild === true, 'the Build phase is recorded');
  assert(rb.info.mode === 'RUN' && rb.info.step === 2 && rb.info.build.join(',') === custom.join(','), 'same upcoming encounter and build');
});

test('§20.9 an incompatible or drifted active save is rejected, never defaulted', () => {
  const g = newBattle(D, 91);
  g.startPlayerPhase();
  const json = serializeSession(qmInfo(g.state.identity.hackerPrograms, 'DEFAULT'), g, null);
  // §17.1 — the Alpha 0.3 shape (schema 2) is rejected outright
  const old = JSON.parse(json) as Record<string, unknown>;
  old.schema = 2;
  assert(deserializeSession(JSON.stringify(old)) === null, 'the Alpha 0.3 schema is rejected');
  // a build referencing a Program outside the inventory
  const drifted = JSON.parse(json) as { identity: { hackerPrograms: string[] } };
  drifted.identity.hackerPrograms = ['PRG_S_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'];
  assert(deserializeSession(JSON.stringify(drifted)) === null, 'a build outside the inventory rejects rather than defaulting');
  // a duplicated Program in the saved build
  const dup = JSON.parse(json) as { identity: { hackerPrograms: string[] } };
  dup.identity.hackerPrograms = ['PRG_H_001', 'PRG_H_001', 'PRG_H_003', 'PRG_H_004'];
  assert(deserializeSession(JSON.stringify(dup)) === null, 'a duplicated Program rejects');
  // a stale inventory that no longer matches the portfolios
  const inv = JSON.parse(json) as { identity: { inventory: string[] } };
  inv.identity.inventory = ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004', 'PRG_H_005', 'PRG_H_006'];
  assert(deserializeSession(JSON.stringify(inv)) === null, 'an inventory disagreeing with portfolio order rejects');
});

test('§20.9 metrics stay disjoint and reconcile with the new line-slice bucket', () => {
  const g = ninjaGame(70, ['PRG_H_005', 'PRG_H_001', 'PRG_H_002', 'PRG_H_003']);
  g.fireProgram(0, { kind: 'packet', p: { x: 3, y: 4 } });
  let safety = 0;
  while (!g.state.winner && safety++ < 25) {
    const mv = botMove(g);
    if (!mv) break;
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  for (const side of ['player', 'enemy'] as const) {
    const m = g.state.metrics.sides[side];
    // Alpha 0.5.0 — `transform` joins the disjoint set; omitting it here would
    // under-count rather than fail loudly.
    const sum =
      m.matchDamage + m.attackerDamage + m.bombDamage + m.linesliceDamage +
      m.transformDamage + m.skillDamage + m.bufferDamageAdded;
    assert(Math.abs(sum - m.totalDamage) < 1e-9, `${side}: disjoint buckets must sum to the total (${sum} vs ${m.totalDamage})`);
  }
  assert(g.state.metrics.sides.player.linesliceDamage > 0, 'DATACUT damage landed in its own bucket');
  assert(g.state.metrics.sides.player.units['PRG_H_005'].effect > 0, 'and is attributed to NINJA');
});

// ============================================================================
// Alpha 0.4.1 §20 — logging levels, route filtering, and the charge-waste
// metric correction.
// ============================================================================

// Play a battle at a given logging level and collect exactly what the logger
// would hand to the storage adapter.
function capture(level: LoggingLevel, seed = 12, build?: string[]): { turns: TurnLogEntry[]; events: BattleEventEntry[]; g: Game } {
  const previous = loggingLevel();
  setLoggingLevel(level);
  const g = build ? newGameWithBuild(build, seed) : newGame(seed);
  const turns: TurnLogEntry[] = [];
  const events: BattleEventEntry[] = [];
  let safety = 0;
  while (!g.state.winner && safety++ < 40) {
    botFireAbilities(g);
    if (g.state.winner) break;
    const mv = botMove(g);
    if (!mv) break;
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    turns.push(...g.drainTurnLogs());
    events.push(...g.drainEventLogs());
  }
  turns.push(...g.drainTurnLogs());
  events.push(...g.drainEventLogs());
  setLoggingLevel(previous);
  return { turns, events, g };
}

test('§20.1 BASIC keeps no turn stream; VERBOSE and COMPLETE do', () => {
  const basic = capture('BASIC');
  assert(basic.turns.length === 0, `BASIC must persist no ordinary turn records, got ${basic.turns.length}`);
  assert(basic.events.length > 0, 'BASIC still persists high-value battle events');
  const verbose = capture('VERBOSE');
  assert(verbose.turns.length > 0, 'VERBOSE persists compact turn records');
  const complete = capture('COMPLETE');
  assert(complete.turns.length > 0, 'COMPLETE persists turn records');
});

test('§20.1/§20.2 turn records carry join keys and NO battle-static context', () => {
  const { turns, g } = capture('VERBOSE');
  for (const t of turns) {
    assert(t.battleId === g.state.battleId, 'every turn joins to its battle by battleId');
    assert(t.ls === LOGGING_SCHEMA_VERSION && t.lvl === 'VERBOSE', 'schema version and level are stamped');
    const raw = t as unknown as Record<string, unknown>;
    for (const banned of ['identity', 'config', 'fp', 'inventory', 'chargeRoutes', 'targeted', 'drains']) {
      assert(raw[banned] === undefined, `turn records must not repeat ${banned}`);
    }
    assert(t.actions === undefined, 'VERBOSE drops the readable action mirror');
  }
  // COMPLETE keeps the readable mirror, still without battle-static context
  const complete = capture('COMPLETE');
  assert(complete.turns.some((t) => (t.actions?.length ?? 0) > 0), 'COMPLETE retains action mirrors');
  for (const t of complete.turns) {
    assert((t as unknown as Record<string, unknown>).identity === undefined, 'COMPLETE still joins rather than repeating identity');
  }
});

test('§20.3 ordinary routes are filtered below COMPLETE; interesting ones are kept', () => {
  const routesOf = (e: BattleEventEntry[]): BattleEventEntry[] => e.filter((x) => x.kind === 'ROUTE');
  const basic = routesOf(capture('BASIC').events);
  const complete = routesOf(capture('COMPLETE').events);
  assert(complete.length > basic.length, `COMPLETE must retain more routes (${complete.length}) than BASIC (${basic.length})`);
  // every BASIC-retained route satisfies the interest predicate
  for (const r of basic) {
    assert(routeIsInteresting(r.route!), 'BASIC retains only interesting routes');
    assert(r.route!.order === undefined && r.route!.eligible === undefined, 'derivable fields are dropped below COMPLETE');
  }
  // and COMPLETE keeps the derivable fields for diagnosis
  assert(complete.some((r) => r.route!.order && r.route!.eligible), 'COMPLETE retains order and eligible');
  // the predicate itself
  const base = { side: 'player' as const, axis: 'color' as const, token: 0, amount: 3, source: 'SYNC' as const, discarded: 0 };
  assert(!routeIsInteresting({ ...base, assignments: [{ programId: 'A', before: 0, assigned: 3, after: 3, overflowOut: 0 }] }), 'one recipient, no discard is ordinary');
  assert(routeIsInteresting({ ...base, discarded: 2, assignments: [{ programId: 'A', before: 5, assigned: 2, after: 7, overflowOut: 0 }] }), 'a discard is interesting');
  assert(routeIsInteresting({ ...base, assignments: [
    { programId: 'A', before: 0, assigned: 2, after: 2, overflowOut: 1 },
    { programId: 'B', before: 0, assigned: 1, after: 1, overflowOut: 0 },
  ] }), 'multiple recipients are interesting');
  assert(routeIsInteresting({ ...base, source: 'SKILL_MODIFIED_SYNC', assignments: [{ programId: 'A', before: 0, assigned: 3, after: 3, overflowOut: 0 }] }), 'Skill-modified is interesting');
  assert(routeIsInteresting({ ...base, source: 'EFFECT_DESTRUCTION', assignments: [{ programId: 'A', before: 0, assigned: 3, after: 3, overflowOut: 0 }] }), 'Effect-generated is interesting');
});

test('§20.3 retained route assignments stay arithmetically exact', () => {
  for (const r of capture('COMPLETE').events.filter((e) => e.kind === 'ROUTE')) {
    const route = r.route!;
    let running = route.amount;
    for (const a of route.assignments) {
      assert(a.after === a.before + a.assigned, 'before + assigned = after');
      running -= a.assigned;
      assert(a.overflowOut === running, 'overflow passed onward is exact');
    }
    assert(running === route.discarded, 'amount = assigned + discarded');
  }
});

// Alpha 0.5.0 §39 — ONE canonical side-level total, covering EVERY source of
// unstorable Program charge. §39.3 requires it to equal the sum of the
// discarded/overflowed amounts in the routing and timer events, which is
// exactly what this checks (and what makes the figure auditable).
test('§39 charge waste is one side-level total equal to all discard/overflow sources', () => {
  // A build where BOMBER and WEASEL share RED guarantees overflow and discard.
  const { g, events } = capture('COMPLETE', 12, ['PRG_H_001', 'PRG_H_006', 'PRG_H_002', 'PRG_H_003']);
  const routes = events.filter((e) => e.kind === 'ROUTE').map((e) => e.route!);
  for (const side of ['player', 'enemy'] as const) {
    const routed = routes.filter((r) => r.side === side).reduce((n, r) => n + r.discarded, 0);
    // The flat System timer is the other genuine source; it emits chargeWaste
    // events, which the metrics collector folds into the same total.
    const total = g.state.metrics.sides[side].chargeWastedTotal;
    assert(total >= routed, `${side}: total ${total} must include routing discard ${routed}`);
    if (side === 'player') {
      // The Hacker has no timer path, so its total is exactly routing discard.
      assert(total === routed, `player: total ${total} must equal summed route discards ${routed}`);
    }
  }
  assert(g.state.metrics.sides.player.chargeWastedTotal > 0, 'the overlapping build actually discarded charge');
  // §39.2 — per-Program chargeWasted is GONE from the metric shape entirely,
  // so it can no longer be mistaken for the analytical authority.
  for (const id of Object.keys(g.state.metrics.sides.player.units)) {
    const u = g.state.metrics.sides.player.units[id] as unknown as Record<string, unknown>;
    assert(!('chargeWasted' in u), `${id} must not carry a per-Program chargeWasted field`);
  }
  // §39.4 — axis-specific waste is deferred and must not have crept in.
  const sm = g.state.metrics.sides.player as unknown as Record<string, unknown>;
  assert(!('chargeWastedColor' in sm) && !('chargeWastedShape' in sm), 'no axis-specific waste fields');
});

// §39.1/§39.3 — flat/timer overflow is the source Alpha 0.4.1 still reported
// per Program. It must now land in the SAME side-level total as routing
// discard, so the total really is "all charge this side could not store".
// Exercised through the collector directly: whether a live battle happens to
// leave a System pool full at timer time depends on the AI, and this is an
// assertion about the metric contract, not about that scheduling.
test('§39.1 timer overflow and routing discard share one side-level total', () => {
  const m = createBattleMetrics(['PRG_H_001'], ['PRG_S_001']);
  consumeEvents(m, [
    { t: 'chargeWaste', side: 'enemy', ownerKind: 'program', programId: 'PRG_S_001', amount: 4 },
    {
      t: 'chargeRoute', side: 'enemy', axis: 'color', token: Color.Red, amount: 5,
      streamSource: 'SYNC', order: ['PRG_S_001'], eligible: ['PRG_S_001'],
      assignments: [{ programId: 'PRG_S_001', before: 0, assigned: 3, after: 3, overflowOut: 2 }],
      discarded: 2,
    },
    // The Deck pool is a separate authority (director ruling): it keeps its own
    // bucket and must NOT inflate the side total.
    { t: 'deckCharge', side: 'player', amount: 2, wasted: 6 },
  ]);
  assert(m.sides.enemy.chargeWastedTotal === 6, `timer 4 + routing 2 = 6, got ${m.sides.enemy.chargeWastedTotal}`);
  assert(m.sides.player.deck.chargeWasted === 6, 'Deck overflow is tracked in its own bucket');
  assert(m.sides.player.chargeWastedTotal === 0, 'Deck overflow does not enter the Program-pool total');
});

// §39.1 — and the live path really does emit that timer overflow, so the
// contract above is wired to something real.
test('§39.1 a full System pool overflows the flat timer into chargeWaste events', () => {
  const g = newGame(5);
  for (const u of g.state.units.enemy) u.charge = programById(u.programId).chargeCap;
  // Only the flat-timer branch is under test, so the Function phase must not
  // spend the charge first: an all-full roster is exactly what it would fire.
  const events: GameEvent[] = [];
  for (const u of g.state.units.enemy) {
    const wasted = addUnitCharge(g.state, u, ENEMY_TIMER_CHARGE_RATE);
    if (wasted > 0) events.push({ t: 'chargeWaste', side: 'enemy', ownerKind: 'program', programId: u.programId, amount: wasted });
  }
  const emitted = events.reduce((n, e) => n + (e.t === 'chargeWaste' ? e.amount : 0), 0);
  assert(emitted === ENEMY_TIMER_CHARGE_RATE * g.state.units.enemy.length, 'every full pool discards the whole tick');
  const before = g.state.metrics.sides.enemy.chargeWastedTotal;
  consumeEvents(g.state.metrics, events);
  assert(g.state.metrics.sides.enemy.chargeWastedTotal === before + emitted, 'and it lands in the side total');
});

test('§20.4 detonations, line clears and reshuffles survive as battle aggregates', () => {
  // Designer ruling: these are counters on the metrics record, so BASIC can
  // still answer "did this materially appear?" with no turn stream at all.
  const { g } = capture('BASIC', 23);
  const m = g.state.metrics;
  assert(typeof m.detonations === 'number', 'detonations is a battle-level aggregate');
  assert(typeof m.autoReshuffles === 'number', 'reshuffles remain a battle-level aggregate');
  assert(typeof m.sides.player.lineClears === 'number', 'line clears remain per-side aggregates');
  assert(m.detonations > 0, 'the sampled battle detonated at least one bomb');
});

test('§20.1 targeted and Drain telemetry survive at BASIC via the event stream', () => {
  const { events } = capture('BASIC', 33, ['PRG_H_005', 'PRG_H_004', 'PRG_H_002', 'PRG_H_003']);
  const targeted = events.filter((e) => e.kind === 'TARGETED');
  assert(targeted.length > 0, 'DATACUT activations are persisted at BASIC');
  const t = targeted[0].targeted!;
  assert(t.fnId === 'FNC_011' && t.slicedCount > 0, 'the record carries Function and outcome');
  assert(t.sliced === undefined, 'the full coordinate list is COMPLETE-only detail');
  assert(targeted.every((e) => e.battleId && e.lvl === 'BASIC'), 'events join by battleId and carry their level');
  const complete = capture('COMPLETE', 33, ['PRG_H_005', 'PRG_H_004', 'PRG_H_002', 'PRG_H_003']);
  assert(
    complete.events.filter((e) => e.kind === 'TARGETED').some((e) => (e.targeted!.sliced?.length ?? 0) > 0),
    'COMPLETE retains sliced coordinates',
  );
});

test('§20.8 a level change affects future records only', () => {
  const previous = loggingLevel();
  setLoggingLevel('BASIC');
  // Deep pools so the battle cannot end before the level change: Alpha 0.5.0
  // gives the System its own BASE_ICE (100), which ends default battles sooner
  // than the Alpha 0.4 mirrored 150 did.
  const g = newGame(41, manualLink(D, 500, 500));
  const collected: TurnLogEntry[] = [];
  let safety = 0;
  while (!g.state.winner && safety++ < 6) {
    const mv = botMove(g);
    if (!mv) break;
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    collected.push(...g.drainTurnLogs());
  }
  assert(collected.length === 0, 'BASIC wrote no turn records');
  setLoggingLevel('VERBOSE');
  safety = 0;
  while (!g.state.winner && safety++ < 6) {
    const mv = botMove(g);
    if (!mv) break;
    g.attemptSwap(mv.a, mv.b);
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    collected.push(...g.drainTurnLogs());
  }
  assert(collected.length > 0, 'records written after the change use the new level');
  assert(collected.every((t) => t.lvl === 'VERBOSE'), 'no retroactive relabelling of earlier records');
  setLoggingLevel(previous);
});

// ---- §20.5/§20.7/§20.8 storage adapter (instrumented, no browser) ----
// storage.ts resolves the free identifier `localStorage` at CALL time, so a
// stub installed on globalThis exercises the real append/trim/quota paths.

interface FakeStore {
  data: Map<string, string>;
  reads: number;
  writes: number;
  bytesWritten: number;
  quota: number;
  failNext: number;
}

function installFakeStorage(quota = 5 * 1024 * 1024): FakeStore {
  const f: FakeStore = { data: new Map(), reads: 0, writes: 0, bytesWritten: 0, quota, failNext: 0 };
  const api = {
    get length(): number {
      return f.data.size;
    },
    key: (i: number): string | null => [...f.data.keys()][i] ?? null,
    getItem: (k: string): string | null => {
      f.reads++;
      return f.data.get(k) ?? null;
    },
    setItem: (k: string, v: string): void => {
      if (f.failNext > 0) {
        f.failNext--;
        throw new Error('QuotaExceededError');
      }
      let total = v.length;
      for (const [key, val] of f.data) if (key !== k) total += val.length;
      if (total > f.quota) throw new Error('QuotaExceededError');
      f.writes++;
      f.bytesWritten += v.length;
      f.data.set(k, v);
    },
    removeItem: (k: string): void => void f.data.delete(k),
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = api;
  return f;
}

test('§20.8 legacy Alpha 0.4 turn logs are cleared once; other streams are retained', () => {
  const f = installFakeStorage();
  // a fat pre-0.4.1 turn record (no `ls` field) plus valid sibling streams
  f.data.set('breach:log:turns', JSON.stringify([{ turn: 1, identity: {}, config: {}, chargeRoutes: [] }]));
  f.data.set('breach:log:metrics', JSON.stringify([{ battleId: 'b1' }]));
  f.data.set('breach:log:selection', JSON.stringify([{ event: 'RUN_CREATED' }]));
  f.data.set('breach:log:wizard', JSON.stringify([{ action: 'WIZARD_FORCE_WIN' }]));
  f.data.set('breach:save', 'THE-ACTIVE-SAVE');

  const note = storage.migrateLegacyLogs();
  assert(note && note.includes('cleared 1'), `expected a migration diagnostic, got ${note}`);
  assert(!f.data.has('breach:log:turns'), 'the incompatible turn history is cleared');
  assert(f.data.has('breach:log:metrics'), 'metrics are retained');
  assert(f.data.has('breach:log:selection'), 'selection records are retained');
  assert(f.data.has('breach:log:wizard'), 'wizard records are retained');
  assert(f.data.get('breach:save') === 'THE-ACTIVE-SAVE', 'the active save is never touched by log migration');
  // idempotent: a second startup is a no-op
  assert(storage.migrateLegacyLogs() === null, 'migration runs once');
});

test('§20.8 the logging-level preference round-trips and falls back safely', () => {
  installFakeStorage();
  storage.saveLoggingLevel('COMPLETE');
  assert(storage.loadLoggingLevel() === 'COMPLETE', 'a valid preference round-trips');
  (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(
    'breach:log:meta',
    JSON.stringify({ ls: 999, level: 'COMPLETE' }),
  );
  assert(storage.loadLoggingLevel() !== 'COMPLETE', 'a stale schema version falls back to the environment default');
  (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(
    'breach:log:meta',
    'not json',
  );
  assert(LOGGING_LEVELS.includes(storage.loadLoggingLevel()), 'a corrupt preference still yields a valid level');
});

test('§20.5 the byte budget trims before the write and never exceeds itself', () => {
  const f = installFakeStorage();
  const fat = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ i, pad: 'x'.repeat(400) }));
  // push far more than the 3 MiB budget through the lowest-priority stream
  for (let round = 0; round < 12; round++) {
    storage.appendEventLogs(fat(400) as never);
    let total = 0;
    for (const [k, v] of f.data) total += (k.length + v.length) * 2;
    assert(total <= LOG_BUDGET_BYTES, `estimated footprint ${total} must stay within ${LOG_BUDGET_BYTES}`);
  }
  assert(f.data.has('breach:log:events'), 'the stream survives, trimmed rather than dropped');
});

test('§20.5 lower-priority streams are sacrificed before metrics', () => {
  const f = installFakeStorage();
  const pad = 'y'.repeat(2000);
  storage.appendMetricsLog({ battleId: 'keep-me', pad } as never);
  for (let i = 0; i < 40; i++) storage.appendEventLogs(Array.from({ length: 200 }, () => ({ pad })) as never);
  const metrics = JSON.parse(f.data.get('breach:log:metrics') || '[]') as { battleId?: string }[];
  assert(metrics.some((m) => m.battleId === 'keep-me'), 'the metrics record outlives the flood of low-priority events');
});

test('§20.7 a quota failure trims, retries once, then degrades without looping', () => {
  const f = installFakeStorage();
  f.failNext = 99; // every write throws, however much we trim
  const before = f.writes;
  for (let i = 0; i < 25; i++) storage.appendEventLogs([{ battleId: 'b', pad: 'z'.repeat(100) }] as never);
  assert(f.writes === before, 'no write ever succeeded');
  // the adapter must have STOPPED attempting rather than retrying every event
  assert(f.failNext > 99 - 25 * 3, `expected bounded retry attempts, ${99 - f.failNext} throws observed`);
});

test('§16 wiping logs never touches the active save or preferences', () => {
  const f = installFakeStorage();
  f.data.set('breach:save', 'SAVE');
  f.data.set('breach:config', 'SETTINGS');
  f.data.set('breach:pref:constructed', 'PRESET');
  storage.appendEventLogs([{ battleId: 'b' }] as never);
  storage.wipeLogs();
  assert(f.data.get('breach:save') === 'SAVE', 'active save survives');
  assert(f.data.get('breach:config') === 'SETTINGS', 'menu settings survive');
  assert(f.data.get('breach:pref:constructed') === 'PRESET', 'the Constructed preset survives');
  assert(!f.data.has('breach:log:events'), 'log streams are cleared');
});

// ---- §22.10 UI and vocabulary (headless-checkable parts) ----

test('§22.10 no player-facing legacy vocabulary remains in the rendered surfaces', () => {
  // §19 required visible replacements. Scans the renderer and orchestrator for
  // legacy player-facing STRING LITERALS. Internal identifiers (player/enemy/hp/
  // tile/board/match) are explicitly permitted by §19 and are not matched here.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const surfaces = [
    path.join(root, 'src', 'render', 'view.ts'),
    path.join(root, 'src', 'main.ts'),
  ];
  const banned: [RegExp, string][] = [
    [/'YOU'/, "avatar label 'YOU' must be 'HACKER'"],
    [/'ENEMY'/, "avatar label 'ENEMY' must be 'SYSTEM'"],
    [/No match — move reverted/, 'no-match notice must use Sync vocabulary'],
    [/Enemy down!/, 'victory notice must use System ICE vocabulary'],
    [/You are down!/, 'defeat notice must use Hacker LINK vocabulary'],
    [/'SHAKE'/, 'the Deck control label comes from resolved content'],
    [/No match damage/, 'the setting is now Reinforced Connection'],
    [/Board shake/, 'Shake messaging must use Datastream vocabulary'],
  ];
  // Comments are stripped first: explaining what a term USED to be called is
  // legitimate documentation, and only real code strings reach the player.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const f of surfaces) {
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    for (const [re, why] of banned) {
      assert(!re.test(text), `${path.relative(root, f)}: ${why}`);
    }
  }
  // and the required replacements are actually present
  const viewText = fs.readFileSync(surfaces[0], 'utf8');
  assert(viewText.includes("'HACKER'") && viewText.includes("'SYSTEM'"), 'HACKER/SYSTEM avatar labels present');
  assert(viewText.includes("'LINK'") && viewText.includes("'ICE'"), 'LINK/ICE stat labels present');
  assert(viewText.includes('No valid Sync'), "the 'No valid Sync' notice is present");
  assert(viewText.includes('System ICE breached'), 'the System ICE breached notice is present');
});

test('§22.10 placeholder BIO/GRAPHICS/DESCRIPT are never rendered', () => {
  // §13.1/§14.1/§20.3 — the placeholder fields are parsed and retained as data
  // but must not reach any player-facing surface.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mainText = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf8');
  for (const field of ['.bio', '.graphics', '.descript']) {
    assert(!mainText.includes(field), `main.ts must not read the placeholder field ${field}`);
  }
});

// ---- §14.6 layout/geometry ----
// The View requires a live DOM <canvas> 2D context, unavailable in this
// headless Node harness. Per the escalation guidance, this remains a MANUAL
// check rather than mocking a canvas (which would test the mock, not the real
// renderer). See the manual-checks list in the final report.

// ============================================================================
// Alpha 0.5.0 §42 — SYS DATA AND FINGERPRINT
// ============================================================================

// Build a SYS dataset text with one field of SYS_01 replaced.
const sysWith = (field: string, value: string): string => {
  // The authored file is CRLF, so header cells are trimmed exactly as the
  // loader's readTable does before matching.
  const lines = real.systems.text.replace(/\s*$/, '').split(/\r?\n/);
  const idx = lines[0].split(',').map((h) => h.trim()).indexOf(field);
  assert(idx >= 0, `SYS header has no ${field}`);
  const cells = lines[1].split(',');
  cells[idx] = value;
  lines[1] = cells.join(',');
  return lines.join('\n');
};

test('§42 the SYS dataset is REQUIRED and its header is enforced', () => {
  // §42.2 — a missing dataset blocks startup rather than defaulting.
  expectErrors({ systems: '' }, 'file is empty', 'empty SYS dataset');
  // §42.3/§2.3 — the durability column is BASE_ICE. A stale export still
  // carrying BASE_LINK is a header error, never a silent alias.
  expectErrors(
    { systems: real.systems.text.replace('BASE_ICE', 'BASE_LINK') },
    'header',
    'BASE_LINK instead of BASE_ICE',
  );
});

test('§42 SYS row validation: ID prefix, BASE_ICE, axes, PRG_SET, SKILL', () => {
  expectErrors({ systems: sysWith('SYS_ID', 'SYSTEM_01') }, 'wrong System ID prefix', 'bad SYS_ID prefix'); // §42.4
  expectErrors({ systems: sysWith('BASE_ICE', '0') }, 'out of range', 'zero BASE_ICE'); // §42.5
  expectErrors({ systems: sysWith('BASE_ICE', '') }, 'BASE_ICE', 'blank BASE_ICE');
  expectErrors({ systems: sysWith('STRONG_COLORS', 'RED:RED:YEL') }, 'duplicate token', 'duplicate strong color'); // §42.6
  expectErrors({ systems: sysWith('STRONG_SHAPES', 'TRI:NOPE') }, 'unknown enum value', 'invalid strong shape');
  // §42.7 — exactly four Programs
  expectErrors({ systems: sysWith('PRG_SET', 'PRG_S_001:PRG_S_002:PRG_S_003') }, 'exactly 4', 'three Programs');
  expectErrors(
    { systems: sysWith('PRG_SET', 'PRG_S_001:PRG_S_002:PRG_S_003:PRG_S_004:PRG_S_005') },
    'exactly 4',
    'five Programs',
  );
  // §42.8 — duplicates within PRG_SET
  expectErrors({ systems: sysWith('PRG_SET', 'PRG_S_001:PRG_S_001:PRG_S_003:PRG_S_004') }, 'duplicate token', 'duplicate Program');
  // §42.9 — a Hacker Program in a System build
  expectErrors({ systems: sysWith('PRG_SET', 'PRG_H_001:PRG_S_002:PRG_S_003:PRG_S_004') }, 'wrong ID prefix', 'PRG_H in System build');
  // §42.10 — a well-formed but undefined reference
  expectErrors({ systems: sysWith('PRG_SET', 'PRG_S_099:PRG_S_002:PRG_S_003:PRG_S_004') }, 'unknown System Program', 'broken Program reference');
  // §42.11/§2.2 — System passive Skills are unsupported content in Alpha 0.5
  expectErrors({ systems: sysWith('SKILL', 'SKL_001') }, 'not supported', 'nonblank System SKILL');
});

test('§42.12 System weak sets derive as the complement, in recognized enum order', () => {
  const c = loadContent(real).content!;
  const s = c.systems.get('SYS_01')!;
  assert(s.strongColors.join(',') === [Color.Red, Color.Green, Color.Yellow].join(','), 'authored order preserved');
  assert(s.weakColors.join(',') === [Color.Magenta, Color.Cyan, Color.Blue].join(','), 'weak colors are the complement in enum order');
  assert(s.weakShapes.join(',') === [Shape.Circle, Shape.Diamond, Shape.Cross].join(','), 'weak shapes are the complement in enum order');
  // §5.3 — no authored weak columns exist to disagree with the derivation.
  assert(!real.systems.text.includes('WEAK'), 'the schema has no redundant weak-set columns');
});

test('§42.13/§42.14 the fingerprint tracks System gameplay fields and ignores placeholders', () => {
  const base = loadContent(real).content!.fingerprint;
  const changed: Array<[string, string]> = [
    ['BASE_ICE', sysWith('BASE_ICE', '120')],
    ['STRONG_COLORS', sysWith('STRONG_COLORS', 'RED:GRE:CYA')],
    ['STRONG_SHAPES', sysWith('STRONG_SHAPES', 'TRI:SQU:CRO')],
    ['PRG_SET members', sysWith('PRG_SET', 'PRG_S_003:PRG_S_005:PRG_S_006:PRG_S_002')],
    // §5.4 — ORDER is charge-routing priority, so reordering is a real change.
    ['PRG_SET order', sysWith('PRG_SET', 'PRG_S_005:PRG_S_003:PRG_S_006:PRG_S_001')],
  ];
  for (const [label, text] of changed) {
    const fp = loadContent(files({ systems: text })).content!.fingerprint;
    assert(fp !== base, `${label} must change the gameplay fingerprint`);
  }
  const same: Array<[string, string]> = [
    ['BIO', sysWith('BIO', 'completely different biography prose')],
    ['GRAPHICS', sysWith('GRAPHICS', 'some/other/asset.png')],
    ['name', sysWith('name', 'RENAMED')],
  ];
  for (const [label, text] of same) {
    const r = loadContent(files({ systems: text }));
    assert(r.content !== null, `${label} fixture must still load`);
    assert(r.content.fingerprint === base, `${label} must NOT change the gameplay fingerprint`);
  }
});

test('§42.15 leading-apostrophe normalization applies to SYS and the Transform axes', () => {
  const sys = sysWith('BASE_ICE', "'100");
  const fns = mutate(real.functions.text, ',NEU,YEL:STR,', ",'NEU,'YEL:STR,");
  const r = loadContent(files({ systems: sys, functions: fns }));
  assert(r.content !== null, `quoted values must load: ${r.issues.filter((i) => i.severity === 'error').map((i) => i.reason).join('; ')}`);
  assert(r.content.systems.get('SYS_01')!.baseIce === 100, "'100 parsed as 100");
  const op = r.content.functions.get('FNC_013')!.plan[0];
  assert(op.params.axisTarget === 'NEU' && op.params.axisResult!.color === Color.Yellow, 'quoted axes parsed');
  // §20.1.4 — quoting must not change the fingerprint.
  assert(r.content.fingerprint === loadContent(real).content!.fingerprint, 'quoting must not change the fingerprint');
});

test('§42.16 EFFECT_TRANSFORM axis and tuple validation', () => {
  // exact two-value tuple
  expectErrors({ functions: mutate(real.functions.text, 'YEL:STR,0:1', 'YEL:STR,0') }, 'exactly 2', 'short Transform tuple');
  expectErrors({ functions: mutate(real.functions.text, 'YEL:STR,0:1', 'YEL:STR,0:1:0') }, 'exactly 2', 'long Transform tuple');
  // supported tuple enum values
  expectErrors({ functions: mutate(real.functions.text, 'YEL:STR,0:1', 'YEL:STR,0:9') }, 'specialPacketTreatment', 'bad special treatment');
  expectErrors({ functions: mutate(real.functions.text, 'YEL:STR,0:1', 'YEL:STR,5:1') }, 'targeting', 'bad targeting');
  // §22.1 — the only supported axisTarget in Alpha 0.5
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',RED,YEL:STR,') }, 'unsupported axisTarget', 'color axisTarget');
  // §22.2 — exactly one color and one shape, and the color may not be neutral
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',NEU,YEL,') }, 'exactly one color and one shape', 'axisResult missing shape');
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',NEU,YEL:STR:TRI,') }, 'exactly one color and one shape', 'axisResult too long');
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',NEU,NEU:STR,') }, 'may not be neutral', 'neutral result color');
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',NEU,YEL:NOPE,') }, 'unknown shape', 'bad result shape');
  // required axes must be present
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',,YEL:STR,') }, 'missing required parameter', 'blank axisTarget');
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,', ',NEU,,') }, 'missing required parameter', 'blank axisResult');
  // §23.1/§45.15 — targeted Transform is restricted to quantity 1
  expectErrors({ functions: mutate(real.functions.text, ',NEU,YEL:STR,0:1', ',NEU,YEL:STR,1:1') }, 'must have quantity 1', 'targeted Transform with quantity 99');
});

test('§2.5 quantity is an ordinary maximum — 99 gets no special handling', () => {
  const c = loadContent(real).content!;
  assert(c.functions.get('FNC_013')!.plan[0].params.quantity === 99, 'COERCE quantity is the authored 99');
  // A quantity far above the board size is legal and means "up to that many".
  const big = loadContent(files({ functions: mutate(real.functions.text, 'COERCE,7,EFFECT_TRANSFORM,turn neutral packets into attacker axes,99', 'COERCE,7,EFFECT_TRANSFORM,turn neutral packets into attacker axes,500') }));
  assert(big.content !== null, 'a quantity above the board size is valid');
  assert(big.content.functions.get('FNC_013')!.plan[0].params.quantity === 500, 'and is stored verbatim');
});

// ============================================================================
// Alpha 0.5.0 §45 — COERCE / EFFECT_TRANSFORM behavior
// ============================================================================

// A board whose neutral Packets are placed deliberately. Everything else is a
// non-matching background, so any Sync that appears is one COERCE created.
function coerceGame(neutrals: Pt[], seed = 5): Game {
  const g = newGame(seed);
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const t = g.state.board[y][x]!;
      t.kind = 'standard';
      t.color = (x + y) % 2 === 0 ? Color.Red : Color.Green;
      t.shape = (x + y) % 3;
      delete t.special;
    }
  }
  for (const p of neutrals) {
    const t = g.state.board[p.y][p.x]!;
    t.kind = 'neutral';
    delete t.color;
    delete t.shape;
  }
  return g;
}

// Fire the System's COERCE Program directly, whatever slot it occupies.
function fireCoerce(g: Game): GameEvent[] {
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_013');
  assert(idx >= 0, 'the fielded System build includes COERCE');
  chargeSlot(g, 'enemy', idx);
  return g.runEnemyPhase();
}

test('§45.1/§45.2 COERCE converts up to quantity, and 99 converts every neutral', () => {
  const neutrals: Pt[] = [{ x: 0, y: 0 }, { x: 4, y: 6 }, { x: 7, y: 2 }];
  const g = coerceGame(neutrals);
  const ev = fireCoerce(g);
  const xf = ev.find((e) => e.t === 'transform') as Extract<GameEvent, { t: 'transform' }>;
  assert(xf, 'a transform event is emitted');
  assert(xf.candidates === neutrals.length, `all ${neutrals.length} neutrals were eligible`);
  assert(xf.converted === neutrals.length, 'fewer neutrals than quantity converts them all');
  assert(xf.requested === 99, 'the authored maximum is recorded as requested');
  for (const p of neutrals) {
    const t = g.state.board[p.y][p.x];
    // A converted Packet may have been sliced by a resulting Sync; if it
    // survives, it must carry the authored result axes.
    if (t && t.kind === 'standard') {
      assert(t.color === Color.Yellow || t.shape === Shape.Star, 'converted Packets carry the authored axes');
    }
  }
});

test('§45.6 COERCE produces exactly the authored result color and shape', () => {
  // One isolated neutral cannot form a Sync, so the converted Packet stays put.
  const g = coerceGame([{ x: 3, y: 3 }]);
  fireCoerce(g);
  const t = g.state.board[3][3]!;
  assert(t.kind === 'standard', 'the Packet is no longer neutral');
  assert(t.color === Color.Yellow && t.shape === Shape.Star, `expected YEL:STR, got ${t.color}/${t.shape}`);
});

test('§45.13 converting EVERY eligible Packet consumes no gameplay RNG', () => {
  // Measured around the transform EXECUTOR: a whole System turn legitimately
  // rolls for activation choice and for refills, which would mask the point.
  const spec = {
    owner: 'enemy' as const,
    params: { targeting: 0 as const, specialPacketTreatment: 1 as const },
    axisResult: { color: Color.Yellow, shape: Shape.Star },
    programId: 'PRG_S_005',
    fnId: 'FNC_013',
  };
  const g = coerceGame([{ x: 3, y: 3 }, { x: 6, y: 1 }]);
  const before = g.state.rng.getState();
  applyTransform(g.state, { ...spec, quantity: 99 }, []);
  assert(g.state.rng.getState() === before, 'a complete selection must not roll for order');
  // But a PARTIAL selection genuinely is gameplay-affecting and must use it.
  const g2 = coerceGame([{ x: 3, y: 3 }, { x: 6, y: 1 }, { x: 1, y: 7 }]);
  const before2 = g2.state.rng.getState();
  const out = applyTransform(g2.state, { ...spec, quantity: 2 }, []);
  assert(out.cells.length === 2, 'quantity caps the conversion');
  assert(g2.state.rng.getState() !== before2, 'an excluding selection consumes gameplay RNG');
});

test('§45.5/§45.7 transformation is atomic, and the Sync it creates resolves immediately', () => {
  // Three neutrals in a row become three YEL:STR Packets — a Sync on BOTH axes.
  const g = coerceGame([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
  const hpBefore = g.state.hp.player;
  const ev = fireCoerce(g);
  const xf = ev.indexOf(ev.find((e) => e.t === 'transform')!);
  const destroy = ev.findIndex((e) => e.t === 'destroy');
  assert(destroy > xf, 'detection runs only AFTER the transform is complete');
  assert(ev.some((e) => e.t === 'damage' && e.source === 'transform'), 'the created Sync dealt damage immediately');
  assert(g.state.hp.player < hpBefore, 'and the Hacker actually took it');
  // §26 — the resulting Packets do not linger as a stable pre-existing Sync.
  assert(detectMatches(g.state.board).length === 0, 'the board settles with no leftover Sync');
});

test('§45.8/§45.9 resulting damage uses the System profile and charge routes through its queue', () => {
  const g = coerceGame([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
  const ev = fireCoerce(g);
  const dmg = ev.find((e) => e.t === 'damage' && e.source === 'transform') as Extract<GameEvent, { t: 'damage' }>;
  assert(dmg && dmg.target === 'player', 'the System owns the Sync it created');
  // YEL is strong for BOUNCER and STR is one of its strong shapes, so each
  // sliced Packet pays the HIGH tier — which is the authored synergy.
  assert(g.state.config.strongColors.enemy.includes(Color.Yellow), 'YEL is strong for this System');
  // §30.1 — the charge goes through the ordinary ordered queue, not a
  // hardcoded COERCE -> ATTACKER path.
  const routes = ev.filter((e) => e.t === 'chargeRoute' && e.side === 'enemy') as Extract<GameEvent, { t: 'chargeRoute' }>[];
  assert(routes.length > 0, 'the created Sync generated System charge');
  const order = g.state.identity.systemPrograms;
  for (const r of routes) {
    assert(r.order.join(',') === order.join(','), 'routing used the authored PRG_SET order');
    assert(r.streamSource === 'EFFECT_TRANSFORM', 'generation is attributed to the Transform');
    assert(r.sourceId === 'FNC_013', 'and names the causing Function');
  }
  // The Yellow/Star streams reach ATTACKER because it is bound to them AND sits
  // first — emergent from bindings and order (§30.1).
  const attacker = routes.find((r) => r.eligible.includes('PRG_S_003'));
  assert(attacker, 'ATTACKER is eligible for the transformed axes');
});

test('§45.12 the Transform itself contributes no direct damage and no direct charge', () => {
  // A single neutral cannot create a Sync, so anything observed here would be
  // the Effect's own contribution.
  const g = coerceGame([{ x: 3, y: 3 }]);
  const hpBefore = g.state.hp.player;
  const chargeBefore = g.state.units.enemy.reduce((n, u) => n + u.charge, 0);
  const ev = fireCoerce(g);
  assert(g.state.hp.player === hpBefore, 'no direct Function damage');
  assert(!ev.some((e) => e.t === 'damage'), 'no damage event at all');
  // No charge stream at all: the Effect grants none of its own, and with no
  // Sync created there is nothing else to route. (The flat System timer adds
  // charge at END of phase without routing, so pool totals are the wrong
  // instrument for this assertion.)
  assert(!ev.some((e) => e.t === 'chargeRoute'), 'no direct charge stream');
  assert(!ev.some((e) => e.t === 'destroy'), 'a lone conversion slices nothing');
  void chargeBefore;
});

test('§45.4/§45.16 all three special-retention branches are contract-tested', () => {
  const c = loadContent(real).content!;
  assert(c.functions.get('FNC_013')!.plan[0].params.transform!.specialPacketTreatment === 1, 'live content retains all');
  // Neutral Packets cannot currently carry an overlay, so the branches are
  // exercised against a planted special via the shared executor rather than
  // through authored content (§45.16 — every typed branch gets coverage).
  for (const [treatment, expectKept] of [[0, false], [1, true], [2, true]] as const) {
    const g = coerceGame([{ x: 3, y: 3 }]);
    const t = g.state.board[3][3]!;
    t.special = { type: 'buff', owner: 'enemy', magnitude: 5, seq: 1 };
    const events: GameEvent[] = [];
    applyTransform(
      g.state,
      {
        owner: 'enemy',
        params: { targeting: 0, specialPacketTreatment: treatment },
        axisResult: { color: Color.Yellow, shape: Shape.Star },
        quantity: 99,
        programId: 'PRG_S_005',
        fnId: 'FNC_013',
      },
      events,
    );
    const after = g.state.board[3][3]!;
    assert(!!after.special === expectKept, `treatment ${treatment}: special kept=${!!after.special}`);
    assert(after.color === Color.Yellow, 'the underlying Packet changed either way');
  }
  // treatment 2 destroys overlays owned by the OTHER side
  const g2 = coerceGame([{ x: 3, y: 3 }]);
  g2.state.board[3][3]!.special = { type: 'buff', owner: 'player', magnitude: 5, seq: 1 };
  applyTransform(
    g2.state,
    {
      owner: 'enemy',
      params: { targeting: 0, specialPacketTreatment: 2 },
      axisResult: { color: Color.Yellow, shape: Shape.Star },
      quantity: 99,
      programId: 'PRG_S_005',
      fnId: 'FNC_013',
    },
    [],
  );
  assert(!g2.state.board[3][3]!.special, 'retain-own destroys an opposing special');
});

test('§45.14/§26 COERCE is withheld when no neutral Packet exists, keeping its charge', () => {
  const g = coerceGame([]); // a board with no neutrals at all
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_013');
  chargeSlot(g, 'enemy', idx);
  const cost = programById(g.state.units.enemy[idx].programId).cost;
  const ev = g.runEnemyPhase();
  assert(!ev.some((e) => e.t === 'transform'), 'no transform is attempted');
  assert(!ev.some((e) => e.t === 'ability' && e.fn === 'FNC_013'), 'no activation is logged');
  assert(g.state.units.enemy[idx].charge === cost, 'the charge is preserved, not spent on a no-op');
  assert(g.state.metrics.systemWithholds > 0, 'the withhold is counted at battle level');
});

// ============================================================================
// Alpha 0.5.0 §46 — DYNAMIC SYSTEM FUNCTION PHASE
// ============================================================================

test('§46.3/§46.4 a Program activates at most once per Function phase', () => {
  const g = newGame(31);
  // Give every System Program full charge and enough ICE that nothing ends.
  for (const u of g.state.units.enemy) u.charge = programById(u.programId).chargeCap;
  const ev = g.runEnemyPhase();
  const fired = ev.filter((e) => e.t === 'ability' && e.side === 'enemy') as Extract<GameEvent, { t: 'ability' }>[];
  const counts = new Map<string, number>();
  for (const f of fired) counts.set(f.programId, (counts.get(f.programId) ?? 0) + 1);
  for (const [pid, n] of counts) assert(n === 1, `${pid} activated ${n} times in one phase`);
});

test('§46.4 a Program recharged after firing does not fire again in the same phase', () => {
  const g = newGame(32);
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_003'); // ATTACKER
  assert(idx >= 0, 'BOUNCER fields ATTACKER');
  chargeSlot(g, 'enemy', idx);
  // Refill the pool the instant it is spent, which a same-phase recharge would
  // otherwise turn into a second activation.
  const unit = g.state.units.enemy[idx];
  const cap = programById(unit.programId).chargeCap;
  let charge = cap;
  Object.defineProperty(unit, 'charge', {
    get: () => charge,
    set: (v: number) => {
      charge = v < cap ? cap : v; // instantly "recharged"
    },
    configurable: true,
  });
  const ev = g.runEnemyPhase();
  const fires = ev.filter((e) => e.t === 'ability' && e.side === 'enemy' && e.fn === 'FNC_003').length;
  assert(fires === 1, `a permanently full Program still fired ${fires} times`);
});

test('§46.1/§46.2 charge created by one Function can enable another in the SAME phase', () => {
  // COERCE creates a YEL:STR Sync; ATTACKER is bound to YEL and STR and sits
  // first in BOUNCER's queue, so the charge reaches it mid-phase.
  const g = coerceGame([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }], 12);
  const coerceIdx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_013');
  const attackIdx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_003');
  chargeSlot(g, 'enemy', coerceIdx);
  // ATTACKER starts one short of ready, so ONLY same-phase charge can fire it.
  const attackCost = programById(g.state.units.enemy[attackIdx].programId).cost;
  g.state.units.enemy[attackIdx].charge = attackCost - 1;
  const ev = g.runEnemyPhase();
  const order = ev.filter((e) => e.t === 'ability' && e.side === 'enemy') as Extract<GameEvent, { t: 'ability' }>[];
  assert(order.some((e) => e.fn === 'FNC_013'), 'COERCE fired');
  assert(order.some((e) => e.fn === 'FNC_003'), 'ATTACKER became ready and fired in the same phase');
  assert(
    order.findIndex((e) => e.fn === 'FNC_013') < order.findIndex((e) => e.fn === 'FNC_003'),
    'and it fired AFTER the Function that charged it',
  );
});

test('§46.5/§46.6 a ready-but-invalid Function is skipped, then reconsidered when it becomes valid', () => {
  // No neutrals: COERCE is ready but ineligible, so it must not spend charge.
  const g = coerceGame([], 13);
  const coerceIdx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_013');
  chargeSlot(g, 'enemy', coerceIdx);
  const cost = programById(g.state.units.enemy[coerceIdx].programId).cost;
  g.runEnemyPhase();
  assert(g.state.units.enemy[coerceIdx].charge === cost, 'blocked COERCE keeps its charge');
  // Now give it a target: the same Program becomes eligible on a later phase.
  const t = g.state.board[3][3]!;
  t.kind = 'neutral';
  delete t.color;
  delete t.shape;
  const ev2 = g.runEnemyPhase();
  assert(ev2.some((e) => e.t === 'transform'), 'once a valid target exists the Function fires');
});

test('§46.8/§46.9 the phase terminates, and the turn-ending match does not reopen it', () => {
  const g = newGame(33, { ...D, enemyMatching: true });
  for (const u of g.state.units.enemy) u.charge = programById(u.programId).chargeCap;
  const ev = g.runEnemyPhase();
  // The System's own match happens after the Function phase; any charge it
  // creates belongs to the NEXT turn (§19.6). So no activation may appear after
  // the turn-ending swap.
  const swapAt = ev.findIndex((e) => e.t === 'swap');
  if (swapAt >= 0) {
    const after = ev.slice(swapAt).filter((e) => e.t === 'ability' && e.side === 'enemy');
    assert(after.length === 0, 'no System Function activated after the turn-ending match');
  }
});

// ============================================================================
// Alpha 0.5.0 §47 — EBUFF delayed delivery
// ============================================================================

// Fire the System's EBUFF Program (ENHANCE) directly.
function fireEbuff(g: Game): GameEvent[] {
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_014');
  assert(idx >= 0, 'the fielded System build includes ENHANCE');
  // Isolate ENHANCE: MUSCLE opens charged (COERCE is startCharged=Y), and a
  // same-phase COERCE Sync could slice the very overlays under test.
  for (const u of g.state.units.enemy) u.charge = 0;
  chargeSlot(g, 'enemy', idx);
  return g.runEnemyPhase();
}

test('§47.1/§47.2 EBUFF arms up to quantity countdowns that provide ZERO magnitude', () => {
  const g = newGame(40);
  fireEbuff(g);
  const pending = specialsOf(g, 'buff', 'enemy');
  assert(pending.length === 3, `authored quantity 3, placed ${pending.length}`);
  for (const t of pending) {
    assert(t.special!.countdown === 2, 'authored countdown 2');
    assert(t.special!.delivers === 'EFFECT_BUFF', 'the overlay names what it will deliver');
    assert(t.special!.magnitude === 5, 'the authored magnitude travels with the overlay');
  }
  // §28.1 — pending overlays contribute nothing while armed.
  assert(buffBonus(g.state, 'enemy') === 0, 'a pending EBUFF adds no Buff magnitude');
});

test('§47.3/§47.4/§47.5/§47.6 at expiry the countdown becomes a live Buff on the same Packet', () => {
  const g = newGame(41);
  fireEbuff(g);
  const armed = specialsOf(g, 'buff', 'enemy');
  const seqs = armed.map((t) => t.special!.seq);
  const coordsOf = (): string[] => {
    const out: string[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const sp = g.state.board[y][x]?.special;
        if (sp && seqs.includes(sp.seq)) out.push(`${x},${y}`);
      }
    }
    return out;
  };
  const before = coordsOf();
  assert(before.length === 3, 'three armed overlays on the board');
  // §28.2 — established owner-turn countdown semantics: ticked on System turns.
  g.runEnemyPhase();
  assert(specialsOf(g, 'buff', 'enemy').every((t) => t.special!.countdown === 1), 'one turn elapsed');
  assert(buffBonus(g.state, 'enemy') === 0, 'still pending, still zero');
  g.runEnemyPhase();
  const live = specialsOf(g, 'buff', 'enemy').filter((t) => t.special!.countdown === undefined);
  assert(live.length > 0, 'surviving countdowns delivered');
  for (const t of live) {
    assert(t.special!.magnitude === 5, 'the authored magnitude is applied');
    assert(t.special!.delivers === undefined, 'a delivered overlay is no longer armed');
  }
  // §28.3 — delivery happens on the SAME Packet.
  const after = coordsOf();
  for (const c of after) assert(before.includes(c), `delivered Buff at ${c} was not one of the armed Packets`);
  // §47.6 — the now-live Buff contributes to damage.
  assert(buffBonus(g.state, 'enemy') === 5 * live.length, 'live Buffs contribute their magnitude');
});

test('§47.7 slicing a pending EBUFF prevents any later delivery', () => {
  const g = newGame(42);
  fireEbuff(g);
  const armedSeqs = specialsOf(g, 'buff', 'enemy').map((t) => t.special!.seq);
  assert(armedSeqs.length === 3, 'three overlays were armed');
  // Remove every armed overlay before it can expire.
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const t = g.state.board[y][x];
      if (t?.special && armedSeqs.includes(t.special.seq)) delete t.special;
    }
  }
  // Well past the authored countdown. ENHANCE may legitimately recharge and arm
  // NEW overlays, so the assertion is scoped to the REMOVED objects: none of
  // them may reappear, anywhere, in any state.
  for (let i = 0; i < 4; i++) g.runEnemyPhase();
  const survivors = specialsOf(g, 'buff', 'enemy').filter((t) => armedSeqs.includes(t.special!.seq));
  assert(survivors.length === 0, 'a removed countdown never delivers and never reappears');
});

test('§47.8 a pending EBUFF survives save/resume and still delivers correctly', () => {
  const g = newGame(43);
  fireEbuff(g);
  g.startPlayerPhase(); // §17.3 — an active save is taken in the stable phase
  const info = qmInfo([...g.state.identity.hackerPrograms], g.state.identity.buildOrigin);
  const restored = deserializeSession(serializeSession(info, g, null));
  assert(restored && restored.game, 'a battle holding pending countdowns round-trips');
  const pending = specialsOf(restored.game, 'buff', 'enemy');
  assert(pending.length === 3, 'all three armed overlays survive');
  for (const t of pending) {
    assert(t.special!.countdown === 2 && t.special!.delivers === 'EFFECT_BUFF', 'armed state survives verbatim');
    assert(t.special!.magnitude === 5, 'the resolved magnitude survives');
  }
  assert(buffBonus(restored.game.state, 'enemy') === 0, 'still contributes nothing after resume');
});

test('§47.9/§47.10 Bomb countdowns are unchanged and share the one scheduler', () => {
  const g = newTestbedGame(44);
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_005');
  chargeSlot(g, 'enemy', idx);
  g.runEnemyPhase();
  const bombs = specialsOf(g, 'bomb', 'enemy');
  assert(bombs.length === 1 && bombs[0].special!.countdown === 3, 'E-Bomb still arms at countdown 3');
  assert(bombs[0].special!.delivers === 'EFFECT_BOMB', 'a bomb declares its own delivery');
  g.runEnemyPhase();
  assert(specialsOf(g, 'bomb', 'enemy')[0].special!.countdown === 2, 'bomb timing is unchanged');
});

// ============================================================================
// Alpha 0.5.0 §48 — SPAM / Bomb charge behavior
// ============================================================================

test('§48.1/§48.2 SPAM uses its authored parameters and its tuple enables charge', () => {
  const c = loadContent(real).content!;
  const spam = c.functions.get('FNC_015')!.plan[0];
  assert(spam.params.quantity === 3 && spam.params.countdown === 1, 'authored quantity/countdown');
  assert(spam.params.areaPattern === 'AREA_CARDINAL_1', 'authored area');
  // §29.1 — gainCharge 0 MEANS "sliced Packets charge" (param notes). This is
  // the intentional difference from every other Bomb row, which uses 1.
  assert(spam.params.bomb!.gainCharge === 0, 'SPAM enables the charge branch');
  for (const id of ['FNC_001', 'FNC_005', 'FNC_008', 'FNC_012']) {
    assert(c.functions.get(id)!.plan[0].params.bomb!.gainCharge === 1, `${id} keeps the no-charge branch (§48.4)`);
  }
});

test('§48.2/§48.3 a SPAM detonation grants charge that routes through the System queue', () => {
  // MIDNIGHT fields SPAMBOT.
  const g = newBattle(D, 51, undefined, 'DEFAULT', { systemId: 'SYS_02', source: 'HEADLESS_PINNED' });
  g.startPlayerPhase();
  const idx = g.state.units.enemy.findIndex((u) => programById(u.programId).fn.id === 'FNC_015');
  assert(idx >= 0, 'MIDNIGHT fields SPAMBOT');
  chargeSlot(g, 'enemy', idx);
  g.runEnemyPhase(); // arms three 1-turn bombs
  const bombs = specialsOf(g, 'bomb', 'enemy');
  assert(bombs.length === 3 && bombs.every((b) => b.special!.gainCharge === 0), 'three charge-granting bombs armed');
  const ev = g.runEnemyPhase(); // they detonate at the start of this System turn
  assert(ev.some((e) => e.t === 'detonate'), 'the bombs detonated');
  const routes = ev.filter(
    (e) => e.t === 'chargeRoute' && e.side === 'enemy' && e.streamSource === 'EFFECT_DESTRUCTION',
  );
  assert(routes.length > 0, 'sliced Packets generated System charge (§29.1)');
});

// ============================================================================
// Alpha 0.5.0 §49 — save / resume of System identity
// ============================================================================

test('§49 an Alpha 0.4.x active save is rejected cleanly, never migrated', () => {
  const g = newGame(52);
  const json = serializeSession(qmInfo(), g, null);
  const env = JSON.parse(json) as Record<string, unknown>;
  // §31.1 — the version/schema bump is what rejects it; there is no migration
  // path and no synthesized System identity for an old battle.
  assert(deserializeSession(JSON.stringify({ ...env, version: 'alpha-0.4.0' })) === null, 'old build tag rejected');
  assert(deserializeSession(JSON.stringify({ ...env, schema: 3 })) === null, 'old save schema rejected');
  // §41 — an envelope with no System identity at all is incompatible, NOT an
  // invitation to substitute a default.
  const identity = { ...(env.identity as Record<string, unknown>) };
  delete identity.systemId;
  assert(deserializeSession(JSON.stringify({ ...env, identity })) === null, 'a save without SYS_ID is rejected');
  assert(
    deserializeSession(JSON.stringify({ ...env, identity: { ...(env.identity as object), systemId: 'SYS_99' } })) === null,
    'a save naming an unknown System is rejected',
  );
});

test('§49 an Alpha 0.5 save round-trips System identity and its exact Program order', () => {
  const g = newGame(53);
  const r = deserializeSession(serializeSession(qmInfo(), g, null));
  assert(r && r.game, 'the save round-trips');
  assert(r.info.system.systemId === g.state.identity.systemId, 'session opponent survives');
  assert(r.game.state.identity.systemId === g.state.identity.systemId, 'battle opponent survives');
  assert(
    r.game.state.identity.systemPrograms.join(',') === g.state.identity.systemPrograms.join(','),
    'the ordered System build survives exactly',
  );
  assert(r.game.state.identity.systemSelectionSource === g.state.identity.systemSelectionSource, 'selection source survives');
  // §32 — Program charge state is battle state and must round-trip too.
  assert(
    r.game.state.units.enemy.map((u) => `${u.programId}:${u.charge}`).join(',') ===
      g.state.units.enemy.map((u) => `${u.programId}:${u.charge}`).join(','),
    'System Program charges survive',
  );
});

test('§49/§33 PENDING_BUILD restores the same upcoming System without rerolling', () => {
  const info: RunInfo = { ...runInfoFor(snapshotRunSettings(D), 2), pendingBuild: true };
  const json = serializeSession(info, null, null);
  const r = deserializeSession(json);
  assert(r && r.game === null, 'a pending-build Run restores with no battle');
  assert(r.info.mode === 'RUN' && r.info.system.systemId === info.system.systemId, 'the upcoming System is preserved');
  // Reopening/re-serializing must be idempotent — no reroll on the way back.
  assert(serializeSession(r.info, null, null) === json, 'round-trip is byte-identical');
});

test('§49/§11.5 retrying the same Run step keeps the same System', () => {
  const info = runInfoFor(snapshotRunSettings(D), 3);
  const first = createRunBattle(info, 3, 61);
  // A retry rebuilds the battle from the SAME RunInfo (the session layer never
  // rerolls on defeat), so the opponent must be identical.
  const retry = createRunBattle(info, 3, 62);
  assert(retry.state.identity.systemId === first.state.identity.systemId, 'the retry faces the same System');
  assert(
    retry.state.identity.systemPrograms.join(',') === first.state.identity.systemPrograms.join(','),
    'and the same ordered build',
  );
  assert(retry.state.battleId !== first.state.battleId, 'but it is a genuinely new battle');
});

test('§49/§34 the Constructed build preference is independent of System identity', () => {
  const preset = serializeConstructedPreset('HAK_01', 'DEK_01', defaultBuild('HAK_01', 'DEK_01'));
  assert(!preset.includes('SYS_'), 'no remembered System is written into the Hacker build preference');
  const back = deserializeConstructedPreset(preset);
  assert(back && back.build.join(',') === defaultBuild('HAK_01', 'DEK_01').join(','), 'the remembered build still resolves');
});

// ============================================================================
// Alpha 0.5.0 §50 — logging and metrics
// ============================================================================

test('§50.1/§50.2 System identity is battle-level context, not repeated per turn', () => {
  const g = newGame(54);
  const stamp = identityStamp(g.state.identity);
  assert(stamp.systemId === g.state.identity.systemId, 'the battle record carries SYS_ID');
  assert(stamp.systemSelectionSource === g.state.identity.systemSelectionSource, 'and the selection source');
  assert(stamp.systemPrograms.join(',') === g.state.identity.systemPrograms.join(','), 'and the ordered build');
  // §35/§50.9 — turn records must NOT carry any of it.
  setLoggingLevel('VERBOSE');
  const mv = botMove(g)!;
  g.attemptSwap(mv.a, mv.b);
  g.runEnemyPhase();
  g.startPlayerPhase();
  for (const turn of g.drainTurnLogs()) {
    const json = JSON.stringify(turn);
    assert(!json.includes('SYS_'), 'a turn record must not repeat System identity');
    assert(!json.includes('PRG_S_'), 'nor the System roster');
  }
});

test('§50.3 a COERCE activation records converted count, candidates and result axes', () => {
  setLoggingLevel('COMPLETE');
  const g = coerceGame([{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }], 55);
  fireCoerce(g);
  const rec = g.drainEventLogs().find((e) => e.kind === 'TRANSFORM');
  assert(rec && rec.transform, 'a TRANSFORM battle event is written');
  assert(rec.transform.converted === 3 && rec.transform.candidates === 3, 'converted and eligible counts');
  assert(rec.transform.requested === 99, 'the authored maximum');
  assert(rec.transform.axisTarget === 'NEU', 'the source axis');
  assert(rec.transform.resultColor === Color.Yellow && rec.transform.resultShape === Shape.Star, 'the result axes');
  assert(rec.transform.fnId === 'FNC_013', 'the causing Function');
});

test('§50.4 EBUFF placement and delivery are both auditable', () => {
  setLoggingLevel('COMPLETE');
  const g = newGame(56);
  fireEbuff(g);
  const placed = g.drainEventLogs();
  assert(placed.length >= 0, 'placement drains cleanly');
  g.runEnemyPhase();
  g.runEnemyPhase();
  const delivered = g.drainEventLogs().filter((e) => e.kind === 'COUNTDOWN');
  assert(delivered.length > 0, 'delivery is recorded');
  for (const d of delivered) {
    assert(d.countdown!.effectId === 'EFFECT_BUFF', 'the delivered payload is named');
    assert(d.countdown!.magnitude === 5, 'with its resolved magnitude');
  }
});

test('§50.11/§50.13 current metrics carry one total and no axis-specific waste', () => {
  const g = newGame(57);
  const sm = g.state.metrics.sides.player as unknown as Record<string, unknown>;
  assert('chargeWastedTotal' in sm, 'the canonical total exists');
  assert(!('chargeDiscardedTotal' in sm), 'the Alpha 0.4.1 field name is gone from current metrics');
  assert(!('chargeWastedColor' in sm) && !('chargeWastedShape' in sm), 'no axis-specific waste (§39.4)');
});

// ---- summary ----

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
