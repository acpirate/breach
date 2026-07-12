// Headless smoke test: drives the pure logic layer through full battles
// across config variants, checking core invariants after every turn.
// Run with `npm run smoke`.

import { findValidMove, swap } from '../src/logic/board';
import { BOARD_HEIGHT, BOARD_SHAKE_COST, BOARD_WIDTH, DEFAULT_BATTLE_CONFIG, UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { detectMatches } from '../src/logic/match';
import { deserializeGame, serializeGame } from '../src/logic/save';
import { BattleConfig } from '../src/logic/types';
import { botFireAbilities, findBotMove } from './bot';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

function checkInvariants(g: Game): void {
  const s = g.state;
  // board fully populated between turns (resolution halts at game over, so a
  // finished battle may legitimately leave holes behind the game-over dialog)
  if (!s.winner) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        assert(s.board[y][x], `hole in settled board at ${x},${y}`);
      }
    }
  }
  // charge caps respected
  for (const side of ['player', 'enemy'] as const) {
    for (const u of s.units[side]) {
      const cost = UNIT_DEFS[u.type].cost;
      assert(u.charge >= 0 && u.charge <= cost, `${side} ${u.type} charge ${u.charge} out of [0,${cost}]`);
    }
  }
  assert(s.shakeCharge >= 0 && s.shakeCharge <= BOARD_SHAKE_COST, `shake charge ${s.shakeCharge} out of range`);
  // deadlock prevention: a settled board always has a valid move
  if (!s.winner) assert(findValidMove(s.board), 'settled board has no valid move');
}

function testInvalidSwapDoesNotConsumeTurn(g: Game): void {
  // find an adjacent pair verified (via tentative swap) to produce no match,
  // then confirm attemptSwap reverts it without consuming the turn
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
        assert(!r.matched, 'verified non-matching swap must not match');
        assert(g.state.phase === 'playerPre', 'invalid swap must not consume the turn');
        return;
      }
    }
  }
}

function runBattle(label: string, config: BattleConfig, seed: number): void {
  const g = new Game(config, seed);
  g.startPlayerPhase();
  testInvalidSwapDoesNotConsumeTurn(g);

  let safety = 0;
  while (!g.state.winner && safety++ < 600) {
    botFireAbilities(g);
    if (g.state.winner) break;
    if (g.state.shakeCharge >= BOARD_SHAKE_COST && safety % 4 === 0) {
      // MK2.2: shake is a pure anti-lock reshuffle — verify NO damage, NO
      // charge, NO cascades, and a no-match board with >=1 valid move
      const hpBefore = JSON.stringify(g.state.hp);
      const chargesBefore = JSON.stringify({
        p: g.state.units.player.map((u) => u.charge),
        e: g.state.units.enemy.map((u) => u.charge),
      });
      const shakeBefore = g.state.shakeCharge;
      const ev = g.fireShake();
      assert(ev.length > 0, 'charged shake in playerPre must fire');
      assert(!ev.some((e) => e.t === 'damage'), 'shake must deal no damage');
      assert(!ev.some((e) => e.t === 'destroy'), 'shake must trigger no cascades');
      assert(JSON.stringify(g.state.hp) === hpBefore, 'shake must not change HP');
      assert(
        JSON.stringify({ p: g.state.units.player.map((u) => u.charge), e: g.state.units.enemy.map((u) => u.charge) }) === chargesBefore,
        'shake must not change unit charges',
      );
      assert(g.state.shakeCharge === shakeBefore - BOARD_SHAKE_COST, 'shake must spend its cost');
      assert(detectMatches(g.state.board).length === 0, 'shake board must contain no pre-existing match');
      assert(findValidMove(g.state.board), 'shake board must have a valid move');
      assert(g.state.phase === 'playerPre', 'shake must not end the turn');
    }
    if (g.state.winner) break;

    const mv = findBotMove(g.state.board);
    assert(mv, 'deadlock prevention guarantees a move');
    const r = g.attemptSwap(mv.a, mv.b);
    assert(r.matched, 'bot-selected swap must produce a match');
    if (!g.state.winner) {
      assert(g.fireProgram(0).length === 0, 'abilities must not fire after the match is committed');
      assert(g.fireShake().length === 0, 'shake must not fire after the match is committed');
    }

    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    checkInvariants(g);
    // under a cascade cap, resolution must never leave matches on the board
    if (!g.state.winner && config.maxCascadeSteps !== null) {
      assert(detectMatches(g.state.board).length === 0, 'capped battle left unresolved matches on board');
    }
  }

  assert(g.state.winner, `${label} (seed ${seed}) should reach game over`);
  assert(g.state.hp[g.state.winner] > 0, 'winner must have positive HP');
  const m = g.state.metrics;
  assert(m.winner === g.state.winner, 'metrics winner must match game winner');
  assert(m.turns === g.state.turn, 'metrics turn count must match game state');
  assert(m.sides[g.state.winner].totalDamage > 0, 'winning side must have dealt damage');
  const tallied = m.sides[g.state.winner].matchDamage + m.sides[g.state.winner].attackerDamage + m.sides[g.state.winner].bombDamage;
  assert(tallied === m.sides[g.state.winner].totalDamage, 'damage source split must sum to total');
  if (config.enemyMatching) {
    assert(m.sides.enemy.tilesDestroyed > 0, 'matching enemy should have destroyed tiles');
  }
  // MK6.2: matches deal zero damage; bombs must STILL deal detonation damage
  if (config.noMatchDamage) {
    assert(m.sides.player.matchDamage === 0 && m.sides.enemy.matchDamage === 0, 'NMD: match damage must be zero');
    assert(
      m.sides.player.totalDamage === m.sides.player.attackerDamage + m.sides.player.bombDamage,
      'NMD: all damage must come from abilities',
    );
  }
  console.log(
    `${label} seed=${seed}: winner=${g.state.winner} turns=${g.state.turn} ` +
      `hp(player=${Math.max(0, g.state.hp.player)}, enemy=${Math.max(0, g.state.hp.enemy)})` +
      `${config.noMatchDamage ? ` [bombDmg P:${m.sides.player.bombDamage} E:${m.sides.enemy.bombDamage}]` : ''}`,
  );
}

