import { useEffect, useState } from 'react';
import { api, Settings } from '../api/client';

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

export default function CronManager() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editingMorning, setEditingMorning] = useState(false);
  const [editingWeekly, setEditingWeekly] = useState(false);
  const [editingPromoter, setEditingPromoter] = useState(false);
  const [editingHealth, setEditingHealth] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings);
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

  function updatePromoter<K extends keyof Settings['reminderPromoter']>(key: K, val: Settings['reminderPromoter'][K]) {
    setSettings((prev) => prev ? { ...prev, reminderPromoter: { ...(prev.reminderPromoter ?? { enabled: false, time: '08:00' }), [key]: val } } : prev);
  }

  function updateHealth<K extends keyof Settings['healthCheck']>(key: K, val: Settings['healthCheck'][K]) {
    setSettings((prev) => prev ? { ...prev, healthCheck: { ...(prev.healthCheck ?? { enabled: false, time: '23:00' }), [key]: val } } : prev);
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
      setEditingPromoter(false);
      setEditingHealth(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const morningDayLabels = settings.morningDigest.days.map((d) => DAYS[d]).join(', ');

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Cron Manager</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Recurring schedules. All times are in {settings.timezone}.
        </p>
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
      {err && <p className="error-msg" style={{ marginBottom: 14 }}>⚠ {err}</p>}

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

          {/* Reminder Promoter — intentionally has no on/off toggle. Deferred
              reminders depend entirely on this cron, so it is always enabled;
              only its run time is configurable. */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 16 }}>📅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Reminder Promoter</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                  Weekly cron — queues reminders set more than 7 days ahead
                </div>
              </div>
              <StatusPill label="Always on" />
            </div>

            <div style={{
              fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
              marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)',
            }}>
              Reminders further out than 7 days cannot be queued directly, so they are saved
              as <em>deferred</em> and this job queues them once they come within range.
              It cannot be turned off — without it, deferred reminders would never fire.
            </div>

            {!editingPromoter ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusPill label={`at ${settings.reminderPromoter?.time ?? '08:00'}`} />
                  <StatusPill label="every Sunday" />
                </div>
                <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setEditingPromoter(true)}>
                  Edit
                </button>
              </div>
            ) : (
              <div style={{ maxWidth: 180 }}>
                <label className="field-label">Run at</label>
                <input
                  type="time"
                  value={settings.reminderPromoter?.time ?? '08:00'}
                  onChange={(e) => updatePromoter('time', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Google Tasks Sync */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 16 }}>🔄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Google Tasks Sync</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                  Two-way sync between local tasks and Google Tasks, every 15 minutes
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.googleTasksSync?.enabled ?? false}
                  onChange={(e) => setSettings((prev) => prev ? {
                    ...prev,
                    googleTasksSync: { ...(prev.googleTasksSync ?? { enabled: false }), enabled: e.target.checked },
                  } : prev)}
                />
                <span className="toggle-track" />
              </label>
            </div>

            {settings.googleTasksSync?.enabled ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <StatusPill label="every 15 minutes" />
                {settings.googleTasksSync.lastSyncAt && (
                  <StatusPill label={`last synced ${new Date(settings.googleTasksSync.lastSyncAt).toLocaleString()}`} />
                )}
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

          {/* Health Check */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ fontSize: 16 }}>🩺</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Health Check</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                  Nightly check of Kapso, Google tokens, schedules, and Redis
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.healthCheck?.enabled ?? false}
                  onChange={(e) => {
                    updateHealth('enabled', e.target.checked);
                    if (!e.target.checked) setEditingHealth(false);
                  }}
                />
                <span className="toggle-track" />
              </label>
            </div>

            {(settings.healthCheck?.enabled ?? false) && !editingHealth ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <StatusPill label={`at ${settings.healthCheck?.time ?? '23:00'}`} />
                  <StatusPill label="every day" />
                  {settings.healthCheck?.lastRunAt && (
                    <StatusPill label={`last run ${new Date(settings.healthCheck.lastRunAt).toLocaleString()}`} />
                  )}
                </div>
                <button className="btn-ghost" style={{ fontSize: 12, flexShrink: 0 }} onClick={() => setEditingHealth(true)}>
                  Edit
                </button>
              </div>
            ) : (settings.healthCheck?.enabled ?? false) ? (
              <div style={{ maxWidth: 180 }}>
                <label className="field-label">Run at</label>
                <input
                  type="time"
                  value={settings.healthCheck?.time ?? '23:00'}
                  onChange={(e) => updateHealth('time', e.target.value)}
                />
              </div>
            ) : null}
          </div>

          {/* MBA Reminder */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🎓</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>MBA List — Monday Reminder</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Sends pending MBA items every Monday morning
                  </div>
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.mbaReminder?.enabled ?? true}
                  onChange={(e) => setSettings((prev) => prev ? {
                    ...prev,
                    mbaReminder: { ...(prev.mbaReminder ?? { enabled: true, time: '09:00' }), enabled: e.target.checked },
                  } : prev)}
                />
                <span className="toggle-track" />
              </label>
            </div>
            {(settings.mbaReminder?.enabled ?? true) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <label className="field-label" style={{ margin: 0 }}>Time</label>
                <input
                  type="time"
                  value={settings.mbaReminder?.time ?? '09:00'}
                  onChange={(e) => setSettings((prev) => prev ? {
                    ...prev,
                    mbaReminder: { ...(prev.mbaReminder ?? { enabled: true, time: '09:00' }), time: e.target.value },
                  } : prev)}
                  style={{ width: 110 }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>every Monday</span>
              </div>
            )}
          </div>

          <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: 120 }}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
      </div>
    </div>
  );
}
