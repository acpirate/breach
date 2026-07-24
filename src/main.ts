// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (data load → title → battle → pause/result) but
// no game rules: mode/Run/result/save semantics live in logic/session.ts and
// this file only composes dialogs and routes actions through that API.

import {
  BOARD_SHAKE_COST,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  COLOR_COUNT,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_HIGH_SHAPE,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_LOW_SHAPE,
  DAMAGE_PER_TILE_NEUTRAL,
  DEFAULT_BATTLE_CONFIG,
  SHAPE_COUNT,
} from './logic/constants';
import {
  ResolvedProgram,
  contentStamp,
  getContent,
  programsFor,
  requiresTarget,
  setActiveContent,
} from './logic/data/content';
import { formatIssue, loadContent } from './logic/data/load';
import { findBotMove, findHintMove } from './logic/bot';
import { Game } from './logic/game';
import { LOG_VERSION } from './logic/logger';
import { BattleMetrics } from './logic/metrics';
import {
  PendingResultInfo,
  SessionInfo,
  battleContext,
  contextLabel,
  continueLabel,
  createQuickMatchBattle,
  createRunBattle,
  deserializeSession,
  encounterFor,
  isRunComplete,
  naturalOf,
  nextStep,
  progressesAsVictory,
  serializeSession,
  snapshotRunConfig,
} from './logic/session';
import { BattleConfig, Color, Pt, Shape, Side, WizardAction, gridViewOf } from './logic/types';
import { browserDataFiles } from './dataBrowser';
import { attachInput } from './render/input';
import { Hud, View } from './render/view';
import {
  appendMetricsLog,
  appendTurnLogs,
  appendWizardLog,
  clearBattleSave,
  loadBattleJson,
  loadMenuConfig,
  readLogs,
  saveBattle,
  saveMenuConfig,
  wipeLogs,
} from './storage';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

// ---- session state (owned semantics live in logic/session.ts) ----
let session: SessionInfo | null = null;
let pending: PendingResultInfo | null = null;
let game: Game | null = null;

let busy = false; // true while animations / enemy phase are in flight
let selection: Pt | null = null;
// MK6.6 — think-time clock
let thinkStart: number | null = null;
let battleStartAt = 0; // wall-clock anchor for this session's battle
// MK7.7 — hint state
let hintFiredThisTurn = false;
let lastInputAt = performance.now();
// Targeting mode: which player slot is armed and awaiting an enemy target.
let targetingSlot: number | null = null;
// MK5.4: the menu's battle config — persisted, never implicitly reset.
let menuConfig: BattleConfig = DEFAULT_BATTLE_CONFIG;

// canonical value list — safer than field-by-field as the config grows
function configKey(c: BattleConfig): string {
  return JSON.stringify([
    c.enemyMatching,
    c.hackerBonusEnabled,
    c.singleAxisPayout,
    c.maxCascadeSteps,
    c.noMatchDamage,
    c.nmdChargeAwareBot,
    c.playerHp,
    c.enemyHp,
    c.hintEnabled,
    c.hintDelaySeconds,
    c.strongColors,
    c.strongShapes,
  ]);
}

function configsEqual(a: BattleConfig, b: BattleConfig): boolean {
  return configKey(a) === configKey(b);
}

function endBusy(): void {
  busy = false;
  thinkStart = canAct() ? performance.now() : null;
  hintFiredThisTurn = false;
  view.setHint(null);
}

function canAct(): boolean {
  return !!game && !busy && !game.state.winner && game.state.phase === 'playerPre';
}

// Sum of active special-tile magnitudes for a side (§9.2 — Effect value from
// authoritative logic state, not tile count, not render objects).
function specialMagnitude(kind: 'buff' | 'shield', side: Side): number {
  if (!game) return 0;
  let n = 0;
  for (const row of game.state.board) {
    for (const t of row) {
      if (t?.special?.type === kind && t.special.owner === side) n += t.special.magnitude ?? 0;
    }
  }
  return n;
}

