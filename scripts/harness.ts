// Shared headless-harness construction glue. Every script builds battles
// through the SAME session-layer entry points the browser uses (Alpha 0.3.0
// §4.1/§5.1), so LINK/ICE resolution, strong-set derivation, and Hacker/Deck
// identity are never re-implemented here.

import { DEFAULT_BATTLE_SETTINGS } from '../src/logic/constants';
import { deckById, hackerById } from '../src/logic/data/content';
import { Game } from '../src/logic/game';
import { createQuickMatchBattle, defaultIdentity } from '../src/logic/session';
import { BattleSettings } from '../src/logic/types';

export const D: BattleSettings = DEFAULT_BATTLE_SETTINGS;

// A headless battle under the explicit DEFAULT Hacker/Deck identity. Under
// Normal LINK (the default) this resolves to BASE_LINK + ADD_LINK for the
// Hacker with the System's ICE mirroring it.
export function newBattle(settings: BattleSettings, seed?: number): Game {
  return createQuickMatchBattle(settings, defaultIdentity(), seed);
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
