// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import type { RepeaterAutoLogin } from '@/hooks/useRepeaterAutoLogin';
import type { Contact, LoginKind } from '@/types/meshcore';

/** Props for {@link RepeaterLoginGate}. */
export interface RepeaterLoginGateProps {
  /** The node being signed in to; its name is what the failure copy names. */
  contact: Contact;
  /** Whether this node is a room server, which labels its two passwords
   * differently from a repeater's. */
  isRoom: boolean;
  /** True when the store holds a login this gate did not start — a view
   * remounted mid-handshake. */
  pending: boolean;
  /** The sign-in cycle this gate reports on and drives. */
  auto: RepeaterAutoLogin;
}

/**
 * What fills the node view while it is signed out: the credential probe, a
 * sign-in cycle's progress, the failure a remembered credential hit along
 * with the actions that retry it, and the manual password form.
 */
export function RepeaterLoginGate({
  contact,
  isRoom,
  pending,
  auto,
}: RepeaterLoginGateProps) {
  const { t } = useTranslation();
  const { checking, credAccess, attempt, attempts, failure, retry, signIn } =
    auto;
  // Whether the user opened the manual form behind the failure. Sticky for the
  // visit, so a retry that fails again doesn't fold the form they just opened.
  const [manual, setManual] = useState(false);
  const formId = useId();

  if (checking) {
    return (
      <p className='text-sm text-text2'>{t('repeaterAdmin.login.checking')}</p>
    );
  }

  if (attempt > 0) {
    return (
      <p className='text-sm text-text2'>
        {attempts > 1
          ? t('repeaterAdmin.login.attempt', { attempt, total: attempts })
          : t('repeaterAdmin.login.loggingIn')}
      </p>
    );
  }

  const name = contact.name || contact.pubkeyPrefix.slice(0, 8);
  // A *remembered* credential that failed is the whole point of this state: it
  // exists and is still stored, so the user gets it replayed on a click rather
  // than a blank form that has silently forgotten it. `credAccess` is null for
  // a password merely typed into the form, which is what keeps this panel —
  // and its "the password is probably fine" copy — off a wrong one the user
  // just entered. That case keeps the form, as it did before.
  const stranded = failure !== null && credAccess !== null;

  return (
    <div className='w-full max-w-md space-y-4'>
      {stranded && (
        <div className='space-y-3 rounded-md border border-border bg-surface2 p-3'>
          <div className='flex items-start gap-2'>
            <AlertTriangle size={16} className='mt-0.5 shrink-0 text-amber' />
            <div className='space-y-1'>
              <p className='text-sm font-medium text-text'>
                {t(
                  failure === 'timeout'
                    ? 'repeaterAdmin.login.timedOutTitle'
                    : 'repeaterAdmin.login.failedTitle',
                  { name },
                )}
              </p>
              <p className='text-xs text-text2'>
                {t(
                  failure === 'timeout'
                    ? 'repeaterAdmin.login.timedOutBody'
                    : 'repeaterAdmin.login.failedBody',
                )}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            <button
              type='button'
              onClick={() => retry(false)}
              className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90'
            >
              {t('repeaterAdmin.login.retry')}
            </button>
            <button
              type='button'
              onClick={() => retry(true)}
              className='rounded-md border border-border-control px-3 py-1.5 text-sm text-text hover:bg-surface'
            >
              {t('repeaterAdmin.login.retryFlood')}
            </button>
          </div>
          <button
            type='button'
            onClick={() => setManual((v) => !v)}
            aria-expanded={manual}
            // Only while the form is actually rendered: `aria-controls` naming
            // an element that isn't in the tree is a dangling reference, which
            // assistive tech reports as a broken relationship rather than a
            // collapsed one. `aria-expanded` alone carries the collapsed state.
            aria-controls={manual ? formId : undefined}
            className='flex items-center gap-1 text-xs text-text2 hover:text-text'
          >
            <ChevronDown
              size={14}
              className={manual ? 'rotate-180' : undefined}
            />
            {t('repeaterAdmin.login.differentPassword')}
          </button>
        </div>
      )}

      {(!stranded || manual) && (
        <LoginForm
          id={formId}
          pending={pending}
          isRoom={isRoom}
          defaultKind={credAccess ?? 'admin'}
          onSubmit={signIn}
        />
      )}
    </div>
  );
}

