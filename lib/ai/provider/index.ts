// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// Public surface of the in-browser LLM provider layer (task 6.3). Consumers
// (the settings test chat now; the automation loop in task 6.4) import from
// here, never from a concrete provider module.

export {
  LLMError,
  type LLMErrorKind,
  type LLMContentBlock,
  type LLMMessage,
  type LLMModel,
  type LLMProvider,
  type LLMRequest,
  type LLMStreamEvent,
  type ProviderId,
  type TokenUsage,
  type ToolSchema,
} from './types';
export {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  listProviders,
} from './registry';
