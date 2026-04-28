import { useEffect, useState } from 'react';
import { api, Settings } from '../api/client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIMEZONES = [
  'America/Santiago', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Buenos_Aires',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

export default function Digests() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { api.getSettings().then(setSettings); }, []);

  if (!settings) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  function update<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: val } : prev);
  }

  function updateMorning<K extends keyof Settings['morningDigest']>(key: K, val: Settings['morningDigest'][K]) {
    setSettings((prev) => prev ? { ...prev, morningDigest: { ...prev.morningDigest, [key]: val } } : prev);
  }

  function updateWeekly<K extends keyof Settings['weeklySummary']>(key: K, val: Settings['weeklySummary'][K]) {
    setSettings((prev) => prev ? { ...prev, weeklySummary: { ...prev.weeklySummary, [key]: val } } : prev);
  }

  function toggleMorningDay(day: number) {
    const days = settings!.morningDigest.days;
    updateMorning('days', days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort());
  }

  async function handleSave() {
    setSaving(true);
    setMsg(''); setErr('');
    try {
      await api.saveSettings(settings!);
      setMsg('Settings saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const sectionStyle = (enabled: boolean): React.CSSProperties => ({
    opacity: enabled ? 1 : 0.5,
    transition: 'opacity 0.2s',
    pointerEvents: enabled ? 'auto' : 'none',
  });

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Digests</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Scheduled WhatsApp messages sent automatically
        </p>
      </div>

      {/* Timezone */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>🌍</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Timezone</span>
        </div>
        <select value={settings.timezone} onChange={(e) => update('timezone', e.target.value)}>
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>

      {/* Morning Digest */}
      <div className="card" style={{ marginBottom: 12 }}>
        {/* Section header with toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 16 }}>☀️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Morning Digest</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              Daily calendar + task summary
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.morningDigest.enabled}
              onChange={(e) => updateMorning('enabled', e.target.checked)}
            />
            <span className="toggle-track" />
          </label>
        </div>

        <div style={sectionStyle(settings.morningDigest.enabled)}>
          {/* Time */}
          <div style={{ marginBottom: 16, maxWidth: 180 }}>
            <label className="field-label">Send at</label>
            <input
              type="time"
              value={settings.morningDigest.time}
              onChange={(e) => updateMorning('time', e.target.value)}
            />
          </div>

          {/* Days */}
          <div>
            <label className="field-label">Days</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAYS.map((day, i) => (
                <button
                  key={i}
                  className={`day-pill${settings.morningDigest.days.includes(i) ? ' active' : ''}`}
                  onClick={() => toggleMorningDay(i)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Summary */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Weekly Summary</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              Weekly task and event recap
            </div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.weeklySummary.enabled}
              onChange={(e) => updateWeekly('enabled', e.target.checked)}
            />
            <span className="toggle-track" />
          </label>
        </div>

        <div style={{ ...sectionStyle(settings.weeklySummary.enabled), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="field-label">Day</label>
            <select value={settings.weeklySummary.day} onChange={(e) => updateWeekly('day', Number(e.target.value))}>
              {DAYS.map((day, i) => <option key={i} value={i}>{day}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Time</label>
            <input
              type="time"
              value={settings.weeklySummary.time}
              onChange={(e) => updateWeekly('time', e.target.value)}
            />
          </div>
        </div>
      </div>

      {err && <p className="error-msg" style={{ marginBottom: 12 }}>⚠ {err}</p>}
      {msg && <p className="success-msg" style={{ marginBottom: 12 }}>✓ {msg}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 120 }}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
