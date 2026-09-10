// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { setApiKey, forgetApiKey } from '@/lib/ai/secret';
import { type AiPref } from '@/lib/ai/pref';
import { Select } from './Select';
import { Switch } from './Switch';
import {
  getProvider,
  isProviderId,
  listProviders,
  LLMError,
  type LLMErrorKind,
  type ProviderId,
} from '@/lib/ai/provider';

const TEST_MAX_TOKENS = 256;

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

  // The provider/model picker choice is a per-radio preference, persisted in
  // the encrypted preferences blob via the store (never localStorage).
  const pref = useMeshStore((s) => s.aiPref);
  const setAiPref = useMeshStore((s) => s.setAiPref);
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
    setAiPref(next);
  };

  const pickModel = (model: string) => {
    setAiPref({ ...pref, model });
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
      <p className='text-xs text-text2'>{t('settings.ai.hint')}</p>

      <div className='flex gap-3'>
        <div className='flex-1'>
          <Select
            label={t('settings.ai.provider')}
            value={pref.providerId}
            onChange={pickProvider}
            options={listProviders().map((p) => ({
              value: p.id,
              label: p.label,
            }))}
          />
        </div>
        <div className='flex-1'>
          <Select
            label={t('settings.ai.model')}
            value={pref.model}
            onChange={pickModel}
            options={provider.models.map((m) => ({
              value: m.id,
              label: m.label,
            }))}
          />
        </div>
      </div>

      <label className='flex flex-col gap-1 text-xs'>
        <span className='text-text2'>{t('settings.ai.apiKey')}</span>
        <input
          type='password'
          autoComplete='off'
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={t('settings.ai.apiKeyPlaceholder')}
          aria-label={t('settings.ai.apiKey')}
          className='min-w-0 rounded-md border border-border-control bg-surface px-2 py-1 font-mono text-xs text-text outline-none focus:border-accent'
        />
      </label>

      <a
        href={provider.apiKeyUrl}
        target='_blank'
        rel='noreferrer'
        className='-mt-1 self-start text-[11px] text-accent hover:underline'
      >
        {t('settings.ai.apiKeyLink', { provider: provider.label })}
      </a>

      <Switch
        checked={remember}
        onChange={setRemember}
        disabled={!canRemember}
        label={t('settings.ai.remember')}
        description={t('settings.ai.rememberHint')}
      />

      <div className='flex items-center justify-between gap-2'>
        <span className='text-[11px] text-text2'>{t(statusKey)}</span>
        <div className='flex shrink-0 gap-2'>
          {keyStatus !== 'none' && (
            <button
              onClick={() => void forget()}
              className='rounded-md border border-border-control px-3 py-1.5 text-xs text-text2 hover:text-text'
            >
              {t('settings.ai.forget')}
            </button>
          )}
          <button
            onClick={() => void save()}
            disabled={keyInput.trim() === '' || saving}
            className='rounded-md bg-accent-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.ai.save')}
          </button>
        </div>
      </div>

      <p className='rounded-md border border-border px-2.5 py-2 text-[11px] text-text2'>
        {t('settings.ai.warning')}
      </p>

      <AiTestChat providerId={pref.providerId} model={pref.model} />
    </div>
  );
}

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
    <div className='flex flex-col gap-2 border-t border-border pt-3'>
      <span className='text-xs font-semibold text-text'>
        {t('settings.ai.test')}
      </span>
      <p className='text-[11px] text-text2'>{t('settings.ai.testHint')}</p>
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
          className='min-w-0 flex-1 rounded-md border border-border-control bg-surface px-2 py-1 text-xs text-text outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50'
        />
        {sending ? (
          <button
            onClick={cancel}
            className='shrink-0 rounded-md border border-border-control px-3 py-1.5 text-xs text-text2 hover:text-text'
          >
            {t('common.cancel')}
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!hasKey || prompt.trim() === ''}
            className='shrink-0 rounded-md bg-accent-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent-solid'
          >
            {t('settings.ai.send')}
          </button>
        )}
      </div>
      {errorKind && (
        <p className='rounded-md border border-red px-2.5 py-2 text-xs text-red'>
          {t(ERROR_KEY[errorKind])}
        </p>
      )}
      {response && (
        <p className='rounded-md bg-surface px-2.5 py-2 text-xs whitespace-pre-wrap text-text'>
          {response}
        </p>
      )}
    </div>
  );
}
