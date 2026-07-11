// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (title → battle → pause/game-over) but no game rules.

import {
  BOARD_SHAKE_COST,
  DEFAULT_BATTLE_CONFIG,
  STARTING_HP_ENEMY,
  STARTING_HP_PLAYER_LOW_SCENARIO,
  STARTING_HP_PLAYER_NORMAL,
  UNIT_DEFS,
} from './logic/constants';
import { Game } from './logic/game';
import { LOG_VERSION } from './logic/logger';
import { BattleMetrics } from './logic/metrics';
import { deserializeGame, serializeGame } from './logic/save';
import { BattleConfig, Pt, Scenario, Side, UNIT_ORDER, gridViewOf } from './logic/types';
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
let scenario: Scenario = 'normal';
let busy = false; // true while animations / enemy phase are in flight
let selection: Pt | null = null;
// MK3.2: Disabler targeting mode — armed by tapping the charged Disabler;
// the next tap on an enemy minion fires it, any other tap cancels (free).
let targeting = false;
// MK5.4: the menu's battle config — persisted, never implicitly reset. A
// running battle uses ITS OWN immutable copy (game.state.config), not this.
let menuConfig: BattleConfig = loadMenuConfig();

function configsEqual(a: BattleConfig, b: BattleConfig): boolean {
  return (
    a.enemyMatching === b.enemyMatching &&
    a.hackerBonusEnabled === b.hackerBonusEnabled &&
    a.singleAxisPayout === b.singleAxisPayout &&
    a.maxCascadeSteps === b.maxCascadeSteps
  );
}

function canAct(): boolean {
  return !!game && !busy && !game.state.winner && game.state.phase === 'playerPre';
}

function buffCount(side: Side): number {
  if (!game) return 0;
  let n = 0;
  for (const row of game.state.board) {
    for (const t of row) {
      if (t?.special?.type === 'buff' && t.special.owner === side) n++;
    }
  }
  return n;
}

function getHud(): Hud | null {
  if (!game) return null;
  const s = game.state;
  const act = canAct();
  const hpMaxPlayer = s.scenario === 'normal' ? STARTING_HP_PLAYER_NORMAL : STARTING_HP_PLAYER_LOW_SCENARIO;
  return {
    hpPlayer: Math.max(0, s.hp.player),
    hpPlayerMax: hpMaxPlayer,
    hpEnemy: Math.max(0, s.hp.enemy),
    hpEnemyMax: STARTING_HP_ENEMY,
    programs: s.units.player.map((u) => {
      const d = UNIT_DEFS[u.type];
      return { label: d.label, cost: d.cost, charge: u.charge, ready: act && u.charge >= d.cost, color: d.color, shape: d.shape };
    }),
    minions: s.units.enemy.map((u) => {
      const d = UNIT_DEFS[u.type];
      return { label: d.label, cost: d.cost, charge: u.charge, ready: false, color: d.color, shape: d.shape };
    }),
    shakeCharge: s.shakeCharge,
    shakeCost: BOARD_SHAKE_COST,
    shakeReady: act && s.shakeCharge >= BOARD_SHAKE_COST,
    buffPlayer: buffCount('player') * 5,
    buffEnemy: buffCount('enemy') * 5,
    turn: s.turn,
    canAct: act,
    statusText: s.winner
      ? ''
      : targeting
        ? 'Tap an enemy minion to disable it'
        : act
          ? 'Fire abilities, then swap to match'
          : '…',
    targeting,
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

  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    row(side === 'player' ? 'YOUR SIDE' : 'ENEMY SIDE', true);
    row(`Total damage dealt: ${fmt(sm.totalDamage)}`);
    row(`  from matches: ${fmt(sm.matchDamage)}`);
    row(`  from Attacker ability: ${fmt(sm.attackerDamage)}`);
    row(`  from bomb detonations: ${fmt(sm.bombDamage)}`);
    const critPct = sm.matchDamage > 0 ? ((sm.critExtra / sm.matchDamage) * 100).toFixed(1) : '0.0';
    row(`Crit bonus damage (1.5x extra): ${fmt(sm.critExtra)} (${critPct}% of match damage)`);
    row(`Largest single hit: ${fmt(sm.largestHit)}`);
    row(`Deepest cascade: ${sm.deepestCascade} step${sm.deepestCascade === 1 ? '' : 's'}`);
    const contPct = sm.tilesDestroyed > 0 ? ((sm.contentionTiles / sm.tilesDestroyed) * 100).toFixed(1) : '0.0';
    row(`Opponent-bound tiles destroyed: ${sm.contentionTiles} of ${sm.tilesDestroyed} (${contPct}%)`);
    for (const t of UNIT_ORDER) {
      const u = sm.units[t];
      row(`${UNIT_DEFS[t].label}: fired ${u.fires}, effect ${fmt(u.effect)}, charge wasted ${fmt(u.chargeWasted)}`);
    }
  }
  return wrap;
}

