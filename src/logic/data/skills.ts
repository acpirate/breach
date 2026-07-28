// Alpha 0.3.0 §6.1 — Hacker SKILL-EFFECT registry. Hacker Skills are PASSIVE
// CODED behavior referenced by the selected Hacker: the dataset chooses a coded
// `skill_effect` and supplies validated parameters. They are not activated
// Functions, not charge-owning entities, not Deck Functions, and NOT a
// generalized event-rule language (§6.1 explicitly rules that out).
//
// This registry mirrors the Effect registry's shape: a stable ID -> validation
// contract lookup that validation and tooling consult. Trigger behavior lives
// in the combat layer (resolve.ts), switched exhaustively on SkillEffectId.

export type SkillEffectId = 'SKL_EXTRA_MATCH_DAMAGE' | 'SKL_EXTRA_MATCH_CHARGE';

// The typed token kinds a Skill parameter tuple can require.
export type SkillParamKind = 'color' | 'positiveInt';

export interface SkillContract {
  id: SkillEffectId;
  // Ordered typed parameter tuple. BOTH current Skill effects take the same
  // <color>:<positive integer magnitude> shape (§6.4/§6.5), which is why the
  // resolved model can expose named `color`/`magnitude` fields. A future Skill
  // with a different tuple shape must extend the resolved model rather than
  // overload these names.
  params: ReadonlyArray<SkillParamKind>;
}

const registry = new Map<SkillEffectId, SkillContract>();

export function registerSkillEffect(contract: SkillContract): void {
  if (registry.has(contract.id)) {
    throw new Error(`duplicate skill-effect registration: ${contract.id}`);
  }
  registry.set(contract.id, contract);
}

export function skillContract(id: string): SkillContract | null {
  return registry.get(id as SkillEffectId) ?? null;
}

export function isSkillEffectId(s: string): s is SkillEffectId {
  return registry.has(s as SkillEffectId);
}

export function skillEffectIds(): SkillEffectId[] {
  return [...registry.keys()];
}

// §6.4 — extra raw Skill damage once per qualifying color-axis Sync event.
registerSkillEffect({ id: 'SKL_EXTRA_MATCH_DAMAGE', params: ['color', 'positiveInt'] });
// §6.5 — increases the normal charge payout of each qualifying Sync event.
registerSkillEffect({ id: 'SKL_EXTRA_MATCH_CHARGE', params: ['color', 'positiveInt'] });
