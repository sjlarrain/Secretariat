import { useEffect, useState } from 'react';
import { api, MbaItem, SnoozeOption } from '../api/client';
import SnoozeModal from '../components/SnoozeModal';

function formatDue(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Due dates inside this window are past the automatic 24h-before reminder. */
function isDueSoon(iso: string): boolean {
  return new Date(iso).getTime() - Date.now() < 24 * 60 * 60 * 1000;
}

export default function MbaPage() {
  const [items, setItems] = useState<MbaItem[]>([]);
  const [done, setDone] = useState<MbaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newDueTime, setNewDueTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [snoozeTarget, setSnoozeTarget] = useState<{ item: MbaItem; mode: 'snooze' | 'remind' } | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);

  async function load() {
    setLoading(true);
    const [activeRes, doneRes] = await Promise.all([api.getMbaItems(), api.getDoneMbaItems()]);
    setItems(activeRes.items);
    setDone(doneRes.items);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function flash(message: string, isErr = false) {
    if (isErr) { setErr(message); setMsg(''); }
    else { setMsg(message); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, 3000);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setSaving(true);
    try {
      // Default to end of day when a date is given without a time.
      const dueDate = newDueDate
        ? new Date(`${newDueDate}T${newDueTime || '23:59'}:00`).toISOString()
        : undefined;
      const res = await api.createMbaItem(newText.trim(), dueDate);
      setItems((prev) => [...prev, res.item]);
      setNewText('');
      setNewDueDate('');
      setNewDueTime('');
      flash(dueDate ? 'Added — reminder set for 24h before it is due.' : 'Added to MBA list.');
    } catch {
      flash('Failed to add item.', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id: number) {
    try {
      const item = items.find((w) => w.id === id);
      await api.markMbaItemDone(id);
      setItems((prev) => prev.filter((w) => w.id !== id));
      if (item) setDone((prev) => [...prev, { ...item, doneAt: new Date().toISOString() }]);
      flash('Marked as done!');
    } catch {
      flash('Failed to mark as done.', true);
    }
  }

  async function handleSnooze(option: SnoozeOption) {
    if (!snoozeTarget) return;
    setSnoozing(true);
    try {
      const { item, mode } = snoozeTarget;
      const res = mode === 'snooze'
        ? await api.snoozeMba(item.id, option) as { ok: boolean; fireAt: string }
        : await api.remindMba(item.id, option) as { ok: boolean; fireAt: string };
      setItems((prev) => prev.map((w) => w.id === item.id
        ? { ...w, reminderFor: res.fireAt, qstashMessageId: 'scheduled' }
        : w));
      setSnoozeTarget(null);
      flash(mode === 'snooze' ? 'Snoozed!' : 'Reminder added!');
    } catch {
      flash('Failed. Try again.', true);
    } finally {
      setSnoozing(false);
    }
  }

  function openEditReminder(item: MbaItem) {
    const d = item.reminderFor ? new Date(item.reminderFor) : new Date();
    setEditDate(d.toLocaleDateString('en-CA'));
    setEditTime(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }));
    setEditingReminderId(item.id);
    setSnoozeTarget(null);
  }

  async function handleSaveReminder(id: number) {
    if (!editDate || !editTime) return;
    setSavingReminder(true);
    setErr('');
    try {
      const fireAt = new Date(`${editDate}T${editTime}:00`).toISOString();
      await api.updateMbaReminder(id, fireAt);
      setItems((prev) => prev.map((w) => w.id === id
        ? { ...w, reminderFor: fireAt, qstashMessageId: w.qstashMessageId ?? 'scheduled' }
        : w));
      setEditingReminderId(null);
      flash('Reminder updated.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update reminder. Check the date and time.');
    } finally {
      setSavingReminder(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this MBA item?')) return;
    try {
      await api.deleteMbaItem(id);
      setItems((prev) => prev.filter((w) => w.id !== id));
    } catch {
      flash('Failed to delete item.', true);
    }
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>MBA List</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {items.length} pending · due items remind 24h ahead · Monday reminder auto-sends to WhatsApp
          </p>
        </div>
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
      {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

      {/* Add item form */}
      <form
        onSubmit={handleAdd}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16,
          display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <label className="field-label">New MBA item</label>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="What needs to be done?"
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <label className="field-label">Due date <span style={{ color: 'var(--text-dim)' }}>(optional)</span></label>
          <input
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
        </div>
        <div style={{ flexShrink: 0 }}>
          <label className="field-label">Time</label>
          <input
            type="time"
            value={newDueTime}
            onChange={(e) => setNewDueTime(e.target.value)}
            disabled={!newDueDate}
            placeholder="23:59"
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving || !newText.trim()} style={{ flexShrink: 0 }}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>

      {/* Active items */}
      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>MBA list is clear!</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Add items above or send <code>/mba your task</code> from WhatsApp.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {items.map((item, i) => (
            <div key={item.id} className="card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 8 }}>{i + 1}.</span>
                    {item.text}
                  </div>
                  {item.dueDate && (
                    <div style={{
                      fontSize: 11,
                      color: isDueSoon(item.dueDate) ? 'var(--red, #e5534b)' : 'var(--text-muted)',
                      marginTop: 4,
                    }}>
                      📅 Due: {formatDue(item.dueDate)}
                      {isDueSoon(item.dueDate) && ' · due within 24h'}
                    </div>
                  )}
                  {item.reminderFor && (
                    <div style={{ fontSize: 11, color: 'var(--blue-bright)', marginTop: 4 }}>
                      ⏰ Reminder: {formatDue(item.reminderFor)}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {item.qstashMessageId ? (
                    <>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 12 }}
                        onClick={() => setSnoozeTarget({ item, mode: 'snooze' })}
                      >Snooze</button>
                      <button
                        className="btn-secondary"
                        style={{ fontSize: 12 }}
                        onClick={() => editingReminderId === item.id ? setEditingReminderId(null) : openEditReminder(item)}
                      >{editingReminderId === item.id ? 'Close' : 'Edit'}</button>
                    </>
                  ) : (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => setSnoozeTarget({ item, mode: 'remind' })}
                    >+ Remind</button>
                  )}
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, color: 'var(--green)', borderColor: 'var(--green)' }}
                    onClick={() => handleDone(item.id)}
                  >✓ Done</button>
                  <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handleDelete(item.id)}>
                    Delete
                  </button>
                </div>
              </div>
              {editingReminderId === item.id && (
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
                    onClick={() => handleSaveReminder(item.id)}
                  >
                    {savingReminder ? '…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completed section (collapsed) */}
      {done.length > 0 && (
        <div>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, marginBottom: 10 }}
            onClick={() => setShowDone((v) => !v)}
          >
            {showDone ? '▾' : '▸'} Completed ({done.length})
          </button>
          {showDone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {done.map((item) => (
                <div key={item.id} className="card" style={{ padding: '12px 18px', opacity: 0.65 }}>
                  <div style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--text-muted)' }}>
                    {item.text}
                  </div>
                  {item.doneAt && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                      Done {new Date(item.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {snoozeTarget && (
        <SnoozeModal
          title={snoozeTarget.item.text}
          mode={snoozeTarget.mode}
          loading={snoozing}
          onSelect={handleSnooze}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
    </div>
  );
}
