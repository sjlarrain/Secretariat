import { useEffect, useState } from 'react';
import { api, Reminder, SnoozeOption } from '../api/client';
import SnoozeModal from '../components/SnoozeModal';

function formatFireAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingReminder, setEditingReminder] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<Reminder | null>(null);
  const [snoozing, setSnoozing] = useState(false);

  useEffect(() => {
    api.getReminders().then((r) => setReminders(r.reminders));
  }, []);

  if (!reminders) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  async function handleDeleteReminder(id: string) {
    setDeletingId(id);
    try {
      await api.deleteReminder(id);
      setReminders((prev) => (prev ?? []).filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  function openEditReminder(r: Reminder) {
    const d = new Date(r.fireAt);
    setEditDate(d.toLocaleDateString('en-CA')); // YYYY-MM-DD for input[type=date]
    setEditTime(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
    setEditingReminder(r.id);
  }

  async function handleSnoozeReminder(option: SnoozeOption) {
    if (!snoozeTarget) return;
    setSnoozing(true);
    try {
      const res = await api.snoozeReminder(snoozeTarget.id, option) as { ok: boolean; fireAt: string };
      setReminders((prev) => (prev ?? []).map((r) => r.id === snoozeTarget!.id ? { ...r, fireAt: res.fireAt } : r));
      // Sync edit form if it's open for the same reminder
      if (editingReminder === snoozeTarget.id) {
        const d = new Date(res.fireAt);
        setEditDate(d.toLocaleDateString('en-CA'));
        setEditTime(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
      }
      setSnoozeTarget(null);
      setMsg('Snoozed!');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setSnoozeTarget(null);
      setErr(e instanceof Error ? e.message : 'Snooze failed.');
      setTimeout(() => setErr(''), 4000);
    } finally {
      setSnoozing(false);
    }
  }

  async function handleSaveReminder(id: string) {
    if (!editDate || !editTime) return;
    setSavingReminder(true);
    setErr('');
    try {
      const fireAt = new Date(`${editDate}T${editTime}:00`).toISOString();
      await api.updateReminder(id, fireAt);
      setReminders((prev) => (prev ?? []).map((r) => r.id === id ? { ...r, fireAt } : r));
      setEditingReminder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update reminder. Check the date and time.');
    } finally {
      setSavingReminder(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Reminders</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          {reminders.length > 0
            ? `${reminders.length} queued · sent to WhatsApp when they fire`
            : 'Pending one-off reminders from /reminder'}
        </p>
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
      {err && <p className="error-msg" style={{ marginBottom: 14 }}>⚠ {err}</p>}

      {reminders.length === 0 ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>⏰</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No pending reminders</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Send <code>/reminder Call the dentist --for tomorrow --at 09:00</code> from WhatsApp.
          </div>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, wordBreak: 'break-word' }}>
                        {r.title}
                      </div>
                      {r.deferred && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, flexShrink: 0,
                          color: 'var(--orange)', background: 'var(--orange-dim)',
                          border: '1px solid var(--orange-border)',
                          padding: '1px 7px', borderRadius: 99,
                        }} title="More than 7 days out — not yet queued in QStash; the weekly promoter will queue it closer to fire time.">
                          Deferred
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {formatFireAt(r.fireAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => { setSnoozeTarget(r); setEditingReminder(null); }}
                    >
                      Snooze
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => { setSnoozeTarget(null); editingReminder === r.id ? setEditingReminder(null) : openEditReminder(r); }}
                    >
                      {editingReminder === r.id ? 'Close' : 'Edit'}
                    </button>
                    <button
                      className="btn-danger"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      disabled={deletingId === r.id}
                      onClick={() => handleDeleteReminder(r.id)}
                    >
                      {deletingId === r.id ? '…' : 'Cancel'}
                    </button>
                  </div>
                </div>
                {editingReminder === r.id && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px' }}
                    />
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      style={{ fontSize: 12, padding: '3px 6px' }}
                    />
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      disabled={savingReminder}
                      onClick={() => handleSaveReminder(r.id)}
                    >
                      {savingReminder ? '…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {snoozeTarget && (
        <SnoozeModal
          title={snoozeTarget.title}
          mode="snooze"
          loading={snoozing}
          onSelect={handleSnoozeReminder}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
    </div>
  );
}