function hideDialog(): void {
  overlay.classList.add('hidden');
}

// MK5.3 — menu config panel: all four flags settable per battle. Persists on
// every change; "Reset to Defaults" is the only reset.
function configPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config';
  const head = document.createElement('div');
  head.className = 'cfghead';
  head.textContent = 'BATTLE CONFIG';
  wrap.appendChild(head);

  const check = (label: string, key: 'enemyMatching' | 'hackerBonusEnabled' | 'singleAxisPayout'): void => {
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
    wrap.appendChild(l);
  };
  check('Enemy matching', 'enemyMatching');
  check('Hacker color bonus', 'hackerBonusEnabled');
  check('Single-axis payout', 'singleAxisPayout');

  // cascade cap: "Infinite?" toggle + 0-9 integer input (0 = zero cascades)
  const capRow = document.createElement('label');
  const inf = document.createElement('input');
  inf.type = 'checkbox';
  inf.checked = menuConfig.maxCascadeSteps === null;
  capRow.appendChild(inf);
  capRow.appendChild(document.createTextNode(' Infinite cascades'));
  wrap.appendChild(capRow);

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
  wrap.appendChild(numRow);

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
    showTitle(); // rebuild the panel with default values
  });
  wrap.appendChild(reset);
  return wrap;
}

// Read-only config summary (pause panel + divergent-resume acknowledgment)
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
    `Cascade cap: ${c.maxCascadeSteps === null ? 'Infinite' : c.maxCascadeSteps}`,
  ];
  for (const r of rows) {
    const d = document.createElement('div');
    d.textContent = r;
    wrap.appendChild(d);
  }
  return wrap;
}

function showTitle(): void {
  game = null;
  const buttons: [string, () => void][] = [];
  // MK4.2: Continue appears only when a valid, version-compatible,
  // in-progress save exists
  const resumable = deserializeGame(loadBattleJson());
  if (resumable) {
    buttons.push([`Continue (turn ${resumable.state.turn}, ${resumable.state.scenario === 'normal' ? 'normal' : 'forced loss'})`, () => void resumeBattle()]);
  }
  buttons.push([`Normal (${STARTING_HP_PLAYER_NORMAL} HP vs ${STARTING_HP_ENEMY} HP)`, () => void startBattle('normal')]);
  buttons.push([`Forced loss (${STARTING_HP_PLAYER_LOW_SCENARIO} HP vs ${STARTING_HP_ENEMY} HP)`, () => void startBattle('forcedLoss')]);
  showDialog('BREACH — PoC', 'Select scenario', buttons, configPanel());
}

