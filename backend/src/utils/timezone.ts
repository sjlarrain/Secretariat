// Timezone parsing + QStash cron construction.
//
// QStash evaluates cron expressions in UTC by default, but supports a
// `CRON_TZ=<IANA zone>` prefix inside the expression itself. Using it means we
// never compute UTC offsets ourselves, so schedules follow DST automatically
// instead of drifting an hour whenever the zone crosses a boundary.

export function isValidZone(zone: string): boolean {
  return canonicalizeZone(zone) !== null;
}

/**
 * Resolves a zone name to its canonical IANA spelling via ICU, or null if it is
 * not a real zone. `america/santiago` becomes `America/Santiago`.
 *
 * Casing matters downstream even though Intl accepts any casing: the canonical
 * name is what gets embedded in QStash's `CRON_TZ=` prefix, and the tz database
 * lookup on that side is case-sensitive.
 */
function canonicalizeZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Resolves user-supplied zone input to an IANA zone name.
 *
 * Accepts a full IANA name (`America/Santiago`) or a fixed offset
 * (`GMT-3`, `UTC+2`, `GMT-03:00`). Returns null if unrecognized.
 *
 * Fixed offsets map to `Etc/GMT` pseudo-zones, whose sign convention is
 * INVERTED relative to the usual UTC±N notation: UTC-3 is `Etc/GMT+3`. These
 * zones are DST-naive by definition — prefer a real IANA name where DST matters.
 */
export function parseZoneInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const offset = raw.match(/^(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (offset) {
    const [, sign, hoursStr, minutesStr] = offset;
    const hours = Number(hoursStr);

    // Etc/GMT zones are whole-hour only.
    if (minutesStr && minutesStr !== '00') return null;
    if (hours === 0) return 'UTC';

    // Invert the sign: UTC-3 is Etc/GMT+3.
    const etcSign = sign === '-' ? '+' : '-';
    // Etc/GMT+N exists for N 1..12 (west), Etc/GMT-N for N 1..14 (east).
    const max = etcSign === '+' ? 12 : 14;
    if (hours > max) return null;

    return canonicalizeZone(`Etc/GMT${etcSign}${hours}`);
  }

  if (/^(?:GMT|UTC)$/i.test(raw)) return 'UTC';

  // Otherwise treat it as an IANA name and let ICU do the canonicalization —
  // it handles casing and underscores correctly, which hand-rolled title-casing
  // does not (it would mangle `Etc/GMT+3` into `Etc/Gmt+3`).
  return canonicalizeZone(raw);
}

/**
 * Builds a QStash cron expression that fires at `localTime` in `zone`.
 * Days are local weekday numbers (0=Sun..6=Sat) and need no shifting, because
 * QStash resolves the whole expression within the declared zone.
 */
export function buildCron(localTime: string, zone: string, days: number[]): string {
  const [h, m] = localTime.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) {
    throw new Error(`Invalid time: "${localTime}" (expected HH:MM)`);
  }
  const dayField = days.length ? [...days].sort((a, b) => a - b).join(',') : '*';
  return `CRON_TZ=${zone} ${m} ${h} * * ${dayField}`;
}

/** Human-readable current offset for a zone, e.g. "GMT-3" — for display only. */
export function describeZone(zone: string, at: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  });
  const name = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
  // longOffset renders as "GMT-03:00" / "GMT"; trim to "GMT-3" / "GMT+0".
  const m = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!m) return name === 'GMT' ? 'GMT+0' : name;
  const [, sign, hh, mm] = m;
  const hours = Number(hh);
  return mm === '00' ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${mm}`;
}