function getHud(): Hud | null {
  if (!game) return null;
  const s = game.state;
  const act = canAct();
  const hacker = programsFor('player');
  const system = programsFor('enemy');
  return {
    hpPlayer: Math.max(0, s.hp.player),
    hpPlayerMax: s.config.playerHp,
    hpEnemy: Math.max(0, s.hp.enemy),
    hpEnemyMax: s.config.enemyHp,
    programs: s.units.player.map((u, i) => {
      const p = hacker[i];
      return { label: p.name, cost: p.cost, charge: u.charge, ready: act && u.charge >= p.cost, color: p.colors[0], shape: p.shapes[0] };
    }),
    minions: s.units.enemy.map((u, i) => {
      const p = system[i];
      return { label: p.name, cost: p.cost, charge: u.charge, ready: false, color: p.colors[0], shape: p.shapes[0] };
    }),
    shakeCharge: s.shakeCharge,
    shakeCost: BOARD_SHAKE_COST,
    shakeReady: act && s.shakeCharge >= BOARD_SHAKE_COST,
    buffPlayer: specialMagnitude('buff', 'player'),
    buffEnemy: specialMagnitude('buff', 'enemy'),
    shieldPlayer: specialMagnitude('shield', 'player'),
    shieldEnemy: specialMagnitude('shield', 'enemy'),
    turn: s.turn,
    canAct: act,
    statusText: s.winner
      ? ''
      : targetingSlot !== null
        ? 'Tap an enemy program to drain it'
        : act
          ? 'Fire abilities, then swap to match'
          : '…',
    targeting: targetingSlot !== null,
  };
}

const view = new View(canvas, getHud);

// ---- dialogs (DOM) ----

// A button spec's optional third element is a CSS class — used to mark
// wizard/dev controls as visually distinct (§5.2) without changing which
// handler fires.
type ButtonSpec = [string, () => void, string?];

function showDialog(title: string, sub: string, buttons: ButtonSpec[], extra?: HTMLElement): void {
  overlay.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'dialog';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  box.appendChild(h1);
  if (sub) {
    const p = document.createElement('p');
    p.textContent = sub;
    box.appendChild(p);
  }
  for (const [label, cb, cls] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', cb);
    box.appendChild(b);
  }
  if (extra) box.appendChild(extra);
  overlay.appendChild(box);
  overlay.classList.remove('hidden');
}

// MK2.3 game-over metrics panel (unchanged content).
function metricsElement(m: BattleMetrics): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'metrics';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'mhead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  row('BATTLE', true);
  row(`Turns to resolution: ${m.turns}`);
  row(`Match-locks (auto-reshuffles): ${m.autoReshuffles}`);
  row(`Enemy shields — created ${m.enemyShieldCreated}, removed ${m.enemyShieldRemoved}`);
  row(`Shielded hits: ${m.enemyShieldInstances}, damage prevented: ${fmt(m.enemyShieldPrevented)}`);

  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    row(side === 'player' ? 'YOUR SIDE' : 'ENEMY SIDE', true);
    row(`Total damage dealt: ${fmt(sm.totalDamage)}`);
    row(`  match-caused (incl. its cascades): ${fmt(sm.matchDamage)}`);
    row(`  bomb-caused (incl. its cascades): ${fmt(sm.bombDamage)}`);
    row(`  Attack: ${fmt(sm.attackerDamage)}`);
    row(`  Buffer added: ${fmt(sm.bufferDamageAdded)}`);
    row(`Cascade (RNG-refill) damage, any cause: ${fmt(sm.cascadeDamage)}`);
    row(`Match damage by axis: color ${fmt(sm.matchDamageColor)} / shape ${fmt(sm.matchDamageShape)}`);
    const critPct = sm.matchDamage > 0 ? ((sm.critExtra / sm.matchDamage) * 100).toFixed(1) : '0.0';
    row(`Crit bonus damage (1.5x extra): ${fmt(sm.critExtra)} (${critPct}% of match damage)`);
    row(`Largest single hit: ${fmt(sm.largestHit)}`);
    row(`Biggest round: ${fmt(sm.biggestRound)}`);
    row(`Avg round damage (nonzero rounds): ${sm.roundDamageCount ? fmt(sm.roundDamageSum / sm.roundDamageCount) : '0'}`);
    row(`Deepest cascade: ${sm.deepestCascade} RNG round${sm.deepestCascade === 1 ? '' : 's'}`);
    const contPct = sm.tilesDestroyed > 0 ? ((sm.contentionTiles / sm.tilesDestroyed) * 100).toFixed(1) : '0.0';
    row(`Opponent-bound tiles destroyed: ${sm.contentionTiles} of ${sm.tilesDestroyed} (${contPct}%)`);
    for (const p of programsFor(side)) {
      const u = sm.units[p.id];
      if (!u) continue;
      const placed = u.bombsPlaced > 0 ? `, bombs placed ${u.bombsPlaced}` : '';
      const fizz = u.fizzles > 0 ? `, fizzles ${u.fizzles}` : '';
      row(`${p.name} [${p.id}]: fired ${u.fires}, effect ${fmt(u.effect)}, charge wasted ${fmt(u.chargeWasted)}${placed}${fizz}`);
    }
  }

  row('TIMING', true);
  const med = median(m.thinkTimesMs);
  row(`Median think-time: ${med === null ? 'n/a' : `${(med / 1000).toFixed(1)}s`} (${m.thinkTimesMs.length} moves)`);
  row(`Battle wall-clock: ${((Date.now() - battleStartAt) / 1000).toFixed(0)}s (this session)`);
  if (m.hintsShown > 0) row(`Hints shown: ${m.hintsShown}`);
  return wrap;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function hideDialog(): void {
  overlay.classList.add('hidden');
}

