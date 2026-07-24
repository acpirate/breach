// Canvas renderer + event-queue animator. Contains NO game rules: it replays
// GameEvents emitted by the logic layer and reads HUD data through a getter.
// Whitebox/greybox visuals only (spec 1.2).

import { BOARD_HEIGHT, BOARD_WIDTH } from '../logic/constants';
import { Color, GameEvent, Pt, Shape, TileView } from '../logic/types';

export interface HudUnit {
  label: string;
  cost: number;
  charge: number;
  ready: boolean;
  color: Color;
  shape: Shape;
}

export interface Hud {
  hpPlayer: number;
  hpPlayerMax: number;
  hpEnemy: number;
  hpEnemyMax: number;
  programs: HudUnit[];
  minions: HudUnit[];
  shakeCharge: number;
  shakeCost: number;
  shakeReady: boolean;
  // Alpha 0.2.0 §9.2 — side-general persistent-effect totals (Effect VALUE,
  // not tile count), shown compactly in the avatar boxes only.
  buffPlayer: number;
  buffEnemy: number;
  shieldPlayer: number;
  shieldEnemy: number;
  turn: number;
  canAct: boolean;
  statusText: string;
  targeting: boolean; // targeting mode — minion boxes are tap-targets
}

export type Hit =
  | { kind: 'cell'; p: Pt }
  | { kind: 'program'; idx: number }
  | { kind: 'minion'; idx: number } // tap-target for the player's targeted Drain
  | { kind: 'shake' }
  | { kind: 'menu' }
  | { kind: 'avatar'; side: 'player' | 'enemy' } // Alpha 0.2.0 §9/§10 — character-sheet access
  | null;

const COLOR_HEX: Record<Color, string> = {
  [Color.Red]: '#e04343',
  [Color.Yellow]: '#ddcf3d',
  [Color.Magenta]: '#cf52cf',
  [Color.Green]: '#43b953',
  [Color.Cyan]: '#3fc4c4',
  [Color.Blue]: '#4a72e8',
};

// MK2.1: darker shade of each gem color, used for the 1px tile border and the
// 1px outline around the white shape glyph.
const DARK_HEX: Record<Color, string> = {
  [Color.Red]: '#79201f',
  [Color.Yellow]: '#776e1a',
  [Color.Magenta]: '#6f2570',
  [Color.Green]: '#1f5f28',
  [Color.Cyan]: '#1c6666',
  [Color.Blue]: '#22397e',
};

const ease = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t * (2 - t));

interface VTile {
  view: TileView;
  fx: number; // displayed position in cell units (floats while tweening)
  fy: number;
}

interface Tween { vt: VTile; x0: number; y0: number; x1: number; y1: number; }

interface ActiveEvent { ev: GameEvent; started: number; dur: number; tweens: Tween[]; }

interface Rect { x: number; y: number; w: number; h: number; }

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function makeNoise(): HTMLCanvasElement {
  // Single shared static/glitch pattern for every neutral tile (spec 1.8).
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  const grays = [0, 70, 140, 200, 255];
  for (let i = 0; i < img.data.length; i += 4) {
    const g = grays[Math.floor(Math.random() * grays.length)];
    img.data[i] = g;
    img.data[i + 1] = g;
    img.data[i + 2] = g;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function traceShape(ctx: CanvasRenderingContext2D, shape: Shape, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case Shape.Circle:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case Shape.Square:
      ctx.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    case Shape.Triangle:
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.95, cy + r * 0.75);
      ctx.lineTo(cx - r * 0.95, cy + r * 0.75);
      ctx.closePath();
      break;
    case Shape.Diamond:
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.8, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.8, cy);
      ctx.closePath();
      break;
    case Shape.Star: {
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = cx + Math.cos(ang) * rad;
        const py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case Shape.Cross: {
      const w = r * 0.38;
      ctx.moveTo(cx - w, cy - r);
      ctx.lineTo(cx + w, cy - r);
      ctx.lineTo(cx + w, cy - w);
      ctx.lineTo(cx + r, cy - w);
      ctx.lineTo(cx + r, cy + w);
      ctx.lineTo(cx + w, cy + w);
      ctx.lineTo(cx + w, cy + r);
      ctx.lineTo(cx - w, cy + r);
      ctx.lineTo(cx - w, cy + w);
      ctx.lineTo(cx - r, cy + w);
      ctx.lineTo(cx - r, cy - w);
      ctx.lineTo(cx - w, cy - w);
      ctx.closePath();
      break;
    }
  }
}

