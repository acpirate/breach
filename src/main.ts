// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (title → battle → pause/game-over) but no game rules.

import { BOARD_SHAKE_COST, UNIT_DEFS } from './logic/constants';
import { Game } from './logic/game';
import { Pt, Scenario, Side, gridViewOf } from './logic/types';
import { attachInput } from './render/input';
import { Hud, View } from './render/view';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

let game: Game | null = null;
let scenario: Scenario = 'normal';
let busy = false; // true while animations / enemy phase are in flight
let selection: Pt | null = null;

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
  const hpMaxPlayer = s.scenario === 'normal' ? 150 : 1;
  return {
    hpPlayer: Math.max(0, s.hp.player),
    hpPlayerMax: hpMaxPlayer,
    hpEnemy: Math.max(0, s.hp.enemy),
    hpEnemyMax: 150,
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
    statusText: s.winner ? '' : act ? 'Fire abilities, then swap to match' : '…',
  };
}

const view = new View(canvas, getHud);

// ---- dialogs (DOM) ----

function showDialog(title: string, sub: string, buttons: [string, () => void][]): void {
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
  overlay.appendChild(box);
  overlay.classList.remove('hidden');
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
    selection = null;
    view.setSelection(null);
    void doSwap(a, b);
  },
  onProgram(i: number): void {
    if (!canAct() || !game) return;
    const events = game.fireProgram(i);
    if (!events.length) return;
    busy = true;
    void view.play(events).then(() => {
      busy = false;
      maybeGameOver();
    });
  },
  onShake(): void {
    if (!canAct() || !game) return;
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
    showDialog('PAUSED', '', [
      ['Resume', hideDialog],
      ['Reset', () => void startBattle(scenario)],
      ['Quit', showTitle],
    ]);
  },
});

showTitle();
