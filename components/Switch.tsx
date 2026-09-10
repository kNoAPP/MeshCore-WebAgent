// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

/**
 * The switch's track and knob on their own, for the rare row that needs
 * something else (a save-status chip) sitting next to it inside the same
 * `role='switch'` button. Decorative — the button around it carries the role.
 */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-accent-solid bg-accent-solid'
          : 'border-text2 bg-surface2'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
          checked ? 'translate-x-4.5 bg-white' : 'translate-x-0.5 bg-text2'
        }`}
      />
    </span>
  );
}

/**
 * The app's on/off switch.
 *
 * @remarks
 * There is exactly one so the Settings page, the repeater Config tab and the
 * automation panel can't drift apart on size, knob color or geometry — the
 * same reason {@link Card} and {@link StatCard} exist. The off state carries a
 * `--text2` knob on a `--surface2` track rather than white-on-`--border`,
 * which reads at ~1.5:1 and makes an OFF switch look like an undifferentiated
 * pill.
 *
 * With `label`, the whole row is the switch (label on the left, track on the
 * right); without it, only the track renders and `ariaLabel` names it.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  ariaLabel,
  disabled,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Row label. Omit for a bare track named by {@link ariaLabel}. */
  label?: React.ReactNode;
  /** Secondary line under {@link label}. */
  description?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const common = {
    type: 'button' as const,
    role: 'switch',
    'aria-checked': checked,
    'aria-label': ariaLabel,
    disabled,
    onClick: () => onChange(!checked),
  };

  if (label === undefined) {
    return (
      <button {...common} className={`shrink-0 ${className}`}>
        <SwitchTrack checked={checked} />
      </button>
    );
  }

  return (
    <button
      {...common}
      className={`flex w-full items-center justify-between gap-3 text-left text-xs text-text disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <span className='flex min-w-0 flex-col'>
        <span className='truncate'>{label}</span>
        {description !== undefined && (
          <span className='text-[11px] text-text2'>{description}</span>
        )}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}
