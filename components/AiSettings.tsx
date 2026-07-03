// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { setApiKey, forgetApiKey } from '@/lib/ai/secret';
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isProviderId,
  listProviders,
  LLMError,
  type LLMErrorKind,
  type ProviderId,
} from '@/lib/ai/provider';

/** localStorage key for the (non-sensitive) provider/model picker choice. */
const AI_PREF_STORAGE_KEY = 'meshcore.aiModel';

/** Max tokens for the manual test completion — a trivial round-trip. */
const TEST_MAX_TOKENS = 256;

/** Localized copy for each {@link LLMErrorKind} the test call can surface. */
const ERROR_KEY = {
  auth: 'settings.ai.error.auth',
  rateLimit: 'settings.ai.error.rateLimit',
  billing: 'settings.ai.error.billing',
  badRequest: 'settings.ai.error.badRequest',
  tooLarge: 'settings.ai.error.tooLarge',
  network: 'settings.ai.error.network',
  server: 'settings.ai.error.server',
  aborted: 'settings.ai.error.unknown',
  unknown: 'settings.ai.error.unknown',
} as const satisfies Record<LLMErrorKind, string>;

/** The provider/model the picker last selected. */
interface AiPref {
  providerId: ProviderId;
  model: string;
}

/** Reads the persisted picker choice, falling back to the default provider. */
function loadAiPref(): AiPref {
  const fallback: AiPref = {
    providerId: DEFAULT_PROVIDER_ID,
    model: getProvider(DEFAULT_PROVIDER_ID).models[0].id,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(AI_PREF_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AiPref>;
    const providerId =
      typeof parsed.providerId === 'string' && isProviderId(parsed.providerId)
        ? parsed.providerId
        : fallback.providerId;
    const models = getProvider(providerId).models;
    const model = models.some((m) => m.id === parsed.model)
      ? (parsed.model as string)
      : models[0].id;
    return { providerId, model };
  } catch {
    return fallback;
  }
}

/** Persists the picker choice (never a secret) to localStorage. */
function saveAiPref(pref: AiPref): void {
  try {
    window.localStorage.setItem(AI_PREF_STORAGE_KEY, JSON.stringify(pref));
  } catch {}
}

/**
 * The AI settings card body: bring-your-own LLM key entry, provider/model
 * picker, and a manual test call. Rendered inside the Settings page's AI card.
 * The key value is never held in the store — only the masked
 * {@link MeshState.aiKeyStatus} indicator is — and only ever leaves the tab via
 * the provider's request to its official origin.
 */
export function AiSettingsBody() {
  const { t } = useTranslation();
  const keyStatus = useMeshStore((s) => s.aiKeyStatus);
  const connected = useMeshStore((s) => s.status === 'connected');

  const [pref, setPref] = useState<AiPref>(loadAiPref);
  const [keyInput, setKeyInput] = useState('');
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);

  const provider = getProvider(pref.providerId);
  const canRemember = connected;

  const pickProvider = (id: string) => {
    if (!isProviderId(id)) return;
    const next: AiPref = {
      providerId: id,
      model: getProvider(id).models[0].id,
    };
    setPref(next);
    saveAiPref(next);
  };

  const pickModel = (model: string) => {
    const next: AiPref = { ...pref, model };
    setPref(next);
    saveAiPref(next);
  };

  const save = async () => {
    const value = keyInput.trim();
    if (!value || saving) return;
    setSaving(true);
    await setApiKey(value, remember && canRemember);
    setSaving(false);
    // Drop the plaintext from the field as soon as it's handed off — the store
    // status indicator reflects that a key is now loaded.
    setKeyInput('');
  };

  const forget = async () => {
    await forgetApiKey();
    setKeyInput('');
  };

  const statusKey =
    keyStatus === 'persisted'
      ? 'settings.ai.statusPersisted'
      : keyStatus === 'memory'
        ? 'settings.ai.statusMemory'
        : 'settings.ai.statusNone';

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-xs text-(--text2)'>{t('settings.ai.hint')}</p>

      <div className='flex gap-3'>
        <label className='flex flex-1 flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('settings.ai.provider')}</span>
          <select
            value={pref.providerId}
            onChange={(e) => pickProvider(e.target.value)}
            className='min-w-0 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent)'
          >
            {listProviders().map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex flex-1 flex-col gap-1 text-xs'>
          <span className='text-(--text2)'>{t('settings.ai.model')}</span>
          <select
            value={pref.model}
            onChange={(e) => pickModel(e.target.value)}
            className='min-w-0 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent)'
          >
            {provider.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-(--text2)'>{t('settings.ai.apiKey')}</span>
        <input
          type='password'
          autoComplete='off'
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={t('settings.ai.apiKeyPlaceholder')}
          aria-label={t('settings.ai.apiKey')}
          className='min-w-0 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 font-mono text-xs text-(--text) outline-none focus:border-(--accent)'
        />
      </label>

      <a
        href={provider.apiKeyUrl}
        target='_blank'
        rel='noreferrer'
        className='-mt-1 self-start text-[11px] text-(--accent) hover:underline'
      >
        {t('settings.ai.apiKeyLink', { provider: provider.label })}
      </a>

      <button
        role='switch'
        aria-checked={remember}
        disabled={!canRemember}
        onClick={() => setRemember((v) => !v)}
        className='flex w-full items-center justify-between gap-2 text-left text-xs text-(--text) disabled:cursor-not-allowed disabled:opacity-50'
      >
        <span className='flex flex-col'>
          <span>{t('settings.ai.remember')}</span>
          <span className='text-[11px] text-(--text2)'>
            {t('settings.ai.rememberHint')}
          </span>
        </span>
        <span
          className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
          style={{ background: remember ? 'var(--accent)' : 'var(--border)' }}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
              remember ? 'left-3.5' : 'left-0.5'
            }`}
          />
        </span>
      </button>

      <div className='flex items-center justify-between gap-2'>
        <span className='text-[11px] text-(--text2)'>{t(statusKey)}</span>
        <div className='flex shrink-0 gap-2'>
          {keyStatus !== 'none' && (
            <button
              onClick={() => void forget()}
              className='rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text2) hover:text-(--text)'
            >
              {t('settings.ai.forget')}
            </button>
          )}
          <button
            onClick={() => void save()}
            disabled={keyInput.trim() === '' || saving}
            className='rounded-md bg-(--accent) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent)'
          >
            {t('settings.ai.save')}
          </button>
        </div>
      </div>

      <p className='rounded-md border border-(--border) px-2.5 py-2 text-[11px] text-(--text2)'>
        {t('settings.ai.warning')}
      </p>

      <AiTestChat providerId={pref.providerId} model={pref.model} />
    </div>
  );
}

/**
 * A minimal test-call panel: streams a trivial prompt to the selected provider
 * and shows the response or a friendly, localized error, confirming the key and
 * connectivity without wiring any autonomous behavior.
 */
function AiTestChat({
  providerId,
  model,
}: {
  providerId: ProviderId;
  model: string;
}) {
  const { t } = useTranslation();
  const hasKey = useMeshStore((s) => s.aiKeyStatus !== 'none');

  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [errorKind, setErrorKind] = useState<LLMErrorKind | null>(null);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending || !hasKey) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setResponse('');
    setErrorKind(null);
    try {
      const stream = getProvider(providerId).stream(
        {
          model,
          messages: [{ role: 'user', content: text }],
          maxTokens: TEST_MAX_TOKENS,
        },
        controller.signal,
      );
      for await (const ev of stream) {
        if (ev.type === 'text') {
          setResponse((prev) => prev + ev.delta);
        } else if (ev.type === 'error') {
          // A user-initiated cancel is not an error worth surfacing.
          if (ev.error.kind !== 'aborted') setErrorKind(ev.error.kind);
          break;
        } else if (ev.type === 'done') {
          break;
        }
      }
    } catch (err) {
      setErrorKind(err instanceof LLMError ? err.kind : 'unknown');
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <div className='flex flex-col gap-2 border-t border-(--border) pt-3'>
      <span className='text-xs font-semibold text-(--text)'>
        {t('settings.ai.test')}
      </span>
      <p className='text-[11px] text-(--text2)'>{t('settings.ai.testHint')}</p>
      <div className='flex gap-2'>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          disabled={!hasKey || sending}
          placeholder={t('settings.ai.testPlaceholder')}
          aria-label={t('settings.ai.test')}
          className='min-w-0 flex-1 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-50'
        />
        {sending ? (
          <button
            onClick={cancel}
            className='shrink-0 rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text2) hover:text-(--text)'
          >
            {t('common.cancel')}
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!hasKey || prompt.trim() === ''}
            className='shrink-0 rounded-md bg-(--accent) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent)'
          >
            {t('settings.ai.send')}
          </button>
        )}
      </div>
      {errorKind && (
        <p className='rounded-md border border-(--red) px-2.5 py-2 text-xs text-(--red)'>
          {t(ERROR_KEY[errorKind])}
        </p>
      )}
      {response && (
        <p className='rounded-md bg-(--surface) px-2.5 py-2 text-xs whitespace-pre-wrap text-(--text)'>
          {response}
        </p>
      )}
    </div>
  );
}
