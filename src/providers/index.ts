import type { StatProvider } from "./types.js";
import { mooseProvider } from "./moose/index.js";

/** Registry of available providers, keyed by their `name`. */
const registry: Record<string, StatProvider> = {
  [mooseProvider.name]: mooseProvider,
};

export function getProvider(name: string): StatProvider {
  const provider = registry[name];
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Available: ${Object.keys(registry).join(", ")}`
    );
  }
  return provider;
}

export function listProviders(): { name: string; label: string }[] {
  return Object.values(registry).map((p) => ({ name: p.name, label: p.label }));
}