export class View {
  private ctx: CanvasRenderingContext2D;
  private grid: (VTile | null)[][] = [];
  private queue: GameEvent[] = [];
  private cur: ActiveEvent | null = null;
  private enqueued = 0;
  private processed = 0;
  private waiters: { target: number; resolve: () => void }[] = [];
  private msgText = '';
  private msgUntil = 0;
  private floats: { text: string; cx: number; cy: number; born: number; color: string }[] = [];
  private selection: Pt | null = null;
  private hintMove: { a: Pt; b: Pt } | null = null; // MK7.7/7.8 highlight
  private noise: HTMLCanvasElement;
  // MK7.12 — letterboxed logical viewport (phone aspect), centered via CSS
  private cssW = 0;
  private cssH = 0;

  // layout (CSS pixels) — Alpha 0.2.0 §8 region contract. layout() is the
  // ONLY producer of these rectangles; rendering and hitTest() are the only
  // consumers. Regions are disjoint by construction (§8.3).
  private pad = 8;
  private cell = 40;
  private boardX = 0;
  private boardY = 0;
  private menuRect: Rect = { x: 0, y: 0, w: 0, h: 0 }; // Pause — top center, between avatars
  private avatarPlayerRect: Rect = { x: 0, y: 0, w: 0, h: 0 }; // Hacker avatar — upper-left
  private avatarEnemyRect: Rect = { x: 0, y: 0, w: 0, h: 0 }; // System avatar — upper-right
  private programRects: Rect[] = []; // Hacker Programs — vertical stack, left column
  private shakeRect: Rect = { x: 0, y: 0, w: 0, h: 0 }; // Board-Shake — bottom of the Hacker stack
  private minionRects: Rect[] = []; // System Programs — vertical stack, right column
  private statusRect: Rect = { x: 0, y: 0, w: 0, h: 0 }; // bottom status/help region (§12)

  constructor(private canvas: HTMLCanvasElement, private getHud: () => Hud | null) {
    this.ctx = canvas.getContext('2d')!;
    this.noise = makeNoise();
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      this.grid.push(new Array<VTile | null>(BOARD_WIDTH).fill(null));
    }
    window.addEventListener('resize', () => this.layout());
    this.layout();
    const loop = (now: number): void => {
      this.update(now);
      this.draw(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get cellSize(): number {
    return this.cell;
  }

  // Canvas-local anchor for the debug find-match button: right side of the
  // bottom status region, clear of the board and status text. The caller
  // converts to page coordinates.
  get debugAnchor(): { x: number; y: number } {
    return { x: this.cssW - 84, y: this.statusRect.y + 2 };
  }

  reset(grid: (TileView | null)[][]): void {
    this.queue = [];
    this.cur = null;
    this.floats = [];
    this.msgText = '';
    this.selection = null;
    this.enqueued = 0;
    this.processed = 0;
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
    this.setGrid(grid);
  }

  private setGrid(grid: (TileView | null)[][]): void {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const v = grid[y]?.[x];
        this.grid[y][x] = v ? { view: v, fx: x, fy: y } : null;
      }
    }
  }

  setSelection(p: Pt | null): void {
    this.selection = p;
  }

  // MK7.7/7.8 — pulsing highlight on a suggested swap pair (null clears)
  setHint(mv: { a: Pt; b: Pt } | null): void {
    this.hintMove = mv;
  }

