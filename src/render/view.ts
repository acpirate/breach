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
  buffPlayer: number;
  buffEnemy: number;
  turn: number;
  canAct: boolean;
  statusText: string;
}

export type Hit =
  | { kind: 'cell'; p: Pt }
  | { kind: 'program'; idx: number }
  | { kind: 'shake' }
  | { kind: 'menu' }
  | null;

const COLOR_HEX: Record<Color, string> = {
  [Color.Red]: '#e04343',
  [Color.Yellow]: '#ddcf3d',
  [Color.Magenta]: '#cf52cf',
  [Color.Green]: '#43b953',
  [Color.Cyan]: '#3fc4c4',
  [Color.Blue]: '#4a72e8',
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
  private noise: HTMLCanvasElement;

  // layout (CSS pixels)
  private pad = 8;
  private cell = 40;
  private boardX = 0;
  private boardY = 0;
  private menuRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private hpPlayerRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private hpEnemyRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private programRects: Rect[] = [];
  private shakeRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private minionRects: Rect[] = [];
  private statusY = 0;
  private buffY = 0;

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

  reset(grid: TileView[][]): void {
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

  private setGrid(grid: TileView[][]): void {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        this.grid[y][x] = grid[y]?.[x] ? { view: grid[y][x], fx: x, fy: y } : null;
      }
    }
  }

  setSelection(p: Pt | null): void {
    this.selection = p;
  }

  play(events: GameEvent[]): Promise<void> {
    if (!events.length) return Promise.resolve();
    this.queue.push(...events);
    this.enqueued += events.length;
    const target = this.enqueued;
    return new Promise((resolve) => this.waiters.push({ target, resolve }));
  }

  hitTest(x: number, y: number): Hit {
    if (inRect(this.menuRect, x, y)) return { kind: 'menu' };
    for (let i = 0; i < this.programRects.length; i++) {
      if (inRect(this.programRects[i], x, y)) return { kind: 'program', idx: i };
    }
    if (inRect(this.shakeRect, x, y)) return { kind: 'shake' };
    const bx = Math.floor((x - this.boardX) / this.cell);
    const by = Math.floor((y - this.boardY) / this.cell);
    if (bx >= 0 && bx < BOARD_WIDTH && by >= 0 && by < BOARD_HEIGHT && y >= this.boardY) {
      return { kind: 'cell', p: { x: bx, y: by } };
    }
    return null;
  }

  // ---- layout ----

  private layout(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = this.pad;
    this.cell = Math.max(24, Math.floor(Math.min((w - pad * 2) / BOARD_WIDTH, (h - 210) / BOARD_HEIGHT)));
    const boardW = this.cell * BOARD_WIDTH;
    this.boardX = Math.floor((w - boardW) / 2);
    this.boardY = h - this.cell * BOARD_HEIGHT - pad;

    this.menuRect = { x: w - 42, y: 6, w: 36, h: 28 };
    const hpW = (w - pad * 2 - 52) / 2;
    this.hpPlayerRect = { x: pad, y: 10, w: hpW, h: 22 };
    this.hpEnemyRect = { x: pad + hpW + 8, y: 10, w: hpW, h: 22 };
    this.statusY = 38;

    const progY = 58;
    const progH = 54;
    const gap = 4;
    const bw = (w - pad * 2 - gap * 4) / 5;
    this.programRects = [];
    for (let i = 0; i < 4; i++) {
      this.programRects.push({ x: pad + i * (bw + gap), y: progY, w: bw, h: progH });
    }
    this.shakeRect = { x: pad + 4 * (bw + gap), y: progY, w: bw, h: progH };

    const minY = progY + progH + 6;
    const minH = 42;
    const mw = (w - pad * 2 - gap * 3) / 4;
    this.minionRects = [];
    for (let i = 0; i < 4; i++) {
      this.minionRects.push({ x: pad + i * (mw + gap), y: minY, w: mw, h: minH });
    }
    this.buffY = minY + minH + 4;
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
        const r = ev.target === 'player' ? this.hpPlayerRect : this.hpEnemyRect;
        this.floats.push({
          text: `-${ev.amount}`,
          cx: r.x + r.w / 2,
          cy: r.y + r.h + 12,
          born: now,
          color: '#ff7070',
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = '#1b1b22';
    ctx.fillRect(0, 0, w, h);

    const hud = this.getHud();
    if (hud) this.drawHud(hud);
    this.drawBoard(now);

    // message line just above the board
    if (now < this.msgUntil && this.msgText) {
      ctx.fillStyle = '#f0e070';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.msgText, w / 2, this.boardY - 6);
    }

    // floating damage numbers
    this.floats = this.floats.filter((f) => now - f.born < 900);
    for (const f of this.floats) {
      const age = (now - f.born) / 900;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = f.color;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.cx, f.cy + 14 + age * 22);
      ctx.globalAlpha = 1;
    }
  }

  private drawHud(hud: Hud): void {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle';

    // HP bars
    this.drawHpBar(this.hpPlayerRect, 'YOU', hud.hpPlayer, hud.hpPlayerMax, '#58c06a');
    this.drawHpBar(this.hpEnemyRect, 'ENEMY', hud.hpEnemy, hud.hpEnemyMax, '#c05858');

    // menu button
    ctx.fillStyle = '#33333e';
    ctx.fillRect(this.menuRect.x, this.menuRect.y, this.menuRect.w, this.menuRect.h);
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.menuRect.x + 0.5, this.menuRect.y + 0.5, this.menuRect.w - 1, this.menuRect.h - 1);
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('≡', this.menuRect.x + this.menuRect.w / 2, this.menuRect.y + this.menuRect.h / 2 + 1);

    // status line
    ctx.fillStyle = '#9a9aa8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Turn ${hud.turn}   ${hud.statusText}`, this.pad, this.statusY + 6);

    // player programs + shake
    for (let i = 0; i < 4; i++) {
      this.drawUnitBox(this.programRects[i], hud.programs[i], true);
    }
    this.drawShakeBox(this.shakeRect, hud);

    // enemy minions (always-visible charge)
    for (let i = 0; i < 4; i++) {
      this.drawUnitBox(this.minionRects[i], hud.minions[i], false);
    }

    // buffs
    ctx.fillStyle = '#9a9aa8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Buffs — you: +${hud.buffPlayer}   enemy: +${hud.buffEnemy}`, this.pad, this.buffY + 6);
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
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${label} ${hp}/${max}`, r.x + 6, r.y + r.h / 2 + 1);
  }

  private drawUnitBox(r: Rect, u: HudUnit, interactive: boolean): void {
    const ctx = this.ctx;
    const charged = u.charge >= u.cost;
    ctx.fillStyle = '#2c2c36';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = charged ? (interactive && u.ready ? '#ffffff' : '#e0a040') : '#555';
    ctx.lineWidth = charged ? 2 : 1;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

    // binding swatch (color square with shape glyph)
    const sw = 14;
    ctx.fillStyle = COLOR_HEX[u.color];
    ctx.fillRect(r.x + 4, r.y + 4, sw, sw);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    traceShape(ctx, u.shape, r.x + 4 + sw / 2, r.y + 4 + sw / 2, sw * 0.36);
    ctx.fill();

    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(u.label, r.x + 4 + sw + 4, r.y + 11);

    ctx.fillStyle = charged ? '#ffe080' : '#aaa';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${u.charge}/${u.cost}`, r.x + 4, r.y + r.h - 18);

    // charge bar
    const bw = r.w - 8;
    ctx.fillStyle = '#1c1c24';
    ctx.fillRect(r.x + 4, r.y + r.h - 10, bw, 6);
    ctx.fillStyle = charged ? '#f0c040' : '#6080c0';
    ctx.fillRect(r.x + 4, r.y + r.h - 10, bw * Math.min(1, u.charge / u.cost), 6);
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
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SHAKE', r.x + 4, r.y + 11);
    ctx.fillStyle = charged ? '#ffe080' : '#aaa';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${hud.shakeCharge}/${hud.shakeCost}`, r.x + 4, r.y + r.h - 18);
    const bw = r.w - 8;
    ctx.fillStyle = '#1c1c24';
    ctx.fillRect(r.x + 4, r.y + r.h - 10, bw, 6);
    ctx.fillStyle = charged ? '#f0c040' : '#6080c0';
    ctx.fillRect(r.x + 4, r.y + r.h - 10, bw * Math.min(1, hud.shakeCharge / hud.shakeCost), 6);
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
        ctx.fillStyle = `rgba(255,140,30,${a.toFixed(3)})`;
        const pt = this.cur.ev.p;
        for (const d of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
          ctx.fillRect(this.boardX + (pt.x + d.x) * c, this.boardY + (pt.y + d.y) * c, c, c);
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
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.noise, px + 1, py + 1, c - 2, c - 2);
      ctx.imageSmoothingEnabled = true;
    } else {
      ctx.fillStyle = COLOR_HEX[view.color!];
      ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      traceShape(ctx, view.shape!, cx, cy, c * 0.32);
      ctx.fill();
    }

    if (view.special) {
      // ownership: white border = player, black border = enemy (spec 1.11)
      const white = view.special.owner === 'player';
      ctx.strokeStyle = white ? '#ffffff' : '#000000';
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 2.5, py + 2.5, c - 5, c - 5);
      // badge: bomb countdown number, or "+" for a buff, in the owner's color
      const br = c * 0.19;
      const bx = px + br + 4;
      const by = py + br + 4;
      ctx.fillStyle = white ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = white ? '#000000' : '#ffffff';
      ctx.font = `bold ${Math.max(9, Math.floor(br * 1.5))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(view.special.type === 'bomb' ? String(view.special.countdown ?? '?') : '+', bx, by + 0.5);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
