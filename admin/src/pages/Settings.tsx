import { useEffect, useState } from 'react';
import { api, Settings as SettingsType } from '../api/client';

const TIMEZONES = [
  'America/Santiago', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Buenos_Aires',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
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

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Global configuration for your bot
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 14 }}>🌍</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Timezone</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Used for date/time formatting in WhatsApp messages and digest schedules
            </div>
          </div>
        </div>
        <select
          value={settings.timezone}
          onChange={(e) => setSettings((prev) => prev ? { ...prev, timezone: e.target.value } : prev)}
        >
          {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>

      {err && <p className="error-msg" style={{ marginBottom: 12 }}>⚠ {err}</p>}
      {msg && <p className="success-msg" style={{ marginBottom: 12 }}>✓ {msg}</p>}

      <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 120 }}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
