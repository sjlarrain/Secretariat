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

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  if (!settings) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  function update<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: val } : prev);
  }

  function updateMorning<K extends keyof Settings['morningDigest']>(
    key: K, val: Settings['morningDigest'][K]
  ) {
    setSettings((prev) => prev
      ? { ...prev, morningDigest: { ...prev.morningDigest, [key]: val } }
      : prev
    );
  }

  function updateWeekly<K extends keyof Settings['weeklySummary']>(
    key: K, val: Settings['weeklySummary'][K]
  ) {
    setSettings((prev) => prev
      ? { ...prev, weeklySummary: { ...prev.weeklySummary, [key]: val } }
      : prev
    );
  }

  function toggleMorningDay(day: number) {
    const days = settings!.morningDigest.days;
    updateMorning('days', days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort());
  }

  async function handleSave() {
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      await api.saveSettings(settings!);
      setMsg('Settings saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Digests & Reminders</h2>

      {/* Timezone */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Timezone</h3>
        <select
          value={settings.timezone}
          onChange={(e) => update('timezone', e.target.value)}
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </div>

      {/* Morning Digest */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Morning Digest ☀️</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={settings.morningDigest.enabled}
              onChange={(e) => updateMorning('enabled', e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Enabled
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#9ca3af' }}>
              Time (24h)
            </label>
            <input
              type="time"
              value={settings.morningDigest.time}
              onChange={(e) => updateMorning('time', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#9ca3af' }}>
            Days
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map((day, i) => (
              <button
                key={i}
                onClick={() => toggleMorningDay(i)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 500,
                  background: settings.morningDigest.days.includes(i) ? '#2563eb' : '#374151',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Weekly Summary */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Weekly Summary 📋</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={settings.weeklySummary.enabled}
              onChange={(e) => updateWeekly('enabled', e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Enabled
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#9ca3af' }}>
              Day
            </label>
            <select
              value={settings.weeklySummary.day}
              onChange={(e) => updateWeekly('day', Number(e.target.value))}
            >
              {DAYS.map((day, i) => (
                <option key={i} value={i}>{day}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#9ca3af' }}>
              Time (24h)
            </label>
            <input
              type="time"
              value={settings.weeklySummary.time}
              onChange={(e) => updateWeekly('time', e.target.value)}
            />
          </div>
        </div>
      </div>

      {err && <p className="error-msg" style={{ marginBottom: 12 }}>{err}</p>}
      {msg && <p className="success-msg" style={{ marginBottom: 12 }}>{msg}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}
