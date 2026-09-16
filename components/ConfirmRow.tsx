// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';

/**
 * The app's inline "are you sure?" row: the question on the left, Cancel and a
 * red confirm button on the right. Rendered in place of the affordance that
 * raised it, so a destructive verb never fires straight from a single click.
 */
export function ConfirmRow({
  message,
  confirmLabel,
  autoFocus = false,
  onCancel,
  onConfirm,
}: {
  message: string;
  /** Label of the red button — name the verb, never just "OK". */
  confirmLabel: string;
  /**
   * Take focus on mount, landing on Cancel. For call sites that replace the
   * focused control with this row, where focus would otherwise fall out of the
   * dialog entirely.
   */
  autoFocus?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='mt-6 flex items-center justify-between gap-3 border-t border-border pt-4'>
      <span className='text-sm text-text2'>{message}</span>
      <div className='flex shrink-0 gap-2'>
        <button
          autoFocus={autoFocus}
          onClick={onCancel}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          className='rounded-md bg-red-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-hover'
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
