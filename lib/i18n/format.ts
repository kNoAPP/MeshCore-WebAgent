// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import i18n from '@/lib/i18n';
import { bearingDeg, compassKey, haversineKm, microToDeg } from '@/lib/utils';

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

/**
 * Formats the distance and 8-point compass bearing from this node to a target,
 * e.g. `"3.2 km · NE"`, or `null` when either endpoint is unset.
 *
 * @param selfLatDeg - this node's latitude in decimal degrees (from
 * `SelfInfo`), or `undefined`/`0` when the node has no fix.
 * @param selfLonDeg - this node's longitude in decimal degrees.
 * @param targetLatMicro - the target's latitude in micro-degrees (from a
 * `Contact`/`Advert`), where `0`/unset means no location.
 * @param targetLonMicro - the target's longitude in micro-degrees.
 * @returns distance in kilometers to one decimal (locale-formatted) and the
 * compass abbreviation, or `null` if either location is missing.
 */
export function formatDistanceBearing(
  selfLatDeg: number | undefined,
  selfLonDeg: number | undefined,
  targetLatMicro: number | undefined,
  targetLonMicro: number | undefined,
): string | null {
  if (!selfLatDeg || !selfLonDeg || !targetLatMicro || !targetLonMicro) {
    return null;
  }
  const targetLat = microToDeg(targetLatMicro);
  const targetLon = microToDeg(targetLonMicro);
  const km = haversineKm(selfLatDeg, selfLonDeg, targetLat, targetLon);
  const bearing = bearingDeg(selfLatDeg, selfLonDeg, targetLat, targetLon);
  return i18n.t('manage.distanceValue', {
    distance: km.toLocaleString(i18n.language, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    }),
    compass: i18n.t(compassKey(bearing)),
  });
}
