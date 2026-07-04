// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// A tiny standard 5-field cron matcher for the automation engine's `schedule`
// trigger (task 6.4). Fields are minute, hour, day-of-month, month, and
// day-of-week; each supports `*`, lists (`,`), ranges (`-`), and steps (`/`).
// Evaluated against the local wall clock once per minute by the scheduler in
// `useAutomation` — this parses and matches expressions, it does not keep time.

/** The five cron fields, with the inclusive value range each accepts. */
const FIELDS: { min: number; max: number }[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week (0 = Sunday)
];

/**
 * Parses one cron field into the set of integers it matches, or returns `null`
 * if the field is malformed. `*` yields every value in `[min, max]`; commas
 * join sub-expressions; `a-b` is an inclusive range; a trailing `/n` steps
 * through the range (or through `[min, max]` when the base is `*`).
 */
function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '') return null;
    const [rangePart, stepPart] = part.split('/');
    // A step must be a positive integer when present.
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = min;
      hi = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
      lo = Number(a);
      hi = Number(b);
    } else {
      if (!/^\d+$/.test(rangePart)) return null;
      lo = hi = Number(rangePart);
    }

    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** Splits into whitespace-separated fields, or `null` unless there are five. */
function splitFields(expr: string): string[] | null {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 ? fields : null;
}

/**
 * Whether `expr` is a well-formed 5-field cron expression. Used by the rule
 * editor to gate saving so a bad expression can never reach the scheduler.
 */
export function isValidCron(expr: string): boolean {
  const fields = splitFields(expr);
  if (!fields) return false;
  return fields.every((field, i) => {
    const range = FIELDS[i];
    // Normalize day-of-week 7 to 0 (Sunday) before validating that field.
    const normalized = i === 4 ? field.replace(/(^|[^0-9])7/g, '$10') : field;
    return parseField(normalized, range.min, range.max) !== null;
  });
}

/**
 * Whether `expr` fires at the given local `date` (to minute resolution).
 * Following cron convention, when both day-of-month and day-of-week are
 * restricted (neither is `*`), the day matches if *either* does; otherwise both
 * must match. A malformed expression never matches, so a bad rule stays inert.
 */
export function cronMatches(expr: string, date: Date): boolean {
  const fields = splitFields(expr);
  if (!fields) return false;

  const dowField = fields[4].replace(/(^|[^0-9])7/g, '$10');
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dow = parseField(dowField, 0, 6);
  if (!minute || !hour || !dom || !month || !dow) return false;

  if (!minute.has(date.getMinutes())) return false;
  if (!hour.has(date.getHours())) return false;
  if (!month.has(date.getMonth() + 1)) return false;

  const domRestricted = fields[2] !== '*';
  const dowRestricted = fields[4] !== '*';
  const domHit = dom.has(date.getDate());
  const dowHit = dow.has(date.getDay());
  if (domRestricted && dowRestricted) return domHit || dowHit;
  return domHit && dowHit;
}