// MK4.1: save/restore round trip — headless, pure logic (no storage APIs)
function testSaveRoundTrip(): void {
  const cfg: BattleConfig = { ...DEFAULT_BATTLE_CONFIG, enemyMatching: true, maxCascadeSteps: 4, playerHp: 222, enemyHp: 333 };
  const g = new Game(cfg, 42);
  g.startPlayerPhase();
  for (let i = 0; i < 3 && !g.state.winner; i++) {
    const mv = findBotMove(g.state.board);
    assert(mv, 'move available');
    g.attemptSwap(mv.a, mv.b, 1234); // exercise the thinkTime path too
    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
  }
  assert(!g.state.winner, 'battle still in progress at save point');
  assert(g.state.metrics.thinkTimesMs.length === 3, 'raw think-times must be recorded per move');
  const json = serializeGame(g.state);
  const r = deserializeGame(json);
  assert(r, 'valid save must deserialize');
  assert(serializeGame(r.state) === json, 'restored state must re-serialize identically');
  assert(r.state.turn === g.state.turn && r.state.battleId === g.state.battleId, 'turn/battleId survive');
  assert(r.state.config.playerHp === 222 && r.state.config.enemyHp === 333, 'HP config survives the round trip');
  let safety = 0;
  while (!r.state.winner && safety++ < 600) {
    botFireAbilities(r);
    if (r.state.winner) break;
    const mv = findBotMove(r.state.board);
    assert(mv, 'restored game has moves');
    r.attemptSwap(mv.a, mv.b);
    if (!r.state.winner) r.runEnemyPhase();
    if (!r.state.winner) r.startPlayerPhase();
  }
  assert(r.state.winner, 'restored game plays to completion');
  const tampered = JSON.parse(json) as { version: string };
  tampered.version = 'mk999';
  assert(deserializeGame(JSON.stringify(tampered)) === null, 'incompatible version -> no save');
  assert(deserializeGame('{"not":"a save"}') === null, 'wrong shape -> no save');
  assert(deserializeGame('garbage{{{') === null, 'corrupt JSON -> no save');
  assert(deserializeGame(null) === null, 'missing -> no save');
  console.log('save round-trip OK');
}

const D = DEFAULT_BATTLE_CONFIG;
// new defaults (cap-0, hacker off) — standard and low-player-HP (ex-forced-loss)
for (let seed = 1; seed <= 10; seed++) {
  runBattle('default', D, seed);
  runBattle('lowHp', { ...D, playerHp: 1 }, 1000 + seed);
}
// enemy matching on
for (let seed = 1; seed <= 5; seed++) {
  runBattle('enemyMatch', { ...D, enemyMatching: true }, 2000 + seed);
  runBattle('enemyMatch+lowHp', { ...D, enemyMatching: true, playerHp: 1 }, 3000 + seed);
}
// infinite cascades (old default) and single-axis still work
for (let seed = 1; seed <= 5; seed++) {
  runBattle('capInf', { ...D, maxCascadeSteps: null }, 4000 + seed);
  runBattle('singleAxis', { ...D, singleAxisPayout: true }, 5000 + seed);
}
// MK6.2: no-match-damage — abilities are the only damage source, bombs intact
for (let seed = 1; seed <= 5; seed++) {
  runBattle('noMatchDmg', { ...D, noMatchDamage: true }, 6000 + seed);
  runBattle('noMatchDmg+enemyMatch', { ...D, noMatchDamage: true, enemyMatching: true }, 7000 + seed);
}
testSaveRoundTrip();
console.log('SMOKE OK');