  // MK7.11 — tear down the board render (quit-to-title leaves no ghost frame)
  clearBoard(): void {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) this.grid[y][x] = null;
    }
    this.queue = [];
    this.cur = null;
    this.floats = [];
    this.msgText = '';
    this.selection = null;
    this.hintMove = null;
  }

  play(events: GameEvent[]): Promise<void> {
    if (!events.length) return Promise.resolve();
    this.queue.push(...events);
    this.enqueued += events.length;
    const target = this.enqueued;
    return new Promise((resolve) => this.waiters.push({ target, resolve }));
  }

  // §8.3 input priority (canvas channel; blocking DOM modals sit above all of
  // this): Pause → avatars → Hacker Programs/Shake → System Programs → board.
  // Regions are disjoint, so priority is defensive rather than load-bearing.
  hitTest(x: number, y: number): Hit {
    if (inRect(this.menuRect, x, y)) return { kind: 'menu' };
    if (inRect(this.avatarPlayerRect, x, y)) return { kind: 'avatar', side: 'player' };
    if (inRect(this.avatarEnemyRect, x, y)) return { kind: 'avatar', side: 'enemy' };
    for (let i = 0; i < this.programRects.length; i++) {
      if (inRect(this.programRects[i], x, y)) return { kind: 'program', idx: i };
    }
    if (inRect(this.shakeRect, x, y)) return { kind: 'shake' };
    for (let i = 0; i < this.minionRects.length; i++) {
      if (inRect(this.minionRects[i], x, y)) return { kind: 'minion', idx: i };
    }
    const bx = Math.floor((x - this.boardX) / this.cell);
    const by = Math.floor((y - this.boardY) / this.cell);
    if (bx >= 0 && bx < BOARD_WIDTH && by >= 0 && by < BOARD_HEIGHT && y >= this.boardY) {
      return { kind: 'cell', p: { x: bx, y: by } };
    }
    return null;
  }

  // Geometry snapshot for headless layout tests (§14.6). Read-only copies.
  get regions(): {
    avatarPlayer: Rect; avatarEnemy: Rect; pause: Rect; programs: Rect[]; shake: Rect;
    minions: Rect[]; board: Rect; status: Rect; viewport: { w: number; h: number };
  } {
    return {
      avatarPlayer: { ...this.avatarPlayerRect },
      avatarEnemy: { ...this.avatarEnemyRect },
      pause: { ...this.menuRect },
      programs: this.programRects.map((r) => ({ ...r })),
      shake: { ...this.shakeRect },
      minions: this.minionRects.map((r) => ({ ...r })),
      board: { x: this.boardX, y: this.boardY, w: this.cell * BOARD_WIDTH, h: this.cell * BOARD_HEIGHT },
      status: { ...this.statusRect },
      viewport: { w: this.cssW, h: this.cssH },
    };
  }

  // ---- layout ----

  private layout(): void {
    const dpr = window.devicePixelRatio || 1;
    // MK7.12: letterbox to the target phone's vertical aspect (9:19.5) so
    // desktop testing IS phone testing — dead space either side on wide
    // screens (CSS containment, centered by the body flex layout).
    const ASPECT = 9 / 19.5;
    let w = Math.min(window.innerWidth, Math.round(window.innerHeight * ASPECT));
    let h = Math.min(window.innerHeight, Math.round(window.innerWidth / ASPECT));
    if (w < 200) w = Math.min(window.innerWidth, 200);
    if (h < 200) h = Math.min(window.innerHeight, 200);
    this.cssW = w;
    this.cssH = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ---- Alpha 0.2.0 §8.1 battle layout ----
    // Top row: Hacker avatar (upper-left), Pause (top center), System avatar
    // (upper-right). Below: two opposing VERTICAL Program stacks — Hacker
    // down the left column (Board-Shake as its fifth box), System down the
    // right. Square board beneath, pushed toward the bottom (~5% lower than
    // the pre-Alpha layout); a ~5%-height status/help region spans the very
    // bottom (§12). All regions disjoint (§8.3).
    const pad = this.pad;
    const avatarH = 46;
    const avatarW = Math.floor(w * 0.34);
    this.avatarPlayerRect = { x: pad, y: 6, w: avatarW, h: avatarH };
    this.avatarEnemyRect = { x: w - pad - avatarW, y: 6, w: avatarW, h: avatarH };
    const pauseW = Math.min(44, Math.max(28, w - 2 * (pad + avatarW) - 12));
    this.menuRect = { x: Math.floor(w / 2 - pauseW / 2), y: 8, w: pauseW, h: 34 };

    const stackTop = 6 + avatarH + 8;
    const gap = 4;
    const boxH = 40;
    const colW = Math.floor((w - pad * 2 - 8) / 2);
    const sysX = w - pad - colW;
    this.programRects = [];
    this.minionRects = [];
    for (let i = 0; i < 4; i++) {
      this.programRects.push({ x: pad, y: stackTop + i * (boxH + gap), w: colW, h: boxH });
      this.minionRects.push({ x: sysX, y: stackTop + i * (boxH + gap), w: colW, h: boxH });
    }
    this.shakeRect = { x: pad, y: stackTop + 4 * (boxH + gap), w: colW, h: boxH };
    const stacksBottom = stackTop + 5 * boxH + 4 * gap;

    const bottomH = Math.max(26, Math.floor(h * 0.05));
    const availBoardH = h - stacksBottom - 6 - bottomH - 4;
    this.cell = Math.max(24, Math.floor(Math.min((w - pad * 2) / BOARD_WIDTH, availBoardH / BOARD_HEIGHT)));
    const boardW = this.cell * BOARD_WIDTH;
    this.boardX = Math.floor((w - boardW) / 2);
    // board sits directly above the bottom status region; never above the stacks
    this.boardY = Math.max(stacksBottom + 6, h - bottomH - 4 - this.cell * BOARD_HEIGHT);
    this.statusRect = { x: pad, y: h - bottomH, w: w - pad * 2, h: bottomH - 2 };
  }

  // ---- event playback ----

  private update(now: number): void {
    if (this.cur) {
      const p = (now - this.cur.started) / this.cur.dur;
      const e = ease(p);
      for (const tw of this.cur.tweens) {
        tw.vt.fx = tw.x0 + (tw.x1 - tw.x0) * e;
        tw.vt.fy = tw.y0 + (tw.y1 - tw.y0) * e;
      }
      if (p >= 1) {
        this.finishEvent(this.cur);
        this.cur = null;
      }
    }
    if (!this.cur && this.queue.length) {
      this.cur = this.startEvent(this.queue.shift()!, now);
    }
  }

  private startEvent(ev: GameEvent, now: number): ActiveEvent {
    const tweens: Tween[] = [];
    let dur = 200;
    switch (ev.t) {
      case 'swap':
      case 'revert': {
        dur = 150;
        const va = this.grid[ev.a.y][ev.a.x];
        const vb = this.grid[ev.b.y][ev.b.x];
        this.grid[ev.a.y][ev.a.x] = vb;
        this.grid[ev.b.y][ev.b.x] = va;
        if (va) tweens.push({ vt: va, x0: ev.a.x, y0: ev.a.y, x1: ev.b.x, y1: ev.b.y });
        if (vb) tweens.push({ vt: vb, x0: ev.b.x, y0: ev.b.y, x1: ev.a.x, y1: ev.a.y });
        break;
      }
      case 'noMatch':
        dur = 350;
        this.msgText = 'No match — move reverted';
        this.msgUntil = now + 1600;
        break;
      case 'destroy':
        dur = 240; // tiles flash, then are removed in finishEvent
        break;
      case 'fall':
        dur = 180;
        for (const mv of ev.moves) {
          const vt = this.grid[mv.from.y][mv.from.x];
          if (!vt) continue;
          this.grid[mv.from.y][mv.from.x] = null;
          this.grid[mv.to.y][mv.to.x] = vt;
          tweens.push({ vt, x0: mv.from.x, y0: mv.from.y, x1: mv.to.x, y1: mv.to.y });
        }
        break;
      case 'spawn': {
        dur = 190;
        const perCol = new Map<number, number>();
        for (const s of ev.tiles) perCol.set(s.p.x, (perCol.get(s.p.x) ?? 0) + 1);
        for (const s of ev.tiles) {
          const k = perCol.get(s.p.x)!;
          const vt: VTile = { view: s.view, fx: s.p.x, fy: s.p.y - k };
          this.grid[s.p.y][s.p.x] = vt;
          tweens.push({ vt, x0: s.p.x, y0: s.p.y - k, x1: s.p.x, y1: s.p.y });
        }
        break;
      }
      case 'board':
        dur = 280;
        this.setGrid(ev.grid);
        break;
      case 'setTile': {
        dur = 240;
        const vt = this.grid[ev.p.y][ev.p.x];
        if (vt) vt.view = ev.view;
        break;
      }
      case 'countdown': {
        dur = 260;
        const vt = this.grid[ev.p.y][ev.p.x];
        if (vt?.view.special) vt.view.special.countdown = ev.value;
        break;
      }
      case 'detonate':
        dur = 260;
        break;
      case 'damage': {
        dur = 340;
        const r = ev.target === 'player' ? this.avatarPlayerRect : this.avatarEnemyRect;
        this.floats.push({
          text: `-${ev.amount}`,
          cx: r.x + r.w / 2,
          cy: r.y + r.h + 12,
          born: now,
          color: '#ff5a5a',
        });
        break;
      }
      case 'msg':
        dur = 220;
        this.msgText = ev.text;
        this.msgUntil = now + 1800;
        break;
      case 'over':
        dur = 320;
        this.msgText = ev.winner === 'player' ? 'Enemy down!' : 'You are down!';
        this.msgUntil = now + 3000;
        break;
      // metrics/logging-only events (MK2.3/MK4.3): nothing to draw
      case 'ability':
      case 'op':
      case 'chargeWaste':
      case 'autoReshuffle':
      case 'cascadeDepth':
      case 'shakeUsed':
      case 'tileStats':
      case 'thinkTime':
        dur = 1;
        break;
    }
    return { ev, started: now, dur, tweens };
  }

  private finishEvent(ae: ActiveEvent): void {
    for (const tw of ae.tweens) {
      tw.vt.fx = tw.x1;
      tw.vt.fy = tw.y1;
    }
    if (ae.ev.t === 'destroy') {
      for (const c of ae.ev.cells) this.grid[c.y][c.x] = null;
    }
    this.processed++;
    const done = this.waiters.filter((w) => this.processed >= w.target);
    this.waiters = this.waiters.filter((w) => this.processed < w.target);
    for (const w of done) w.resolve();
  }

  // ---- drawing ----

  private draw(now: number): void {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.fillStyle = '#1b1b22';
    ctx.fillRect(0, 0, w, h);

    const hud = this.getHud();
    if (hud) this.drawHud(hud);
    this.drawBoard(now);

    // §12 bottom status/help region — one compact contextual line. Priority:
    // an armed targeting prompt stays visible over transient messages; a live
    // transient message supersedes the default turn/status line.
    {
      const r = this.statusRect;
      const msgLive = now < this.msgUntil && this.msgText;
      let line = '';
      let color = '#b8b8c6';
      if (hud?.targeting) {
        line = hud.statusText;
        color = '#ff9500';
      } else if (msgLive) {
        line = this.msgText;
        color = '#f0e070';
      } else if (hud) {
        line = `Turn ${hud.turn}   ${hud.statusText}`;
      } else if (msgLive) {
        line = this.msgText;
      }
      if (line) {
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        // Fit the single line within the region: shrink the font first, then
        // truncate with an ellipsis if it still doesn't fit (§12 — one
        // compact line, never a wrapping/scrolling log).
        const maxW = r.w - 4;
        let fs = Math.max(13, Math.floor(r.h * 0.5));
        ctx.font = `bold ${fs}px sans-serif`;
        while (fs > 10 && ctx.measureText(line).width > maxW) {
          fs--;
          ctx.font = `bold ${fs}px sans-serif`;
        }
        let shown = line;
        if (ctx.measureText(shown).width > maxW) {
          while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxW) {
            shown = shown.slice(0, -1);
          }
          shown = `${shown}…`;
        }
        ctx.fillText(shown, r.x, r.y + r.h / 2);
        ctx.textBaseline = 'alphabetic';
      }
    }

    // floating damage numbers — MK6.9b: transient UI can afford to be loud;
    // big, bright, dark-outlined so the feedback is impossible to miss
    this.floats = this.floats.filter((f) => now - f.born < 1000);
    for (const f of this.floats) {
      const age = (now - f.born) / 1000;
      ctx.globalAlpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(f.text, f.cx, f.cy + 24 + age * 30);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.cx, f.cy + 24 + age * 30);
      ctx.globalAlpha = 1;
    }
  }

  private drawHud(hud: Hud): void {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle';

    // §9 avatar boxes — side identity, HP, compact Buff/Shield totals
    this.drawAvatarBox(this.avatarPlayerRect, 'YOU', hud.hpPlayer, hud.hpPlayerMax, '#58c06a', hud.buffPlayer, hud.shieldPlayer);
    this.drawAvatarBox(this.avatarEnemyRect, 'ENEMY', hud.hpEnemy, hud.hpEnemyMax, '#c05858', hud.buffEnemy, hud.shieldEnemy);

    // Pause button — top center between avatars (§11)
    ctx.fillStyle = '#33333e';
    ctx.fillRect(this.menuRect.x, this.menuRect.y, this.menuRect.w, this.menuRect.h);
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.menuRect.x + 0.5, this.menuRect.y + 0.5, this.menuRect.w - 1, this.menuRect.h - 1);
    ctx.fillStyle = '#ddd';
    ctx.font = `bold ${Math.floor(this.menuRect.h * 0.64)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('≡', this.menuRect.x + this.menuRect.w / 2, this.menuRect.y + this.menuRect.h / 2 + 1);

    // Hacker Program stack (left, stable authored order) + Board-Shake
    for (let i = 0; i < 4; i++) {
      this.drawUnitBox(this.programRects[i], hud.programs[i], true, false);
    }
    this.drawShakeBox(this.shakeRect, hud);

    // System Program stack (right; highlighted while targeting is armed)
    for (let i = 0; i < 4; i++) {
      this.drawUnitBox(this.minionRects[i], hud.minions[i], false, hud.targeting);
    }
  }

  // §9 avatar box: identity label, compact B/S totals (values, zero-hidden),
  // HP bar along the bottom. Whitebox placeholders per §9.2.
  private drawAvatarBox(r: Rect, label: string, hp: number, hpMax: number, hpColor: string, buff: number, shield: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#2c2c36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = '#ddd';
    ctx.font = `bold 13px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(label, r.x + 4, r.y + 10);
    // compact persistent-effect totals, right-aligned; zero values hidden (§9.2)
    const parts: string[] = [];
    if (buff > 0) parts.push(`B +${buff}`);
    if (shield > 0) parts.push(`S ${shield}`);
    if (parts.length) {
      ctx.fillStyle = '#ffe080';
      ctx.font = `bold 12px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(parts.join('  '), r.x + r.w - 4, r.y + 10);
    }
    this.drawHpBar({ x: r.x + 4, y: r.y + r.h - 22, w: r.w - 8, h: 18 }, '', hp, hpMax, hpColor);
  }

  private drawHpBar(r: Rect, label: string, hp: number, max: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#2a2a33';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = color;
    ctx.fillRect(r.x, r.y, r.w * Math.max(0, Math.min(1, hp / max)), r.h);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(r.h * 0.64)}px sans-serif`; // MK3.6: fill the bar height
    ctx.textAlign = 'left';
    ctx.fillText(`${label ? `${label} ` : ''}${hp}/${max}`, r.x + 6, r.y + r.h / 2 + 1);
  }

  private drawUnitBox(r: Rect, u: HudUnit, interactive: boolean, targetable: boolean): void {
    const ctx = this.ctx;
    const charged = u.charge >= u.cost;
    ctx.fillStyle = targetable ? '#3c3220' : '#2c2c36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = targetable ? '#ff9500' : charged ? (interactive && u.ready ? '#ffffff' : '#e0a040') : '#555';
    ctx.lineWidth = targetable ? 3 : charged ? 2 : 1;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);

    // binding swatch: colored icon, matching the MK4.4 tile style
    const sw = 14;
    traceShape(ctx, u.shape, r.x + 4 + sw / 2, r.y + 4 + sw / 2, sw * 0.55);
    ctx.fillStyle = COLOR_HEX[u.color];
    ctx.fill();
    ctx.strokeStyle = DARK_HEX[u.color];
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ddd';
    // MK3.6: label/charge text scaled to the box height. Alpha: labels are
    // data display names (BOMBER, E-BOMBER, …) — shrink to fit the box width.
    const maxLabelW = r.w - (4 + sw + 4) - 3;
    let fs = Math.max(12, Math.floor(r.h * 0.28));
    ctx.font = `bold ${fs}px sans-serif`;
    while (fs > 8 && ctx.measureText(u.label).width > maxLabelW) {
      fs--;
      ctx.font = `bold ${fs}px sans-serif`;
    }
    ctx.textAlign = 'left';
    // Alpha 0.2.0: boxes are a fixed 40px in the vertical stack (down from
    // 54px pre-0.2.0) — label/charge-text/bar offsets tightened so all three
    // rows fit cleanly instead of nearly touching.
    ctx.fillText(u.label, r.x + 4 + sw + 4, r.y + 11);

    ctx.fillStyle = charged ? '#ffe080' : '#aaa';
    ctx.font = `${Math.max(11, Math.floor(r.h * 0.22))}px sans-serif`;
    ctx.fillText(`${u.charge}/${u.cost}`, r.x + 4, r.y + r.h - 15);

    // charge bar
    const bw = r.w - 8;
    ctx.fillStyle = '#1c1c24';
    ctx.fillRect(r.x + 4, r.y + r.h - 8, bw, 5);
    ctx.fillStyle = charged ? '#f0c040' : '#6080c0';
    ctx.fillRect(r.x + 4, r.y + r.h - 8, bw * Math.min(1, u.charge / u.cost), 5);
  }

  private drawShakeBox(r: Rect, hud: Hud): void {
    const ctx = this.ctx;
    const charged = hud.shakeCharge >= hud.shakeCost;
    ctx.fillStyle = '#2c2c36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = charged ? (hud.shakeReady ? '#ffffff' : '#e0a040') : '#555';
    ctx.lineWidth = charged ? 2 : 1;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.fillStyle = '#ddd';
    ctx.font = `bold ${Math.max(11, Math.floor(r.h * 0.26))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('SHAKE', r.x + 4, r.y + 11);
    ctx.fillStyle = charged ? '#ffe080' : '#aaa';
    ctx.font = `${Math.max(11, Math.floor(r.h * 0.22))}px sans-serif`;
    ctx.fillText(`${hud.shakeCharge}/${hud.shakeCost}`, r.x + 4, r.y + r.h - 15);
    const bw = r.w - 8;
    ctx.fillStyle = '#1c1c24';
    ctx.fillRect(r.x + 4, r.y + r.h - 8, bw, 5);
    ctx.fillStyle = charged ? '#f0c040' : '#6080c0';
    ctx.fillRect(r.x + 4, r.y + r.h - 8, bw * Math.min(1, hud.shakeCharge / hud.shakeCost), 5);
  }

  private drawBoard(now: number): void {
    const ctx = this.ctx;
    const c = this.cell;
    const bw = c * BOARD_WIDTH;
    const bh = c * BOARD_HEIGHT;

    ctx.fillStyle = '#111118';
    ctx.fillRect(this.boardX - 2, this.boardY - 2, bw + 4, bh + 4);

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.boardX, this.boardY, bw, bh);
    ctx.clip();

    // cell backgrounds
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        ctx.fillStyle = '#26262e';
        ctx.fillRect(this.boardX + x * c + 1, this.boardY + y * c + 1, c - 2, c - 2);
      }
    }

    // tiles
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const vt = this.grid[y][x];
        if (!vt) continue;
        this.drawTile(this.boardX + vt.fx * c, this.boardY + vt.fy * c, vt.view);
      }
    }

    // selection highlight
    if (this.selection) {
      ctx.strokeStyle = '#ff9500';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        this.boardX + this.selection.x * c + 1.5,
        this.boardY + this.selection.y * c + 1.5,
        c - 3,
        c - 3,
      );
    }

    // hint highlight (MK7.7/7.8): pulsing cyan outline on the suggested pair
    if (this.hintMove) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      ctx.strokeStyle = `rgba(80,220,255,${(0.45 + 0.55 * pulse).toFixed(3)})`;
      ctx.lineWidth = 4;
      for (const p of [this.hintMove.a, this.hintMove.b]) {
        ctx.strokeRect(this.boardX + p.x * c + 2, this.boardY + p.y * c + 2, c - 4, c - 4);
      }
    }

    // event overlays
    if (this.cur) {
      const p = (now - this.cur.started) / this.cur.dur;
      const a = 0.65 * (1 - Math.abs(2 * Math.min(1, Math.max(0, p)) - 1));
      if (this.cur.ev.t === 'destroy') {
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        for (const cc of this.cur.ev.cells) {
          ctx.fillRect(this.boardX + cc.x * c, this.boardY + cc.y * c, c, c);
        }
      } else if (this.cur.ev.t === 'detonate') {
        // Alpha: the event carries the bomb's own data-defined footprint, so
        // the flash matches the actual blast (E-Bomb included).
        ctx.fillStyle = `rgba(255,140,30,${a.toFixed(3)})`;
        for (const cc of this.cur.ev.cells) {
          ctx.fillRect(this.boardX + cc.x * c, this.boardY + cc.y * c, c, c);
        }
      } else if (this.cur.ev.t === 'board') {
        ctx.fillStyle = `rgba(255,255,255,${(0.4 * (1 - Math.min(1, p))).toFixed(3)})`;
        ctx.fillRect(this.boardX, this.boardY, bw, bh);
      } else if (this.cur.ev.t === 'setTile' || this.cur.ev.t === 'countdown') {
        ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.lineWidth = 3;
        const pt = this.cur.ev.p;
        ctx.strokeRect(this.boardX + pt.x * c + 1.5, this.boardY + pt.y * c + 1.5, c - 3, c - 3);
      }
    }

    ctx.restore();
  }

  private drawTile(px: number, py: number, view: TileView): void {
    const ctx = this.ctx;
    const c = this.cell;
    const cx = px + c / 2;
    const cy = py + c / 2;

    if (view.kind === 'neutral') {
      // static/glitch noise — never a blank space, never one of the 6 colors
      // (unchanged by MK2.1)
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.noise, px + 1, py + 1, c - 2, c - 2);
      ctx.imageSmoothingEnabled = true;
    } else {
      // MK4.4: the tile IS a colored icon — the shape enlarged so its
      // silhouette sits near the tile edges (center stays free for the
      // MK3.6 centered special badges), filled with the gem color and
      // outlined in its darker shade. Supersedes MK2.1's white-on-colored-
      // field style (the field is gone, so white fill lost its purpose).
      traceShape(ctx, view.shape!, cx, cy, c * 0.46);
      ctx.fillStyle = COLOR_HEX[view.color!];
      ctx.fill();
      ctx.strokeStyle = DARK_HEX[view.color!];
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (view.special) {
      // MK6.9a: the tile-perimeter ownership outline is REMOVED (it distorted
      // the enlarged icons and was redundant). Ownership now reads solely
      // from the centered badge: white fill = player, black fill = enemy
      // (spec 1.11 convention, preserved).
      const white = view.special.owner === 'player';
      // MK3.6: badge (bomb countdown / buff "+") centered in the shape glyph
      const br = c * 0.22;
      const bx = px + c / 2;
      const by = py + c / 2;
      ctx.fillStyle = white ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = white ? '#000000' : '#ffffff';
      ctx.lineWidth = white ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = white ? '#000000' : '#ffffff';
      ctx.font = `bold ${Math.max(10, Math.floor(br * 1.5))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // MK9.3: shield badge 'S'; bomb shows countdown; buff shows '+'
      const badge = view.special.type === 'bomb' ? String(view.special.countdown ?? '?') : view.special.type === 'shield' ? 'S' : '+';
      ctx.fillText(badge, bx, by + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