// MK5.4: `cfg` is supplied by Restart paths (a restart is the same battle —
// its rules are part of its identity); new games use the menu's config.
async function startBattle(s: Scenario, cfg?: BattleConfig): Promise<void> {
  clearBattleSave(); // MK4.2: starting fresh wipes any resident save (also the corrupt-save escape hatch)
  scenario = s;
  hideDialog();
  game = new Game(s, cfg ?? menuConfig);
  selection = null;
  targeting = false;
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  busy = true;
  await view.play(game.startPlayerPhase());
  busy = false;
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
  scenario = g.state.scenario;
  selection = null;
  targeting = false;
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  console.info(`[breach] state restored (turn ${game.state.turn})`);
  busy = true;
  await view.play([{ t: 'msg', text: `Battle resumed — turn ${game.state.turn}` }]);
  busy = false;
  // MK5.4: the save's config is authoritative for this battle. If it differs
  // from the current menu config, force an acknowledgment — auto-open the
  // config panel; the player must dismiss it to proceed (the overlay blocks
  // all board/ability input until then). Only when they actually differ.
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
// Tier 1 metrics log entry.
function afterAction(): void {
  if (!game) return;
  appendTurnLogs(game.drainTurnLogs());
  if (game.state.winner) {
    clearBattleSave();
    appendMetricsLog({
      v: LOG_VERSION,
      battleId: game.state.battleId,
      config: { ...game.state.config }, // MK5.5 — config stamp
      endedAt: new Date().toISOString(),
      scenario: game.state.scenario,
      winner: game.state.winner,
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
  // MK5.4: Restart ALWAYS reuses the exact config of the battle just played,
  // regardless of the current menu config
  const cfg = { ...game.state.config };
  showDialog(
    won ? 'VICTORY' : 'DEFEAT',
    won ? 'Enemy system breached.' : 'Your connection was severed.',
    [
      ['Reset', () => void startBattle(scenario, cfg)],
      ['Quit', showTitle],
    ],
    metricsElement(game.state.metrics),
  );
}

// ---- player actions ----

async function doSwap(a: Pt, b: Pt): Promise<void> {
  if (!game) return;
  busy = true;
  const r = game.attemptSwap(a, b);
  await view.play(r.events);
  if (r.matched) {
    if (!game.state.winner) await view.play(game.runEnemyPhase());
    if (!game.state.winner) await view.play(game.startPlayerPhase());
    afterAction();
  }
  busy = false;
  maybeGameOver();
}

attachInput(canvas, view, {
  onTap(p: Pt): void {
    if (!canAct()) return;
    if (targeting) {
      targeting = false; // tap elsewhere cancels targeting (consumes the tap)
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
    if (targeting) {
      targeting = false;
      return;
    }
    selection = null;
    view.setSelection(null);
    void doSwap(a, b);
  },
  onProgram(i: number): void {
    if (!canAct() || !game) return;
    if (targeting) {
      targeting = false; // tapping any program (incl. Disabler again) cancels
      return;
    }
    const u = game.state.units.player[i];
    if (u.type === 'disabler') {
      // MK3.2: charged Disabler arms targeting mode instead of firing blind
      if (u.charge >= UNIT_DEFS[u.type].cost) targeting = true;
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
    if (!canAct() || !game || !targeting) return;
    targeting = false;
    const events = game.fireProgram(UNIT_ORDER.indexOf('disabler'), i);
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
    if (targeting) {
      targeting = false;
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
    // Pause menu only in the make-a-match phase, never mid-resolution (spec 1.12).
    // MK5.3: displays the ACTIVE battle config, read-only; MK5.4: mid-battle
    // Reset also reuses this battle's config (same battle identity).
    if (!canAct() || !game) return;
    targeting = false;
    const cfg = { ...game.state.config };
    showDialog(
      'PAUSED',
      '',
      [
        ['Resume', hideDialog],
        ['Reset', () => void startBattle(scenario, cfg)],
        ['Quit', showTitle],
      ],
      configSummary(cfg, 'ACTIVE BATTLE CONFIG'),
    );
  },
});

showTitle();

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
