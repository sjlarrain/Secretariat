import { useEffect, useState } from 'react';
import { api, Settings, Reminder } from '../api/client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function StatusPill({ label }: { label: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      color: 'var(--green)', background: 'var(--green-dim)',
      padding: '2px 9px', borderRadius: 99,
    }}>{label}</span>
  );
}

function formatFireAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function CronManager() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editingMorning, setEditingMorning] = useState(false);
  const [editingWeekly, setEditingWeekly] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getReminders().then((r) => setReminders(r.reminders));
  }, []);

  if (!settings) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
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
      setEditingMorning(false);
      setEditingWeekly(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteReminder(id: string) {
    setDeletingId(id);
    try {
      await api.deleteReminder(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  const morningDayLabels = settings.morningDigest.days.map((d) => DAYS[d]).join(', ');

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Cron Manager</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Scheduled digests and pending reminders
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
        {/* Left: digests */}
        <div>
          {/* Morning Digest */}
          <div className="card" style={{ marginBottom: 12 }}>
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
                  onChange={(e) => {
                    updateMorning('enabled', e.target.checked);
                    if (!e.target.checked) setEditingMorning(false);
                  }}
                />
                <span className="toggle-track" />
              </label>
            </div>

            {settings.morningDigest.enabled && !editingMorning ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <StatusPill label={`at ${settings.morningDigest.time}`} />
                  {morningDayLabels && <StatusPill label={morningDayLabels} />}
                </div>
                <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setEditingMorning(true)}>
                  Edit
                </button>
              </div>
            ) : settings.morningDigest.enabled ? (
              <div>
                <div style={{ marginBottom: 16, maxWidth: 180 }}>
                  <label className="field-label">Send at</label>
                  <input
                    type="time"
                    value={settings.morningDigest.time}
                    onChange={(e) => updateMorning('time', e.target.value)}
                  />
                </div>
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
            ) : null}
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
                  onChange={(e) => {
                    updateWeekly('enabled', e.target.checked);
                    if (!e.target.checked) setEditingWeekly(false);
                  }}
                />
                <span className="toggle-track" />
              </label>
            </div>

            {settings.weeklySummary.enabled && !editingWeekly ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusPill label={DAYS[settings.weeklySummary.day]} />
                  <StatusPill label={`at ${settings.weeklySummary.time}`} />
                </div>
                <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setEditingWeekly(true)}>
                  Edit
                </button>
              </div>
            ) : settings.weeklySummary.enabled ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
            ) : null}
          </div>

          {err && <p className="error-msg" style={{ marginBottom: 12 }}>⚠ {err}</p>}
          {msg && <p className="success-msg" style={{ marginBottom: 12 }}>✓ {msg}</p>}

          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 120 }}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>

        {/* Right: pending reminders */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            Pending Reminders
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>
              {reminders.length > 0 ? `${reminders.length} queued` : ''}
            </span>
          </div>

          {reminders.length === 0 ? (
            <div className="card" style={{ padding: '28px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⏰</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No pending reminders</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reminders
                .slice()
                .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime())
                .map((r) => (
                  <div key={r.id} className="card" style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {formatFireAt(r.fireAt)}
                        </div>
                      </div>
                      <button
                        className="btn-danger"
                        style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                        disabled={deletingId === r.id}
                        onClick={() => handleDeleteReminder(r.id)}
                      >
                        {deletingId === r.id ? '…' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
