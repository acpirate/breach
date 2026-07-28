// Alpha 0.1.0 §9/§11.3, extended by Alpha 0.3.0 §8 — Effect registry. Effects
// remain CODED TypeScript game actions; this registry is the single
// authoritative lookup from stable EFFECT_* ID to that effect's VALIDATION
// CONTRACT (required/unused parameter columns, the compound `params` tuple
// shape, targeting classification). Behavior execution lives in the pure game
// logic (game.ts castOp), switched exhaustively on EffectId — the registry is
// what validation and tooling consult, and it rejects duplicate registrations.

export type EffectId =
  | 'EFFECT_BOMB'
  | 'EFFECT_BUFF'
  | 'EFFECT_ATTACK'
  | 'EFFECT_DRAIN'
  | 'EFFECT_SHIELD'
  | 'EFFECT_SHAKE';

// The discrete Function-CSV parameter columns an effect contract can claim.
export type EffectParamName = 'quantity' | 'countdown' | 'areaPattern' | 'magnitude' | 'damage';

export const EFFECT_PARAM_NAMES: ReadonlyArray<EffectParamName> = [
  'quantity',
  'countdown',
  'areaPattern',
  'magnitude',
  'damage',
];

// Alpha 0.3.0 §4.6 — one field of an Effect's compound `params` tuple: a small
// integer enum with an inclusive accepted range. The tuple is validated and
// resolved into a typed immutable object at STARTUP; runtime execution never
// parses the raw string (§8.2).
export interface EffectTupleField {
  name: string;
  min: number;
  max: number;
}

export interface EffectContract {
  id: EffectId;
  required: ReadonlyArray<EffectParamName>;
  // §3.3/§7.3 — a "non-random targeted operation" for payload-order
  // validation. Drain is the only targeted effect (Hacker: player-chosen
  // target; System: the explicit deterministic override).
  targeted: boolean;
  // Present iff this Effect requires a compound `params` tuple. Absent means a
  // populated `params` column is unused (a warning, per §9's convention for
  // populated-but-unused parameters).
  tuple?: ReadonlyArray<EffectTupleField>;
}

const registry = new Map<EffectId, EffectContract>();

export function registerEffect(contract: EffectContract): void {
  if (registry.has(contract.id)) {
    throw new Error(`duplicate effect registration: ${contract.id}`);
  }
  registry.set(contract.id, contract);
}

export function effectContract(id: string): EffectContract | null {
  return registry.get(id as EffectId) ?? null;
}

export function isEffectId(s: string): s is EffectId {
  return registry.has(s as EffectId);
}

// §9.1-9.5 contracts. Unused = every param column not listed as required.
registerEffect({ id: 'EFFECT_BOMB', required: ['quantity', 'countdown', 'areaPattern'], targeted: false });
registerEffect({ id: 'EFFECT_BUFF', required: ['quantity', 'magnitude'], targeted: false });
registerEffect({ id: 'EFFECT_ATTACK', required: ['damage'], targeted: false });
registerEffect({ id: 'EFFECT_DRAIN', required: [], targeted: true });
registerEffect({ id: 'EFFECT_SHIELD', required: ['quantity', 'magnitude'], targeted: false });

// Alpha 0.3.0 §8.2 — EFFECT_SHAKE takes exactly four colon-delimited integer
// enum values and no discrete parameter columns:
//   boardComposition:specialGems:matches:cascades
export const SHAKE_TUPLE: ReadonlyArray<EffectTupleField> = [
  { name: 'boardComposition', min: 0, max: 1 },
  { name: 'specialGems', min: 0, max: 1 },
  { name: 'matches', min: 0, max: 1 },
  { name: 'cascades', min: 0, max: 2 },
];

registerEffect({ id: 'EFFECT_SHAKE', required: [], targeted: false, tuple: SHAKE_TUPLE });
