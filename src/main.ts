// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (data load → title → battle → pause/game-over)
// but no game rules.
//
// Alpha 0.1.0: startup loads and validates the CSV datasets BEFORE any title
// or battle initialization (§5.3/§10.4). Any validation error shows a
// blocking developer-facing failure screen with no bypass; the resolved
// runtime model is then the single source of truth for every consumer here.

import {
  BOARD_SHAKE_COST,
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_HIGH_SHAPE,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_LOW_SHAPE,
  DAMAGE_PER_TILE_NEUTRAL,
  DEFAULT_BATTLE_CONFIG,
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
import { deserializeGame, serializeGame } from './logic/save';
import { BattleConfig, Color, Pt, Shape, Side, gridViewOf } from './logic/types';
import { browserDataFiles } from './dataBrowser';
import { attachInput } from './render/input';
import { Hud, View } from './render/view';
import {
  appendMetricsLog,
  appendTurnLogs,
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

let game: Game | null = null;
let busy = false; // true while animations / enemy phase are in flight
let selection: Pt | null = null;
// MK6.6 — think-time clock: stamped when the turn's input actually unlocks,
// read when the match commits. Abilities/invalid swaps leave it running.
let thinkStart: number | null = null;
let battleStartAt = 0; // wall-clock anchor for this session's battle
// MK7.7 — hint state
let hintFiredThisTurn = false;
let lastInputAt = performance.now();
// Targeting mode: which player slot is armed and awaiting an enemy target
// (Alpha: any Program whose plan leads with the player-targeted Drain).
let targetingSlot: number | null = null;
// MK5.4: the menu's battle config — persisted, never implicitly reset. A
// running battle uses ITS OWN immutable copy (game.state.config), not this.
let menuConfig: BattleConfig = DEFAULT_BATTLE_CONFIG;

// canonical value list — safer than field-by-field as the config grows
// (Alpha: cost fields removed from config; costs are content)
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

// input just unlocked into the make-a-match phase → start the think clock
// and reset the per-turn hint state (MK7.7)
function endBusy(): void {
  busy = false;
  thinkStart = canAct() ? performance.now() : null;
  hintFiredThisTurn = false;
  view.setHint(null);
}

function canAct(): boolean {
  return !!game && !busy && !game.state.winner && game.state.phase === 'playerPre';
}

// Sum of active special-tile magnitudes for a side (buff bonus / shield
// points come from the per-tile data stamped at placement).
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
    hpPlayerMax: s.config.playerHp, // MK6.4: HP lives in the config
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
    shieldEnemy: specialMagnitude('shield', 'enemy'), // MK9.3
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

function showDialog(title: string, sub: string, buttons: [string, () => void][], extra?: HTMLElement): void {
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
  for (const [label, cb] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', cb);
    box.appendChild(b);
  }
  if (extra) box.appendChild(extra); // MK2.3: metrics go BELOW the buttons
  overlay.appendChild(box);
  overlay.classList.remove('hidden');
}

// MK2.3 game-over metrics: plain text rows in a scrollable area, player side
// first, enemy side second. Reads only logic-layer metrics state.
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
  // MK9.3 — enemy shields (prevention is NOT damage dealt; reported separately)
  row(`Enemy shields — created ${m.enemyShieldCreated}, removed ${m.enemyShieldRemoved}`);
  row(`Shielded hits: ${m.enemyShieldInstances}, damage prevented: ${fmt(m.enemyShieldPrevented)}`);

  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    row(side === 'player' ? 'YOUR SIDE' : 'ENEMY SIDE', true);
    // MK7.3/7.4 — four disjoint causal buckets (sum exactly to total)
    row(`Total damage dealt: ${fmt(sm.totalDamage)}`);
    row(`  match-caused (incl. its cascades): ${fmt(sm.matchDamage)}`);
    row(`  bomb-caused (incl. its cascades): ${fmt(sm.bombDamage)}`);
    row(`  Attack: ${fmt(sm.attackerDamage)}`);
    row(`  Buffer added: ${fmt(sm.bufferDamageAdded)}`);
    row(`Cascade (RNG-refill) damage, any cause: ${fmt(sm.cascadeDamage)}`); // MK7.3 cross-cut
    row(`Match damage by axis: color ${fmt(sm.matchDamageColor)} / shape ${fmt(sm.matchDamageShape)}`); // MK7.5
    const critPct = sm.matchDamage > 0 ? ((sm.critExtra / sm.matchDamage) * 100).toFixed(1) : '0.0';
    row(`Crit bonus damage (1.5x extra): ${fmt(sm.critExtra)} (${critPct}% of match damage)`);
    row(`Largest single hit: ${fmt(sm.largestHit)}`);
    row(`Biggest round: ${fmt(sm.biggestRound)}`); // MK7.6 swinginess
    row(`Avg round damage (nonzero rounds): ${sm.roundDamageCount ? fmt(sm.roundDamageSum / sm.roundDamageCount) : '0'}`);
    row(`Deepest cascade: ${sm.deepestCascade} RNG round${sm.deepestCascade === 1 ? '' : 's'}`);
    const contPct = sm.tilesDestroyed > 0 ? ((sm.contentionTiles / sm.tilesDestroyed) * 100).toFixed(1) : '0.0';
    row(`Opponent-bound tiles destroyed: ${sm.contentionTiles} of ${sm.tilesDestroyed} (${contPct}%)`);
    // Alpha §13.4: metrics keyed by stable Program ID; display names joined here
    for (const p of programsFor(side)) {
      const u = sm.units[p.id];
      if (!u) continue;
      const placed = u.bombsPlaced > 0 ? `, bombs placed ${u.bombsPlaced}` : '';
      const fizz = u.fizzles > 0 ? `, fizzles ${u.fizzles}` : '';
      row(`${p.name} [${p.id}]: fired ${u.fires}, effect ${fmt(u.effect)}, charge wasted ${fmt(u.chargeWasted)}${placed}${fizz}`);
    }
  }

  // MK6.6 — timing (median computed here at display time; raw values logged)
  row('TIMING', true);
  const med = median(m.thinkTimesMs);
  row(`Median think-time: ${med === null ? 'n/a' : `${(med / 1000).toFixed(1)}s`} (${m.thinkTimesMs.length} moves)`);
  row(`Battle wall-clock: ${((Date.now() - battleStartAt) / 1000).toFixed(0)}s (this session)`);
  if (m.hintsShown > 0) row(`Hints shown: ${m.hintsShown}`); // MK7.7
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

// MK5.3/MK7.10 — battle config panel (lives in the Settings modal). Persists
// on every change; "Reset to Defaults" is the only reset. MK8.2 accordion.
// Alpha §12.4/12.5: the flat-cost and per-ability-cost controls are REMOVED.
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

  // MK6.2 No match damage + MK7.13 addendum sub-option
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

  // MK6.4 — starting HP inputs (1-9999)
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

  // MK7.7 — hint system
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

  // cascade cap: "Infinite?" toggle + 0-9 integer input (0 = zero cascades)
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
    rerender(); // rebuild the modal with default values
  });
  wrap.appendChild(reset);
  return wrap;
}

