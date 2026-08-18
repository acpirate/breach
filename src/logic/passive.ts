// Alpha 0.6.0 §11-§15 — the PASSIVE RUNTIME model: which PASSIVE instances a
// battle has, who supplied each one, which agent each one affects, and in what
// order the triggered ones resolve.
//
// The central rule (§11): a PASSIVE instance is NOT identified by its
// PASSIVE_ID. The same PSV row referenced by a Hacker and by a HOST is TWO
// instances and both apply. Nothing here deduplicates by passive ID, ever.
//
// This module is the single authority for that assembly. Combat (resolve.ts),
// turn structure (game.ts), and presentation all read instances from here
// rather than each walking identity -> content -> passives on their own.

import {
  ResolvedPassive,
  hackerById,
  hostById,
  systemById,
  upgradeById,
} from './data/content';
import { PassiveEffectId } from './data/passives';
import { BattleIdentity, PassiveCause, PassiveSourceKind, Side, opponentOf } from './types';

export interface PassiveInstance {
  passive: ResolvedPassive;
  sourceKind: PassiveSourceKind;
  sourceId: string;
  // The agent that OWNS this instance, or null for a HOST instance. HOST is
  // deliberately unowned rather than "owned by whoever is acting": §13 makes it
  // a first-class third source, and collapsing it into an agent would lose the
  // causal fact that the battlefield did it.
  owner: Side | null;
}

// §47 — the causal record for logs and metrics. Kept separate from the
// resolution owner (the acting/active agent), which travels as the event's
// `side`, so §14's "source and owner can differ" survives serialization.
export function causeOf(inst: PassiveInstance): PassiveCause {
  return { passiveId: inst.passive.id, sourceKind: inst.sourceKind, sourceId: inst.sourceId };
}

// Assembly is pure over (identity, content), so it is memoized per identity
// OBJECT rather than stored on GameState. Storing it on state would put derived
// data in the save envelope and create a second authority for "what is active";
// recomputing it on every damage instance would walk four maps per hit.
const cache = new WeakMap<BattleIdentity, PassiveInstance[]>();

// The complete active instance list for a battle, in a stable canonical order:
// Hacker, System, HOST, then UPGRADEs in acquisition order, each source's own
// PASSIVEs in authored order (§15.4). Continual modifiers are additive so this
// order does not change their arithmetic; it makes attribution and telemetry
// deterministic. START_OF_TURN resolution uses startOfTurnPassives() below,
// which imposes §15's different, trigger-specific order.
export function activePassives(identity: BattleIdentity): PassiveInstance[] {
  const hit = cache.get(identity);
  if (hit) return hit;
  const out: PassiveInstance[] = [];
  const push = (passives: ReadonlyArray<ResolvedPassive>, sourceKind: PassiveSourceKind, sourceId: string, owner: Side | null): void => {
    for (const passive of passives) out.push({ passive, sourceKind, sourceId, owner });
  };
  const hacker = hackerById(identity.hackerId);
  push(hacker.passives, 'HAK', hacker.id, 'player');
  // Alpha 0.7.0 §5.1/§26 — only a SYSTEM opponent contributes identity
  // PASSIVEs. The Alpha 0.7 Boss schema has NO PASSIVES column (§2 forbids
  // inventing one), so a Boss battle simply contributes nothing at this step;
  // §26.2 is explicit that no Boss PASSIVE layer is to be added to populate it.
  if (identity.opponentKind === 'SYS') {
    const system = systemById(identity.opponentId);
    push(system.passives, 'SYS', system.id, 'enemy');
  }
  const host = hostById(identity.hostId);
  push(host.passives, 'HST', host.id, null);
  // §12 — UPGRADEs are ALWAYS Hacker-owned, whatever their agent_scope says
  // about which side the effect lands on.
  for (const upgradeId of identity.upgradeIds) {
    const upgrade = upgradeById(upgradeId);
    push(upgrade.passives, 'UPG', upgrade.id, 'player');
  }
  cache.set(identity, out);
  return out;
}

// §12/§13 — the ONE scope resolver. Does this instance affect `side`?
//
//  - a HOST instance ignores the authored agent_scope entirely and applies to
//    BOTH agents symmetrically (§13);
//  - OWNER means the supplying agent;
//  - ENEMY means the supplying agent's opponent.
export function affects(inst: PassiveInstance, side: Side): boolean {
  if (inst.owner === null) return true;
  return inst.passive.agentScope === 'OWNER' ? inst.owner === side : opponentOf(inst.owner) === side;
}

// Every active instance of one coded effect that affects `side`, in canonical
// order. Duplicates from different sources are all present — that IS the
// stacking rule (§11), not an accident to be filtered.
export function passivesAffecting(
  identity: BattleIdentity,
  effect: PassiveEffectId,
  side: Side,
): PassiveInstance[] {
  return activePassives(identity).filter((i) => i.passive.effectType === effect && affects(i, side));
}

// §15 — the START_OF_TURN resolution order for the agent whose turn is
// beginning:
//   1. HOST passives,
//   2. the ACTIVE agent's identity passives,
//   3. the Hacker's UPGRADE passives in acquisition order (Hacker turns only),
// each source's own list in authored order. Countdown ticking happens after
// everything this returns has fully resolved (§15.5) — that ordering lives in
// game.ts, which owns the turn structure.
export function startOfTurnPassives(identity: BattleIdentity, active: Side): PassiveInstance[] {
  const all = activePassives(identity);
  const triggered = all.filter((i) => i.passive.activation === 'START_OF_TURN');
  const host = triggered.filter((i) => i.sourceKind === 'HST');
  const self = triggered.filter((i) => i.sourceKind === (active === 'player' ? 'HAK' : 'SYS'));
  // §15.3 — UPGRADE triggers belong to the Hacker's turn. activePassives()
  // already emitted them in acquisition order.
  const upgrades = active === 'player' ? triggered.filter((i) => i.sourceKind === 'UPG') : [];
  return [...host, ...self, ...upgrades];
}

// §17/§18 — the summed magnitude of one qualifying color-axis effect for a
// side. Instances stack additively simply by being counted (§11).
export function matchAxisBonus(
  identity: BattleIdentity,
  effect: 'PSV_EXTRA_MATCH_DAMAGE' | 'PSV_EXTRA_MATCH_CHARGE',
  side: Side,
  color: number,
): PassiveInstance[] {
  return passivesAffecting(identity, effect, side).filter((i) => i.passive.color === color);
}

// §19 — total dampening applied to `side`'s qualifying charge streams.
export function chargeDampen(identity: BattleIdentity, side: Side): number {
  return passivesAffecting(identity, 'PSV_CHARGE_DAMPEN', side).reduce((n, i) => n + (i.passive.magnitude ?? 0), 0);
}

// §21 — the non-removable Shield value protecting `side`. Added to live Packet
// Shield; it is not a Packet and cannot be sliced.
export function permanentShield(identity: BattleIdentity, side: Side): number {
  return passivesAffecting(identity, 'PSV_PERM_SHIELD', side).reduce((n, i) => n + (i.passive.magnitude ?? 0), 0);
}

// §22 — how many named area-pattern steps `owner`'s Bombs advance. Each active
// instance is one step; saturation is applied by advanceAreaPattern().
export function biggerBombSteps(identity: BattleIdentity, owner: Side): number {
  return passivesAffecting(identity, 'PSV_BIGGER_BOMB', owner).length;
}