// The password is never auto-filled: it stays in local state and is persisted
// (encrypted, per-radio) only when the user opts in via the remember toggle.
// A room offers the same two choices, but its non-admin password is the room
// password, which grants posting — the server reports the role it actually
// granted, so the label here is only about which password is being entered.
function LoginForm({
  id,
  pending,
  isRoom,
  defaultKind,
  onSubmit,
}: {
  id: string;
  pending: boolean;
  isRoom: boolean;
  defaultKind: LoginKind;
  onSubmit: (password: string, kind: LoginKind, remember: boolean) => void;
}) {
  const { t } = useTranslation();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [kind, setKind] = useState<LoginKind>(defaultKind);
  const [remember, setRemember] = useState(false);
  const scope = isRoom ? 'room.login' : 'repeaterAdmin.login';

  const submit = () => {
    // An empty password is a valid guest login; only Admin requires one.
    if (pending || (kind === 'admin' && password === '')) return;
    onSubmit(password, kind, remember);
  };

  return (
    <form
      id={id}
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className='text-sm text-text2'>{t(`${scope}.prompt`)}</p>

      <div
        role='radiogroup'
        aria-label={t('repeaterAdmin.login.accessLabel')}
        onKeyDown={(e) =>
          handleRovingKeyDown(e, 2, kind === 'admin' ? 0 : 1, (i) =>
            setKind(i === 0 ? 'admin' : 'guest'),
          )
        }
        className='grid grid-cols-2 gap-2'
      >
        {(['admin', 'guest'] as const).map((k) => (
          <button
            key={k}
            type='button'
            role='radio'
            aria-checked={kind === k}
            tabIndex={kind === k ? 0 : -1}
            onClick={() => setKind(k)}
            disabled={pending}
            className={`rounded-md border px-3 py-2 text-left disabled:opacity-50 ${
              kind === k
                ? 'border-accent bg-surface2'
                : 'border-border-control hover:bg-surface2'
            }`}
          >
            <span className='block text-sm font-medium text-text'>
              {t(`${scope}.${k}`)}
            </span>
            <span className='block text-xs text-text2'>
              {t(`${scope}.${k}Hint`)}
            </span>
          </button>
        ))}
      </div>

      <div>
        <label htmlFor={passwordId} className='mb-1 block text-xs text-text2'>
          {t('repeaterAdmin.login.password')}
        </label>
        <div className='relative'>
          <input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            autoComplete='off'
            autoFocus
            disabled={pending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('repeaterAdmin.login.passwordPlaceholder')}
            className='w-full rounded-md border border-border-control bg-surface py-1.5 pr-9 pl-2 text-sm text-text outline-none focus:border-accent disabled:opacity-50'
          />
          <button
            type='button'
            onClick={() => setShowPassword((v) => !v)}
            disabled={pending}
            aria-label={t(
              showPassword
                ? 'repeaterAdmin.login.hidePassword'
                : 'repeaterAdmin.login.showPassword',
            )}
            title={t(
              showPassword
                ? 'repeaterAdmin.login.hidePassword'
                : 'repeaterAdmin.login.showPassword',
            )}
            className='absolute inset-y-0 right-0 flex items-center px-2 text-text2 hover:text-text disabled:opacity-50'
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <label className='flex items-center gap-2 text-sm text-text'>
        <input
          type='checkbox'
          disabled={pending}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className='h-4 w-4 accent-accent disabled:opacity-50'
        />
        <span>{t('repeaterAdmin.login.remember')}</span>
      </label>

      <div className='flex justify-end border-t border-border pt-4'>
        <button
          type='submit'
          disabled={pending || (kind === 'admin' && password === '')}
          className='rounded-md bg-accent-solid px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
        >
          {pending
            ? t('repeaterAdmin.login.loggingIn')
            : t('repeaterAdmin.login.submit')}
        </button>
      </div>
    </form>
  );
}
