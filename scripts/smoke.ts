// Headless smoke test: drives the pure logic layer through full battles
// across config variants, checking core invariants after every turn.
// Alpha 0.1.0: content loads from the packaged CSV datasets through the same
// shared pipeline the browser uses. Run with `npm run smoke`.

import { findValidMove, swap } from '../src/logic/board';
import { BOARD_HEIGHT, BOARD_WIDTH } from '../src/logic/constants';
import { getContent, programById } from '../src/logic/data/content';
import { Game } from '../src/logic/game';
import { detectMatches } from '../src/logic/match';
import { SAVE_VERSION } from '../src/logic/save';
import { defaultIdentity, deserializeSession, serializeSession } from '../src/logic/session';
import { BattleSettings } from '../src/logic/types';
import { botFireAbilities, botMove } from './bot';
import { initContentOrExit } from './dataNode';
import { D, deckCost, defaultHackerLink, headlessHost, headlessSystem, manualLink, newBattle } from './harness';

initContentOrExit();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

const DECK_COST = deckCost();

function checkInvariants(g: Game): void {
  const s = g.state;
  // Datastream fully populated between turns (resolution halts at game over)
  if (!s.winner) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        assert(s.board[y][x], `hole in settled Datastream at ${x},${y}`);
      }
    }
  }
  // charge caps respected (Alpha: against each Program's data cost).
  // Alpha 0.5.0 — the expected roster comes from the BATTLE'S OWN identity, not
  // from the loaded content roster: the Hacker side is an ordered four drawn
  // from a six-Program inventory, and the System side is the selected System's
  // ordered PRG_SET drawn from eight loaded System Programs. (Indexing the
  // loaded roster used to agree with the player's build by coincidence.)
  for (const side of ['player', 'enemy'] as const) {
    const roster = side === 'player' ? s.identity.hackerPrograms : s.identity.systemPrograms;
    assert(s.units[side].length === roster.length, `${side} roster size ${s.units[side].length} != ${roster.length}`);
    s.units[side].forEach((u, i) => {
      assert(u.programId === roster[i], `${side} slot ${i} program mismatch`);
      const cap = programById(u.programId).chargeCap;
      assert(u.charge >= 0 && u.charge <= cap, `${side} ${u.programId} charge ${u.charge} out of [0,${cap}]`);
    });
  }
  // §7.2 — the Deck Function's independent pool is capped at its cost
  assert(s.deckCharge >= 0 && s.deckCharge <= DECK_COST, `deck charge ${s.deckCharge} out of range`);
  // deadlock prevention: a settled Datastream always has a valid move
  if (!s.winner) assert(findValidMove(s.board), 'settled Datastream has no valid move');
}

function testInvalidSwapDoesNotConsumeTurn(g: Game): void {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      for (const d of [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }]) {
        const a = { x, y };
        const b = { x: x + d.dx, y: y + d.dy };
        if (b.x >= BOARD_WIDTH || b.y >= BOARD_HEIGHT) continue;
        swap(g.state.board, a, b);
        const wouldMatch = detectMatches(g.state.board).length > 0;
        swap(g.state.board, a, b);
        if (wouldMatch) continue;
        const r = g.attemptSwap(a, b);
        assert(!r.matched, 'verified non-Syncing swap must not match');
        assert(g.state.phase === 'playerPre', 'invalid swap must not consume the turn');
        return;
      }
    }
  }
}

