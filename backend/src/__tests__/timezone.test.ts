import { describe, it, expect } from 'vitest';
import { parseZoneInput, isValidZone, describeZone } from '../shared/utils/timezone';

// ─── parseZoneInput — IANA names ──────────────────────────────────────────────

describe('parseZoneInput — IANA names', () => {
  it('accepts a canonical IANA name', () => {
    expect(parseZoneInput('America/Santiago')).toBe('America/Santiago');
  });

  it('normalizes casing', () => {
    expect(parseZoneInput('america/santiago')).toBe('America/Santiago');
    expect(parseZoneInput('EUROPE/MADRID')).toBe('Europe/Madrid');
  });

  it('normalizes multi-word city names with underscores', () => {
    expect(parseZoneInput('america/new_york')).toBe('America/New_York');
    expect(parseZoneInput('America/Los_angeles')).toBe('America/Los_Angeles');
  });

  it('rejects a nonsense zone', () => {
    expect(parseZoneInput('Mars/Olympus')).toBeNull();
    expect(parseZoneInput('')).toBeNull();
    expect(parseZoneInput('   ')).toBeNull();
  });
});

// ─── parseZoneInput — fixed offsets ───────────────────────────────────────────
//
// The Etc/GMT sign convention is INVERTED. These tests exist specifically to
// pin that down, since it is notoriously easy to get backwards.

describe('parseZoneInput — GMT offsets map to inverted Etc/GMT zones', () => {
  it('maps GMT-3 (Santiago) to Etc/GMT+3', () => {
    expect(parseZoneInput('GMT-3')).toBe('Etc/GMT+3');
  });

  it('maps GMT+2 (Madrid summer) to Etc/GMT-2', () => {
    expect(parseZoneInput('GMT+2')).toBe('Etc/GMT-2');
  });

  it('treats UTC as an alias for GMT', () => {
    expect(parseZoneInput('UTC-5')).toBe('Etc/GMT+5');
    expect(parseZoneInput('UTC+9')).toBe('Etc/GMT-9');
  });

  it('maps zero offset to UTC', () => {
    expect(parseZoneInput('GMT+0')).toBe('UTC');
    expect(parseZoneInput('GMT-0')).toBe('UTC');
    expect(parseZoneInput('GMT')).toBe('UTC');
    expect(parseZoneInput('UTC')).toBe('UTC');
  });

  it('tolerates whitespace and :00 minutes', () => {
    expect(parseZoneInput('GMT -3')).toBe('Etc/GMT+3');
    expect(parseZoneInput('GMT-03:00')).toBe('Etc/GMT+3');
    expect(parseZoneInput('gmt-3')).toBe('Etc/GMT+3');
  });

  it('rejects non-whole-hour offsets, which Etc/GMT cannot express', () => {
    expect(parseZoneInput('GMT-3:30')).toBeNull();
    expect(parseZoneInput('GMT+5:45')).toBeNull();
  });

  it('rejects offsets outside the Etc/GMT range', () => {
    expect(parseZoneInput('GMT-13')).toBeNull(); // west only goes to -12
    expect(parseZoneInput('GMT+15')).toBeNull(); // east only goes to +14
  });

  it('accepts the extremes of the range', () => {
    expect(parseZoneInput('GMT-12')).toBe('Etc/GMT+12');
    expect(parseZoneInput('GMT+14')).toBe('Etc/GMT-14');
  });

  it('produces zones that resolve to the intended real offset', () => {
    // The round-trip that actually matters: type GMT-3, get UTC-3 behavior.
    const zone = parseZoneInput('GMT-3')!;
    const at = new Date('2026-07-16T12:00:00Z');
    expect(describeZone(zone, at)).toBe('GMT-3');
  });
});

// ─── isValidZone ──────────────────────────────────────────────────────────────

describe('isValidZone', () => {
  it('accepts real zones and rejects fake ones', () => {
    expect(isValidZone('America/Santiago')).toBe(true);
    expect(isValidZone('Etc/GMT+3')).toBe(true);
    expect(isValidZone('Not/AZone')).toBe(false);
  });
});

// ─── Round-tripping an already-canonical zone ────────────────────────────────

describe('parseZoneInput — idempotence', () => {
  // Both /zone and PUT /settings normalize through parseZoneInput, so a stored
  // zone gets re-parsed on every subsequent save and must survive unchanged.
  for (const zone of ['America/Santiago', 'Etc/GMT+3', 'Etc/GMT-14', 'UTC', 'America/New_York']) {
    it(`${zone} parses back to itself`, () => {
      expect(parseZoneInput(zone)).toBe(zone);
    });
  }

  it('preserves the uppercase GMT in Etc zones', () => {
    // Regression: title-casing produced "Etc/Gmt+3", which Intl accepts (so it
    // looked fine) but is not the canonical spelling stored in Settings.
    const zone = parseZoneInput('GMT-3')!;
    expect(zone).toBe('Etc/GMT+3');
    expect(parseZoneInput(zone)).toBe('Etc/GMT+3');
  });
});