// Read-only config summary (pause panel + divergent-resume acknowledgment).
// Alpha: cost rows removed — costs are content, shown on the Character Sheet.
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

// MK6.5 — character sheet: the game's numbers, readable in-game. Alpha §12.1:
// names, costs, and bindings come from the RESOLVED DATA.
const COLOR_NAMES: Record<Color, string> = {
  [Color.Red]: 'Red', [Color.Yellow]: 'Yellow', [Color.Magenta]: 'Magenta',
  [Color.Green]: 'Green', [Color.Cyan]: 'Cyan', [Color.Blue]: 'Blue',
};
const SHAPE_NAMES: Record<Shape, string> = {
  [Shape.Circle]: 'Circle', [Shape.Square]: 'Square', [Shape.Triangle]: 'Triangle',
  [Shape.Diamond]: 'Diamond', [Shape.Star]: 'Star', [Shape.Cross]: 'Cross',
};

function characterSheet(cfg: BattleConfig): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  row('CHARACTER SHEET', true);
  // MK9.5: player and enemy statistics visibly separated; each side shows its
  // OWN strong color/shape. Charge & neutral explanations stay at the bottom.
  const sides: Array<[string, Side]> = [
    ['YOU', 'player'],
    ['ENEMY', 'enemy'],
  ];
  for (const [label, side] of sides) {
    row(label, true);
    const sc = cfg.strongColors[side];
    const ss = cfg.strongShapes[side];
    row(`Strong colors (${DAMAGE_PER_TILE_HIGH_COLOR} dmg): ${sc.length ? sc.map((c) => COLOR_NAMES[c]).join(', ') : 'none'}`);
    row(`Strong shapes (${DAMAGE_PER_TILE_HIGH_SHAPE} dmg): ${ss.length ? ss.map((s) => SHAPE_NAMES[s]).join(', ') : 'none'}`);
    row(`Weak (all other) colors/shapes: ${DAMAGE_PER_TILE_LOW_COLOR}/${DAMAGE_PER_TILE_LOW_SHAPE} dmg`);
    for (const p of programsFor(side)) {
      const colors = p.colors.map((c) => COLOR_NAMES[c]).join('/');
      const shapes = p.shapes.map((s) => SHAPE_NAMES[s]).join('/');
      row(`${p.name} [${p.id}] — cost ${p.cost} — ${colors} + ${shapes} — ${p.fn.name}`);
    }
  }
  // MK9.5: general charge + neutral explanations LAST, after side-specific info.
  row('GENERAL', true);
  row(`Charge: +${CHARGE_PER_TILE_COLOR_MATCH} per tile of a program's bound color, +${CHARGE_PER_TILE_SHAPE_MATCH} per bound shape`);
  row(`Neutral damage: ${DAMAGE_PER_TILE_NEUTRAL} (matches only other neutrals; refills your Shake)`);
  return wrap;
}