// MK5.3/MK7.10 — battle config panel (Settings modal). Unchanged by 0.2.0.
function configPanel(rerender: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config';
  const head = document.createElement('div');
  head.className = 'cfghead';
  head.textContent = 'BATTLE CONFIG';
  wrap.appendChild(head);

  const section = (title: string): HTMLDetailsElement => {
    const det = document.createElement('details');
    det.className = 'cfgsection';
    const sum = document.createElement('summary');
    sum.textContent = title;
    det.appendChild(sum);
    wrap.appendChild(det);
    return det;
  };

  const modes = section('Game modes');
  const health = section('Starting HP');
  const hints = section('Hints');
  const cascades = section('Cascades');

  const check = (parent: HTMLElement, label: string, key: 'enemyMatching' | 'hackerBonusEnabled' | 'singleAxisPayout' | 'noMatchDamage'): void => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = menuConfig[key];
    cb.addEventListener('change', () => {
      menuConfig = { ...menuConfig, [key]: cb.checked };
      saveMenuConfig(menuConfig);
    });
    l.appendChild(cb);
    l.appendChild(document.createTextNode(` ${label}`));
    parent.appendChild(l);
  };
  check(modes, 'Enemy matching', 'enemyMatching');
  check(modes, 'Hacker color bonus', 'hackerBonusEnabled');
  check(modes, 'Single-axis payout', 'singleAxisPayout');

  const nmdRow = document.createElement('label');
  const nmdCb = document.createElement('input');
  nmdCb.type = 'checkbox';
  nmdCb.checked = menuConfig.noMatchDamage;
  nmdRow.appendChild(nmdCb);
  nmdRow.appendChild(document.createTextNode(' No match damage'));
  modes.appendChild(nmdRow);
  const subRow = document.createElement('label');
  subRow.className = 'suboption';
  const subCb = document.createElement('input');
  subCb.type = 'checkbox';
  subCb.checked = menuConfig.nmdChargeAwareBot;
  subCb.disabled = !menuConfig.noMatchDamage;
  subRow.appendChild(subCb);
  subRow.appendChild(document.createTextNode(' Charge-aware bot (NMD)'));
  modes.appendChild(subRow);
  nmdCb.addEventListener('change', () => {
    menuConfig = { ...menuConfig, noMatchDamage: nmdCb.checked };
    subCb.disabled = !nmdCb.checked;
    saveMenuConfig(menuConfig);
  });
  subCb.addEventListener('change', () => {
    menuConfig = { ...menuConfig, nmdChargeAwareBot: subCb.checked };
    saveMenuConfig(menuConfig);
  });

  const hpInput = (label: string, key: 'playerHp' | 'enemyHp'): void => {
    const l = document.createElement('label');
    l.appendChild(document.createTextNode(`${label} `));
    const n = document.createElement('input');
    n.type = 'number';
    n.min = '1';
    n.max = '9999';
    n.step = '1';
    n.value = String(menuConfig[key]);
    n.addEventListener('change', () => {
      const v = Math.max(1, Math.min(9999, Math.floor(Number(n.value) || 1)));
      n.value = String(v);
      menuConfig = { ...menuConfig, [key]: v };
      saveMenuConfig(menuConfig);
    });
    l.appendChild(n);
    health.appendChild(l);
  };
  hpInput('Player HP', 'playerHp');
  hpInput('Enemy HP', 'enemyHp');

  const hintRow = document.createElement('label');
  const hintCb = document.createElement('input');
  hintCb.type = 'checkbox';
  hintCb.checked = menuConfig.hintEnabled;
  hintCb.addEventListener('change', () => {
    menuConfig = { ...menuConfig, hintEnabled: hintCb.checked };
    saveMenuConfig(menuConfig);
  });
  hintRow.appendChild(hintCb);
  hintRow.appendChild(document.createTextNode(' Show hints'));
  hints.appendChild(hintRow);
  const delayRow = document.createElement('label');
  delayRow.appendChild(document.createTextNode('Hint delay (s) '));
  const delayN = document.createElement('input');
  delayN.type = 'number';
  delayN.min = '1';
  delayN.max = '60';
  delayN.step = '1';
  delayN.value = String(menuConfig.hintDelaySeconds);
  delayN.addEventListener('change', () => {
    const v = Math.max(1, Math.min(60, Math.floor(Number(delayN.value) || 7)));
    delayN.value = String(v);
    menuConfig = { ...menuConfig, hintDelaySeconds: v };
    saveMenuConfig(menuConfig);
  });
  delayRow.appendChild(delayN);
  hints.appendChild(delayRow);

  const capRow = document.createElement('label');
  const inf = document.createElement('input');
  inf.type = 'checkbox';
  inf.checked = menuConfig.maxCascadeSteps === null;
  capRow.appendChild(inf);
  capRow.appendChild(document.createTextNode(' Infinite cascades'));
  cascades.appendChild(capRow);

  const numRow = document.createElement('label');
  numRow.appendChild(document.createTextNode('Cascade cap (0–9) '));
  const num = document.createElement('input');
  num.type = 'number';
  num.min = '0';
  num.max = '9';
  num.step = '1';
  num.value = String(menuConfig.maxCascadeSteps ?? 0);
  num.disabled = inf.checked;
  numRow.appendChild(num);
  numRow.style.display = inf.checked ? 'none' : '';
  cascades.appendChild(numRow);

  const readCap = (): number => Math.max(0, Math.min(9, Math.floor(Number(num.value) || 0)));
  inf.addEventListener('change', () => {
    num.disabled = inf.checked;
    numRow.style.display = inf.checked ? 'none' : '';
    menuConfig = { ...menuConfig, maxCascadeSteps: inf.checked ? null : readCap() };
    saveMenuConfig(menuConfig);
  });
  num.addEventListener('change', () => {
    num.value = String(readCap());
    if (!inf.checked) {
      menuConfig = { ...menuConfig, maxCascadeSteps: readCap() };
      saveMenuConfig(menuConfig);
    }
  });

  const reset = document.createElement('button');
  reset.className = 'cfgreset';
  reset.textContent = 'Reset to Defaults';
  reset.addEventListener('click', () => {
    menuConfig = { ...DEFAULT_BATTLE_CONFIG };
    saveMenuConfig(menuConfig);
    rerender();
  });
  wrap.appendChild(reset);
  return wrap;
}

