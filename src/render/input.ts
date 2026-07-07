// Pointer input: tap-select / tap-adjacent-swap and press-and-drag swap for
// the board, plus taps on program/shake/menu UI. Two separate channels —
// board gestures never fire abilities and vice versa (spec 1.12).

import { BOARD_HEIGHT, BOARD_WIDTH } from '../logic/constants';
import { Pt } from '../logic/types';
import { Hit, View } from './view';

export interface InputHandlers {
  onTap(p: Pt): void;
  onDrag(a: Pt, b: Pt): void;
  onProgram(i: number): void;
  onShake(): void;
  onMenu(): void;
}

export function attachInput(canvas: HTMLCanvasElement, view: View, h: InputHandlers): void {
  let downPos: { x: number; y: number } | null = null;
  let downHit: Hit = null;
  let dragged = false;

  const pos = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    downPos = pos(e);
    downHit = view.hitTest(downPos.x, downPos.y);
    dragged = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!downPos || dragged || downHit?.kind !== 'cell') return;
    const p = pos(e);
    const dx = p.x - downPos.x;
    const dy = p.y - downPos.y;
    const th = view.cellSize * 0.4;
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    const from = downHit.p;
    const to = { x: from.x + dir.x, y: from.y + dir.y };
    dragged = true;
    if (to.x >= 0 && to.x < BOARD_WIDTH && to.y >= 0 && to.y < BOARD_HEIGHT) {
      h.onDrag(from, to);
    }
    // drag toward a non-adjacent/out-of-bounds target: no swap, no error
  });

  const up = (e: PointerEvent): void => {
    if (!downPos) return;
    if (!dragged) {
      const p = pos(e);
      const hit = view.hitTest(p.x, p.y);
      if (hit && downHit && hit.kind === downHit.kind) {
        switch (hit.kind) {
          case 'cell':
            if (downHit.kind === 'cell' && hit.p.x === downHit.p.x && hit.p.y === downHit.p.y) h.onTap(hit.p);
            break;
          case 'program':
            if (downHit.kind === 'program' && hit.idx === downHit.idx) h.onProgram(hit.idx);
            break;
          case 'shake':
            h.onShake();
            break;
          case 'menu':
            h.onMenu();
            break;
        }
      }
    }
    downPos = null;
    downHit = null;
    dragged = false;
  };

  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => {
    downPos = null;
    downHit = null;
    dragged = false;
  });
}
