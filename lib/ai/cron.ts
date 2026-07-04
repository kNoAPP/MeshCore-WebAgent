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
 * through the base range, where the base is `[min, max]` for `*`, the given
 * range for `a-b`, and `[k, max]` for a bare number `k` (matching crontab
 * semantics, so `5/10` means 5, 15, 25, …). Any extra `-` or `/` is rejected.
 */
function parseField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '') return null;
    const slashParts = part.split('/');
    // At most one step is allowed — reject forms like `*/5/2`.
    if (slashParts.length > 2) return null;
    const [rangePart, stepPart] = slashParts;
    // A step must be a positive integer when present.
    let step = 1;
    const hasStep = stepPart !== undefined;
    if (hasStep) {
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
      const dashParts = rangePart.split('-');
      // A range is exactly two bounds — reject forms like `1-2-3`.
      if (dashParts.length !== 2) return null;
      const [a, b] = dashParts;
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
      lo = Number(a);
      hi = Number(b);
    } else {
      if (!/^\d+$/.test(rangePart)) return null;
      lo = Number(rangePart);
      // A bare number with a step runs from it through `max` (`k/n`); without a
      // step it is the single value `k`.
      hi = hasStep ? max : lo;
    }

    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/**
 * Parses the day-of-week field, accepting `7` as an alias for `0` (Sunday).
 * The field is parsed against `[0, 7]` so `7` is legal wherever a number may
 * appear — as a bare value, a range bound (e.g. `6-7`), or a step base — then
 * any resulting `7` is folded into `0`, matching crontab semantics.
 */
function parseDowField(field: string): Set<number> | null {
  const values = parseField(field, 0, 7);
  if (!values) return null;
  if (values.delete(7)) values.add(0);
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
    if (i === 4) return parseDowField(field) !== null;
    const range = FIELDS[i];
    return parseField(field, range.min, range.max) !== null;
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

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dow = parseDowField(fields[4]);
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
