// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { anthropicProvider } from './anthropic';
import type { LLMProvider, ProviderId } from './types';

// Registry of shipped LLM providers. Adding a provider is a single entry here
// plus its implementation module — no consumer changes — which is the whole
// point of the {@link LLMProvider} boundary.

/** Every shipped provider, keyed by its stable {@link ProviderId}. */
const PROVIDERS: Record<ProviderId, LLMProvider> = {
  anthropic: anthropicProvider,
};

/** The default provider selected when none is chosen yet. */
export const DEFAULT_PROVIDER_ID: ProviderId = 'anthropic';

/** Returns the provider for {@link id}. */
export function getProvider(id: ProviderId): LLMProvider {
  return PROVIDERS[id];
}

/** Lists all shipped providers, for the settings picker. */
export function listProviders(): readonly LLMProvider[] {
  return Object.values(PROVIDERS);
}

/** Narrows an arbitrary string to a known {@link ProviderId}. */
export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}