// Read-only config summary (pause panel + divergent-resume acknowledgment).
function configSummary(c: BattleConfig, heading: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const head = document.createElement('div');
  head.className = 'cfghead';
  head.textContent = heading;
  wrap.appendChild(head);
  const rows = [
    `Enemy matching: ${c.enemyMatching ? 'ON' : 'OFF'}`,
    `Hacker color bonus: ${c.hackerBonusEnabled ? 'ON' : 'OFF'}`,
    `Single-axis payout: ${c.singleAxisPayout ? 'ON' : 'OFF'}`,
    `No match damage: ${c.noMatchDamage ? `ON (${c.nmdChargeAwareBot ? 'charge-aware' : 'classic'} bot)` : 'OFF'}`,
    `Cascade cap: ${c.maxCascadeSteps === null ? 'Infinite' : c.maxCascadeSteps}`,
    `Starting HP: you ${c.playerHp} / enemy ${c.enemyHp}`,
    `Hints: ${c.hintEnabled ? `ON (${c.hintDelaySeconds}s)` : 'OFF'}`,
  ];
  for (const r of rows) {
    const d = document.createElement('div');
    d.textContent = r;
    wrap.appendChild(d);
  }
  return wrap;
}

// ---- character sheets (§10 — per side, opened from the avatar boxes) ----

const COLOR_NAMES: Record<Color, string> = {
  [Color.Red]: 'Red', [Color.Yellow]: 'Yellow', [Color.Magenta]: 'Magenta',
  [Color.Green]: 'Green', [Color.Cyan]: 'Cyan', [Color.Blue]: 'Blue',
};
const SHAPE_NAMES: Record<Shape, string> = {
  [Shape.Circle]: 'Circle', [Shape.Square]: 'Square', [Shape.Triangle]: 'Triangle',
  [Shape.Diamond]: 'Diamond', [Shape.Star]: 'Star', [Shape.Cross]: 'Cross',
};

