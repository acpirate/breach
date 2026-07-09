// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (title → battle → pause/game-over) but no game rules.

import {
  BOARD_SHAKE_COST,
  STARTING_HP_ENEMY,
  STARTING_HP_PLAYER_LOW_SCENARIO,
  STARTING_HP_PLAYER_NORMAL,
  UNIT_DEFS,
} from './logic/constants';
import { Game } from './logic/game';
import { BattleMetrics } from './logic/metrics';
import { Pt, Scenario, Side, UNIT_ORDER, gridViewOf } from './logic/types';
import { attachInput } from './render/input';
import { Hud, View } from './render/view';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

let game: Game | null = null;
let scenario: Scenario = 'normal';
let busy = false; // true while animations / enemy phase are in flight
let selection: Pt | null = null;
// MK3.2: Disabler targeting mode — armed by tapping the charged Disabler;
// the next tap on an enemy minion fires it, any other tap cancels (free).
let targeting = false;

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

function showTitle(): void {
  game = null;
  showDialog('BREACH — PoC', 'Select scenario', [
    ['Normal (150 HP vs 150 HP)', () => void startBattle('normal')],
    ['Forced loss (1 HP vs 150 HP)', () => void startBattle('forcedLoss')],
  ]);
}

async function startBattle(s: Scenario): Promise<void> {
  scenario = s;
  hideDialog();
  game = new Game(s);
  selection = null;
  targeting = false;
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  busy = true;
  await view.play(game.startPlayerPhase());
  busy = false;
  maybeGameOver();
}

function maybeGameOver(): void {
  if (!game?.state.winner) return;
  busy = true; // lock input for good
  const won = game.state.winner === 'player';
  showDialog(
    won ? 'VICTORY' : 'DEFEAT',
    won ? 'Enemy system breached.' : 'Your connection was severed.',
    [
      ['Reset', () => void startBattle(scenario)],
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
      busy = false;
      maybeGameOver();
    });
  },
  onMenu(): void {
    // Pause menu only in the make-a-match phase, never mid-resolution (spec 1.12)
    if (!canAct()) return;
    targeting = false;
    showDialog('PAUSED', '', [
      ['Resume', hideDialog],
      ['Reset', () => void startBattle(scenario)],
      ['Quit', showTitle],
    ]);
  },
});

showTitle();
