// Alpha 0.1.0 §8 — Area-Pattern Registry. Enumerated stable IDs mapped to
// EXPLICIT coordinate sets (stored directly, never derived from catalog
// numbers; patterns 4-7 from the design notes are deliberately absent).
// Coordinate convention: (0,0) = source/detonating tile, +x right, +y down.
// Out-of-board coordinates are clipped by the consumer at resolution time.

export type AreaPatternId =
  | 'AREA_SELF'
  | 'AREA_CARDINAL_1'
  | 'AREA_SQUARE_3X3'
  | 'AREA_SQUARE_3X3_CARDINAL_2';

export interface AreaOffset {
  x: number;
  y: number;
}

// §8.1 catalog 0 — the source tile only.
const AREA_SELF: ReadonlyArray<AreaOffset> = [{ x: 0, y: 0 }];

// §8.2 catalog 1 — AREA_SELF plus the four cardinal neighbors.
const AREA_CARDINAL_1: ReadonlyArray<AreaOffset> = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

// §8.3 catalog 2 — every coordinate in the centered 3x3 square.
const AREA_SQUARE_3X3: ReadonlyArray<AreaOffset> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

// §8.4 catalog 3 — the 3x3 square plus one tile in each cardinal direction at
// distance 2 (13 cells at board center; NO distance-2 diagonals).
const AREA_SQUARE_3X3_CARDINAL_2: ReadonlyArray<AreaOffset> = [
  ...AREA_SQUARE_3X3,
  { x: 0, y: -2 },
  { x: 2, y: 0 },
  { x: 0, y: 2 },
  { x: -2, y: 0 },
];

export const AREA_PATTERNS: Record<AreaPatternId, ReadonlyArray<AreaOffset>> = {
  AREA_SELF,
  AREA_CARDINAL_1,
  AREA_SQUARE_3X3,
  AREA_SQUARE_3X3_CARDINAL_2,
};

export function isAreaPatternId(s: string): s is AreaPatternId {
  return Object.prototype.hasOwnProperty.call(AREA_PATTERNS, s);
}
