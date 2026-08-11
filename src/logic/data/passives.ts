// Alpha 0.6.0 §5/§53 — PASSIVE-EFFECT registry. PASSIVEs are the unified
// passive layer that replaces the Alpha 0.3-0.5 Hacker-only Skill mechanic:
// Hackers, Systems, HOSTs, and UPGRADEs all reference rows from ONE external
// `PSV` dataset, the dataset chooses a coded `passive_effect`, and this registry
// is the single stable-ID -> validation-contract lookup that validation and
// tooling consult. Trigger and modifier behavior lives in the combat layer,
// switched exhaustively on PassiveEffectId.
//
// This is deliberately NOT a generalized trigger/rule/expression language
// (§2 rules that out explicitly): every contract below is a fixed typed tuple
// plus a fixed activation, and adding a passive kind means adding a registered
// contract and a coded branch, not authoring a script.

export type PassiveEffectId =
  | 'PSV_EXTRA_MATCH_DAMAGE'
  | 'PSV_EXTRA_MATCH_CHARGE'
  | 'PSV_CHARGE_DAMPEN'
  | 'PSV_FUNCTION_DAMAGE_INCREASE'
  | 'PSV_PERM_SHIELD'
  | 'PSV_BIGGER_BOMB'
  | 'PSV_CARRIER';

// The typed token kinds a PASSIVE parameter tuple can require.
//   'color'       — a canonical color enum token (RED/YEL/MAG/GRE/CYA/BLU).
//   'scope'       — the ALL wildcard. Its own kind rather than a color that
//                   happens to spell ALL, so "which axis" and "how broad" can
//                   never be confused by validation or by a reader.
//   'positiveInt' — a magnitude >= 1.
export type PassiveParamKind = 'color' | 'scope' | 'positiveInt';

// §5.3 — the complete authored activation vocabulary. Alpha 0.6 adds no others.
export type PassiveActivation = 'CONTINUAL' | 'START_OF_TURN';

// §5.4 — the authored agent scope. Meaningful for HAK/SYS/UPG sources; IGNORED
// for HST sources, whose semantics are defined by §13 instead.
export type AgentScope = 'OWNER' | 'ENEMY';

export const ALL_SCOPE_TOKEN = 'ALL';

export interface PassiveContract {
  id: PassiveEffectId;
  // Ordered typed parameter tuple. An empty tuple means the `params` column
  // must be BLANK — a populated one is an authoring error, not a silent ignore.
  params: ReadonlyArray<PassiveParamKind>;
  // The ONE activation this effect supports. A continual modifier authored as
  // START_OF_TURN (or the reverse) is a content error, so the pairing is part
  // of the contract rather than a free combination (§52).
  activation: PassiveActivation;
  // Whether `function_payload` is required or forbidden for this effect (§52 —
  // "required/forbidden function_payload combinations by current passive type").
  payload: 'required' | 'forbidden';
}

const registry = new Map<PassiveEffectId, PassiveContract>();

export function registerPassiveEffect(contract: PassiveContract): void {
  if (registry.has(contract.id)) {
    throw new Error(`duplicate passive-effect registration: ${contract.id}`);
  }
  registry.set(contract.id, contract);
}

export function passiveContract(id: string): PassiveContract | null {
  return registry.get(id as PassiveEffectId) ?? null;
}

export function isPassiveEffectId(s: string): s is PassiveEffectId {
  return registry.has(s as PassiveEffectId);
}

export function passiveEffectIds(): PassiveEffectId[] {
  return [...registry.keys()];
}

export function isPassiveActivation(s: string): s is PassiveActivation {
  return s === 'CONTINUAL' || s === 'START_OF_TURN';
}

export function isAgentScope(s: string): s is AgentScope {
  return s === 'OWNER' || s === 'ENEMY';
}

// §17 — the migrated Hacker Red behavior: extra raw Sync damage once per
// qualifying color-axis Sync event. Mechanically identical to the retired
// SKL_EXTRA_MATCH_DAMAGE; only the authority moved.
registerPassiveEffect({
  id: 'PSV_EXTRA_MATCH_DAMAGE',
  params: ['color', 'positiveInt'],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §18 — increases the qualifying Sync's charge STREAM before routing. Migrated
// from SKL_EXTRA_MATCH_CHARGE unchanged.
registerPassiveEffect({
  id: 'PSV_EXTRA_MATCH_CHARGE',
  params: ['color', 'positiveInt'],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §19 — reduces qualifying Sync charge streams. `ALL` covers every stream.
registerPassiveEffect({
  id: 'PSV_CHARGE_DAMPEN',
  params: ['scope', 'positiveInt'],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §20 — adds to raw Function-originated direct damage before defensive handling.
registerPassiveEffect({
  id: 'PSV_FUNCTION_DAMAGE_INCREASE',
  params: ['scope', 'positiveInt'],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §21 — non-removable Shield value, stacked with Packet Shield.
registerPassiveEffect({
  id: 'PSV_PERM_SHIELD',
  params: ['scope', 'positiveInt'],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §22 — advances every qualifying EFFECT_BOMB one named area-pattern step.
// Takes no parameters: the step count is the number of active instances.
registerPassiveEffect({
  id: 'PSV_BIGGER_BOMB',
  params: [],
  activation: 'CONTINUAL',
  payload: 'forbidden',
});
// §23 — invokes its authored `function_payload` at the start of the relevant
// turn, paying NO Function cost (§16).
registerPassiveEffect({
  id: 'PSV_CARRIER',
  params: [],
  activation: 'START_OF_TURN',
  payload: 'required',
});