// §10.2: strong/weak colors and shapes (weak = recognized complement), plus
// the pre-existing per-Program and general reference rows (designer ruling:
// keep extras while they fit; trim later if crowded).
function characterSheetSide(cfg: BattleConfig, side: Side): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  const strongC = cfg.strongColors[side];
  const strongS = cfg.strongShapes[side];
  const weakC = Array.from({ length: COLOR_COUNT }, (_, i) => i as Color).filter((c) => !strongC.includes(c));
  const weakS = Array.from({ length: SHAPE_COUNT }, (_, i) => i as Shape).filter((s) => !strongS.includes(s));
  row(side === 'player' ? 'HACKER' : 'SYSTEM', true);
  row(`Strong colors (${DAMAGE_PER_TILE_HIGH_COLOR} dmg): ${strongC.length ? strongC.map((c) => COLOR_NAMES[c]).join(', ') : 'none'}`);
  row(`Weak colors (${DAMAGE_PER_TILE_LOW_COLOR} dmg): ${weakC.length ? weakC.map((c) => COLOR_NAMES[c]).join(', ') : 'none'}`);
  row(`Strong shapes (${DAMAGE_PER_TILE_HIGH_SHAPE} dmg): ${strongS.length ? strongS.map((s) => SHAPE_NAMES[s]).join(', ') : 'none'}`);
  row(`Weak shapes (${DAMAGE_PER_TILE_LOW_SHAPE} dmg): ${weakS.length ? weakS.map((s) => SHAPE_NAMES[s]).join(', ') : 'none'}`);
  row('PROGRAMS', true);
  for (const p of programsFor(side)) {
    const colors = p.colors.map((c) => COLOR_NAMES[c]).join('/');
    const shapes = p.shapes.map((s) => SHAPE_NAMES[s]).join('/');
    row(`${p.name} [${p.id}] — cost ${p.cost} — ${colors} + ${shapes} — ${p.fn.name}`);
  }
  row('GENERAL', true);
  row(`Charge: +${CHARGE_PER_TILE_COLOR_MATCH} per tile of a program's bound color, +${CHARGE_PER_TILE_SHAPE_MATCH} per bound shape`);
  row(`Neutral damage: ${DAMAGE_PER_TILE_NEUTRAL} (matches only other neutrals; refills your Shake)`);
  return wrap;
}

function showCharacterSheet(side: Side): void {
  if (!game) return;
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(characterSheetSide(game.state.config, side));
  showDialog(side === 'player' ? 'HACKER' : 'SYSTEM', '', [['Close', hideDialog]], panels);
}

// ---- persistence (session envelope — logic/session.ts owns the format) ----

function persistSession(): void {
  if (!game || !session) return;
  saveBattle(serializeSession(session, game, pending), game.state.turn);
}

function appendWizard(action: WizardAction): void {
  if (!game || !session || !pending) return;
  appendWizardLog({
    v: LOG_VERSION,
    battleId: game.state.battleId,
    mode: session.mode,
    ...(session.mode === 'RUN' ? { runStep: session.step } : {}),
    natural: pending.natural,
    action,
    at: new Date().toISOString(),
  });
}

// After every completed action: drain and context-stamp turn logs, then
// either persist the active battle (stable point) or conclude into a saved
// PENDING_RESULT (§5.1 — the save is NOT cleared when the result appears;
// only accepted terminal actions clear it, §6.4).
function afterAction(): void {
  if (!game || !session) return;
  const ctx = battleContext(session);
  const entries = game.drainTurnLogs().map((e) => ({ ...e, mode: ctx.mode, ...(ctx.runStep !== undefined ? { runStep: ctx.runStep } : {}) }));
  appendTurnLogs(entries);
  if (game.state.winner) {
    if (!pending) {
      pending = { natural: naturalOf(game.state.winner), metricsLogged: false };
      logBattleMetrics();
    }
    persistSession();
  } else if (game.state.phase === 'playerPre') {
    persistSession();
  }
}

function logBattleMetrics(): void {
  if (!game || !session || !pending || pending.metricsLogged || !game.state.winner) return;
  const ctx = battleContext(session);
  appendMetricsLog({
    v: LOG_VERSION,
    battleId: game.state.battleId,
    config: { ...game.state.config },
    content: contentStamp(),
    endedAt: new Date().toISOString(),
    winner: game.state.winner,
    natural: pending.natural,
    mode: ctx.mode,
    ...(ctx.runStep !== undefined ? { runStep: ctx.runStep } : {}),
    ...(ctx.encounterSystemHp !== undefined ? { encounterSystemHp: ctx.encounterSystemHp } : {}),
    wallClockMs: Date.now() - battleStartAt,
    metrics: game.state.metrics,
  });
  pending.metricsLogged = true;
}

// ---- title flow (§3) ----

function showTitle(): void {
  game = null;
  session = null;
  pending = null;
  view.clearBoard();
  const restored = deserializeSession(loadBattleJson());
  const buttons: ButtonSpec[] = [];
  if (restored) {
    buttons.push([continueLabel(restored.info), () => void resumeSession()]);
  }
  const savedInfo = restored ? restored.info : null;
  buttons.push(['Quick Match', () => confirmReplace(savedInfo, () => void startQuickMatch())]);
  buttons.push(['New Run', () => confirmReplace(savedInfo, () => void startNewRun())]);
  buttons.push(['Settings', showSettings]);
  showDialog('BREACH — alpha-0.2.0', '', buttons);
}