function runBattle(label: string, settings: BattleSettings, seed: number): void {
  const g = newBattle(settings, seed);
  g.startPlayerPhase();
  testInvalidSwapDoesNotConsumeTurn(g);

  let safety = 0;
  while (!g.state.winner && safety++ < 600) {
    botFireAbilities(g);
    if (g.state.winner) break;
    if (g.state.deckCharge >= DECK_COST && safety % 4 === 0) {
      // Alpha 0.3.0 §8.8 — the live SCRAMBLE variant is 0:0:0:0: REARRANGE
      // (composition preserved), RETAIN specials, PREVENT immediate Syncs, no
      // cascades. Verify NO damage, NO Sync resolution, composition preserved,
      // and a legal no-Sync Datastream with a valid move.
      const hpBefore = JSON.stringify(g.state.hp);
      const chargesBefore = JSON.stringify({
        p: g.state.units.player.map((u) => u.charge),
        e: g.state.units.enemy.map((u) => u.charge),
      });
      const deckBefore = g.state.deckCharge;
      const compBefore = JSON.stringify(
        g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).sort(),
      );
      const specialsBefore = g.state.board.flat().filter((t) => t!.special).length;
      const ev = g.fireDeckFunction();
      assert(
        JSON.stringify(g.state.board.flat().map((t) => `${t!.kind}:${t!.color ?? '-'}:${t!.shape ?? '-'}`).sort()) === compBefore,
        'REARRANGE must preserve Datastream composition (permutation, not re-roll)',
      );
      assert(
        g.state.board.flat().filter((t) => t!.special).length === specialsBefore,
        'RETAIN must preserve every special object through the Shake',
      );
      assert(ev.length > 0, 'a charged Deck Function in playerPre must fire');
      assert(!ev.some((e) => e.t === 'damage'), 'a 0:0:0:0 Shake must deal no damage');
      assert(!ev.some((e) => e.t === 'destroy'), 'a 0:0:0:0 Shake must resolve no Syncs');
      assert(ev.some((e) => e.t === 'shake' && e.resolved), 'the Shake attempt must be recorded as resolved');
      assert(
        ev.some((e) => e.t === 'ability' && e.ownerKind === 'deck'),
        'the activation must be recorded as DECK-owned, not as a Program (§7.1)',
      );
      assert(JSON.stringify(g.state.hp) === hpBefore, 'Shake must not change LINK/ICE');
      assert(
        JSON.stringify({ p: g.state.units.player.map((u) => u.charge), e: g.state.units.enemy.map((u) => u.charge) }) === chargesBefore,
        'Shake must not change Program charges',
      );
      assert(g.state.deckCharge === deckBefore - DECK_COST, 'the Deck Function must spend its cost');
      assert(detectMatches(g.state.board).length === 0, 'a PREVENT_MATCHES Shake must leave no pre-existing Sync');
      assert(findValidMove(g.state.board), 'the Shake Datastream must have a valid move');
      assert(g.state.phase === 'playerPre', 'the Deck Function must not end the turn');
    }
    if (g.state.winner) break;

    const mv = botMove(g);
    assert(mv, 'deadlock prevention guarantees a move');
    const r = g.attemptSwap(mv.a, mv.b);
    assert(r.matched, 'bot-selected swap must produce a Sync');
    if (!g.state.winner) {
      assert(g.fireProgram(0).length === 0, 'Functions must not fire after the Sync is committed');
      assert(g.fireDeckFunction().length === 0, 'the Deck Function must not fire after the Sync is committed');
    }

    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    checkInvariants(g);
    // under a cascade cap, resolution must never leave Syncs on the Datastream
    if (!g.state.winner && settings.maxCascadeSteps !== null) {
      assert(detectMatches(g.state.board).length === 0, 'capped battle left unresolved Syncs on the Datastream');
    }
  }

  assert(g.state.winner, `${label} (seed ${seed}) should reach game over`);
  assert(g.state.hp[g.state.winner] > 0, 'winner must have positive LINK/ICE');
  const m = g.state.metrics;
  assert(m.winner === g.state.winner, 'metrics winner must match game winner');
  assert(m.turns === g.state.turn, 'metrics turn count must match game state');
  assert(m.sides[g.state.winner].totalDamage > 0, 'winning side must have dealt damage');
  // MK7.3/7.4 + §11.3 + Alpha 0.5.0: the DISJOINT causal buckets must sum
  // EXACTLY to total. `lineslice` and `transform` are their own buckets, so
  // omitting either would silently under-count rather than fail loudly.
  for (const side of ['player', 'enemy'] as const) {
    const sm = m.sides[side];
    const tallied =
      sm.matchDamage +
      sm.bombDamage +
      sm.attackerDamage +
      sm.linesliceDamage +
      sm.transformDamage +
      sm.bufferDamageAdded +
      sm.passiveDamage;
    assert(
      Math.abs(tallied - sm.totalDamage) < 1e-9,
      `${side} causal buckets (${tallied}) must sum to total (${sm.totalDamage})`,
    );
  }
  if (settings.enemyMatching) {
    assert(m.sides.enemy.tilesDestroyed > 0, 'a matching System should have sliced Packets');
  }
  // §11.2/§17: base Sync damage is suppressed for BOTH sides; match-triggered
  // PASSIVE damage still resolves, and bombs still deal detonation damage.
  if (settings.reinforcedConnection) {
    assert(
      m.sides.player.matchDamage === 0 && m.sides.enemy.matchDamage === 0,
      'Reinforced Connection: base Sync damage must be zero for both sides',
    );
    const p = m.sides.player;
    assert(
      Math.abs(p.totalDamage - (p.attackerDamage + p.bombDamage + p.bufferDamageAdded + p.passiveDamage)) < 1e-9,
      'Reinforced Connection: Hacker damage must come only from Functions, buffer, and PASSIVEs',
    );
    // Alpha 0.6.0 §12 — the headless System fields no PASSIVEs and the pinned
    // HOST has none, so nothing can contribute PASSIVE damage on that side.
    assert(m.sides.enemy.passiveDamage === 0, 'Reinforced Connection: the pinned System must accrue no PASSIVE damage');
  }
  console.log(
    `${label} seed=${seed}: winner=${g.state.winner} turns=${g.state.turn} ` +
      `link=${Math.max(0, g.state.hp.player)} ice=${Math.max(0, g.state.hp.enemy)}` +
      ` passiveDmg=${m.sides.player.passiveDamage} lineClears=${m.sides.player.lineClears}` +
      ` deckNeutral=${m.sides.player.deck.chargeFromNeutral}` +
      `${settings.reinforcedConnection ? ` [bombDmg H:${m.sides.player.bombDamage} S:${m.sides.enemy.bombDamage}]` : ''}`,
  );
}

