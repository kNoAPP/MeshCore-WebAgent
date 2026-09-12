// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import i18n from '@/lib/i18n';
import { bearingDeg, compassKey, haversineKm, microToDeg } from '@/lib/utils';
import {
  DEFAULT_UNIT_SYSTEM,
  MILES_PER_KM,
  type UnitSystem,
} from '@/lib/units/config';

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
 * Formats a Unix epoch-seconds timestamp as a full locale date and time, for a
 * tooltip that disambiguates a bare wall-clock time.
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
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
 * Formats a Unix epoch-seconds timestamp as a localized day label for a chat
 * date divider: `Today`, `Yesterday`, or a full localized date (e.g.
 * `June 28, 2026`) for older days. Day boundaries are compared in local time.
 */
export function formatDateDivider(timestamp: number): string {
  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const date = new Date(timestamp * 1000);
  const dayDiff = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );
  if (dayDiff === 0) return i18n.t('relative.today');
  if (dayDiff === 1) return i18n.t('relative.yesterday');
  return date.toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Formats the distance and 8-point compass bearing from this node to a target,
 * e.g. `"3.2 km · NE"` (or `"2.0 mi · NE"` in imperial), or `null` when either
 * endpoint is unset.
 *
 * @param selfLatDeg - this node's latitude in decimal degrees (from
 * `SelfInfo`), or `undefined`/`0` when the node has no fix.
 * @param selfLonDeg - this node's longitude in decimal degrees.
 * @param targetLatMicro - the target's latitude in micro-degrees (from a
 * `Contact`/`Advert`), where `0`/unset means no location.
 * @param targetLonMicro - the target's longitude in micro-degrees.
 * @param unitSystem - measurement system for the distance value; defaults to
 * {@link DEFAULT_UNIT_SYSTEM}.
 * @returns distance to one decimal (locale-formatted) in the chosen units and
 * the compass abbreviation, or `null` if either location is missing.
 */
export function formatDistanceBearing(
  selfLatDeg: number | undefined,
  selfLonDeg: number | undefined,
  targetLatMicro: number | undefined,
  targetLonMicro: number | undefined,
  unitSystem: UnitSystem = DEFAULT_UNIT_SYSTEM,
): string | null {
  if (!selfLatDeg || !selfLonDeg || !targetLatMicro || !targetLonMicro) {
    return null;
  }
  const targetLat = microToDeg(targetLatMicro);
  const targetLon = microToDeg(targetLonMicro);
  const km = haversineKm(selfLatDeg, selfLonDeg, targetLat, targetLon);
  const bearing = bearingDeg(selfLatDeg, selfLonDeg, targetLat, targetLon);
  const imperial = unitSystem === 'imperial';
  const value = imperial ? km * MILES_PER_KM : km;
  return i18n.t(
    imperial ? 'manage.distanceValueImperial' : 'manage.distanceValue',
    {
      distance: value.toLocaleString(i18n.language, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
      compass: i18n.t(compassKey(bearing)),
    },
  );
}

/** Formats `value` with a fixed number of fraction digits in the active locale
 * (so the decimal separator follows the language, e.g. `4,16` in German). */
export function fixed(value: number, digits: number): string {
  return value.toLocaleString(i18n.language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Formats a duration in seconds as a compact `1d 2h 3m 4s` string (zero units
 * dropped), with the day count grouped for the active locale (e.g. `1,000d`).
 * The `d`/`h`/`m`/`s` symbols are locale-neutral and not translated.
 */
export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [
    d && `${d.toLocaleString(i18n.language)}d`,
    h && `${h}h`,
    m && `${m}m`,
    `${s}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Formats a supply voltage given in millivolts as locale-aware volts to two
 * decimals, e.g. `4.16 V` (or `4,16 V` in German). The `V` symbol is an SI unit
 * and is not translated.
 */
export function formatVoltage(milliVolts: number): string {
  return `${fixed(milliVolts / 1000, 2)} V`;
}

/**
 * Formats an airtime duration in seconds with a locale-aware value and a unit
 * that scales: whole `s` under a minute, then `m`, then `h`. Unit symbols are
 * not translated.
 */
export function formatAirtime(secs: number): string {
  if (secs < 60) return `${secs.toLocaleString(i18n.language)} s`;
  if (secs < 3600) return `${fixed(secs / 60, 1)} m`;
  return `${fixed(secs / 3600, 2)} h`;
}

/**
 * Formats a signal-to-noise ratio in dB with a locale-aware two-decimal value
 * and an explicit `+` for positive readings, e.g. `+5.25 dB` / `-3.00 dB`. The
 * `dB` symbol is not translated.
 */
export function formatSnr(db: number): string {
  return `${db > 0 ? '+' : ''}${fixed(db, 2)} dB`;
}

/**
 * Formats a clock skew (device time minus real time, in seconds) as a signed
 * compact duration: `+5s`, `-2h 1m 3s`, or `0s` when in sync. A negative value
 * means the device clock is running behind.
 */
export function formatSkew(secs: number): string {
  if (secs === 0) return '0s';
  return `${secs > 0 ? '+' : '-'}${formatUptime(Math.abs(secs))}`;
}

/** Formats a received-power reading in dBm, e.g. `-104 dBm`. */
export function formatDbm(dbm: number): string {
  return i18n.t('units.dbm', { value: dbm.toLocaleString(i18n.language) });
}

/** Formats a kilobyte count with locale digit grouping, e.g. `3,169 KB`. */
export function formatKilobytes(kb: number): string {
  return i18n.t('units.kb', { value: kb.toLocaleString(i18n.language) });
}

/**
 * Formats a used-of-total kilobyte pair as one compact reading, e.g.
 * `9/3,169 KB`, for the header's inline storage readout.
 */
export function formatStorage(usedKB: number, totalKB: number): string {
  const used = usedKB.toLocaleString(i18n.language);
  const total = totalKB.toLocaleString(i18n.language);
  return i18n.t('units.kb', { value: `${used}/${total}` });
}

/** Formats a whole percentage, e.g. `73%`. */
export function formatPercent(value: number): string {
  return i18n.t('units.percent', {
    value: Math.round(value).toLocaleString(i18n.language),
  });
}
