// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';

/**
 * Icon button that copies `value` to the clipboard, with a hover tooltip that
 * briefly shows "Copied" on success.
 *
 * @param label - tooltip/aria text (default "Copy").
 */
export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const tooltip = label ?? t('common.copy');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <span className='group relative inline-flex shrink-0'>
      <button
        onClick={copy}
        aria-label={tooltip}
        className='text-(--text2) transition-colors hover:text-(--text)'
      >
        <Copy size={14} />
      </button>
      <span
        className='pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100'
        style={{ background: 'var(--surface2)', color: 'var(--text)' }}
      >
        {copied ? t('common.copied') : tooltip}
      </span>
    </span>
  );
}
