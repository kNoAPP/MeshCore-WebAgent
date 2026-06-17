// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import i18n from '@/lib/i18n';

/**
 * Formats a Unix epoch-seconds timestamp as a locale wall-clock time (hh:mm).
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a Unix epoch-seconds timestamp as a relative age (`just now`,
 * `5m ago`, `2h ago`, `3d ago`).
 */
export function formatRelative(timestamp: number): string {
  const secs = Math.floor(Date.now() / 1000) - timestamp;
  if (secs < 60) return i18n.t('relative.justNow');
  if (secs < 3600)
    return i18n.t('relative.minutes', { count: Math.floor(secs / 60) });
  if (secs < 86400)
    return i18n.t('relative.hours', { count: Math.floor(secs / 3600) });
  return i18n.t('relative.days', { count: Math.floor(secs / 86400) });
}
