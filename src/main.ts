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
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  GAME_VERSION,
  PortfolioSource,
  ResolvedDeck,
  ResolvedHacker,
  ResolvedHost,
  ResolvedProgram,
  ResolvedSystem,
  allDecks,
  allHackers,
  allHosts,
  allSystems,
  contentStamp,
  deckById,
  defaultBuild,
  functionTargetKind,
  getContent,
  hackerById,
  hostById,
  inventoryFor,
  inventoryProgramIds,
  programById,
  programsFor,
  setActiveContent,
  systemById,
  targetKindOf,
  upgradeById,
} from './logic/data/content';
import type { TargetKind } from './logic/data/effects';
import { formatIssue, loadContent } from './logic/data/load';
import { findBotMove, findHintMove } from './logic/bot';
import { Game } from './logic/game';
import {
  LOGGING_LEVELS,
  LOGGING_SCHEMA_VERSION,
  LOG_VERSION,
  METRICS_SCHEMA_VERSION,
  LoggingLevel,
  SelectionLogEntry,
  identityStamp,
  loggingLevel,
  setLoggingLevel,
} from './logic/logger';
import { BattleMetrics } from './logic/metrics';
import { isPendingSpecial } from './logic/resolve';
import {
  BuildContext,
  BuildState,
  PathOffer,
  PendingPath,
  PendingResultInfo,
  PendingSetup,
  RunInfo,
  SelectedSystem,
  SessionInfo,
  battleContext,
  beginBuild,
  beginSetup,
  chooseDeck,
  chooseHacker,
  commitNewRun,
  RUN_LENGTH,
  contextLabel,
  continueLabel,
  createQuickMatchBattle,
  createRunBattle,
  defaultIdentity,
  deserializeConstructedPreset,
  deserializeSession,
  forceWinAvailable,
  inactiveOf,
  isRunComplete,
  makeSetupRandom,
  moveBuildSlot,
  naturalOf,
  nextStep,
  openPathChoice,
  progressesAsVictory,
  randomBuild,
  randomHost,
  randomSystem,
  recreateBattleFromConfig,
  replaceInBuild,
  resolveHackerMaxLink,
  resolveQuickMatchIce,
  resolveRunIce,
  selectPath,
  serializeConstructedPreset,
  serializeSession,
  setupBack,
  setupComplete,
  snapshotRunSettings,
} from './logic/session';
import {
  ActivationTarget,
  BattleConfig,
  BattleIdentity,
  BattleSettings,
  BuildOrigin,
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
  appendEventLogs,
  appendMetricsLog,
  appendSelectionLog,
  appendTurnLogs,
  appendWizardLog,
  loadLoggingLevel,
  migrateLegacyLogs,
  saveLoggingLevel,
  clearBattleSave,
  loadBattleJson,
  loadConstructedPreset,
  loadMenuSettings,
  readLogs,
  saveBattle,
  saveConstructedPreset,
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
// §12 — targeting mode: which Hacker control is armed, and what kind of target
// it is waiting for. `slot` is a Program index, or DECK_SLOT for the Deck
// Function. Tapping the armed control again cancels (the standard practice for
// every targeted Function); tapping the target resolves it.
const DECK_SLOT = -1;
let targeting: { slot: number; kind: TargetKind } | null = null;
// §8 — the Build screen's state while it is open (null at every other time).
let build: BuildState | null = null;
// Alpha 0.5.0 §12.3 — the System chosen for a Constructed Quick Match that has
// NOT started yet. Ephemeral pending setup exactly like `setup` above: it does
// not touch the resident save until the battle actually begins.
let pendingQuickSystem: SelectedSystem | null = null;
// Alpha 0.6.0 §38 — the HOST chosen for a Constructed Quick Match that has not
// started yet, on exactly the same ephemeral terms as the System above.
let pendingQuickHost: string | null = null;
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

// Sum of LIVE special-tile magnitudes for a side (§9.2 — Effect value from
// authoritative logic state, not tile count, not render objects).
// Alpha 0.5.0 §28.1 — an armed (pending) overlay contributes nothing yet, so
// the HUD must not promise a bonus that is not being applied. This mirrors
// resolve.buffBonus exactly; the two must never disagree.
function specialMagnitude(kind: 'buff' | 'shield', side: Side): number {
  if (!game) return 0;
  let n = 0;
  for (const row of game.state.board) {
    for (const t of row) {
      const sp = t?.special;
      if (sp?.type === kind && sp.owner === side && !isPendingSpecial(sp)) n += sp.magnitude ?? 0;
    }
  }
  return n;
}

function getHud(): Hud | null {
  if (!game) return null;
  const s = game.state;
  const act = canAct();
  // §5.8/§19.4 — the battle roster IS the ordered active build; the Program
  // boxes read top-to-bottom in exactly that order.
  const hacker = s.units.player.map((u) => programById(u.programId));
  const system = s.units.enemy.map((u) => programById(u.programId));
  // §7.1 — the fifth Hacker-side control is Deck-owned; its label and cost come
  // from resolved Deck content, never from a Program.
  const deck = deckById(s.identity.deckId);
  const packetMode = targeting?.kind === 'packet';
  const unitMode = targeting?.kind === 'unit';
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
      : packetMode
        ? 'Tap a Packet to target — tap the Program again to cancel'
        : unitMode
          ? 'Tap a System Program to drain it — tap the Program again to cancel'
          : act
            ? 'Fire Functions, then swap to Sync'
            : '…',
    // §12/§19.4 — while armed, everything that is NOT a legal target dims and
    // the armed control carries a red X (tap it to cancel). Packet targeting
    // lights the Datastream; unit targeting lights the System Program boxes.
    targeting: targeting !== null,
    targetPackets: packetMode,
    targetUnits: unitMode,
    armedSlot: targeting ? targeting.slot : null,
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
  row(`Detonations: ${m.detonations}`);
  row(`System shields — created ${m.enemyShieldCreated}, sliced ${m.enemyShieldRemoved}`);
  row(`Shielded hits: ${m.enemyShieldInstances}, damage prevented: ${fmt(m.enemyShieldPrevented)}`);

  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    row(side === 'player' ? 'HACKER' : 'SYSTEM', true);
    row(`Total damage dealt: ${fmt(sm.totalDamage)}`);
    row(`  Sync-caused (incl. its cascades): ${fmt(sm.matchDamage)}`);
    row(`  bomb-caused (incl. its cascades): ${fmt(sm.bombDamage)}`);
    row(`  line-slice-caused (incl. its cascades): ${fmt(sm.linesliceDamage)}`);
    // Alpha 0.5.0 — Syncs an EFFECT_TRANSFORM created, credited to the Effect
    // so its contribution is legible next to the others.
    row(`  transform-caused (incl. its cascades): ${fmt(sm.transformDamage)}`);
    row(`  Attack: ${fmt(sm.attackerDamage)}`);
    row(`  Buffer added: ${fmt(sm.bufferDamageAdded)}`);
    row(`  PASSIVE damage: ${fmt(sm.passiveDamage)}`);
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
    // Alpha 0.5.0 §39.1 — ONE side-level total covering every source of
    // unstorable Program charge (routing discard and flat/timer overflow).
    // §39.2 — there is deliberately no per-Program waste row any more.
    row(`Charge wasted (no Program could take it): ${fmt(sm.chargeWastedTotal)}`);
    for (const p of programsFor(side)) {
      const u = sm.units[p.id];
      if (!u) continue;
      const placed = u.bombsPlaced > 0 ? `, bombs placed ${u.bombsPlaced}` : '';
      const fizz = u.fizzles > 0 ? `, fizzles ${u.fizzles}` : '';
      row(`${p.name} [${p.id}]: fired ${u.fires}, effect ${fmt(u.effect)}${placed}${fizz}`);
    }
    // §21.3 — Deck-owned metrics stay separate from the Program rows
    if (side === 'player' && game) {
      const d = sm.deck;
      const deck = deckById(game.state.identity.deckId);
      row(`${deck.fn.name} [${deck.id} deck]: fired ${d.fires}, neutral charge ${d.chargeFromNeutral} (wasted ${d.chargeWasted})`);
      if (d.shakeAttempts > 0) {
        row(`  Shake: ${d.shakeSuccesses}/${d.shakeAttempts} resolved, ${d.shakeFizzles} legal fizzle${d.shakeFizzles === 1 ? '' : 's'}`);
      }
    }
    // Alpha 0.6.0 §47 — PASSIVE contributions, one row per INSTANCE (source +
    // PASSIVE), for BOTH sides: a HOST or an UPGRADE can now modify either
    // agent's numbers, so restricting this to the Hacker would hide half of it.
    for (const k of Object.values(sm.passives)) {
      const psv = getContent().passives.get(k.passiveId);
      const parts = [
        k.damage !== 0 ? `${k.damage >= 0 ? '+' : ''}${fmt(k.damage)} dmg` : '',
        k.charge !== 0 ? `${k.charge >= 0 ? '+' : ''}${k.charge} charge` : '',
        k.shield !== 0 ? `+${k.shield} shield` : '',
        k.steps !== 0 ? `+${k.steps} area step${k.steps === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      row(
        `${k.sourceKind} ${k.sourceId} / ${k.passiveId}${psv?.display ? ` (${psv.display})` : ''}: ` +
          `${k.triggers} trigger${k.triggers === 1 ? '' : 's'}${parts.length ? `, ${parts.join(', ')}` : ''}`,
      );
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

  // Alpha 0.6.0 §51 — the note text and the manual rows are updated IN PLACE
  // when Normal Link toggles. Through Alpha 0.5 the handler called rerender(),
  // which rebuilt the whole panel and therefore collapsed every open <details>
  // section — including this one, hiding the manual inputs it had just enabled.
  const noteText = (): string =>
    menuSettings.normalLink
      ? 'Hacker LINK = Hacker BASE_LINK + Deck ADD_LINK. Quick Match System ICE is the System’s own BASE_ICE; a Run adds +0/+50/+100/+150.'
      : 'Manual values below are used for the Hacker and for every Run encounter.';
  const note = document.createElement('div');
  note.className = 'cfgnote';
  note.textContent = noteText();
  health.appendChild(note);

  const manualRows: HTMLElement[] = [];
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
    manualRows.push(l);
    health.appendChild(l);
  };
  manualRow('Hacker LINK', 'manualHackerLink');
  manualRow('System ICE', 'manualSystemIce');

  // §51 — toggling in EITHER direction leaves this accordion exactly as the
  // user left it. The OFF case matters most: the manual inputs it reveals must
  // be immediately visible, not behind a section that just collapsed itself.
  nlCb.addEventListener('change', () => {
    menuSettings = { ...menuSettings, normalLink: nlCb.checked };
    saveMenuSettings(menuSettings);
    note.textContent = noteText();
    for (const l of manualRows) l.style.display = menuSettings.normalLink ? 'none' : '';
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

  // Alpha 0.4.1 §3.3 — logging level lives on the DEVELOPER surface, not among
  // normal player settings, and is absent from production builds entirely.
  if (import.meta.env.DEV) {
    const dev = section('Developer — logging');
    const note = document.createElement('div');
    note.className = 'cfgnote';
    note.textContent =
      'BASIC keeps battle results only. VERBOSE adds compact per-turn records. ' +
      'COMPLETE also keeps every charge route and readable action mirrors — short retention, diagnostics only.';
    dev.appendChild(note);
    for (const level of LOGGING_LEVELS) {
      const l = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'logginglevel';
      radio.checked = loggingLevel() === level;
      radio.addEventListener('change', () => {
        // §3.2 — future records only; nothing already retained is rewritten.
        setLoggingLevel(level as LoggingLevel);
        saveLoggingLevel(level as LoggingLevel);
        rerender();
      });
      l.appendChild(radio);
      l.appendChild(document.createTextNode(` ${level}`));
      dev.appendChild(l);
    }
  }

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

// ---- §7 shared Program inspection ----
// ONE informational component, opened from Hacker Selection, Deck Selection,
// and the Build screen. It is strictly read-only: it never edits the build,
// never renders Function `notes` as player-facing copy, and never synthesizes
// prose from Effect parameters (§7).

const SOURCE_LABEL: Record<PortfolioSource, string> = {
  HACKER_PORTFOLIO: 'Hacker',
  DECK_PORTFOLIO: 'Deck',
};

// §7 — Alpha 0.4 has no authored Function-description infrastructure, and
// deciding how those are written and stored is explicitly the designer's next
// call. Until then this literal placeholder holds the layout region.
const FUNCTION_DESCRIPTION_PLACEHOLDER = 'Function description goes here';

function showProgramInspection(programId: string, source: PortfolioSource | null, back: () => void): void {
  const p = programById(programId);
  const wrap = document.createElement('div');
  wrap.className = 'config readonly';
  const row = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    wrap.appendChild(d);
  };
  row(`${p.name} [${p.id}]`, true);
  if (source) row(`Source: ${SOURCE_LABEL[source]} portfolio`);
  row(`Colors: ${colorList(p.colors)}`);
  row(`Shapes: ${shapeList(p.shapes)}`);
  row('FUNCTION', true);
  row(`${p.fn.name} [${p.fn.id}]`);
  row(`Charge cost: ${p.cost}`);
  row(startChargeText(p.fn.startCharged, p.cost));
  row(FUNCTION_DESCRIPTION_PLACEHOLDER);
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(wrap);
  showDialog('PROGRAM', '', [['Back', back]], panels, true);
}

// A tappable row of Programs — used by the Hacker/Deck selection screens and
// (Alpha 0.5.0 §15/§16) by System Selection and the Run Build opponent panel.
// Each chip opens the SHARED inspection modal and nothing else (§19.2), so
// there is exactly one Program-inspection component in the application.
// `source` is null for System Programs: they come from a System's fixed
// PRG_SET, not from a Hacker/Deck portfolio, and labelling them otherwise
// would be false.
function portfolioStrip(
  programIds: ReadonlyArray<string>,
  source: PortfolioSource | null,
  back: () => void,
  numbered = false,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'prgstrip';
  programIds.forEach((id, i) => {
    const p = programById(id);
    const b = document.createElement('button');
    b.className = 'prgchip';
    b.textContent = `${numbered ? `${i + 1}. ` : ''}${p.name} — ${p.fn.name} (${p.cost})`;
    b.addEventListener('click', () => showProgramInspection(id, source, back));
    wrap.appendChild(b);
  });
  return wrap;
}

// §15/§16/§17 — a System's ordered Programs. Numbered, because the order IS
// the charge-routing priority the player is being asked to read (§30).
function systemProgramStrip(programIds: ReadonlyArray<string>, back: () => void): HTMLElement {
  return portfolioStrip(programIds, null, back, true);
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
  // §20.3, revised by Alpha 0.5.0 §17 — strong/weak sets come from RESOLVED
  // state: each side's OWN authored identity, never prose, constants, or (as
  // through Alpha 0.4) the other side's complement.
  const strongC = cfg.strongColors[side];
  const strongS = cfg.strongShapes[side];
  const weakC = ([0, 1, 2, 3, 4, 5] as Color[]).filter((c) => !strongC.includes(c));
  const weakS = ([0, 1, 2, 3, 4, 5] as Shape[]).filter((s) => !strongS.includes(s));
  const hacker = hackerById(identity.hackerId);
  if (side === 'player') {
    row(`HACKER — ${hacker.name}`, true);
    row(`LINK ${cfg.playerHp}`);
  } else {
    // §17 — the sheet now names the System it is describing. BIO and GRAPHICS
    // stay unused placeholders and are deliberately not displayed.
    row(`SYSTEM — ${systemById(identity.systemId).name}`, true);
    row(`ICE ${cfg.enemyHp}`);
  }
  row(`Strong colors (${DAMAGE_PER_TILE_HIGH_COLOR} dmg): ${colorList(strongC)}`);
  row(`Weak colors (${DAMAGE_PER_TILE_LOW_COLOR} dmg): ${colorList(weakC)}`);
  row(`Strong shapes (${DAMAGE_PER_TILE_HIGH_SHAPE} dmg): ${shapeList(strongS)}`);
  row(`Weak shapes (${DAMAGE_PER_TILE_LOW_SHAPE} dmg): ${shapeList(weakS)}`);
  // Alpha 0.6.0 §25/§26 — PASSIVEs on the sheet for BOTH sides, each labelled
  // with the source that supplied it. The HOST is not an agent, so its
  // PASSIVEs appear on the environment panel below rather than being folded
  // into either sheet (§13 — HOST is a first-class source, not a Hacker or
  // System property).
  const sidePassives =
    side === 'player'
      ? [
          ...hacker.passives.map((p) => ({ p, src: `HAK ${hacker.id}` })),
          ...identity.upgradeIds.flatMap((uid) =>
            upgradeById(uid).passives.map((p) => ({ p, src: `UPG ${upgradeById(uid).name}` })),
          ),
        ]
      : systemById(identity.systemId).passives.map((p) => ({ p, src: `SYS ${identity.systemId}` }));
  row('PASSIVES', true);
  if (!sidePassives.length) row('none');
  for (const { p, src } of sidePassives) row(`${p.display} [${p.id}] — ${src}`);
  if (side === 'player') {
    // §20.3 — Deck name and Deck Function summary on the Hacker side
    const deck = deckById(identity.deckId);
    row('DECK', true);
    row(`${deck.name} [${deck.id}] — +${deck.addLink} LINK`);
    row(`${deck.fn.name} costs ${deck.fn.cost}, ${startChargeText(deck.fn.startCharged, deck.fn.cost)}`);
  } else {
    // §25 — the committed HOST and its resolved PASSIVEs, on the System sheet
    // because that is the opponent-facing surface a tester already opens.
    const host = hostById(identity.hostId);
    row('HOST', true);
    row(`${host.name} [${host.id}]`);
    if (!host.passives.length) row('no PASSIVEs');
    for (const p of host.passives) row(`${p.display} [${p.id}]`);
  }
  // §5.3/§19.4 — the ACTIVE build in battle order, numbered so the charge
  // priority the player is looking at is unambiguous.
  // §17 — for the System this is the selected System's ordered PRG_SET, with
  // each Program's Function named, exactly as the Hacker's active build is.
  row('PROGRAMS (active, top to bottom)', true);
  const roster = side === 'player' ? identity.hackerPrograms : identity.systemPrograms;
  roster.forEach((id, i) => row(`${i + 1}. ${programLine(programById(id))}`));
  if (side === 'player') {
    const inactive = identity.inventory.filter((id) => !identity.hackerPrograms.includes(id));
    if (inactive.length) {
      row('INVENTORY (inactive this battle)', true);
      for (const id of inactive) row(programLine(programById(id)));
    }
  }
  row('GENERAL', true);
  // §10.4 — charge no longer reaches every compatible Program at once.
  row('Charge routes top-to-bottom: the first compatible Program that is not full takes it, and the overflow passes down.');
  row(`Charge: +${CHARGE_PER_TILE_COLOR_MATCH} per Packet of a Program's bound color, +${CHARGE_PER_TILE_SHAPE_MATCH} per bound shape`);
  row(`Neutral Packets: ${DAMAGE_PER_TILE_NEUTRAL} damage (Sync only with other neutrals); each one sliced in your Sync gives your Deck +${DECK_CHARGE_PER_NEUTRAL_TILE} charge`);
  return wrap;
}

function showCharacterSheet(side: Side): void {
  if (!game) return;
  const identity = game.state.identity;
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(characterSheetSide(game.state.config, side, identity));
  // §17 — shared Program inspection from the sheet, so a player can read what
  // the opponent's Programs actually do mid-battle without a second component.
  const head = document.createElement('div');
  head.className = 'cfghead';
  head.textContent = 'INSPECT';
  panels.appendChild(head);
  const roster = side === 'player' ? identity.hackerPrograms : identity.systemPrograms;
  panels.appendChild(portfolioStrip(roster, null, () => showCharacterSheet(side), true));
  showDialog(side === 'player' ? 'HACKER' : 'SYSTEM', '', [['Close', hideDialog]], panels);
}

// ---- persistence (session envelope — logic/session.ts owns the format) ----

// Alpha 0.6.0 §28/§42 — a committed Run is saveable with NO battle: the Path
// Choice is real persisted state, not a transient screen. Through Alpha 0.5
// this required `game`, which would have silently dropped every pending-path
// save on the floor. Quick Match still always has a battle, and a battle-less
// Quick Match envelope would not deserialize, so it is never written.
function persistSession(): void {
  if (!session) return;
  if (!game && session.mode !== 'RUN') return;
  saveBattle(serializeSession(session, game, pending), game?.state.turn ?? 0);
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

// §21.2/§18.2 — COMMITTED selection events and battle creation. Preselection,
// screen views, and Back navigation are deliberately never logged as committed
// choices.
function logSelection(
  event: SelectionLogEntry['event'],
  opts: {
    g?: Game;
    identity?: Partial<SelectionLogEntry['identity']>;
    extra?: Partial<SelectionLogEntry>;
  },
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
    ...(opts.extra ?? {}),
  };
  appendSelectionLog(entry);
}

// Alpha 0.5.0 §36 — one record per COMMITTED opponent resolution. Emitted at
// the moment the System is resolved (Run roll, Random Quick Match roll, or an
// explicit Constructed choice), never once per turn: System identity is
// battle-static and joins to turn records through the battle-level record.
function logSystemSelected(system: SelectedSystem, context: SelectionLogEntry['buildContext']): void {
  const s = systemById(system.systemId);
  logSelection('SYSTEM_SELECTED', {
    extra: {
      systemId: s.id,
      systemSelectionSource: system.source,
      systemStrongColors: [...s.strongColors],
      systemStrongShapes: [...s.strongShapes],
      systemPrograms: [...s.programIds],
      ...(context ? { buildContext: context } : {}),
    },
  });
}

// Alpha 0.6.0 §46 — one record per COMMITTED HOST resolution, on exactly the
// System's terms: emitted when the HOST is resolved, never per turn.
function logHostSelected(
  hostId: string,
  source: 'QUICK_RANDOM' | 'QUICK_CONSTRUCTED' | 'RUN_PATH',
  context: SelectionLogEntry['buildContext'],
): void {
  const h = hostById(hostId);
  logSelection('HOST_SELECTED', {
    extra: {
      hostId: h.id,
      hostSelectionSource: source,
      hostPassives: [...h.passiveIds],
      ...(context ? { buildContext: context } : {}),
    },
  });
}

// §46 — the offer-generation record: enough to reconstruct EVERY offered path,
// including which battle it leads into and whether the duplicate UPGRADE was
// the pool-exhaustion case. Abandoned hover/preselect state is deliberately not
// logged (§46 — no abandoned modal noise); only generation and commitment are.
function logPathOffered(p: PendingPath): void {
  logSelection('PATH_OFFERED', {
    extra: {
      targetStep: p.step,
      offers: p.offers.map((o) => ({ index: o.index, systemId: o.systemId, hostId: o.hostId, upgradeId: o.upgradeId })),
      upgradeExhausted: p.upgradeExhausted,
    },
  });
}

// §46 — the commitment record: which path, its exact package, and the acquired
// UPGRADE list AFTER commitment.
function logPathSelected(p: PendingPath, offer: PathOffer, before: string[], after: string[]): void {
  logSelection('PATH_SELECTED', {
    extra: {
      targetStep: p.step,
      selectedPath: offer.index,
      systemId: offer.systemId,
      hostId: offer.hostId,
      upgradeId: offer.upgradeId,
      upgradeExhausted: p.upgradeExhausted,
      // §31 — a duplicate-offer path acquires its UPGRADE exactly once, so an
      // unchanged list here is the legitimate already-acquired case, not a bug.
      upgradeAcquired: after.length > before.length,
      acquiredUpgrades: [...after],
    },
  });
}

// §18.2 — the portfolio/inventory context every setup and build record carries.
function portfolioContext(hackerId: string, deckId: string): Partial<SelectionLogEntry> {
  const entries = inventoryFor(hackerId, deckId);
  return {
    hackerPortfolio: [...hackerById(hackerId).portfolioProgramIds],
    deckPortfolio: [...deckById(deckId).portfolioProgramIds],
    inventory: entries.map((e) => e.programId),
    inventorySources: entries.map((e) => e.source),
  };
}

// §18.3 — every ACCEPTED replacement and reorder, with before/after order.
function logBuildChange(kind: 'REPLACE' | 'REORDER', before: string[], after: string[]): void {
  if (!build) return;
  logSelection(kind === 'REPLACE' ? 'BUILD_REPLACE' : 'BUILD_REORDER', {
    identity: { hackerId: build.hackerId, deckId: build.deckId },
    extra: {
      buildContext: build.context,
      buildBefore: [...before],
      build: [...after],
      buildOrigin: build.origin,
    },
  });
}

function logBuildOpened(s: BuildState): void {
  logSelection('BUILD_OPENED', {
    identity: { hackerId: s.hackerId, deckId: s.deckId },
    extra: {
      ...portfolioContext(s.hackerId, s.deckId),
      buildContext: s.context,
      buildOrigin: s.origin,
      build: [...s.build],
    },
  });
}

// §8.7/§17.4 — persist Build edits immediately once the Run is COMMITTED, so a
// suspension can never resume a stale or half-applied build. Pending setup
// (initial Run) and Constructed Quick Match Build write nothing.
function persistBuildIfCommitted(): void {
  if (!build || !session || session.mode !== 'RUN' || !session.pendingBuild) return;
  session = { ...session, build: [...build.build], buildOrigin: build.origin };
  saveBattle(serializeSession(session, null, null), 0);
}

// After every completed action: drain and context-stamp turn logs, then
// either persist the active battle (stable point) or conclude into a saved
// PENDING_RESULT (§17.5 — the save is NOT cleared when the result appears;
// only accepted terminal actions clear it).
function afterAction(): void {
  if (!game || !session) return;
  const ctx = battleContext(session);
  const stamp = <T,>(e: T): T => ({ ...e, mode: ctx.mode, ...(ctx.runStep !== undefined ? { runStep: ctx.runStep } : {}) });
  appendTurnLogs(game.drainTurnLogs().map(stamp));
  // §4.3 — high-value events persist at every level, including BASIC where
  // there is no turn stream for them to ride along in.
  appendEventLogs(game.drainEventLogs().map(stamp));
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
    ls: LOGGING_SCHEMA_VERSION,
    ms: METRICS_SCHEMA_VERSION,
    lvl: loggingLevel(),
    battleId: game.state.battleId,
    config: { ...game.state.config },
    // §4.1 — the stamp is deduplicated by fingerprint at the storage boundary.
    fp: getContent().fingerprint,
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
  build = null;
  targeting = null;
  systemTurnActive = false;
  view.clearBoard();
  const restored = deserializeSession(loadBattleJson());
  const buttons: ButtonSpec[] = [];
  if (restored) {
    buttons.push([continueLabel(restored.info), () => void resumeSession()]);
  }
  // §9.1 — Quick Match is a bounded submenu now; neither mode replaces the
  // save until its battle is actually created.
  buttons.push(['Quick Match', showQuickMatchMenu]);
  // §12.1/§12.3 — New Run enters SETUP. The resident save is preserved
  // throughout Hacker Selection, Deck Selection, and Build; only the final
  // Start Run action replaces it.
  buttons.push(['New Run', () => showHackerSelection(beginSetup())]);
  buttons.push(['Settings', showSettings]);
  showDialog(`BREACH — ${GAME_VERSION}`, '', buttons);
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
        // §6.1 — the LINK contribution resolved under the CURRENT selection
        // context, plus strong AND weak sets on both axes.
        s.deckId
          ? `LINK ${resolveHackerMaxLink(menuSettings, h.id, s.deckId)} (base ${h.baseLink} + deck ${deckById(s.deckId).addLink})`
          : `Base LINK ${h.baseLink}`,
        `Strong colors: ${colorList(h.strongColors)}`,
        `Weak colors: ${colorList(h.weakColors)}`,
        `Strong shapes: ${shapeList(h.strongShapes)}`,
        `Weak shapes: ${shapeList(h.weakShapes)}`,
        ...h.passives.map((p) => `Passive: ${p.display}`),
      ],
    })),
    preselect,
    (id) => showHackerSelection({ ...s, hackerId: id }),
  );
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(list);
  // §6.1 — the selected Hacker's three Programs in authored portfolio order,
  // each with an inspection affordance.
  if (preselect) {
    const head = document.createElement('div');
    head.className = 'cfghead';
    head.textContent = 'PROGRAMS (portfolio order)';
    panels.appendChild(head);
    panels.appendChild(
      portfolioStrip(hackerById(preselect).portfolioProgramIds, 'HACKER_PORTFOLIO', () =>
        showHackerSelection({ ...s, hackerId: preselect }),
      ),
    );
  }
  showDialog(
    'SELECT HACKER',
    'Step 1 of 2',
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
  // §6.2 — the selected Hacker's strengths sit on the PRIMARY screen so the
  // Deck's Programs can be compared against them without navigating away.
  if (s.hackerId) {
    const h = hackerById(s.hackerId);
    const cmp = document.createElement('div');
    cmp.className = 'config readonly';
    for (const [text, head] of [
      [`HACKER — ${h.name}`, true],
      [`Strong colors: ${colorList(h.strongColors)}`, false],
      [`Weak colors: ${colorList(h.weakColors)}`, false],
      [`Strong shapes: ${shapeList(h.strongShapes)}`, false],
      [`Weak shapes: ${shapeList(h.weakShapes)}`, false],
    ] as [string, boolean][]) {
      const d = document.createElement('div');
      if (head) d.className = 'cfghead';
      d.textContent = text;
      cmp.appendChild(d);
    }
    panels.appendChild(cmp);
  }
  panels.appendChild(list);
  // §6.2 — the Deck's three Programs in authored portfolio order.
  if (preselect) {
    const head = document.createElement('div');
    head.className = 'cfghead';
    head.textContent = 'PROGRAMS (portfolio order)';
    panels.appendChild(head);
    panels.appendChild(
      portfolioStrip(deckById(preselect).portfolioProgramIds, 'DECK_PORTFOLIO', () =>
        showDeckSelection({ ...s, deckId: preselect }),
      ),
    );
  }
  showDialog(
    'SELECT DECK',
    'Step 2 of 2',
    [
      ['Choose', () => {
        if (!preselect) return;
        logSelection('DECK_SELECTED', { identity: { hackerId: s.hackerId ?? undefined, deckId: preselect } });
        setup = chooseDeck({ ...s, deckId: preselect }, preselect);
        // Alpha 0.6.0 §28 — this is now the DESTRUCTIVE COMMITMENT BOUNDARY:
        // advancing into the initial Path Choice creates the Run and replaces
        // the resident save. The confirmation moved here with it, so the
        // destructive step is still confirmed exactly once (§12.3).
        const restored = deserializeSession(loadBattleJson());
        confirmReplace(
          restored ? restored.info : null,
          () => void commitRunToPathChoice(),
          () => showDeckSelection({ ...s, deckId: preselect }),
        );
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

// ============================================================================
// §8 — FUNCTIONAL BUILD SCREEN. Replaces the Alpha 0.3 fixed Build Review.
//
// All four validity rules live in the session layer's build actions (§5.5), so
// this screen owns presentation only: it can never construct an invalid build
// because it cannot express one. Selecting an inactive Program arms it; then
// tapping an active slot SWAPS them. ▲/▼ reorder. No drag input (§19.1).
// ============================================================================

// Which inactive Program is armed for the next slot tap (presentation state:
// it never affects the build until a slot is chosen).
let buildPick: string | null = null;

// ============================================================================
// Alpha 0.6.0 §27-§32 — PATH CHOICE
//
// Before every battle the player commits one of two `SYS + HST + UPG` packages.
// The offers live in the committed Run save (§42), so this screen renders
// session state and never generates or holds it.
// ============================================================================

// §25/§26 — the whitebox description of one offered path. Names first, then the
// resolved PASSIVE displays: enough to understand the encounter without an art
// system, an inventory screen, or `notes` leaking into player-facing copy.
function pathOfferLines(offer: PathOffer): string[] {
  const sys = systemById(offer.systemId);
  const host = hostById(offer.hostId);
  const upgrade = upgradeById(offer.upgradeId);
  const lines = [`SYSTEM ${sys.name} — base ICE ${sys.baseIce}`];
  lines.push(`HOST ${host.name}${host.passives.length ? '' : ' — no passives'}`);
  for (const p of host.passives) lines.push(`  ${p.display}`);
  lines.push(`UPGRADE ${upgrade.name}`);
  for (const p of upgrade.passives) lines.push(`  ${p.display}`);
  return lines;
}

function showPathChoice(): void {
  if (!session || session.mode !== 'RUN' || !session.pendingPath) return;
  const run = session;
  const pending = run.pendingPath!;
  const panels = document.createElement('div');
  panels.className = 'panelscroll';

  // §26 — the acquired UPGRADE list, so the tester can verify persistent Run
  // state from the screen where it changes.
  const acquired = document.createElement('div');
  acquired.className = 'config readonly';
  const acqHead = document.createElement('div');
  acqHead.className = 'cfghead';
  acqHead.textContent = 'UPGRADES ACQUIRED';
  acquired.appendChild(acqHead);
  const acqRow = document.createElement('div');
  acqRow.textContent = run.upgradeIds.length
    ? run.upgradeIds.map((id) => upgradeById(id).name).join(', ')
    : 'none yet';
  acquired.appendChild(acqRow);
  panels.appendChild(acquired);

  panels.appendChild(
    optionList(
      pending.offers.map((offer) => ({
        id: String(offer.index),
        title: `PATH ${offer.index + 1}`,
        lines: pathOfferLines(offer),
      })),
      pathPick === null ? null : String(pathPick),
      (id) => {
        pathPick = Number(id);
        showPathChoice();
      },
    ),
  );

  // §31 — the one-remaining-UPGRADE case is normal, not an error. Saying so on
  // the screen keeps it from reading as a bug during playtest.
  if (pending.upgradeExhausted) {
    const note = document.createElement('div');
    note.className = 'cfgnote';
    note.textContent = 'Only one UPGRADE remains — both paths offer it.';
    panels.appendChild(note);
  }

  showDialog(
    `CHOOSE PATH — BATTLE ${pending.step} OF ${RUN_LENGTH}`,
    'Selecting a path commits its System, HOST, and UPGRADE.',
    [
      // §32 — selection is immediate and final for that battle; there is
      // deliberately no Back action on this screen.
      ['Take this path', () => {
        if (pathPick === null) return;
        void takePath(pathPick);
      }, undefined, pathPick === null],
      ['Save and Quit', () => {
        persistSession();
        showTitle();
      }],
    ],
    panels,
    true,
  );
}

// Which path card is armed (presentation only until confirmed).
let pathPick: number | null = null;

// §32 — commit the selected path, then open the pre-battle Build for it. The
// UPGRADE is acquired BEFORE the Build screen exists, so its PASSIVEs are
// already active for the battle the player is now building against (§27).
async function takePath(index: number): Promise<void> {
  if (!session || session.mode !== 'RUN' || !session.pendingPath) return;
  const path = session.pendingPath;
  const offer = path.offers[index];
  if (!offer) return;
  const before = [...session.upgradeIds];
  const committed = selectPath(session, index);
  session = committed;
  logPathSelected(path, offer, before, committed.upgradeIds);
  logHostSelected(offer.hostId, 'RUN_PATH', path.step === 1 ? 'INITIAL_RUN' : 'RUN_BETWEEN');
  logSystemSelected({ systemId: offer.systemId, source: 'RUN_RANDOM' }, path.step === 1 ? 'INITIAL_RUN' : 'RUN_BETWEEN');
  pathPick = null;
  // §33 — Battle 1 opens on the DEFAULT build for a new Run; later battles
  // carry the current build and order forward.
  const first = path.step === 1;
  const s = beginBuild(
    first ? 'INITIAL_RUN' : 'RUN_BETWEEN',
    committed.identity.hackerId,
    committed.identity.deckId,
    first ? null : committed.build,
    first ? 'DEFAULT' : 'CARRIED_RUN',
  );
  openBuild(s);
  persistBuildIfCommitted();
  logBuildOpened(s);
}

function buildTitle(c: BuildContext): string {
  return c === 'CONSTRUCTED_QUICK_MATCH' ? 'CONSTRUCTED QUICK MATCH' : 'BUILD';
}

// §8.2 — the final action's wording follows the flow it sits in.
function buildStartLabel(c: BuildContext, step: number): string {
  if (c === 'CONSTRUCTED_QUICK_MATCH') return 'Start Quick Match';
  if (c === 'RUN_RETRY') return `Retry Battle ${step}`;
  return `Start Battle ${step}`;
}

function openBuild(s: BuildState): void {
  buildPick = null;
  build = s;
  showBuild();
}

// Alpha 0.5.0 §16 — which System this Build screen is preparing against. Each
// context reads it from the authority that already owns it, so the Build
// screen never re-resolves or rerolls an opponent: pending New Run setup, the
// committed Run's persisted selection, or the pending Constructed choice.
function upcomingSystemFor(s: BuildState): SelectedSystem | null {
  if (s.context === 'CONSTRUCTED_QUICK_MATCH') return pendingQuickSystem;
  // Alpha 0.6.0 §27/§33 — every Run Build screen, INITIAL_RUN included, now
  // opens only after a path is committed, so the committed Run is the one
  // authority for the upcoming encounter.
  return session?.mode === 'RUN' ? session.system : null;
}

// §25/§33 — the committed HOST for this Build screen, from the same authority.
function upcomingHostFor(s: BuildState): string | null {
  if (s.context === 'CONSTRUCTED_QUICK_MATCH') return pendingQuickHost;
  return session?.mode === 'RUN' ? session.hostId : null;
}

function showBuild(): void {
  const s = build;
  if (!s) return;
  const hacker = hackerById(s.hackerId);
  const deck = deckById(s.deckId);
  const step = session?.mode === 'RUN' ? session.step : 1;
  const totalLink = resolveHackerMaxLink(menuSettings, s.hackerId, s.deckId);

  const panels = document.createElement('div');
  panels.className = 'panelscroll';

  // ---- identity summary (§8.1) ----
  // Collapsed by default: it is reference information, and on a narrow phone
  // viewport it would otherwise push the four active slots and the reorder
  // controls out of reach (§19.1/§19.3). The summary line still states the
  // selected Hacker, Deck, Deck Function, and resolved LINK at a glance.
  const idBox = document.createElement('div');
  idBox.className = 'config readonly';
  const details = document.createElement('details');
  details.className = 'cfgsection';
  const summary = document.createElement('summary');
  summary.textContent = `${hacker.name} + ${deck.name} — LINK ${totalLink}, ${deck.fn.name} (${deck.fn.cost})`;
  details.appendChild(summary);
  const idRow = (text: string, head = false): void => {
    const d = document.createElement('div');
    if (head) d.className = 'cfghead';
    d.textContent = text;
    details.appendChild(d);
  };
  idRow(`${hacker.name} [${hacker.id}] — LINK ${totalLink}`, true);
  idRow(`Strong colors: ${colorList(hacker.strongColors)}`);
  idRow(`Weak colors: ${colorList(hacker.weakColors)}`);
  idRow(`Strong shapes: ${shapeList(hacker.strongShapes)}`);
  idRow(`Weak shapes: ${shapeList(hacker.weakShapes)}`);
  for (const p of hacker.passives) idRow(`Passive: ${p.display}`);
  idRow(`${deck.name} [${deck.id}] — +${deck.addLink} LINK`, true);
  idRow(`Deck Function: ${deck.fn.name} costs ${deck.fn.cost}, ${startChargeText(deck.fn.startCharged, deck.fn.cost)}`);
  idBox.appendChild(details);
  panels.appendChild(idBox);

  // ---- Alpha 0.5.0 §16 — the UPCOMING OPPONENT ----
  // The System is selected before Build precisely so the player can build
  // against it, so it has to be legible here. Collapsed by default like the
  // identity summary above, for the same narrow-screen reason (§16 — use a
  // compact/expandable presentation); it is INFORMATIONAL only, with no reroll
  // or replace interaction anywhere in a Run.
  const upcoming = upcomingSystemFor(s);
  if (upcoming) {
    const sys = systemById(upcoming.systemId);
    const ice =
      s.context === 'CONSTRUCTED_QUICK_MATCH'
        ? resolveQuickMatchIce(menuSettings, sys.id)
        : session?.mode === 'RUN'
          ? resolveRunIce(session.settings, sys.id, session.step)
          : resolveQuickMatchIce(menuSettings, sys.id);
    const sysBox = document.createElement('div');
    sysBox.className = 'config readonly';
    const sysDetails = document.createElement('details');
    sysDetails.className = 'cfgsection';
    const sysSummary = document.createElement('summary');
    sysSummary.textContent = `SYSTEM: ${sys.name} — ICE ${ice}`;
    sysDetails.appendChild(sysSummary);
    const sysRow = (text: string, head = false): void => {
      const d = document.createElement('div');
      if (head) d.className = 'cfghead';
      d.textContent = text;
      sysDetails.appendChild(d);
    };
    sysRow(`${sys.name} [${sys.id}] — ICE ${ice}`, true);
    sysRow(`Strong colors: ${colorList(sys.strongColors)}`);
    sysRow(`Weak colors: ${colorList(sys.weakColors)}`);
    sysRow(`Strong shapes: ${shapeList(sys.strongShapes)}`);
    sysRow(`Weak shapes: ${shapeList(sys.weakShapes)}`);
    sysRow('PROGRAMS (top to bottom — charge priority)', true);
    sysDetails.appendChild(systemProgramStrip(sys.programIds, showBuild));
    if (sys.passives.length) {
      sysRow('SYSTEM PASSIVES', true);
      for (const p of sys.passives) sysRow(p.display);
    }
    sysBox.appendChild(sysDetails);
    panels.appendChild(sysBox);
  }

  // ---- Alpha 0.6.0 §25/§26 — the committed HOST and acquired UPGRADEs ----
  // The encounter package is committed BEFORE this screen opens (§27), so the
  // player edits the build against a known battlefield and a known reward set.
  // Same compact expandable presentation as the opponent panel, for the same
  // narrow-screen reason.
  const hostId = upcomingHostFor(s);
  if (hostId) {
    const host = hostById(hostId);
    const envBox = document.createElement('div');
    envBox.className = 'config readonly';
    const envDetails = document.createElement('details');
    envDetails.className = 'cfgsection';
    const envSummary = document.createElement('summary');
    const acquiredIds = session?.mode === 'RUN' ? session.upgradeIds : [];
    envSummary.textContent =
      `HOST: ${host.name}` + (acquiredIds.length ? ` — ${acquiredIds.length} UPGRADE${acquiredIds.length === 1 ? '' : 's'}` : '');
    envDetails.appendChild(envSummary);
    const envRow = (text: string, head = false): void => {
      const d = document.createElement('div');
      if (head) d.className = 'cfghead';
      d.textContent = text;
      envDetails.appendChild(d);
    };
    envRow(`${host.name} [${host.id}]`, true);
    if (!host.passives.length) envRow('no PASSIVEs');
    for (const p of host.passives) envRow(p.display);
    // §26 — the acquired UPGRADE list, so persistent Run state is verifiable
    // from the pre-battle screen. Quick Match has none and shows none (§37).
    if (s.context !== 'CONSTRUCTED_QUICK_MATCH') {
      envRow('UPGRADES ACQUIRED', true);
      if (!acquiredIds.length) envRow('none yet');
      for (const id of acquiredIds) {
        const u = upgradeById(id);
        envRow(`${u.name} [${u.id}]`);
        for (const p of u.passives) envRow(`  ${p.display}`);
      }
    }
    envBox.appendChild(envDetails);
    panels.appendChild(envBox);
  }

  // ---- four ordered active slots (§8.1/§5.7) ----
  const activeHead = document.createElement('div');
  activeHead.className = 'cfghead';
  activeHead.textContent = buildPick
    ? `ACTIVE BUILD — tap a slot to swap in ${programById(buildPick).name}`
    : 'ACTIVE BUILD (top to bottom)';
  panels.appendChild(activeHead);

  const slots = document.createElement('div');
  slots.className = 'buildslots';
  s.build.forEach((programId, i) => {
    const p = programById(programId);
    const entry = s.inventory.find((e) => e.programId === programId)!;
    const rowEl = document.createElement('div');
    rowEl.className = buildPick ? 'bslot armed' : 'bslot';

    const pick = document.createElement('button');
    pick.className = 'bslotmain';
    pick.innerHTML = '';
    const line1 = document.createElement('div');
    line1.className = 'optname';
    line1.textContent = `${i + 1}. ${p.name} [${SOURCE_LABEL[entry.source]}]`;
    const line2 = document.createElement('div');
    line2.className = 'optline';
    line2.textContent = `${colorList(p.colors)} + ${shapeList(p.shapes)} — ${p.fn.name} (${p.cost})`;
    pick.appendChild(line1);
    pick.appendChild(line2);
    pick.addEventListener('click', () => {
      if (buildPick) {
        // §5.6 — swap: the armed inactive Program takes this slot and the
        // displaced Program returns to the inventory. Four slots stay filled.
        const next = replaceInBuild(s, i, buildPick);
        if (next !== s) logBuildChange('REPLACE', s.build, next.build);
        buildPick = null;
        build = next;
        persistBuildIfCommitted();
        showBuild();
        return;
      }
      // §19.3 — inspection must never edit the build.
      showProgramInspection(programId, entry.source, showBuild);
    });
    rowEl.appendChild(pick);

    const moves = document.createElement('div');
    moves.className = 'bslotmoves';
    const mk = (label: string, delta: -1 | 1, enabled: boolean): void => {
      const b = document.createElement('button');
      b.className = 'bmove';
      b.textContent = label;
      b.disabled = !enabled;
      b.addEventListener('click', () => {
        const next = moveBuildSlot(s, i, delta);
        if (next !== s) logBuildChange('REORDER', s.build, next.build);
        build = next;
        persistBuildIfCommitted();
        showBuild();
      });
      moves.appendChild(b);
    };
    mk('▲', -1, i > 0);
    mk('▼', 1, i < s.build.length - 1);
    rowEl.appendChild(moves);
    slots.appendChild(rowEl);
  });
  panels.appendChild(slots);

  // ---- the remaining inventory (§8.1) ----
  const invHead = document.createElement('div');
  invHead.className = 'cfghead';
  invHead.textContent = 'INVENTORY (inactive)';
  panels.appendChild(invHead);

  const inv = document.createElement('div');
  inv.className = 'buildslots';
  for (const entry of inactiveOf(s)) {
    const p = entry.program;
    const rowEl = document.createElement('div');
    rowEl.className = buildPick === entry.programId ? 'bslot inactive sel' : 'bslot inactive';
    const pick = document.createElement('button');
    pick.className = 'bslotmain';
    const line1 = document.createElement('div');
    line1.className = 'optname';
    line1.textContent = `${p.name} [${SOURCE_LABEL[entry.source]}]`;
    const line2 = document.createElement('div');
    line2.className = 'optline';
    line2.textContent = `${colorList(p.colors)} + ${shapeList(p.shapes)} — ${p.fn.name} (${p.cost})`;
    pick.appendChild(line1);
    pick.appendChild(line2);
    pick.addEventListener('click', () => {
      buildPick = buildPick === entry.programId ? null : entry.programId;
      showBuild();
    });
    rowEl.appendChild(pick);
    const info = document.createElement('div');
    info.className = 'bslotmoves';
    const b = document.createElement('button');
    b.className = 'bmove';
    b.textContent = 'i';
    b.addEventListener('click', () => showProgramInspection(entry.programId, entry.source, showBuild));
    info.appendChild(b);
    rowEl.appendChild(info);
    inv.appendChild(rowEl);
  }
  panels.appendChild(inv);

  // ---- context-appropriate actions (§8.2/§8.3/§8.4/§8.5) ----
  const buttons: ButtonSpec[] = [];
  const startLabel = buildStartLabel(s.context, step);
  if (s.context === 'CONSTRUCTED_QUICK_MATCH') {
    const restored = deserializeSession(loadBattleJson());
    buttons.push([startLabel, () => confirmReplace(restored ? restored.info : null, () => void startConstructedQuickMatch(), showBuild)]);
    // §9.3 — backing out neither writes the preset nor replaces the save.
    // Alpha 0.5.0 §12.2 — Back from Build returns to System Selection (the
    // screen that now precedes it), with the previous pick still showing.
    buttons.push(['Back', () => {
      build = null;
      hostPick = pendingQuickHost;
      pendingQuickHost = null;
      showHostSelection();
    }]);
  } else {
    buttons.push([startLabel, () => void startRunBattleFromBuild()]);
    // §8.4 — a committed Run may be suspended from Build and resumes here.
    buttons.push(['Save and Quit', () => {
      persistBuildIfCommitted();
      build = null;
      showTitle();
    }]);
  }

  const sub =
    s.context === 'CONSTRUCTED_QUICK_MATCH'
      ? 'Choose four Programs and their order'
      : `Battle ${step} of ${RUN_LENGTH} — adjust your build`;
  showDialog(buildTitle(s.context), sub, buttons, panels, true);
}

// Alpha 0.6.0 §28 — THE DESTRUCTIVE COMMITMENT BOUNDARY. Advancing from Deck
// Selection into the initial Path Choice creates the Run, replaces the previous
// active save, generates the two initial offers, and PERSISTS them immediately,
// so a reload lands on exactly the same two cards (§35).
//
// It does not create a battle and does not open Build: the encounter package is
// what the player is about to choose (§27).
async function commitRunToPathChoice(): Promise<void> {
  if (!setup || !setupComplete(setup) || !setup.hackerId || !setup.deckId) return;
  const hackerId = setup.hackerId;
  const deckId = setup.deckId;
  // §35 — the Run's route randomness comes from ONE isolated stream, seeded
  // here and then persisted with the Run. It never touches gameplay RNG.
  const { seed } = makeSetupRandom();
  clearBattleSave();
  // §10.4 — the settings snapshot (including Normal LINK) is taken at Run
  // creation and is authoritative for the whole Run.
  const run = commitNewRun(setup, menuSettings, seed);
  session = run;
  pending = null;
  setup = null;
  build = null;
  game = null;
  pathPick = null;
  persistSession();
  logSelection('RUN_CREATED', {
    extra: { ...portfolioContext(hackerId, deckId), buildContext: 'INITIAL_RUN', routeSeed: seed },
  });
  logPathOffered(run.pendingPath!);
  showPathChoice();
}

// §8.4/§17.4 — leave the pre-battle Build phase and start the encounter with
// the build exactly as it now stands.
async function startRunBattleFromBuild(): Promise<void> {
  if (!build || !session || session.mode !== 'RUN') return;
  const finalBuild = [...build.build];
  const edited = build.edited;
  const context = build.context;
  session = { ...session, build: finalBuild, buildOrigin: build.origin };
  delete (session as RunInfo).pendingBuild;
  build = null;
  pending = null;
  const g = createRunBattle(session, session.step);
  logSelection('BATTLE_BUILD_APPLIED', { g, extra: { buildContext: context, buildEdited: edited } });
  await enterBattle(g);
}

// §8.4/§8.5 — open the pre-battle Build screen for the current Run step. The
// committed Run parks here as real, saveable state.
function openRunBuild(context: 'RUN_BETWEEN' | 'RUN_RETRY'): void {
  if (!session || session.mode !== 'RUN') return;
  session = { ...session, pendingBuild: true };
  pending = null;
  game = null;
  view.clearBoard();
  // §8.4 — carry the Run's current build and order forward; §8.5 does the same
  // for a retry so the player can adjust before the rematch.
  const s = beginBuild(context, session.identity.hackerId, session.identity.deckId, session.build, 'CARRIED_RUN');
  // openBuild installs `s` as the live Build state; persisting must follow it,
  // or the save would capture the PREVIOUS screen's build.
  openBuild(s);
  persistBuildIfCommitted();
  logBuildOpened(s);
}

// ---- battle starts (all battle construction goes through logic/session.ts) ----

async function enterBattle(g: Game): Promise<void> {
  hideDialog();
  game = g;
  selection = null;
  targeting = null;
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

// ---- §9 Quick Match: Random and Constructed ----

// §9.1 — a bounded choice screen replaces the direct launch. Both modes use
// the explicit default identity; neither adds a selection screen.
function showQuickMatchMenu(): void {
  build = null;
  showDialog(
    'QUICK MATCH',
    `${hackerById(DEFAULT_HACKER_ID).name} / ${deckById(DEFAULT_DECK_ID).name}`,
    [
      ['Random Quick Match', () => {
        const restored = deserializeSession(loadBattleJson());
        confirmReplace(restored ? restored.info : null, () => void startRandomQuickMatch(), showQuickMatchMenu);
      }],
      // Alpha 0.5.0 §12.1 — Constructed now opens SYSTEM SELECTION first, then
      // Build, so the opponent is known while the build is edited (§2.10). The
      // save is still replaced only when the battle actually starts (§12.3).
      ['Constructed Quick Match', () => {
        systemPick = null;
        showSystemSelection();
      }],
      ['Back', showTitle],
    ],
  );
}

// ============================================================================
// Alpha 0.5.0 §12/§15 — CONSTRUCTED QUICK MATCH SYSTEM SELECTION.
//
// The opponent is chosen BEFORE Build so the player can build against it
// (§2.10). Whitebox and mobile-first: every valid loaded System, enough
// resolved data to make the choice meaningful, shared Program inspection, one
// final action and no confirmation modal (§12.2). There is no remembered
// System preference in Alpha 0.5 (§12.4).
// ============================================================================

// Which System the selection screen is currently showing as picked. Pure
// presentation state: nothing is committed until Choose.
let systemPick: string | null = null;

function showSystemSelection(): void {
  build = null;
  const systems = allSystems();
  const preselect = systemPick ?? (systems.length === 1 ? systems[0].id : null);
  const list = optionList(
    systems.map((s: ResolvedSystem) => ({
      id: s.id,
      title: `${s.name} [${s.id}]`,
      lines: [
        // §15 — Quick Match ICE is the System's own BASE_ICE (§10.1), so the
        // number shown here is the number the battle will actually use.
        `ICE ${resolveQuickMatchIce(menuSettings, s.id)}`,
        `Strong: ${colorList(s.strongColors)} / ${shapeList(s.strongShapes)}`,
        `Weak: ${colorList(s.weakColors)} / ${shapeList(s.weakShapes)}`,
      ],
    })),
    preselect,
    (id) => {
      systemPick = id;
      showSystemSelection();
    },
  );
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(list);
  // §15 — the ordered four-Program build, with shared Program inspection.
  if (preselect) {
    const head = document.createElement('div');
    head.className = 'cfghead';
    head.textContent = 'PROGRAMS (top to bottom — charge priority)';
    panels.appendChild(head);
    panels.appendChild(systemProgramStrip(systemById(preselect).programIds, showSystemSelection));
  }
  showDialog(
    'SELECT SYSTEM',
    'Choose the System you will breach',
    [
      ['Choose', () => {
        if (!preselect) return;
        const system: SelectedSystem = { systemId: preselect, source: 'QUICK_CONSTRUCTED' };
        logSystemSelected(system, 'CONSTRUCTED_QUICK_MATCH');
        // Alpha 0.6.0 §37 — HOST Selection sits between System Selection and
        // Build, so both deliberate choices are made before the build is edited.
        pendingQuickSystem = system;
        hostPick = null;
        showHostSelection();
      }, undefined, !preselect],
      // §12.2 — Back from System Selection returns to the Quick Match submenu.
      ['Back', () => {
        systemPick = null;
        showQuickMatchMenu();
      }],
    ],
    panels,
    true,
  );
}

// ============================================================================
// Alpha 0.6.0 §38 — CONSTRUCTED QUICK MATCH HOST SELECTION.
//
// Every valid HOST is listed, `in_pool` included or not: that flag governs
// RANDOM generation only, and this screen exists precisely so a tester can
// field a specific battlefield deliberately (director spec 2026-08-11).
// ============================================================================

let hostPick: string | null = null;

function showHostSelection(): void {
  build = null;
  const hosts = allHosts();
  const preselect = hostPick ?? (hosts.length === 1 ? hosts[0].id : null);
  const list = optionList(
    hosts.map((h: ResolvedHost) => ({
      id: h.id,
      title: `${h.name} [${h.id}]`,
      // §38 — the resolved PASSIVE display, or the payload Function name where
      // a carrier has no authored display (§5.7), is what makes the current
      // whitebox behavior understandable without an art system.
      lines: h.passives.length ? h.passives.map((p) => p.display) : ['no PASSIVEs'],
    })),
    preselect,
    (id) => {
      hostPick = id;
      showHostSelection();
    },
  );
  const panels = document.createElement('div');
  panels.className = 'panelscroll';
  panels.appendChild(list);
  showDialog(
    'SELECT HOST',
    'Choose the environment you will fight in',
    [
      ['Choose', () => {
        if (!preselect) return;
        pendingQuickHost = preselect;
        logHostSelected(preselect, 'QUICK_CONSTRUCTED', 'CONSTRUCTED_QUICK_MATCH');
        openConstructedQuickMatchBuild(pendingQuickSystem!);
      }, undefined, !preselect],
      ['Back', () => {
        hostPick = null;
        systemPick = pendingQuickSystem?.systemId ?? null;
        pendingQuickSystem = null;
        showSystemSelection();
      }],
    ],
    panels,
    true,
  );
}

// §9.3 — open the Constructed Build screen: the last valid remembered build
// when one exists, otherwise the default.
function openConstructedQuickMatchBuild(system: SelectedSystem): void {
  pendingQuickSystem = system;
  const ids = defaultIdentity();
  // §9.4 — an unusable preference is discarded quietly and falls back to the
  // default; it never blocks startup or the mode.
  const preset = deserializeConstructedPreset(loadConstructedPreset());
  const usable = preset && preset.hackerId === ids.hackerId && preset.deckId === ids.deckId ? preset.build : null;
  if (preset && !usable) {
    console.warn('[breach] remembered Constructed build does not match the default identity — using the default build');
  }
  const s = beginBuild('CONSTRUCTED_QUICK_MATCH', ids.hackerId, ids.deckId, usable, 'REMEMBERED_CONSTRUCTED');
  openBuild(s);
  logBuildOpened(s);
}

// §9.2 — Random Quick Match: sample four of the six inventory Programs without
// replacement, give them an explicit random order, log the whole resolution,
// and start the battle WITHOUT opening Build.
async function startRandomQuickMatch(): Promise<void> {
  const ids = defaultIdentity();
  const inventory = inventoryProgramIds(ids.hackerId, ids.deckId);
  // §9.2 — an isolated setup random source. The Game seeds its gameplay RNG
  // separately at construction, so this cannot perturb the board, refills, or
  // AI sequence for a given gameplay seed.
  // Alpha 0.5.0 §13/§14 — the opponent is drawn from that SAME setup stream:
  // one isolated source for all setup randomness, never a second one and never
  // the gameplay stream. No System Selection screen opens (§13).
  const { rng, seed } = makeSetupRandom();
  const chosen = randomBuild(inventory, rng);
  const system = randomSystem(rng, 'QUICK_RANDOM');
  // Alpha 0.6.0 §39 — the HOST is drawn from that SAME isolated setup stream,
  // from the in_pool subset, and no HOST Selection screen opens.
  const hostId = randomHost(rng);
  clearBattleSave(); // confirmed replacement
  session = { mode: 'QUICK_MATCH', identity: ids, system, hostId, build: chosen, buildOrigin: 'RANDOM' };
  pending = null;
  setup = null;
  build = null;
  pendingQuickSystem = null;
  pendingQuickHost = null;
  logSystemSelected(system, 'RANDOM_QUICK_MATCH');
  logHostSelected(hostId, 'QUICK_RANDOM', 'RANDOM_QUICK_MATCH');
  // §18.4 — logged BEFORE battle creation.
  logSelection('BUILD_OPENED', {
    identity: { hackerId: ids.hackerId, deckId: ids.deckId },
    extra: {
      ...portfolioContext(ids.hackerId, ids.deckId),
      buildContext: 'RANDOM_QUICK_MATCH',
      buildOrigin: 'RANDOM',
      build: [...chosen],
      setupSeed: seed,
      gameplayRngIndependent: true,
    },
  });
  const g = createQuickMatchBattle(menuSettings, ids, system, hostId, chosen, 'RANDOM');
  logSelection('QUICK_MATCH_CREATED', { g, extra: { buildContext: 'RANDOM_QUICK_MATCH', buildEdited: false } });
  await enterBattle(g);
}

// §9.3 — start the Constructed battle and remember the build. The preset is
// written ONLY here, never on Back.
async function startConstructedQuickMatch(): Promise<void> {
  if (!build || !pendingQuickSystem || !pendingQuickHost) return;
  const ids = defaultIdentity();
  const system = pendingQuickSystem;
  const hostId = pendingQuickHost;
  const chosen = [...build.build];
  const edited = build.edited;
  // §12.4/§37 — the remembered preset stays a HACKER build preference. The
  // chosen System and HOST are deliberately NOT part of it, and it remains
  // independent of Run progression.
  saveConstructedPreset(serializeConstructedPreset(ids.hackerId, ids.deckId, chosen));
  clearBattleSave();
  session = { mode: 'QUICK_MATCH', identity: ids, system, hostId, build: chosen, buildOrigin: build.origin };
  pending = null;
  setup = null;
  build = null;
  pendingQuickSystem = null;
  pendingQuickHost = null;
  const g = createQuickMatchBattle(menuSettings, ids, system, hostId, chosen, session.buildOrigin);
  logSelection('QUICK_MATCH_CREATED', { g, extra: { buildContext: 'CONSTRUCTED_QUICK_MATCH', buildEdited: edited } });
  await enterBattle(g);
}

// §18.3 — Quick Match Reset restarts under the concluded battle's OWN config,
// identity, and BUILD, not under current menu settings and never by rerolling
// a Random build. It does not touch the remembered Constructed preset.
async function resetQuickMatch(config: BattleConfig, identity: BattleIdentity): Promise<void> {
  clearBattleSave();
  session = {
    mode: 'QUICK_MATCH',
    identity: { hackerId: identity.hackerId, deckId: identity.deckId, selectionSource: identity.selectionSource },
    // §18.3/§14 — Reset replays the concluded battle's OWN encounter. It never
    // rerolls the opponent, exactly as it never rerolls a Random build.
    system: { systemId: identity.systemId, source: identity.systemSelectionSource },
    hostId: identity.hostId,
    build: [...identity.hackerPrograms],
    buildOrigin: identity.buildOrigin,
  };
  pending = null;
  const g = recreateBattleFromConfig(config, identity);
  logSelection('QUICK_MATCH_CREATED', { g, extra: { buildEdited: false } });
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
  // §17.4/§42 — a Run suspended on its pre-battle Build screen, or parked on a
  // Path Choice, resumes to exactly that screen with exactly the same state:
  // the same upcoming encounter and build, or the same two offers (§35 — a
  // pending choice is NEVER rerolled on reload).
  if (!r.game) {
    session = r.info;
    game = null;
    pending = null;
    setup = null;
    selection = null;
    targeting = null;
    systemTurnActive = false;
    view.clearBoard();
    if (r.info.mode !== 'RUN') {
      showTitle();
      return;
    }
    if (r.info.pendingPath) {
      pathPick = null;
      build = null;
      showPathChoice();
      return;
    }
    const s = beginBuild('RUN_BETWEEN', r.info.identity.hackerId, r.info.identity.deckId, r.info.build, r.info.buildOrigin);
    openBuild(s);
    logBuildOpened(s);
    return;
  }
  hideDialog();
  session = r.info;
  game = r.game;
  pending = r.pending;
  selection = null;
  targeting = null;
  build = null;
  systemTurnActive = false;
  battleStartAt = Date.now();
  view.reset(gridViewOf(game.state.board));
  view.setSelection(null);
  // §21.2 — resume logs identify the restored Hacker, Deck, fixed build, and step
  const id = game.state.identity;
  console.info(
    `[breach] ${contextLabel(session)} restored (turn ${game.state.turn}) — ${id.hackerId}/${id.deckId} ` +
      `host=${id.hostId} upgrades=[${id.upgradeIds.join(',')}] passives=[${id.passiveIds.join(',')}] ` +
      `deckFn=${id.deckFunctionId} build=[${id.hackerPrograms.join(',')}]`,
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

// §8.4 — the Run advances to the next encounter's BUILD screen, not straight
// into the battle. The build carries forward and may be adjusted first.
// Alpha 0.6.0 §27/§30 — winning (or Force-Winning) a battle leads to the next
// PATH CHOICE, not straight to Build: the player commits an encounter package
// before editing the build for it. Offers are generated once, here, from the
// Run's persisted route RNG (§35), then saved; reopening, quitting, resuming,
// or reloading all reuse those exact offers rather than rolling again.
function advanceRun(): void {
  if (!session || session.mode !== 'RUN') return;
  const n = nextStep(session.step);
  if (n === null) return; // step 4 concludes via Run Complete, not advance
  const run = openPathChoice(session, n);
  session = run;
  pending = null;
  game = null;
  build = null;
  pathPick = null;
  view.clearBoard();
  persistSession();
  logPathOffered(run.pendingPath!);
  showPathChoice();
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

// §8.5 — retrying a lost battle returns to BUILD for the same Run step,
// preserving the current build as the starting state so it can be adjusted
// before the rematch. Same step, settings, and encounter ICE; new board + RNG.
function wizardRestartLostBattle(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_LOST_BATTLE');
  // Alpha 0.5.0 §11.5 — a retry is the SAME encounter: the System is not
  // rerolled merely because the player lost. `session.system` is left untouched
  // and openRunBuild reuses it, so the player may re-plan the Hacker build
  // against a known opponent.
  openRunBuild('RUN_RETRY');
}

// Restart Run resets to step 1 within the same saved Run snapshot. DESIGNER
// DECISION (2026-08-01): it opens on the DEFAULT build rather than carrying
// the current one, future-proofing for Programs acquired mid-Run.
function wizardRestartRun(): void {
  if (!session || session.mode !== 'RUN') return;
  appendWizard('WIZARD_RESTART_RUN');
  const ids = session.identity;
  // Alpha 0.6.0 §34.3 — a true Restart Run clears Run-LOCAL progression: the
  // acquired UPGRADEs go with the abandoned Run and are NOT retained. It then
  // reinitializes at the initial Path Choice like any new Run, so Battle 1 is
  // once again the fixed DOORMAN + THRESHOLD encounter with an UPGRADE choice.
  // (A RETRY of the same step keeps everything; that path is
  // wizardRestartLostBattle above.)
  const run = openPathChoice(
    {
      ...session,
      step: 1,
      build: defaultBuild(ids.hackerId, ids.deckId),
      buildOrigin: 'DEFAULT',
      upgradeIds: [],
    },
    1,
  );
  session = run;
  pending = null;
  game = null;
  build = null;
  pathPick = null;
  view.clearBoard();
  persistSession();
  logPathOffered(run.pendingPath!);
  showPathChoice();
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

// Play out one activation's events. An empty batch means the activation was
// rejected at the logic boundary (not charged, not resolved) — nothing to do.
function playActivation(events: ReturnType<Game['fireProgram']>): void {
  if (!events.length) return;
  busy = true;
  void view.play(events).then(() => {
    afterAction();
    busy = false;
    maybeGameOver();
  });
}

// §12.2 — resolve the armed activation against the chosen target. Target mode
// always ends here, whether or not the activation was accepted.
function fireArmed(target: ActivationTarget): void {
  if (!game || !targeting) return;
  const { slot } = targeting;
  targeting = null;
  playActivation(slot === DECK_SLOT ? game.fireDeckFunction(target) : game.fireProgram(slot, target));
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
  // Alpha 0.4.1 §18 — clear the incompatible pre-0.4.1 turn history once, then
  // §3.1 install the validated level (saved preference, else the environment
  // default: BASIC in production, VERBOSE under `npm run dev`).
  const migrated = migrateLegacyLogs();
  if (migrated) console.info(`[breach] log migration: ${migrated}`);
  setLoggingLevel(loadLoggingLevel());
  console.info(`[breach] logging level ${loggingLevel()} (schema ${LOGGING_SCHEMA_VERSION})`);

  attachInput(canvas, view, {
    onTap(p: Pt): void {
      if (!canAct() || !game) return;
      // §12.2 — a Packet tap CONFIRMS a targeted activation; under unit
      // targeting the board is not a legal target and the tap is ignored
      // (cancel is the armed control, never a stray tap).
      if (targeting) {
        if (targeting.kind === 'packet') fireArmed({ kind: 'packet', p });
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
      if (targeting) return; // a drag is never a target confirmation
      selection = null;
      view.setSelection(null);
      void doSwap(a, b);
    },
    onProgram(i: number): void {
      if (!canAct() || !game) return;
      // §12.2 — tapping the ARMED control cancels; this is the standard cancel
      // for every targeted Function. Cancelling spends no charge and does not
      // end the turn. Tapping a DIFFERENT Program just cancels.
      if (targeting) {
        const rearm = targeting.slot !== i;
        targeting = null;
        if (!rearm) return;
      }
      const u = game.state.units.player[i];
      if (!u) return;
      const prog: ResolvedProgram = programById(u.programId);
      const need = targetKindOf(prog);
      if (need) {
        if (u.charge >= prog.cost) targeting = { slot: i, kind: need };
        return;
      }
      playActivation(game.fireProgram(i));
    },
    // §7.4/§16.1 — the Drain target list is ACTIVE Programs only. The Deck
    // Function is not a Program and is structurally absent from this channel.
    onMinion(i: number): void {
      if (!canAct() || !game || targeting?.kind !== 'unit') return;
      fireArmed({ kind: 'unit', idx: i });
    },
    onDeck(): void {
      if (!canAct() || !game) return;
      if (targeting) {
        const rearm = targeting.slot !== DECK_SLOT;
        targeting = null;
        if (!rearm) return;
      }
      const deck = deckById(game.state.identity.deckId);
      const need = functionTargetKind(deck.fn);
      if (need) {
        if (game.state.deckCharge >= deck.fn.cost) targeting = { slot: DECK_SLOT, kind: need };
        return;
      }
      playActivation(game.fireDeckFunction());
    },
    // §20.3 — avatar controls open the side's character sheet. Available only
    // at the same stable input phase as Pause; never a combat event.
    onAvatar(side: Side): void {
      if (!canAct() || !game) return;
      targeting = null;
      showCharacterSheet(side);
    },
    onMenu(): void {
      // Pause only in the make-a-Sync phase, never mid-resolution. §18.3:
      // Quick Match keeps Reset; a Run does NOT show it (Run restarts are
      // result-screen wizard controls).
      if (!canAct() || !game || !session) return;
      targeting = null;
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
// Alpha 0.4.0 whitebox affordance, DEV BUILDS ONLY: fill the active Programs'
// charge pools so charge-gated Functions (targeted DATACUT/PLINK especially)
// can be exercised by hand without grinding out the Syncs first. Never present
// in a production build, and it touches nothing but charge.
if (import.meta.env.DEV) {
  helpers.breachCharge = (slot?: number): string => {
    if (!game) return 'no active battle';
    const slots = slot === undefined ? game.state.units.player.map((_, i) => i) : [slot];
    for (const i of slots) {
      const u = game.state.units.player[i];
      if (u) u.charge = programById(u.programId).chargeCap;
    }
    return game.state.units.player.map((u, i) => `${i}:${u.programId}=${u.charge}`).join(' ');
  };
}
helpers.breachWipe = (opts?: { save?: boolean }) => {
  wipeLogs();
  if (opts?.save) clearBattleSave();
  console.info(`[breach] logs wiped${opts?.save ? ' (and battle save)' : ''}`);
};
