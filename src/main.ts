// Orchestrator: wires the pure logic layer to the canvas view and DOM dialogs.
// Owns the interaction flow (data load → title → setup → battle → pause/result)
// but no game rules: mode/Run/result/save/identity/LINK semantics live in
// logic/session.ts and this file only composes screens and routes actions
// through that API.

import {
  CHARGE_PER_TILE_COLOR_MATCH,
  CHARGE_PER_TILE_SHAPE_MATCH,
  DAMAGE_PER_TILE_HIGH_COLOR,
  DAMAGE_PER_TILE_HIGH_SHAPE,
  DAMAGE_PER_TILE_LOW_COLOR,
  DAMAGE_PER_TILE_LOW_SHAPE,
  DAMAGE_PER_TILE_NEUTRAL,
  DECK_CHARGE_PER_NEUTRAL_TILE,
  DEFAULT_BATTLE_SETTINGS,
} from './logic/constants';
import {
  ResolvedDeck,
  ResolvedHacker,
  ResolvedProgram,
  allDecks,
  allHackers,
  contentStamp,
  deckById,
  getContent,
  hackerById,
  programsFor,
  requiresTarget,
  setActiveContent,
} from './logic/data/content';
import { formatIssue, loadContent } from './logic/data/load';
import { findBotMove, findHintMove } from './logic/bot';
import { Game } from './logic/game';
import { LOG_VERSION, SelectionLogEntry, identityStamp } from './logic/logger';
import { BattleMetrics } from './logic/metrics';
import {
  PendingResultInfo,
  PendingSetup,
  SessionInfo,
  battleContext,
  beginSetup,
  chooseDeck,
  chooseHacker,
  contextLabel,
  continueLabel,
  createQuickMatchBattle,
  createRunBattle,
  defaultIdentity,
  deserializeSession,
  forceWinAvailable,
  isRunComplete,
  naturalOf,
  nextStep,
  progressesAsVictory,
  recreateBattleFromConfig,
  resolveHackerMaxLink,
  serializeSession,
  setupBack,
  setupComplete,
  snapshotRunSettings,
} from './logic/session';
import {
  BattleConfig,
  BattleIdentity,
  BattleSettings,
  Color,
  Pt,
  Shape,
  Side,
  WizardAction,
  gridViewOf,
} from './logic/types';
import { browserDataFiles } from './dataBrowser';
import { attachInput } from './render/input';
import { Hud, View } from './render/view';
import {
  appendMetricsLog,
  appendSelectionLog,
  appendTurnLogs,
  appendWizardLog,
  clearBattleSave,
  loadBattleJson,
  loadMenuSettings,
  readLogs,
  saveBattle,
  saveMenuSettings,
  wipeLogs,
} from './storage';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

// ---- session state (owned semantics live in logic/session.ts) ----
let session: SessionInfo | null = null;
let pending: PendingResultInfo | null = null;
let game: Game | null = null;
// §12 — ephemeral pending New Run setup. NEVER a save: entering setup does not
// touch the resident save, and there is no resumable half-configured Run.
let setup: PendingSetup | null = null;

let busy = false; // true while animations / System phase are in flight
let selection: Pt | null = null;
// MK6.6 — think-time clock
let thinkStart: number | null = null;
let battleStartAt = 0; // wall-clock anchor for this session's battle
// MK7.7 — hint state
let hintFiredThisTurn = false;
let lastInputAt = performance.now();
// Targeting mode: which Hacker slot is armed and awaiting a System target.
let targetingSlot: number | null = null;
// §20.2 — true exactly while Hacker input is locked for the System turn.
let systemTurnActive = false;
// MK5.4: the menu's chosen settings — persisted, never implicitly reset.
let menuSettings: BattleSettings = DEFAULT_BATTLE_SETTINGS;

// Canonical value list over the CHOSEN settings only (the resolved per-battle
// LINK/ICE and strong sets are derived, so they are not divergence signals).
function settingsKey(c: BattleSettings): string {
  return JSON.stringify([
    c.enemyMatching,
    c.singleAxisPayout,
    c.maxCascadeSteps,
    c.reinforcedConnection,
    c.reinforcedChargeAwareBot,
    c.normalLink,
    // manual values matter only while Normal LINK is OFF (§10.3 — they are
    // retained but unused when it is ON)
    c.normalLink ? 0 : c.manualHackerLink,
    c.normalLink ? 0 : c.manualSystemIce,
    c.hintEnabled,
    c.hintDelaySeconds,
  ]);
}

function settingsEqual(a: BattleSettings, b: BattleSettings): boolean {
  return settingsKey(a) === settingsKey(b);
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
  // §7.1 — the fifth Hacker-side control is Deck-owned; its label and cost come
  // from resolved Deck content, never from a Program.
  const deck = deckById(s.identity.deckId);
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
    deckLabel: deck.fn.name,
    deckCharge: s.deckCharge,
    deckCost: deck.fn.cost,
    deckReady: act && s.deckCharge >= deck.fn.cost,
    buffPlayer: specialMagnitude('buff', 'player'),
    buffEnemy: specialMagnitude('buff', 'enemy'),
    shieldPlayer: specialMagnitude('shield', 'player'),
    shieldEnemy: specialMagnitude('shield', 'enemy'),
    turn: s.turn,
    canAct: act,
    statusText: s.winner
      ? ''
      : targetingSlot !== null
        ? 'Tap a System Program to drain it'
        : act
          ? 'Fire Functions, then swap to Sync'
          : '…',
    targeting: targetingSlot !== null,
    systemTurn: systemTurnActive,
  };
}

