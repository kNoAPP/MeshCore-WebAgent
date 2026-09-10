// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

/** One entry in a {@link Select}. */
export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Renders the row but blocks picking it (e.g. an out-of-range value). */
  disabled?: boolean;
}

/**
 * The app's dropdown.
 *
 * @remarks
 * There is exactly one, for the same anti-drift reason as {@link Switch}: five
 * hand-rolled copies had drifted apart on padding, text size and border token.
 * `onChange` hands back the option's own value, so a numeric select stays
 * numeric instead of every call site remembering to `Number(...)` it.
 *
 * With `label`, the caption renders above the control; without it, `ariaLabel`
 * names it for a row that already has visible text of its own.
 */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  size = 'sm',
  disabled,
  className = '',
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label?: string;
  ariaLabel?: string;
  /** `sm` for inline rows and popovers, `md` for a form column. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const control = (
    <select
      value={String(value)}
      aria-label={label === undefined ? ariaLabel : undefined}
      disabled={disabled}
      // The <option> value is always a string, so map back through the options
      // rather than guessing the caller's type from the DOM.
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
      className={`min-w-0 rounded-md border border-border-control bg-surface text-text outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2 py-1.5 text-sm'
      } ${label === undefined ? '' : 'w-full'} ${className}`}
    >
      {options.map((o) => (
        <option
          key={String(o.value)}
          value={String(o.value)}
          disabled={o.disabled}
        >
          {o.label}
        </option>
      ))}
    </select>
  );

  if (label === undefined) return control;

  return (
    <label className='block'>
      <span className='mb-1 block text-xs text-text2'>{label}</span>
      {control}
    </label>
  );
}