// MK7.10 — title screen is ACTIONS ONLY: New Game / Continue / Settings.
function showTitle(): void {
  game = null;
  view.clearBoard(); // MK7.11: no ghost board behind the title after Quit
  const buttons: [string, () => void][] = [];
  const resumable = deserializeGame(loadBattleJson());
  if (resumable) {
    buttons.push([`Continue (turn ${resumable.state.turn})`, () => void resumeBattle()]);
  }
  buttons.push(['New Game', () => void startBattle()]);
  buttons.push(['Settings', showSettings]);
  showDialog('BREACH — alpha-0.1.0', '', buttons);
}

function showSettings(): void {
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(configPanel(showSettings));
  showDialog('SETTINGS', 'Applies to the next new game', [['Back', showTitle]], panels);
}

// MK5.4: `cfg` is supplied by Restart paths (a restart is the same battle —
// its rules are part of its identity); new games use the menu's config.
async function startBattle(cfg?: BattleConfig): Promise<void> {
  clearBattleSave(); // MK4.2: starting fresh wipes any resident save
  hideDialog();
  game = new Game(cfg ?? menuConfig);
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

async function resumeBattle(): Promise<void> {
  const g = deserializeGame(loadBattleJson());
  if (!g) {
    showTitle(); // save vanished/corrupted since the dialog was built
    return;
  }
  hideDialog();
  game = g;
  selection = null;
  targetingSlot = null;
  battleStartAt = Date.now(); // wall-clock counts this session (MK6.6 discretion)
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  console.info(`[breach] state restored (turn ${game.state.turn})`);
  busy = true;
  await view.play([{ t: 'msg', text: `Battle resumed — turn ${game.state.turn}` }]);
  endBusy();
  // MK5.4: the save's config is authoritative for this battle. If it differs
  // from the current menu config, force an acknowledgment.
  if (!configsEqual(game.state.config, menuConfig)) {
    showDialog(
      'BATTLE CONFIG',
      'This battle is using the configuration it was started with, not your current settings.',
      [['Understood', hideDialog]],
      configSummary(game.state.config, 'ACTIVE BATTLE CONFIG'),
    );
  }
}

// MK4: after every completed action — drain turn logs, then autosave (stable
// point) or, the moment the battle is over, clear the save and append the
// Tier 1 metrics log entry (with the Alpha content-identity stamp, §13.2).
function afterAction(): void {
  if (!game) return;
  appendTurnLogs(game.drainTurnLogs());
  if (game.state.winner) {
    clearBattleSave();
    appendMetricsLog({
      v: LOG_VERSION,
      battleId: game.state.battleId,
      config: { ...game.state.config }, // MK5.5 — config stamp (HP included)
      content: contentStamp(), // §13.2 — loaded-content identity
      endedAt: new Date().toISOString(),
      winner: game.state.winner,
      wallClockMs: Date.now() - battleStartAt, // MK6.6
      metrics: game.state.metrics,
    });
  } else if (game.state.phase === 'playerPre') {
    saveBattle(serializeGame(game.state), game.state.turn);
  }
}

function maybeGameOver(): void {
  if (!game?.state.winner) return;
  busy = true; // lock input for good
  const won = game.state.winner === 'player';
  // MK5.4: Restart ALWAYS reuses the exact config of the battle just played
  const cfg = { ...game.state.config };
  showDialog(
    won ? 'VICTORY' : 'DEFEAT',
    won ? 'Enemy system breached.' : 'Your connection was severed.',
    [
      ['Reset', () => void startBattle(cfg)],
      ['Quit', showTitle],
    ],
    metricsElement(game.state.metrics),
  );
}

// ---- player actions ----

async function doSwap(a: Pt, b: Pt): Promise<void> {
  if (!game) return;
  // MK6.6: think-time = input-available -> this committed move
  const thinkMs = thinkStart !== null ? performance.now() - thinkStart : undefined;
  busy = true;
  view.setHint(null);
  const r = game.attemptSwap(a, b, thinkMs, hintFiredThisTurn);
  await view.play(r.events);
  if (r.matched) {
    if (!game.state.winner) await view.play(game.runEnemyPhase());
    if (!game.state.winner) await view.play(game.startPlayerPhase());
    afterAction();
    endBusy(); // move committed: next turn's think clock starts fresh
  } else {
    busy = false; // invalid swap: the think clock keeps running
  }
  maybeGameOver();
}

// ---- startup: load + validate data BEFORE any title/battle init (§10.4) ----

function showDataFailure(errors: number, warnings: number, lines: string[]): void {
  // Blocking developer-facing failure screen: concise count, details in the
  // console, NO bypass button (§10.4).
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
        targetingSlot = null; // tap elsewhere cancels targeting (consumes the tap)
        return;
      }
      if (selection && selection.x === p.x && selection.y === p.y) {
        selection = null; // tap the selected tile again: deselect
      } else if (selection && Math.abs(selection.x - p.x) + Math.abs(selection.y - p.y) === 1) {
        const a = selection;
        selection = null;
        view.setSelection(null);
        void doSwap(a, p);
        return;
      } else {
        selection = p; // no selection, or non-adjacent tap: (move) selection
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
        targetingSlot = null; // tapping any program (incl. the armed one) cancels
        return;
      }
      const u = game.state.units.player[i];
      const prog: ResolvedProgram = programsFor('player')[i];
      if (requiresTarget(prog)) {
        // A targeted Program (plan leads with player-choice Drain) arms
        // targeting mode instead of firing blind; gate on the data cost.
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
    onMenu(): void {
      // Pause menu only in the make-a-match phase, never mid-resolution.
      if (!canAct() || !game) return;
      targetingSlot = null;
      const cfg = { ...game.state.config };
      const panels = document.createElement('div');
      panels.className = 'panelscroll';
      panels.appendChild(configSummary(cfg, 'ACTIVE BATTLE CONFIG'));
      panels.appendChild(characterSheet(cfg)); // Alpha: built from resolved data
      showDialog(
        'PAUSED',
        '',
        [
          ['Resume', hideDialog],
          ['Reset', () => void startBattle(cfg)],
          ['Quit', showTitle],
        ],
        panels,
      );
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
        hintFiredThisTurn = true; // counts as assisted for think-time honesty
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

// MK4.3 console-dump helpers (sanctioned log access — no viewing UI):
//   breachLogs()               -> { metrics: [...], turns: [...] }
//   breachWipe({ save: true }) -> wipes logs (and optionally the battle save)
const helpers = window as unknown as Record<string, unknown>;
helpers.breachLogs = () => readLogs();
helpers.breachWipe = (opts?: { save?: boolean }) => {
  wipeLogs();
  if (opts?.save) clearBattleSave();
  console.info(`[breach] logs wiped${opts?.save ? ' (and battle save)' : ''}`);
};