// Alpha 0.2.0 §6/Alpha 0.3.0 §17: session save/restore round trip — headless
function testSaveRoundTrip(): void {
  const settings: BattleSettings = manualLink(
    { ...D, enemyMatching: true, maxCascadeSteps: 4, hintEnabled: true, hintDelaySeconds: 3 },
    222,
    333,
  );
  const g = newBattle(settings, 42);
  g.startPlayerPhase();
  for (let i = 0; i < 3 && !g.state.winner; i++) {
    const mv = botMove(g);
    assert(mv, 'move available');
    g.attemptSwap(mv.a, mv.b, 1234, i === 0); // exercise thinkTime + hintShown paths
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  assert(!g.state.winner, 'battle still in progress at save point');
  assert(g.state.metrics.thinkTimesMs.length === 3, 'raw think-times must be recorded per move');
  assert(g.state.metrics.hintsShown === 1, 'hint-shown count must be recorded');
  const info = {
    mode: 'QUICK_MATCH' as const,
    identity: defaultIdentity(),
    // Alpha 0.5.0 §32 — the session's opponent must agree with the battle's own
    // identity, or the envelope legitimately fails its consistency check.
    opponent: {
      kind: g.state.identity.opponentKind,
      id: g.state.identity.opponentId,
      source: g.state.identity.opponentSelectionSource,
    },
    // Alpha 0.6.0 §44 — the HOST is part of Quick Match session identity on the
    // System's terms and must likewise agree with the battle's own identity.
    hostId: g.state.identity.hostId,
    build: [...g.state.identity.hackerPrograms],
    buildOrigin: g.state.identity.buildOrigin,
  };
  const json = serializeSession(info, g, null);
  const r = deserializeSession(json);
  assert(r, 'valid save must deserialize');
  assert(r.info.mode === 'QUICK_MATCH' && r.pending === null, 'mode and phase survive');
  assert(r.game, 'an active Quick Match save restores a battle');
  assert(serializeSession(r.info, r.game, r.pending) === json, 'restored session must re-serialize identically');
  assert(r.game.state.turn === g.state.turn && r.game.state.battleId === g.state.battleId, 'turn/battleId survive');
  assert(r.game.state.config.playerHp === 222 && r.game.state.config.enemyHp === 333, 'manual LINK/ICE survive the round trip');
  assert(r.game.state.config.hintDelaySeconds === 3, 'hint config survives');
  // §17.2 — explicit identity and the Deck Function's exact charge round-trip
  assert(r.game.state.identity.hackerId === 'HAK_01' && r.game.state.identity.deckId === 'DEK_01', 'identity survives');
  assert(r.game.state.identity.deckFunctionId === 'FNC_010', 'Deck Function ID survives');
  assert(r.game.state.deckCharge === g.state.deckCharge, 'Deck Function charge survives exactly');
  // Alpha 0.4.0 §17.5 — the exact ordered active build and its source survive
  assert(
    r.game.state.identity.hackerPrograms.join(':') === g.state.identity.hackerPrograms.join(':'),
    'ordered active build survives the round trip',
  );
  assert(
    r.game.state.identity.inventory.join(':') === g.state.identity.inventory.join(':'),
    'six-Program inventory survives the round trip',
  );
  assert(r.game.state.identity.buildOrigin === g.state.identity.buildOrigin, 'build source survives');
  let safety = 0;
  const rg = r.game;
  while (!rg.state.winner && safety++ < 600) {
    botFireAbilities(rg);
    if (rg.state.winner) break;
    const mv = botMove(rg);
    assert(mv, 'restored game has moves');
    rg.attemptSwap(mv.a, mv.b);
    if (!rg.state.winner) rg.runEnemyPhase();
    if (!rg.state.winner) rg.startPlayerPhase();
  }
  assert(rg.state.winner, 'restored game plays to completion');
  // §17.1/§40: earlier saves reject cleanly (no migration, no partial load)
  for (const old of ['mk9', 'alpha-0.1.0', 'alpha-0.2.0', 'alpha-0.3.0', 'alpha-0.5.0']) {
    const preAlpha = JSON.parse(json) as { version: string };
    preAlpha.version = old;
    assert(deserializeSession(JSON.stringify(preAlpha)) === null, `${old} save -> no save`);
  }
  // content-fingerprint mismatch rejects
  const fpMismatch = JSON.parse(json) as { fp: string };
  fpMismatch.fp = 'deadbeef-0';
  assert(deserializeSession(JSON.stringify(fpMismatch)) === null, 'fingerprint mismatch -> no save');
  assert(deserializeSession('{"not":"a save"}') === null, 'wrong shape -> no save');
  assert(deserializeSession('garbage{{{') === null, 'corrupt JSON -> no save');
  assert(deserializeSession(null) === null, 'missing -> no save');
  console.log('save round-trip OK');
}

assert(SAVE_VERSION === 'alpha-0.7.0', 'save version must be alpha-0.7.0');
console.log(`content fingerprint: ${getContent().fingerprint}`);
// §44 — every simulation in this file runs against the PINNED headless System
// and HOST, so results stay comparable between runs.
console.log(`headless System: ${headlessSystem().id} | headless HOST: ${headlessHost()}`);
console.log(`default identity LINK: ${defaultHackerLink()} (deck function cost ${DECK_COST})`);

// defaults (cap-0, Normal LINK on) — standard and low-LINK
for (let seed = 1; seed <= 10; seed++) {
  runBattle('default', D, seed);
  runBattle('lowLink', manualLink(D, 1, 150), 1000 + seed);
}
// System matching on
for (let seed = 1; seed <= 5; seed++) {
  runBattle('systemMatch', { ...D, enemyMatching: true }, 2000 + seed);
  runBattle('systemMatch+lowLink', manualLink({ ...D, enemyMatching: true }, 1, 150), 3000 + seed);
}
// infinite cascades (old default) and single-axis still work
for (let seed = 1; seed <= 5; seed++) {
  runBattle('capInf', { ...D, maxCascadeSteps: null }, 4000 + seed);
  runBattle('singleAxis', { ...D, singleAxisPayout: true }, 5000 + seed);
}
// §11: Reinforced Connection — Functions and Skills are the damage sources
for (let seed = 1; seed <= 5; seed++) {
  runBattle('reinforced', { ...D, reinforcedConnection: true }, 6000 + seed);
  runBattle('reinforced+systemMatch', { ...D, reinforcedConnection: true, enemyMatching: true }, 7000 + seed);
}
// sub-option off restores the classic charge-agnostic tier
for (let seed = 1; seed <= 3; seed++) {
  runBattle(
    'reinforced+classicBot',
    { ...D, reinforcedConnection: true, enemyMatching: true, reinforcedChargeAwareBot: false },
    7500 + seed,
  );
}
testSaveRoundTrip();
console.log('SMOKE OK');
