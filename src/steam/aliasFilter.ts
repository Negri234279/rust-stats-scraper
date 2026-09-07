import type { PlayerInput } from "../types.js";

/** Prefix that marks the players we care about. */
export const ALIAS_PREFIX = "--";

/**
 * Keep only entries whose alias starts with `--` (e.g. "--User"), dropping
 * everything else (e.g. "**Pelos"). Trims surrounding whitespace before testing.
 */
export function filterAliases(
  players: PlayerInput[],
  prefix: string = ALIAS_PREFIX
): PlayerInput[] {
  return players.filter((p) => p.alias?.trim().startsWith(prefix));
}
