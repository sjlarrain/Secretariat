import { useEffect, useState, useRef } from 'react';
import { api, Settings as SettingsType } from '../api/client';

const TIMEZONES = [
  'America/Santiago', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Buenos_Aires',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

/** True for zones with no DST rules — Etc/GMT±N pseudo-zones and plain UTC. */
function isFixedOffset(zone: string): boolean {
  return zone.startsWith('Etc/') || zone === 'UTC';
}

/** Current offset for a zone, e.g. "GMT-3" — display only. */
function describeOffset(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!m) return name === 'GMT' ? 'GMT+0' : name;
    return m[3] === '00' ? `GMT${m[1]}${Number(m[2])}` : `GMT${m[1]}${Number(m[2])}:${m[3]}`;
  } catch {
    return '';
  }
}

function useClock(timezone: string) {
  const [time, setTime] = useState('');
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone,
    });
    setTime(fmt());
    ref.current = setInterval(() => setTime(fmt()), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [timezone]);
  return time;
}

export default function TimeConfig() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { api.getSettings().then(setSettings); }, []);

  const clock = useClock(settings?.timezone ?? 'UTC');

  if (!settings) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  async function handleSave() {
    setSaving(true);
    setMsg(''); setErr('');
    try {
      const res = await api.saveSettings(settings!);
      // Adopt the canonical zone the server stored, so a typed "GMT-3" shows as
      // the Etc/GMT+3 it actually became.
      setSettings(res.settings);
      setMsg(
        res.settings.timezone !== settings!.timezone
          ? `Saved as ${res.settings.timezone}. Schedules rebuilt.`
          : 'Settings saved.'
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Time Configuration</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Timezone used for all date/time formatting and digest schedules
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>🌍</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Timezone</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Used for date/time formatting in WhatsApp messages and digest schedules
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>Server time</div>
            <code style={{ fontSize: 15, fontWeight: 600, color: 'var(--blue-bright)', letterSpacing: '0.04em' }}>
              {clock}
            </code>
          </div>
        </div>
        {/* Free text, not a fixed dropdown: /zone accepts any IANA name or a
            GMT±N offset, and a select would silently mismatch a zone set that
            way. The datalist keeps common zones one click away. */}
        <input
          list="tz-options"
          value={settings.timezone}
          spellCheck={false}
          onChange={(e) => setSettings((prev) => prev ? { ...prev, timezone: e.target.value } : prev)}
          placeholder="America/Santiago or GMT-3"
        />
        <datalist id="tz-options">
          {TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
        </datalist>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
          Currently {describeOffset(settings.timezone) || 'unknown offset'}. A city name tracks daylight
          saving automatically; a fixed <code>GMT±N</code> offset does not.
        </div>
        {isFixedOffset(settings.timezone) && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            ⚠️ <strong>{settings.timezone}</strong> is a fixed offset and will not adjust for daylight
            saving. Use a city name if you want that.
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>📌</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Default task reminder time</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Used when a task is saved with <code>--for</code> but no <code>--at</code> time
            </div>
          </div>
        </div>
        <input
          type="time"
          value={settings.defaultTaskTime ?? '09:00'}
          onChange={(e) => setSettings((prev) => prev ? { ...prev, defaultTaskTime: e.target.value } : prev)}
          style={{ width: 120 }}
        />
      </div>

      {err && <p className="error-msg" style={{ marginBottom: 12 }}>⚠ {err}</p>}
      {msg && <p className="success-msg" style={{ marginBottom: 12 }}>✓ {msg}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 120 }}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