const view = new View(canvas, getHud);

// ---- dialogs (DOM) ----

// A button spec's optional third element is a CSS class — used to mark
// wizard/dev controls as visually distinct (§18.3) without changing which
// handler fires. `disabled` gates the explicit forward actions on the setup
// screens until a choice exists.
type ButtonSpec = [string, () => void, string?, boolean?];

// `extraFirst` puts the supplied panel ABOVE the action buttons — used by the
// setup screens so the player reads the options before the forward action on a
// narrow screen (§13.2 mobile-first presentation).
function showDialog(title: string, sub: string, buttons: ButtonSpec[], extra?: HTMLElement, extraFirst = false): void {
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
  if (extra && extraFirst) box.appendChild(extra);
  for (const [label, cb, cls, disabled] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    if (disabled) b.disabled = true;
    b.addEventListener('click', cb);
    box.appendChild(b);
  }
  if (extra && !extraFirst) box.appendChild(extra);
  overlay.appendChild(box);
  overlay.classList.remove('hidden');
}

// MK2.3 game-over metrics panel.
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
  row(`Sync-locks (auto-reshuffles): ${m.autoReshuffles}`);
  row(`System shields — created ${m.enemyShieldCreated}, sliced ${m.enemyShieldRemoved}`);
  row(`Shielded hits: ${m.enemyShieldInstances}, damage prevented: ${fmt(m.enemyShieldPrevented)}`);

  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    row(side === 'player' ? 'HACKER' : 'SYSTEM', true);
    row(`Total damage dealt: ${fmt(sm.totalDamage)}`);
    row(`  Sync-caused (incl. its cascades): ${fmt(sm.matchDamage)}`);
    row(`  bomb-caused (incl. its cascades): ${fmt(sm.bombDamage)}`);
    row(`  Attack: ${fmt(sm.attackerDamage)}`);
    row(`  Buffer added: ${fmt(sm.bufferDamageAdded)}`);
    row(`  Skill damage: ${fmt(sm.skillDamage)}`);
    row(`Cascade (RNG-refill) damage, any cause: ${fmt(sm.cascadeDamage)}`);
    row(`Sync damage by axis: color ${fmt(sm.matchDamageColor)} / shape ${fmt(sm.matchDamageShape)}`);
    const critPct = sm.matchDamage > 0 ? ((sm.critExtra / sm.matchDamage) * 100).toFixed(1) : '0.0';
    row(`Crit bonus damage (1.5x extra): ${fmt(sm.critExtra)} (${critPct}% of Sync damage)`);
    row(`Largest single hit: ${fmt(sm.largestHit)}`);
    row(`Biggest round: ${fmt(sm.biggestRound)}`);
    row(`Avg round damage (nonzero rounds): ${sm.roundDamageCount ? fmt(sm.roundDamageSum / sm.roundDamageCount) : '0'}`);
    row(`Deepest cascade: ${sm.deepestCascade} RNG round${sm.deepestCascade === 1 ? '' : 's'}`);
    // §9.5 — line-clear frequency, so B1 board churn is observable in play
    row(`Line clears: ${sm.lineClears}`);
    const contPct = sm.tilesDestroyed > 0 ? ((sm.contentionTiles / sm.tilesDestroyed) * 100).toFixed(1) : '0.0';
    row(`Opponent-bound Packets sliced: ${sm.contentionTiles} of ${sm.tilesDestroyed} (${contPct}%)`);
    for (const p of programsFor(side)) {
      const u = sm.units[p.id];
      if (!u) continue;
      const placed = u.bombsPlaced > 0 ? `, bombs placed ${u.bombsPlaced}` : '';
      const fizz = u.fizzles > 0 ? `, fizzles ${u.fizzles}` : '';
      row(`${p.name} [${p.id}]: fired ${u.fires}, effect ${fmt(u.effect)}, charge wasted ${fmt(u.chargeWasted)}${placed}${fizz}`);
    }
    // §21.3 — Deck-owned metrics stay separate from the Program rows
    if (side === 'player' && game) {
      const d = sm.deck;
      const deck = deckById(game.state.identity.deckId);
      row(`${deck.fn.name} [${deck.id} deck]: fired ${d.fires}, neutral charge ${d.chargeFromNeutral} (wasted ${d.chargeWasted})`);
      if (d.shakeAttempts > 0) {
        row(`  Shake: ${d.shakeSuccesses}/${d.shakeAttempts} resolved, ${d.shakeFizzles} legal fizzle${d.shakeFizzles === 1 ? '' : 's'}`);
      }
      for (const [sid, k] of Object.entries(sm.skills)) {
        const skill = getContent().skills.get(sid);
        row(`Skill ${sid}${skill ? ` (${skill.display})` : ''}: ${k.triggers} trigger${k.triggers === 1 ? '' : 's'}, +${fmt(k.damage)} dmg, +${k.charge} charge`);
      }
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

// MK5.3/MK7.10 — battle settings panel (Settings modal).
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
  const health = section('LINK and ICE');
  const hints = section('Hints');
  const cascades = section('Cascades');

  const check = (parent: HTMLElement, label: string, key: 'enemyMatching' | 'singleAxisPayout'): void => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = menuSettings[key];
    cb.addEventListener('change', () => {
      menuSettings = { ...menuSettings, [key]: cb.checked };
      saveMenuSettings(menuSettings);
    });
    l.appendChild(cb);
    l.appendChild(document.createTextNode(` ${label}`));
    parent.appendChild(l);
  };
  check(modes, 'System matching', 'enemyMatching');
  check(modes, 'Single-axis payout', 'singleAxisPayout');

  // §11.1 — the former "No match damage" setting, renamed. Same underlying
  // setting path; no second toggle.
  const rcRow = document.createElement('label');
  const rcCb = document.createElement('input');
  rcCb.type = 'checkbox';
  rcCb.checked = menuSettings.reinforcedConnection;
  rcRow.appendChild(rcCb);
  rcRow.appendChild(document.createTextNode(' Reinforced Connection'));
  modes.appendChild(rcRow);
  const subRow = document.createElement('label');
  subRow.className = 'suboption';
  const subCb = document.createElement('input');
  subCb.type = 'checkbox';
  subCb.checked = menuSettings.reinforcedChargeAwareBot;
  subCb.disabled = !menuSettings.reinforcedConnection;
  subRow.appendChild(subCb);
  subRow.appendChild(document.createTextNode(' Charge-aware bot'));
  modes.appendChild(subRow);
  rcCb.addEventListener('change', () => {
    menuSettings = { ...menuSettings, reinforcedConnection: rcCb.checked };
    subCb.disabled = !rcCb.checked;
    saveMenuSettings(menuSettings);
  });
  subCb.addEventListener('change', () => {
    menuSettings = { ...menuSettings, reinforcedChargeAwareBot: subCb.checked };
    saveMenuSettings(menuSettings);
  });

  // §10.2/§10.3 — Normal LINK. When ON, the manual controls are HIDDEN (their
  // stored values are retained, just unused) and maxima derive from the selected
  // Hacker, Deck, and encounter table.
  const nlRow = document.createElement('label');
  const nlCb = document.createElement('input');
  nlCb.type = 'checkbox';
  nlCb.checked = menuSettings.normalLink;
  nlRow.appendChild(nlCb);
  nlRow.appendChild(document.createTextNode(' Normal LINK'));
  health.appendChild(nlRow);

  const note = document.createElement('div');
  note.className = 'cfgnote';
  note.textContent = menuSettings.normalLink
    ? 'Hacker LINK = Hacker BASE_LINK + Deck ADD_LINK. Quick Match System ICE mirrors it; a Run uses 100/150/200/250.'
    : 'Manual values below are used for the Hacker and for every Run encounter.';
  health.appendChild(note);

  const manualRow = (label: string, key: 'manualHackerLink' | 'manualSystemIce'): void => {
    const l = document.createElement('label');
    l.appendChild(document.createTextNode(`${label} `));
    const n = document.createElement('input');
    n.type = 'number';
    n.min = '1';
    n.max = '9999';
    n.step = '1';
    n.value = String(menuSettings[key]);
    n.addEventListener('change', () => {
      const v = Math.max(1, Math.min(9999, Math.floor(Number(n.value) || 1)));
      n.value = String(v);
      menuSettings = { ...menuSettings, [key]: v };
      saveMenuSettings(menuSettings);
    });
    l.appendChild(n);
    // hidden (not removed) while Normal LINK is ON — the values persist
    if (menuSettings.normalLink) l.style.display = 'none';
    health.appendChild(l);
  };
  manualRow('Hacker LINK', 'manualHackerLink');
  manualRow('System ICE', 'manualSystemIce');

  nlCb.addEventListener('change', () => {
    menuSettings = { ...menuSettings, normalLink: nlCb.checked };
    saveMenuSettings(menuSettings);
    rerender(); // re-open so the manual controls appear/disappear
  });

  const hintRow = document.createElement('label');
  const hintCb = document.createElement('input');
  hintCb.type = 'checkbox';
  hintCb.checked = menuSettings.hintEnabled;
  hintCb.addEventListener('change', () => {
    menuSettings = { ...menuSettings, hintEnabled: hintCb.checked };
    saveMenuSettings(menuSettings);
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
  delayN.value = String(menuSettings.hintDelaySeconds);
  delayN.addEventListener('change', () => {
    const v = Math.max(1, Math.min(60, Math.floor(Number(delayN.value) || 7)));
    delayN.value = String(v);
    menuSettings = { ...menuSettings, hintDelaySeconds: v };
    saveMenuSettings(menuSettings);
  });
  delayRow.appendChild(delayN);
  hints.appendChild(delayRow);

  const capRow = document.createElement('label');
  const inf = document.createElement('input');
  inf.type = 'checkbox';
  inf.checked = menuSettings.maxCascadeSteps === null;
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
  num.value = String(menuSettings.maxCascadeSteps ?? 0);
  num.disabled = inf.checked;
  numRow.appendChild(num);
  numRow.style.display = inf.checked ? 'none' : '';
  cascades.appendChild(numRow);

  const readCap = (): number => Math.max(0, Math.min(9, Math.floor(Number(num.value) || 0)));
  inf.addEventListener('change', () => {
    num.disabled = inf.checked;
    numRow.style.display = inf.checked ? 'none' : '';
    menuSettings = { ...menuSettings, maxCascadeSteps: inf.checked ? null : readCap() };
    saveMenuSettings(menuSettings);
  });
  num.addEventListener('change', () => {
    num.value = String(readCap());
    if (!inf.checked) {
      menuSettings = { ...menuSettings, maxCascadeSteps: readCap() };
      saveMenuSettings(menuSettings);
    }
  });

  const reset = document.createElement('button');
  reset.className = 'cfgreset';
  reset.textContent = 'Reset to Defaults';
  reset.addEventListener('click', () => {
    menuSettings = { ...DEFAULT_BATTLE_SETTINGS };
    saveMenuSettings(menuSettings);
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
    `System matching: ${c.enemyMatching ? 'ON' : 'OFF'}`,
    `Single-axis payout: ${c.singleAxisPayout ? 'ON' : 'OFF'}`,
    `Reinforced Connection: ${c.reinforcedConnection ? `ON (${c.reinforcedChargeAwareBot ? 'charge-aware' : 'classic'} bot)` : 'OFF'}`,
    `Normal LINK: ${c.normalLink ? 'ON' : 'OFF'}`,
    `Cascade cap: ${c.maxCascadeSteps === null ? 'Infinite' : c.maxCascadeSteps}`,
    `Hacker LINK ${c.playerHp} / System ICE ${c.enemyHp}`,
    `Hints: ${c.hintEnabled ? `ON (${c.hintDelaySeconds}s)` : 'OFF'}`,
  ];
  for (const r of rows) {
    const d = document.createElement('div');
    d.textContent = r;
    wrap.appendChild(d);
  }
  return wrap;
}

// ---- shared display helpers (resolved content only — never hardcoded) ----

const COLOR_NAMES: Record<Color, string> = {
  [Color.Red]: 'Red', [Color.Yellow]: 'Yellow', [Color.Magenta]: 'Magenta',
  [Color.Green]: 'Green', [Color.Cyan]: 'Cyan', [Color.Blue]: 'Blue',
};
const SHAPE_NAMES: Record<Shape, string> = {
  [Shape.Circle]: 'Circle', [Shape.Square]: 'Square', [Shape.Triangle]: 'Triangle',
  [Shape.Diamond]: 'Diamond', [Shape.Star]: 'Star', [Shape.Cross]: 'Cross',
};

const colorList = (cs: ReadonlyArray<Color>): string => (cs.length ? cs.map((c) => COLOR_NAMES[c]).join(', ') : 'none');
const shapeList = (ss: ReadonlyArray<Shape>): string => (ss.length ? ss.map((s) => SHAPE_NAMES[s]).join(', ') : 'none');
// §4.6 — starting-charge state, shown where it aids review (§14.1/§15.2).
const startChargeText = (startCharged: boolean, cost: number): string =>
  startCharged ? `starts charged (${cost}/${cost})` : `starts empty (0/${cost})`;

function programLine(p: ResolvedProgram): string {
  return (
    `${p.name} [${p.id}] — ${colorList(p.colors)} + ${shapeList(p.shapes)} — ` +
    `${p.fn.name} costs ${p.cost}, ${startChargeText(p.fn.startCharged, p.cost)}`
  );
}

// ---- character sheets (§20.3 — per side, opened from the avatar boxes) ----

function characterSheetSide(cfg: BattleConfig, side: Side, identity: BattleIdentity): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  // §20.3 — strong/weak sets come from RESOLVED state (the selected Hacker's
  // authored sets, complemented for the System), never from prose or constants.
  const strongC = cfg.strongColors[side];
  const strongS = cfg.strongShapes[side];
  const weakC = ([0, 1, 2, 3, 4, 5] as Color[]).filter((c) => !strongC.includes(c));
  const weakS = ([0, 1, 2, 3, 4, 5] as Shape[]).filter((s) => !strongS.includes(s));
  const hacker = hackerById(identity.hackerId);
  if (side === 'player') {
    row(`HACKER — ${hacker.name}`, true);
    row(`LINK ${cfg.playerHp}`);
  } else {
    row('SYSTEM', true);
    row(`ICE ${cfg.enemyHp}`);
  }
  row(`Strong colors (${DAMAGE_PER_TILE_HIGH_COLOR} dmg): ${colorList(strongC)}`);
  row(`Weak colors (${DAMAGE_PER_TILE_LOW_COLOR} dmg): ${colorList(weakC)}`);
  row(`Strong shapes (${DAMAGE_PER_TILE_HIGH_SHAPE} dmg): ${shapeList(strongS)}`);
  row(`Weak shapes (${DAMAGE_PER_TILE_LOW_SHAPE} dmg): ${shapeList(weakS)}`);
  if (side === 'player') {
    // §20.3 — Hacker Skill descriptions for the selected Hacker
    row('SKILLS', true);
    if (!hacker.skills.length) row('none');
    for (const sk of hacker.skills) row(`${sk.display} [${sk.id}]`);
    // §20.3 — Deck name and Deck Function summary on the Hacker side
    const deck = deckById(identity.deckId);
    row('DECK', true);
    row(`${deck.name} [${deck.id}] — +${deck.addLink} LINK`);
    row(`${deck.fn.name} costs ${deck.fn.cost}, ${startChargeText(deck.fn.startCharged, deck.fn.cost)}`);
  }
  row('PROGRAMS', true);
  for (const p of programsFor(side)) row(programLine(p));
  row('GENERAL', true);
  row(`Charge: +${CHARGE_PER_TILE_COLOR_MATCH} per Packet of a Program's bound color, +${CHARGE_PER_TILE_SHAPE_MATCH} per bound shape`);
  row(`Neutral Packets: ${DAMAGE_PER_TILE_NEUTRAL} damage (Sync only with other neutrals); each one sliced in your Sync gives your Deck +${DECK_CHARGE_PER_NEUTRAL_TILE} charge`);
  return wrap;
}

function showCharacterSheet(side: Side): void {
  if (!game) return;
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(characterSheetSide(game.state.config, side, game.state.identity));
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

// §21.2 — COMMITTED selection events and battle creation. Preselection, screen
// views, and Back navigation are deliberately never logged as committed choices.
function logSelection(
  event: SelectionLogEntry['event'],
  opts: { g?: Game; identity?: Partial<SelectionLogEntry['identity']> },
): void {
  const entry: SelectionLogEntry = {
    v: LOG_VERSION,
    at: new Date().toISOString(),
    event,
    fp: getContent().fingerprint,
    identity: opts.g ? identityStamp(opts.g.state.identity) : (opts.identity ?? {}),
    ...(session ? { mode: session.mode } : {}),
    ...(session?.mode === 'RUN' ? { runStep: session.step } : {}),
    ...(opts.g ? { battleId: opts.g.state.battleId, hackerMaxLink: opts.g.state.config.playerHp, systemMaxIce: opts.g.state.config.enemyHp } : {}),
  };
  appendSelectionLog(entry);
}

// After every completed action: drain and context-stamp turn logs, then
// either persist the active battle (stable point) or conclude into a saved
// PENDING_RESULT (§17.5 — the save is NOT cleared when the result appears;
// only accepted terminal actions clear it).
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
    identity: identityStamp(game.state.identity),
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
  setup = null; // §12.2 — returning to Title discards pending setup ONLY
  systemTurnActive = false;
  view.clearBoard();
  const restored = deserializeSession(loadBattleJson());
  const buttons: ButtonSpec[] = [];
  if (restored) {
    buttons.push([continueLabel(restored.info), () => void resumeSession()]);
  }
  const savedInfo = restored ? restored.info : null;
  buttons.push(['Quick Match', () => confirmReplace(savedInfo, () => void startQuickMatch())]);
  // §12.1/§12.3 — New Run enters SETUP. The resident save is preserved
  // throughout Hacker Selection, Deck Selection, and Build Review; only the
  // final Start Run action replaces it.
  buttons.push(['New Run', () => showHackerSelection(beginSetup())]);
  buttons.push(['Settings', showSettings]);
  showDialog('BREACH — alpha-0.3.0', '', buttons);
}

// §12.3 replacement confirmation — only when a valid resident save exists.
// Cancel leaves the save and title state unchanged.
function confirmReplace(saved: SessionInfo | null, start: () => void, onCancel: () => void = showTitle): void {
  if (!saved) {
    start();
    return;
  }
  showDialog(
    'REPLACE SAVE?',
    `Starting a new game will replace your resumable ${contextLabel(saved)} progress.`,
    [
      ['Cancel', onCancel],
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

// ---- §12-§15 New Run setup screens ----

// A selectable option list. The sole option MAY be preselected, but advancing
// always requires the explicit forward action below the list (§13.2/§14.2).
function optionList(
  items: { id: string; title: string; lines: string[] }[],
  selectedId: string | null,
  onPick: (id: string) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'optlist';
  for (const item of items) {
    const el = document.createElement('button');
    el.className = item.id === selectedId ? 'opt sel' : 'opt';
    const t = document.createElement('div');
    t.className = 'optname';
    t.textContent = item.title;
    el.appendChild(t);
    for (const line of item.lines) {
      const d = document.createElement('div');
      d.className = 'optline';
      d.textContent = line;
      el.appendChild(d);
    }
    el.addEventListener('click', () => onPick(item.id));
    wrap.appendChild(el);
  }
  return wrap;
}

// §13 — Hacker Selection. Displays every loaded Hacker: name, base LINK, strong
// colors, strong shapes, and separately rendered Skill descriptions. BIO and
// GRAPHICS are never displayed or loaded (§13.1).
function showHackerSelection(s: PendingSetup): void {
  setup = s;
  const hackers = allHackers();
  const preselect = s.hackerId ?? (hackers.length === 1 ? hackers[0].id : null);
  const list = optionList(
    hackers.map((h: ResolvedHacker) => ({
      id: h.id,
      title: `${h.name} [${h.id}]`,
      lines: [
        `Base LINK ${h.baseLink}`,
        `Strong colors: ${colorList(h.strongColors)}`,
        `Strong shapes: ${shapeList(h.strongShapes)}`,
        ...h.skills.map((sk) => `Skill: ${sk.display}`),
      ],
    })),
    preselect,
    (id) => showHackerSelection({ ...s, hackerId: id }),
  );
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(list);
  showDialog(
    'SELECT HACKER',
    'Step 1 of 3',
    [
      // explicit forward action; no modal confirmation follows it (§13.2)
      ['Choose', () => {
        if (!preselect) return;
        logSelection('HACKER_SELECTED', { identity: { hackerId: preselect } });
        showDeckSelection(chooseHacker({ ...s, hackerId: preselect }, preselect));
      }, undefined, !preselect],
      ['Back to Title', showTitle],
    ],
    panels,
    true,
  );
}

// §14 — Deck Selection. Displays every loaded Deck: name, added LINK, Deck
// Function name, cost, and starting-charge state. All Decks are compatible with
// the selected Hacker; there is no filtering (§2.8). DESCRIPT and GRAPHICS are
// never displayed or loaded.
function showDeckSelection(s: PendingSetup): void {
  setup = s;
  const decks = allDecks();
  const preselect = s.deckId ?? (decks.length === 1 ? decks[0].id : null);
  const list = optionList(
    decks.map((d: ResolvedDeck) => ({
      id: d.id,
      title: `${d.name} [${d.id}]`,
      lines: [
        `+${d.addLink} LINK`,
        `Function: ${d.fn.name} — cost ${d.fn.cost}`,
        startChargeText(d.fn.startCharged, d.fn.cost),
      ],
    })),
    preselect,
    (id) => showDeckSelection({ ...s, deckId: id }),
  );
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(list);
  showDialog(
    'SELECT DECK',
    'Step 2 of 3',
    [
      ['Choose', () => {
        if (!preselect) return;
        logSelection('DECK_SELECTED', { identity: { hackerId: s.hackerId ?? undefined, deckId: preselect } });
        showBuildReview(chooseDeck({ ...s, deckId: preselect }, preselect));
      }, undefined, !preselect],
      // Back RETAINS the pending choices (§12.2)
      ['Back', () => {
        const prev = setupBack(s);
        if (prev) showHackerSelection(prev);
        else showTitle();
      }],
    ],
    panels,
    true,
  );
}

// §15 — Fixed Build Review. Confirms the selected identity and the fixed combat
// build before persistent Run creation. NOT a build editor: no replacement,
// reordering, inventory, ownership, targeting, or activation controls (§15.3).
function showBuildReview(s: PendingSetup): void {
  setup = s;
  if (!s.hackerId || !s.deckId) {
    showHackerSelection(s);
    return;
  }
  const hacker = hackerById(s.hackerId);
  const deck = deckById(s.deckId);
  // §15.2 — resolved total Hacker LINK under the CURRENT pending Normal LINK
  // configuration (not committed until Start Run).
  const totalLink = resolveHackerMaxLink(menuSettings, s.hackerId, s.deckId);
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  row('HACKER', true);
  row(`${hacker.name} [${hacker.id}]`);
  row(
    menuSettings.normalLink
      ? `Total LINK ${totalLink} (base ${hacker.baseLink} + deck ${deck.addLink})`
      : `Total LINK ${totalLink} (manual — Normal LINK is OFF)`,
  );
  row(`Strong colors: ${colorList(hacker.strongColors)}`);
  row(`Strong shapes: ${shapeList(hacker.strongShapes)}`);
  row('SKILLS', true);
  if (!hacker.skills.length) row('none');
  for (const sk of hacker.skills) row(`${sk.display} [${sk.id}]`);
  row('DECK', true);
  row(`${deck.name} [${deck.id}] — +${deck.addLink} LINK`);
  row(`${deck.fn.name} costs ${deck.fn.cost}, ${startChargeText(deck.fn.startCharged, deck.fn.cost)}`);
  // §5.3 — the four fixed Programs in EXACT battle order; reviewable, not editable
  row('PROGRAMS (fixed order)', true);
  programsFor('player').forEach((p, i) => row(`${i + 1}. ${programLine(p)}`));
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(wrap);

  const restored = deserializeSession(loadBattleJson());
  showDialog(
    'BUILD REVIEW',
    'Step 3 of 3 — this build is fixed for Alpha 0.3',
    [
      // §12.3 — the ONLY setup action that replaces/creates a save. Cancel
      // leaves the old save and this pending Build Review unchanged.
      ['Start Run', () => confirmReplace(restored ? restored.info : null, () => void commitRun(), () => showBuildReview(s))],
      ['Back', () => {
        const prev = setupBack(s);
        if (prev) showDeckSelection(prev);
        else showTitle();
      }],
    ],
    panels,
    true,
  );
}

// §12.3 — atomic commitment: replace the save, commit the selected identity,
// construct the Run, save Battle 1, and enter battle.
async function commitRun(): Promise<void> {
  if (!setup || !setupComplete(setup) || !setup.hackerId || !setup.deckId) return;
  const hackerId = setup.hackerId;
  const deckId = setup.deckId;
  // §10.4 — snapshot the settings (including Normal LINK) and resolve the
  // effective Hacker maximum LINK now; the whole Run uses these saved values.
  const settings = snapshotRunSettings(menuSettings);
  const hackerMaxLink = resolveHackerMaxLink(settings, hackerId, deckId);
  clearBattleSave();
  session = {
    mode: 'RUN',
    step: 1,
    settings,
    identity: { hackerId, deckId, selectionSource: 'EXPLICIT_SELECTION' },
    hackerMaxLink,
  };
  pending = null;
  setup = null;
  const g = createRunBattle(session, 1);
  logSelection('RUN_CREATED', { g });
  await enterBattle(g);
}

// ---- battle starts (all battle construction goes through logic/session.ts) ----

async function enterBattle(g: Game): Promise<void> {
  hideDialog();
  game = g;
  selection = null;
  targetingSlot = null;
  systemTurnActive = false;
  battleStartAt = Date.now();
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  busy = true;
  await view.play(game.startPlayerPhase());
  endBusy();
  afterAction();
  maybeGameOver();
}

// §16 — Quick Match stays a direct single-battle title flow: it resolves the
// explicit default Hacker and Deck IDs, records them as DEFAULTED rather than
// explicitly chosen, and never shows the selection screens.
async function startQuickMatch(): Promise<void> {
  clearBattleSave(); // confirmed replacement
  const ids = defaultIdentity();
  session = { mode: 'QUICK_MATCH', identity: ids };
  pending = null;
  setup = null;
  const g = createQuickMatchBattle(menuSettings, ids);
  logSelection('QUICK_MATCH_CREATED', { g });
  await enterBattle(g);
}

// §18.3 — Quick Match Reset restarts under the concluded battle's OWN config
// and identity, not under current menu settings.
async function resetQuickMatch(config: BattleConfig, identity: BattleIdentity): Promise<void> {
  clearBattleSave();
  session = {
    mode: 'QUICK_MATCH',
    identity: { hackerId: identity.hackerId, deckId: identity.deckId, selectionSource: identity.selectionSource },
  };
  pending = null;
  const g = recreateBattleFromConfig(config, identity);
  logSelection('QUICK_MATCH_CREATED', { g });
  await enterBattle(g);
}

// Create a fresh battle for the CURRENT Run step (§10.5): new Datastream, new
// RNG, full saved maximum LINK, encounter ICE, nothing carried over.
async function startRunStep(): Promise<void> {
  if (!session || session.mode !== 'RUN') return;
  pending = null;
  await enterBattle(createRunBattle(session, session.step));
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
  systemTurnActive = false;
  battleStartAt = Date.now();
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  // §21.2 — resume logs identify the restored Hacker, Deck, fixed build, and step
  const id = game.state.identity;
  console.info(
    `[breach] ${contextLabel(session)} restored (turn ${game.state.turn}) — ${id.hackerId}/${id.deckId} ` +
      `skills=[${id.skillIds.join(',')}] deckFn=${id.deckFunctionId} build=[${id.hackerPrograms.join(',')}]`,
  );
  busy = true;
  await view.play([{ t: 'msg', text: `${contextLabel(session)} resumed — turn ${game.state.turn}` }]);
  if (pending) {
    // §17.5: restore the battle AND its pending result modal — never skip an
    // unresolved result. Heal a crash between conclusion and metric logging.
    logBattleMetrics();
    persistSession();
    showResultModal();
    return;
  }
  endBusy();
  // MK5.4 divergence acknowledgment: the save's settings are authoritative. For
  // a Run compare the RUN SNAPSHOT (per-encounter ICE is rule-derived by design
  // and not a divergence).
  const authoritative: BattleSettings = session.mode === 'RUN' ? session.settings : game.state.config;
  if (!settingsEqual(authoritative, menuSettings)) {
    showDialog(
      'BATTLE CONFIG',
      'This battle is using the configuration it was started with, not your current settings.',
      [['Understood', hideDialog]],
      configSummary(game.state.config, 'ACTIVE BATTLE CONFIG'),
    );
  }
}

// ---- results, progression, wizard actions (§18) ----

function maybeGameOver(): void {
  if (!game?.state.winner || !pending) return;
  showResultModal();
}

function exitToTitleClearing(): void {
  clearBattleSave(); // §17.5 accepted terminal action
  showTitle();
}

function advanceRun(): void {
  if (!session || session.mode !== 'RUN') return;
  const n = nextStep(session.step);
  if (n === null) return; // step 4 concludes via Run Complete, not advance
  session = { ...session, step: n };
  void startRunStep();
}

// §18.2 — Force Win. On a natural DEFEAT it overrides the result while
// preserving the natural outcome (the combat record is never rewritten as a
// natural victory). On an already-natural Run victory it records the explicit
// wizard invocation and applies NORMAL progression only — it never skips an
// encounter or creates an extra one.
function forceWin(): void {
  if (!game || !session || !pending) return;
  appendWizard('WIZARD_FORCE_WIN');
  pending = { ...pending, forcedWin: true };
  persistSession();
  if (session.mode === 'RUN' && session.step < 4) {
    advanceRun(); // battles 1-3: normal progression to the next fresh encounter
  } else {
    showResultModal(); // QM terminal / step-4 Run Complete presentation
  }
}

function wizardRestartLostBattle(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_LOST_BATTLE');
  void startRunStep(); // same step/settings/encounter ICE; new board + RNG
}

function wizardRestartRun(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_RUN');
  session = { ...session, step: 1 };
  void startRunStep(); // same saved Run snapshot; fresh Battle 1
}

function showResultModal(): void {
  if (!game || !session || !pending) return;
  busy = true; // lock Datastream input while a result modal is up
  const m = game.state.metrics;
  // §18.1 — the availability matrix is owned by the session layer.
  const canForce = forceWinAvailable(session, pending);

  // Run Complete (§4.4): step-4 win (natural or forced). No Force Win here.
  if (session.mode === 'RUN' && isRunComplete(session, pending)) {
    showDialog(
      'RUN COMPLETE',
      pending.forcedWin && pending.natural === 'NATURAL_DEFEAT' ? 'Wizard override — run completed.' : 'All four Systems breached.',
      [['Back to Title', exitToTitleClearing]],
      metricsElement(m),
    );
    return;
  }

  const asVictory = progressesAsVictory(pending);
  const title = pending.natural === 'NATURAL_VICTORY' ? 'VICTORY' : pending.forcedWin ? 'FORCED VICTORY' : 'DEFEAT';
  const sub =
    pending.natural === 'NATURAL_VICTORY'
      ? 'System ICE breached.'
      : pending.forcedWin
        ? 'Wizard override accepted.'
        : 'Your LINK was severed.';
  const buttons: ButtonSpec[] = [];

  if (session.mode === 'QUICK_MATCH') {
    // §18.3/§18.4: Reset restarts under this battle's own config and identity;
    // Back to Title is the accepted terminal action (clears the save).
    const cfg = { ...game.state.config };
    const id = { ...game.state.identity };
    buttons.push(['Reset', () => void resetQuickMatch(cfg, id)]);
    buttons.push(['Back to Title', exitToTitleClearing]);
  } else if (asVictory) {
    // Run battles 1-3 won (naturally or forced): accept to advance. Save and
    // Quit returns to title WITHOUT clearing — the result stays resumable.
    buttons.push(['Next Battle', advanceRun]);
    buttons.push(['Save and Quit', showTitle]);
  } else {
    // Run defeat: Restart Run, terminal end, wizard restart.
    buttons.push(['Restart Run', wizardRestartRun]);
    buttons.push(['Back to Title', exitToTitleClearing]);
    buttons.push(['Restart Lost Battle', wizardRestartLostBattle, 'wizard']);
  }
  if (canForce) buttons.push(['Force Win', forceWin, 'wizard']);

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
    if (!game.state.winner) {
      // §20.2 — the input-lock indicator is on for exactly the System turn.
      systemTurnActive = true;
      try {
        await view.play(game.runEnemyPhase());
      } finally {
        systemTurnActive = false;
      }
    }
    if (!game.state.winner) await view.play(game.startPlayerPhase());
    afterAction();
    endBusy();
  } else {
    busy = false; // invalid swap: the think clock keeps running
  }
  maybeGameOver();
}

// ---- startup: load + validate data BEFORE any title/battle init (§4.9) ----

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
  menuSettings = loadMenuSettings();

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
    // §7.4 — the Drain target list is Programs only. The Deck Function is not a
    // Program and is structurally absent from this channel.
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
    onDeck(): void {
      if (!canAct() || !game) return;
      if (targetingSlot !== null) {
        targetingSlot = null;
        return;
      }
      const events = game.fireDeckFunction();
      if (!events.length) return;
      busy = true;
      void view.play(events).then(() => {
        afterAction();
        busy = false;
        maybeGameOver();
      });
    },
    // §20.3 — avatar controls open the side's character sheet. Available only
    // at the same stable input phase as Pause; never a combat event.
    onAvatar(side: Side): void {
      if (!canAct() || !game) return;
      targetingSlot = null;
      showCharacterSheet(side);
    },
    onMenu(): void {
      // Pause only in the make-a-Sync phase, never mid-resolution. §18.3:
      // Quick Match keeps Reset; a Run does NOT show it (Run restarts are
      // result-screen wizard controls).
      if (!canAct() || !game || !session) return;
      targetingSlot = null;
      const cfg = { ...game.state.config };
      const id = { ...game.state.identity };
      const panels = document.createElement('div');
      panels.className = 'panelscroll';
      panels.appendChild(configSummary(cfg, 'ACTIVE BATTLE CONFIG'));
      const buttons: ButtonSpec[] = [['Resume', hideDialog]];
      if (session.mode === 'QUICK_MATCH') {
        buttons.push(['Reset', () => void resetQuickMatch(cfg, id)]);
      }
      // §18.4 — a resumable exit: the save is preserved, not cleared.
      buttons.push(['Save and Quit', showTitle]);
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

  // MK7.8 — debug-only find-Sync button (dev builds only)
  if (import.meta.env.DEV) {
    const b = document.createElement('button');
    b.id = 'dbgfind';
    b.textContent = 'find sync';
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