// §3.6 replacement confirmation — only when a valid resident save exists.
// Cancel leaves the save and title state unchanged.
function confirmReplace(saved: SessionInfo | null, start: () => void): void {
  if (!saved) {
    start();
    return;
  }
  showDialog(
    'REPLACE SAVE?',
    `Starting a new game will replace your resumable ${contextLabel(saved)} progress.`,
    [
      ['Cancel', showTitle],
      ['Replace this save', start],
    ],
  );
}

function showSettings(): void {
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(configPanel(showSettings));
  showDialog('SETTINGS', 'Applies to the next new game', [['Back', showTitle]], panels);
}

// ---- battle starts (all battle construction goes through logic/session.ts) ----

async function enterBattle(g: Game): Promise<void> {
  hideDialog();
  game = g;
  selection = null;
  targetingSlot = null;
  battleStartAt = Date.now();
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  busy = true;
  await view.play(game.startPlayerPhase());
  endBusy();
  afterAction();
  maybeGameOver();
}

async function startQuickMatch(cfg?: BattleConfig): Promise<void> {
  clearBattleSave(); // confirmed replacement (or a result-screen restart)
  session = { mode: 'QUICK_MATCH' };
  pending = null;
  await enterBattle(createQuickMatchBattle(cfg ?? menuConfig));
}

async function startNewRun(): Promise<void> {
  clearBattleSave();
  session = { mode: 'RUN', step: 1, config: snapshotRunConfig(menuConfig) };
  pending = null;
  await enterBattle(createRunBattle(session.config, session.step));
}

// Create a fresh battle for the CURRENT Run step (§4.3): new board, new RNG,
// full Hacker HP, encounter System HP, nothing carried over.
async function startRunStep(): Promise<void> {
  if (!session || session.mode !== 'RUN') return;
  pending = null;
  await enterBattle(createRunBattle(session.config, session.step));
}

async function resumeSession(): Promise<void> {
  const r = deserializeSession(loadBattleJson());
  if (!r) {
    showTitle(); // save vanished/corrupted since the dialog was built
    return;
  }
  hideDialog();
  session = r.info;
  game = r.game;
  pending = r.pending;
  selection = null;
  targetingSlot = null;
  battleStartAt = Date.now();
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  console.info(`[breach] ${contextLabel(session)} restored (turn ${game.state.turn})`);
  busy = true;
  await view.play([{ t: 'msg', text: `${contextLabel(session)} resumed — turn ${game.state.turn}` }]);
  if (pending) {
    // §5.1: restore the battle AND its pending result modal — never skip an
    // unresolved result. Heal a crash between conclusion and metric logging.
    logBattleMetrics();
    persistSession();
    showResultModal();
    return;
  }
  endBusy();
  // MK5.4 divergence acknowledgment: the save's config is authoritative. For
  // a Run compare the RUN SNAPSHOT (per-battle enemyHp is encounter-overridden
  // by design and not a divergence).
  const authoritative = session.mode === 'RUN' ? session.config : game.state.config;
  if (!configsEqual(authoritative, menuConfig)) {
    showDialog(
      'BATTLE CONFIG',
      'This battle is using the configuration it was started with, not your current settings.',
      [['Understood', hideDialog]],
      configSummary(game.state.config, 'ACTIVE BATTLE CONFIG'),
    );
  }
}

// ---- results, progression, wizard actions (§4.4-4.6, §5) ----

function maybeGameOver(): void {
  if (!game?.state.winner || !pending) return;
  showResultModal();
}

function exitToTitleClearing(): void {
  clearBattleSave(); // §6.4 accepted terminal action
  showTitle();
}

function advanceRun(): void {
  if (!session || session.mode !== 'RUN') return;
  const n = nextStep(session.step);
  if (n === null) return; // step 4 concludes via Run Complete, not advance
  session = { ...session, step: n };
  void startRunStep();
}

function forceWin(): void {
  if (!game || !session || !pending) return;
  appendWizard('WIZARD_FORCE_WIN'); // logged distinctly even on a natural win (§5.3)
  pending = { ...pending, forcedWin: true };
  persistSession();
  if (session.mode === 'RUN' && session.step < 4) {
    advanceRun(); // battles 1-3: progress to the next fresh encounter
  } else {
    showResultModal(); // QM terminal / step-4 Run Complete presentation
  }
}

function wizardRestartLostBattle(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_LOST_BATTLE');
  void startRunStep(); // same step/config/encounter HP; new board + RNG (§5.5)
}

function wizardRestartRun(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_RUN');
  session = { ...session, step: 1 };
  void startRunStep(); // same saved Run config; fresh Battle 1 (§4.6)
}

