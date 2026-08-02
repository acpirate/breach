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
  | 'EFFECT_SHAKE'
  | 'EFFECT_LINESLICE';

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

// Alpha 0.4.0 §12 — what a targeted operation asks the player to pick.
//   'unit'   — an opposing Program slot (Drain).
//   'packet' — one Datastream coordinate (LineSlice / targeted Bomb).
export type TargetKind = 'unit' | 'packet';

export interface EffectContract {
  id: EffectId;
  required: ReadonlyArray<EffectParamName>;
  // Alpha 0.4.0 §12/§14.2 — optional discrete parameter columns. Listed
  // columns are accepted when populated (and validated) but never required;
  // absence is meaningful rather than an error. `countdown` is optional for
  // EFFECT_BOMB because blank/zero selects immediate resolution (§14.3).
  optional?: ReadonlyArray<EffectParamName>;
  // §3.3/§7.3 — a "non-random targeted operation" for payload-order
  // validation. Alpha 0.3 had exactly one statically targeted Effect (Drain).
  // Alpha 0.4 adds Effects whose targeting is selected by their `params`
  // tuple, so `targeted` here means "ALWAYS targeted"; per-row targeting is
  // resolved into PlanOp.target at load time and is what validation and
  // runtime actually consume.
  targeted: boolean;
  // The kind of target this Effect asks for when it is targeted at all.
  targetKind?: TargetKind;
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

// Alpha 0.4.0 §14.2 — EFFECT_BOMB takes exactly three colon-delimited integer
// enum values:  targeting:dealDamage:gainCharge
// Every live Bomb row must supply all three; trailing defaults are never
// inferred from the old hardcoded behavior (§4.8).
export const BOMB_TUPLE: ReadonlyArray<EffectTupleField> = [
  { name: 'targeting', min: 0, max: 1 },
  { name: 'dealDamage', min: 0, max: 1 },
  { name: 'gainCharge', min: 0, max: 1 },
];

// Alpha 0.4.0 §13.2 — EFFECT_LINESLICE takes exactly five:
//   dimension:targeting:specialRetention:dealDamage:gainCharge
export const LINESLICE_TUPLE: ReadonlyArray<EffectTupleField> = [
  { name: 'dimension', min: 0, max: 1 },
  { name: 'targeting', min: 0, max: 1 },
  { name: 'specialRetention', min: 0, max: 2 },
  { name: 'dealDamage', min: 0, max: 1 },
  { name: 'gainCharge', min: 0, max: 1 },
];

// §9.1-9.5 contracts. Unused = every param column not listed as required or
// optional.
// §14.3 — `countdown` is OPTIONAL for Bombs: a positive integer deploys the
// countdown overlay, blank/zero resolves the blast immediately.
registerEffect({
  id: 'EFFECT_BOMB',
  required: ['quantity', 'areaPattern'],
  optional: ['countdown'],
  targeted: false,
  targetKind: 'packet',
  tuple: BOMB_TUPLE,
});
registerEffect({ id: 'EFFECT_BUFF', required: ['quantity', 'magnitude'], targeted: false });
registerEffect({ id: 'EFFECT_ATTACK', required: ['damage'], targeted: false });
registerEffect({ id: 'EFFECT_DRAIN', required: [], targeted: true, targetKind: 'unit' });
registerEffect({ id: 'EFFECT_SHIELD', required: ['quantity', 'magnitude'], targeted: false });
// §13.1 — registered through the same typed-contract architecture as
// EFFECT_SHAKE. No areaPattern: the line is derived from the resolved target.
registerEffect({
  id: 'EFFECT_LINESLICE',
  required: ['quantity'],
  targeted: false,
  targetKind: 'packet',
  tuple: LINESLICE_TUPLE,
});

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
