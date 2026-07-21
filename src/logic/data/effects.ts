// Alpha 0.1.0 §9/§11.3 — Effect registry. Effects remain CODED TypeScript game
// actions; this registry is the single authoritative lookup from stable
// EFFECT_* ID to that effect's VALIDATION CONTRACT (required/unused parameter
// columns, targeting classification). Behavior execution lives in the pure
// game logic (game.ts castProgram), switched exhaustively on EffectId — the
// registry is what validation and tooling consult, and it rejects duplicate
// registrations.

export type EffectId =
  | 'EFFECT_BOMB'
  | 'EFFECT_BUFF'
  | 'EFFECT_ATTACK'
  | 'EFFECT_DRAIN'
  | 'EFFECT_SHIELD';

// The Function-CSV parameter columns an effect contract can claim.
export type EffectParamName = 'quantity' | 'countdown' | 'areaPattern' | 'magnitude' | 'damage';

export const EFFECT_PARAM_NAMES: ReadonlyArray<EffectParamName> = [
  'quantity',
  'countdown',
  'areaPattern',
  'magnitude',
  'damage',
];

export interface EffectContract {
  id: EffectId;
  required: ReadonlyArray<EffectParamName>;
  // §3.3/§7.3 — a "non-random targeted operation" for payload-order
  // validation. Drain is the only targeted effect in Alpha 0.1.0 (Hacker:
  // player-chosen target; System: the explicit deterministic override).
  targeted: boolean;
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
