// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  type ProviderId,
} from '@/lib/ai/provider';

/**
 * The provider/model the settings picker last selected. Non-sensitive (never
 * the API key) and persisted per-radio in the encrypted preferences blob.
 */
export interface AiPref {
  providerId: ProviderId;
  model: string;
}

/** The default picker choice: the default provider's first model. */
export const DEFAULT_AI_PREF: AiPref = {
  providerId: DEFAULT_PROVIDER_ID,
  model: getProvider(DEFAULT_PROVIDER_ID).models[0].id,
};

/**
 * Normalizes an arbitrary (persisted or corrupt) value into a valid
 * {@link AiPref}, dropping an unknown provider or a model the provider doesn't
 * offer back to the defaults so it can never reach the provider registry.
 */
export function normalizeAiPref(raw: unknown): AiPref {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_AI_PREF;
  const parsed = raw as Partial<AiPref>;
  const providerId =
    typeof parsed.providerId === 'string' && isProviderId(parsed.providerId)
      ? parsed.providerId
      : DEFAULT_AI_PREF.providerId;
  const models = getProvider(providerId).models;
  const model = models.some((m) => m.id === parsed.model)
    ? (parsed.model as string)
    : models[0].id;
  return { providerId, model };
}
