// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

/** Props for {@link SecretInput}: those of an `<input>`, less its `type`. */
export interface SecretInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  /** The reveal toggle's accessible name. Defaults to "Show passphrase". */
  revealLabel?: string;
}

/**
 * A masked input with an eye toggle that shows what was typed. It starts
 * hidden on every mount, so leaving the step or dialog hides it again. The
 * toggle keeps one name and reports its state through `aria-pressed`.
 */
export function SecretInput({
  revealLabel,
  className = '',
  disabled,
  ...props
}: SecretInputProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const label = revealLabel ?? t('common.showPassphrase');
  return (
    <div className='relative'>
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        disabled={disabled}
        className={`${className} w-full pr-9`}
      />
      <button
        type='button'
        onClick={() => setShown((v) => !v)}
        disabled={disabled}
        aria-label={label}
        aria-pressed={shown}
        title={label}
        className='absolute inset-y-0 right-0 flex items-center px-2 text-text2 hover:text-text disabled:opacity-50'
      >
        {shown ? (
          <EyeOff size={16} aria-hidden='true' />
        ) : (
          <Eye size={16} aria-hidden='true' />
        )}
      </button>
    </div>
  );
}