function showResultModal(): void {
  if (!game || !session || !pending) return;
  busy = true; // lock board input while a result modal is up
  const m = game.state.metrics;

  // Run Complete (§4.4): step-4 win (natural or forced). No Force Win here.
  if (session.mode === 'RUN' && isRunComplete(session, pending)) {
    showDialog(
      'RUN COMPLETE',
      pending.forcedWin && pending.natural === 'NATURAL_DEFEAT' ? 'Wizard override — run completed.' : 'All four systems breached.',
      [['Exit', exitToTitleClearing]],
      metricsElement(m),
    );
    return;
  }

  const asVictory = progressesAsVictory(pending);
  const title = pending.natural === 'NATURAL_VICTORY' ? 'VICTORY' : pending.forcedWin ? 'FORCED VICTORY' : 'DEFEAT';
  const sub =
    pending.natural === 'NATURAL_VICTORY'
      ? 'Enemy system breached.'
      : pending.forcedWin
        ? 'Wizard override accepted.'
        : 'Your connection was severed.';
  const buttons: ButtonSpec[] = [];

  if (session.mode === 'QUICK_MATCH') {
    // §5.6: preserved Quick Match flow — Reset restarts under this battle's
    // config (new save), Quit is the accepted terminal action (clears save).
    const cfg = { ...game.state.config };
    buttons.push(['Reset', () => void startQuickMatch(cfg)]);
    buttons.push(['Quit', exitToTitleClearing]);
    if (!pending.forcedWin) buttons.push(['Force Win', forceWin, 'wizard']);
  } else if (asVictory) {
    // Run battles 1-3 won (naturally or forced): accept to advance. Quit
    // returns to title WITHOUT clearing — the pending result stays resumable.
    buttons.push(['Next Battle', advanceRun]);
    buttons.push(['Quit (resume later)', showTitle]);
    if (!pending.forcedWin) buttons.push(['Force Win', forceWin, 'wizard']);
  } else {
    // Run defeat (§4.5): Restart Run, terminal end, wizard restart/force.
    buttons.push(['Restart Run', wizardRestartRun]);
    buttons.push(['End Run', exitToTitleClearing]);
    buttons.push(['Restart Lost Battle', wizardRestartLostBattle, 'wizard']);
    buttons.push(['Force Win', forceWin, 'wizard']);
  }

  showDialog(title, sub, buttons, metricsElement(m));
}

// ---- player actions ----

async function doSwap(a: Pt, b: Pt): Promise<void> {
  if (!game) return;
  const thinkMs = thinkStart !== null ? performance.now() - thinkStart : undefined;
  busy = true;
  view.setHint(null);
  const r = game.attemptSwap(a, b, thinkMs, hintFiredThisTurn);
  await view.play(r.events);
  if (r.matched) {
    if (!game.state.winner) await view.play(game.runEnemyPhase());
    if (!game.state.winner) await view.play(game.startPlayerPhase());
    afterAction();
    endBusy();
  } else {
    busy = false; // invalid swap: the think clock keeps running
  }
  maybeGameOver();
}

// ---- startup: load + validate data BEFORE any title/battle init (§10.4) ----

function showDataFailure(errors: number, warnings: number, lines: string[]): void {
  const list = document.createElement('div');
  list.className = 'metrics';
  for (const l of lines.slice(0, 20)) {
    const d = document.createElement('div');
    d.textContent = l;
    list.appendChild(d);
  }
  if (lines.length > 20) {
    const d = document.createElement('div');
    d.textContent = `… ${lines.length - 20} more — see the browser console for the full validation report.`;
    list.appendChild(d);
  }
  showDialog(
    'DATA LOAD FAILED',
    `${errors} error(s), ${warnings} warning(s). Startup blocked — fix the CSV datasets and reload. Full report in the browser console.`,
    [],
    list,
  );
}

