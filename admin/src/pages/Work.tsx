import { useEffect, useState } from 'react';
import { api, WorkItem, SnoozeOption } from '../api/client';
import SnoozeModal from '../components/SnoozeModal';

export default function WorkPage() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [done, setDone] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [snoozeTarget, setSnoozeTarget] = useState<{ item: WorkItem; mode: 'snooze' | 'remind' } | null>(null);
  const [snoozing, setSnoozing] = useState(false);

  async function load() {
    setLoading(true);
    const [activeRes, doneRes] = await Promise.all([api.getWorkItems(), api.getDoneWorkItems()]);
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
      const res = await api.createWorkItem(newText.trim());
      setItems((prev) => [...prev, res.item]);
      setNewText('');
      flash('Added to work list.');
    } catch {
      flash('Failed to add item.', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id: number) {
    try {
      const item = items.find((w) => w.id === id);
      await api.markWorkItemDone(id);
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
        ? await api.snoozeWork(item.id, option) as { ok: boolean; fireAt: string }
        : await api.remindWork(item.id, option) as { ok: boolean; fireAt: string };
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

  async function handleDelete(id: number) {
    if (!confirm('Delete this work item?')) return;
    try {
      await api.deleteWorkItem(id);
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
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Work List</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {items.length} pending · Monday reminder auto-sends to WhatsApp
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
          display: 'flex', gap: 10, alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: 1 }}>
          <label className="field-label">New work item</label>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="What needs to be done?"
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
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Work list is clear!</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Add items above or send <code>/work your task</code> from WhatsApp.
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
                  {item.reminderFor && (
                    <div style={{ fontSize: 11, color: 'var(--blue-bright)', marginTop: 4 }}>
                      ⏰ Reminder: {new Date(item.reminderFor).toLocaleString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {item.qstashMessageId ? (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => setSnoozeTarget({ item, mode: 'snooze' })}
                    >Snooze</button>
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
