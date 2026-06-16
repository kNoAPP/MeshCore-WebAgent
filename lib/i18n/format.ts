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
