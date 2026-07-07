// Headless smoke test: drives the pure logic layer through full battles in
// both scenarios across several seeds, checking core invariants after every
// turn. Run with `npm run smoke`.

import { findValidMove, swap } from '../src/logic/board';
import { BOARD_HEIGHT, BOARD_SHAKE_COST, BOARD_WIDTH, UNIT_DEFS } from '../src/logic/constants';
import { Game } from '../src/logic/game';
import { detectMatches } from '../src/logic/match';
import { Scenario } from '../src/logic/types';

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

function runScenario(scenario: Scenario, seed: number): void {
  const g = new Game(scenario, seed);
  g.startPlayerPhase();
  testInvalidSwapDoesNotConsumeTurn(g);

  let safety = 0;
  while (!g.state.winner && safety++ < 600) {
    // pre-match ability phase: fire everything that is charged
    for (let i = 0; i < 4; i++) {
      const u = g.state.units.player[i];
      if (g.state.winner) break;
      if (u.charge >= UNIT_DEFS[u.type].cost) g.fireProgram(i);
    }
    if (g.state.winner) break;
    if (g.state.shakeCharge >= BOARD_SHAKE_COST && safety % 4 === 0) g.fireShake();
    if (g.state.winner) break;

    // abilities must be blocked after the match commits — verified below
    const mv = findValidMove(g.state.board);
    assert(mv, 'deadlock prevention guarantees a move');
    const r = g.attemptSwap(mv.a, mv.b);
    assert(r.matched, 'findValidMove swap must produce a match');
    if (!g.state.winner) {
      assert(g.fireProgram(0).length === 0, 'abilities must not fire after the match is committed');
      assert(g.fireShake().length === 0, 'shake must not fire after the match is committed');
    }

    if (!g.state.winner) g.runEnemyPhase();
    if (!g.state.winner) g.startPlayerPhase();
    checkInvariants(g);
  }

  assert(g.state.winner, `${scenario} (seed ${seed}) should reach game over`);
  assert(g.state.hp[g.state.winner] > 0, 'winner must have positive HP');
  console.log(
    `${scenario} seed=${seed}: winner=${g.state.winner} turns=${g.state.turn} ` +
      `hp(player=${Math.max(0, g.state.hp.player)}, enemy=${Math.max(0, g.state.hp.enemy)})`,
  );
}

for (let seed = 1; seed <= 10; seed++) {
  runScenario('normal', seed);
  runScenario('forcedLoss', 1000 + seed);
}
console.log('SMOKE OK');