function boot(): void {
  menuConfig = loadMenuConfig();

  attachInput(canvas, view, {
    onTap(p: Pt): void {
      if (!canAct()) return;
      if (targetingSlot !== null) {
        targetingSlot = null;
        return;
      }
      if (selection && selection.x === p.x && selection.y === p.y) {
        selection = null;
      } else if (selection && Math.abs(selection.x - p.x) + Math.abs(selection.y - p.y) === 1) {
        const a = selection;
        selection = null;
        view.setSelection(null);
        void doSwap(a, p);
        return;
      } else {
        selection = p;
      }
      view.setSelection(selection);
    },
    onDrag(a: Pt, b: Pt): void {
      if (!canAct()) return;
      if (targetingSlot !== null) {
        targetingSlot = null;
        return;
      }
      selection = null;
      view.setSelection(null);
      void doSwap(a, b);
    },
    onProgram(i: number): void {
      if (!canAct() || !game) return;
      if (targetingSlot !== null) {
        targetingSlot = null;
        return;
      }
      const u = game.state.units.player[i];
      const prog: ResolvedProgram = programsFor('player')[i];
      if (requiresTarget(prog)) {
        if (u.charge >= prog.cost) targetingSlot = i;
        return;
      }
      const events = game.fireProgram(i);
      if (!events.length) return;
      busy = true;
      void view.play(events).then(() => {
        afterAction();
        busy = false;
        maybeGameOver();
      });
    },
    onMinion(i: number): void {
      if (!canAct() || !game || targetingSlot === null) return;
      const slot = targetingSlot;
      targetingSlot = null;
      const events = game.fireProgram(slot, i);
      if (!events.length) return;
      busy = true;
      void view.play(events).then(() => {
        afterAction();
        busy = false;
        maybeGameOver();
      });
    },
    onShake(): void {
      if (!canAct() || !game) return;
      if (targetingSlot !== null) {
        targetingSlot = null;
        return;
      }
      const events = game.fireShake();
      if (!events.length) return;
      busy = true;
      void view.play(events).then(() => {
        afterAction();
        busy = false;
        maybeGameOver();
      });
    },
    // §10 — avatar controls open the side's character sheet. Available only
    // at the same stable input phase as Pause; never a combat event.
    onAvatar(side: Side): void {
      if (!canAct() || !game) return;
      targetingSlot = null;
      showCharacterSheet(side);
    },
    onMenu(): void {
      // Pause only in the make-a-match phase, never mid-resolution. §11: shows
      // mode context; character sheets moved to the avatars; Reset exists in
      // Quick Match only (approved ruling — Run restarts are wizard actions).
      if (!canAct() || !game || !session) return;
      targetingSlot = null;
      const cfg = { ...game.state.config };
      const panels = document.createElement('div');
      panels.className = 'panelscroll';
      panels.appendChild(configSummary(cfg, 'ACTIVE BATTLE CONFIG'));
      const buttons: ButtonSpec[] = [['Resume', hideDialog]];
      if (session.mode === 'QUICK_MATCH') {
        buttons.push(['Reset', () => void startQuickMatch(cfg)]);
      }
      buttons.push(['Quit', showTitle]); // mid-battle quit keeps the save resumable
      showDialog('PAUSED', contextLabel(session), buttons, panels);
    },
  });

  showTitle();

  // MK7.7 — hint timer
  window.addEventListener('pointerdown', () => {
    lastInputAt = performance.now();
  });
  setInterval(() => {
    if (!game || !canAct() || hintFiredThisTurn) return;
    const cfg = game.state.config;
    if (!cfg.hintEnabled || thinkStart === null) return;
    const idleSince = Math.max(thinkStart, lastInputAt);
    if (performance.now() - idleSince < cfg.hintDelaySeconds * 1000) return;
    const mv = findHintMove(game.state.board);
    if (mv) {
      view.setHint(mv);
      hintFiredThisTurn = true;
    }
  }, 400);

  // MK7.8 — debug-only find-match button (dev builds only)
  if (import.meta.env.DEV) {
    const b = document.createElement('button');
    b.id = 'dbgfind';
    b.textContent = 'find match';
    b.addEventListener('click', () => {
      if (!game || !canAct()) return;
      const mv = findBotMove(game.state.board);
      if (mv) {
        view.setHint(mv);
        hintFiredThisTurn = true;
      }
    });
    document.body.appendChild(b);
    const placeDbg = (): void => {
      const r = canvas.getBoundingClientRect();
      const a = view.debugAnchor;
      b.style.left = `${Math.round(r.left + a.x)}px`;
      b.style.top = `${Math.round(r.top + a.y)}px`;
    };
    placeDbg();
    window.addEventListener('resize', placeDbg);
  }
}

{
  const result = loadContent(browserDataFiles());
  const lines = result.issues.map(formatIssue);
  if (result.content) {
    setActiveContent(result.content);
    if (result.warnings > 0) {
      console.warn(`[breach] data loaded with ${result.warnings} warning(s):\n${lines.join('\n')}`);
    }
    console.info(`[breach] content loaded: ${getContent().fingerprint} (${LOG_VERSION})`);
    boot();
  } else {
    console.error(`[breach] DATA VALIDATION FAILED — ${result.errors} error(s), ${result.warnings} warning(s):\n${lines.join('\n')}`);
    showDataFailure(result.errors, result.warnings, lines);
  }
}

// MK4.3 console-dump helpers (sanctioned log access — no viewing UI)
const helpers = window as unknown as Record<string, unknown>;
helpers.breachLogs = () => readLogs();
helpers.breachWipe = (opts?: { save?: boolean }) => {
  wipeLogs();
  if (opts?.save) clearBattleSave();
  console.info(`[breach] logs wiped${opts?.save ? ' (and battle save)' : ''}`);
};
