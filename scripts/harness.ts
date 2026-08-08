// Shared headless-harness construction glue. Every script builds battles
// through the SAME session-layer entry points the browser uses (Alpha 0.3.0
// §4.1/§5.1), so LINK/ICE resolution, strong-set derivation, and Hacker/Deck
// identity are never re-implemented here.

import { DEFAULT_BATTLE_SETTINGS } from '../src/logic/constants';
import { HEADLESS_SYSTEM_ID, deckById, defaultBuild, hackerById, inventoryProgramIds, systemById } from '../src/logic/data/content';
import { Game } from '../src/logic/game';
import { SelectedSystem, createQuickMatchBattle, defaultIdentity } from '../src/logic/session';
import { BattleSettings, BuildOrigin } from '../src/logic/types';

export const D: BattleSettings = DEFAULT_BATTLE_SETTINGS;

// Alpha 0.5.0 §44 — simulations PIN one System rather than rolling per battle.
// Random encounter selection is gameplay/setup behavior; a measurement
// instrument needs a fixed opponent or its output stops being comparable
// between runs. Designer note (2026-08-07): replace with a purpose-built
// TESTER System in a future build.
export function headlessSystem(systemId: string = HEADLESS_SYSTEM_ID): SelectedSystem {
  return { systemId: systemById(systemId).id, source: 'HEADLESS_PINNED' };
}

// Alpha 0.4.0 — the default identity's fixed six-Program inventory and the
// build derived from portfolio order (§5.2/§5.4). Simulations use the default
// build unless a scenario deliberately supplies another.
export function defaultInventory(): string[] {
  const ids = defaultIdentity();
  return inventoryProgramIds(ids.hackerId, ids.deckId);
}

export function defaultActiveBuild(): string[] {
  const ids = defaultIdentity();
  return defaultBuild(ids.hackerId, ids.deckId);
}

// A headless battle under the explicit DEFAULT Hacker/Deck identity against the
// PINNED System. Under Normal LINK (the default) the Hacker resolves to
// BASE_LINK + ADD_LINK; Alpha 0.5.0 §10.1 gives the System its own BASE_ICE
// rather than mirroring that value. `undefined` for `build` or `system` keeps
// the default, so callers can override only the one they care about.
export function newBattle(
  settings: BattleSettings,
  seed?: number,
  build: readonly string[] = defaultActiveBuild(),
  origin: BuildOrigin = 'DEFAULT',
  system: SelectedSystem = headlessSystem(),
): Game {
  return createQuickMatchBattle(settings, defaultIdentity(), system, build, origin, seed);
}

// Settings with Normal LINK OFF and explicit manual maxima — the only way to
// pin arbitrary LINK/ICE values for a simulation sweep (§10.2).
export function manualLink(settings: BattleSettings, hackerLink: number, systemIce: number): BattleSettings {
  return { ...settings, normalLink: false, manualHackerLink: hackerLink, manualSystemIce: systemIce };
}

// The default identity's resolved Deck Function cost — the Deck charge cap.
export function deckCost(): number {
  return deckById(defaultIdentity().deckId).fn.cost;
}

export function defaultHackerLink(): number {
  const ids = defaultIdentity();
  return hackerById(ids.hackerId).baseLink + deckById(ids.deckId).addLink;
}
