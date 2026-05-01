import { useEffect, useState } from 'react';
import { api, PlanType } from '../api/client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface EditState {
  name: string;
  days: number[];
  slots: string[];
  durationMinutes: number;
  newSlot: string;
}

function emptyEdit(): EditState {
  return { name: '', days: [1, 2, 3, 4, 5], slots: [], durationMinutes: 60, newSlot: '' };
}

function planToEdit(p: PlanType): EditState {
  return { name: p.name, days: p.days, slots: p.slots, durationMinutes: p.durationMinutes, newSlot: '' };
}

export default function Plans() {
  const [plans, setPlans] = useState<PlanType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [edit, setEdit] = useState<EditState>(emptyEdit());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    const res = await api.getPlans();
    setPlans(res.plans);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function flash(message: string, isErr = false) {
    if (isErr) { setErr(message); setMsg(''); }
    else { setMsg(message); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, 3000);
  }

  function toggleDay(day: number) {
    setEdit((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day].sort(),
    }));
  }

  function addSlot() {
    const slot = edit.newSlot.trim();
    if (!slot || edit.slots.includes(slot)) return;
    setEdit((prev) => ({ ...prev, slots: [...prev.slots, slot].sort(), newSlot: '' }));
  }

  function removeSlot(slot: string) {
    setEdit((prev) => ({ ...prev, slots: prev.slots.filter((s) => s !== slot) }));
  }

  async function handleSave() {
    if (!edit.name.trim()) { flash('Name is required.', true); return; }
    if (edit.days.length === 0) { flash('Select at least one day.', true); return; }
    if (edit.slots.length === 0) { flash('Add at least one time slot.', true); return; }
    setSaving(true);
    try {
      const data = { name: edit.name.trim(), days: edit.days, slots: edit.slots, durationMinutes: edit.durationMinutes };
      if (editingId === 'new') {
        const res = await api.createPlan(data);
        setPlans((prev) => [...prev, res.plan]);
        flash(`Plan "${res.plan.name}" created.`);
      } else if (editingId !== null) {
        await api.updatePlan(editingId, data);
        setPlans((prev) => prev.map((p) => p.id === editingId ? { ...p, ...data } : p));
        flash('Plan updated.');
      }
      setEditingId(null);
    } catch {
      flash('Failed to save plan.', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete plan "${name}"?`)) return;
    try {
      await api.deletePlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
      flash('Plan deleted.');
    } catch {
      flash('Failed to delete plan.', true);
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

  const isEditing = editingId !== null;

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Plans</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            Meeting types used by <code>/myschedule --plan</code> to find free slots
          </p>
        </div>
        {!isEditing && (
          <button className="btn-primary" onClick={() => { setEdit(emptyEdit()); setEditingId('new'); }}>
            + New plan
          </button>
        )}
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
      {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

      {/* New plan form */}
      {editingId === 'new' && (
        <PlanForm
          edit={edit}
          setEdit={setEdit}
          toggleDay={toggleDay}
          addSlot={addSlot}
          removeSlot={removeSlot}
          onSave={handleSave}
          onCancel={() => setEditingId(null)}
          saving={saving}
          title="New plan"
        />
      )}

      {/* Plan cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {plans.map((plan) => (
          <div key={plan.id}>
            {editingId === plan.id ? (
              <PlanForm
                edit={edit}
                setEdit={setEdit}
                toggleDay={toggleDay}
                addSlot={addSlot}
                removeSlot={removeSlot}
                onSave={handleSave}
                onCancel={() => setEditingId(null)}
                saving={saving}
                title={`Edit: ${plan.name}`}
              />
            ) : (
              <div className="card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>{plan.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {DAYS.map((d, i) => (
                        <span key={i} style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                          background: plan.days.includes(i) ? 'var(--blue-dim)' : '#1a1a1a',
                          color: plan.days.includes(i) ? 'var(--blue-bright)' : 'var(--text-dim)',
                          border: plan.days.includes(i) ? '1px solid rgba(59,130,246,0.2)' : '1px solid var(--border)',
                        }}>{d}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {plan.slots.map((s) => (
                        <code key={s} style={{ fontSize: 12, background: '#141414', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 6 }}>
                          {s}
                        </code>
                      ))}
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>· {plan.durationMinutes} min</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn-ghost" style={{ fontSize: 12 }}
                      onClick={() => { setEdit(planToEdit(plan)); setEditingId(plan.id); }}>
                      Edit
                    </button>
                    <button className="btn-danger" style={{ fontSize: 12 }}
                      onClick={() => handleDelete(plan.id, plan.name)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {plans.length === 0 && editingId !== 'new' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>📋</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No plan types yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Create one above to use <code>/myschedule --plan</code> from WhatsApp.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface PlanFormProps {
  edit: EditState;
  setEdit: React.Dispatch<React.SetStateAction<EditState>>;
  toggleDay: (day: number) => void;
  addSlot: () => void;
  removeSlot: (slot: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
}

function PlanForm({ edit, setEdit, toggleDay, addSlot, removeSlot, onSave, onCancel, saving, title }: PlanFormProps) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="card" style={{ padding: '20px 22px', marginBottom: 12, border: '1px solid rgba(59,130,246,0.2)' }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 18, color: 'var(--blue-bright)' }}>{title}</div>

      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Name</label>
        <input
          value={edit.name}
          onChange={(e) => setEdit((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. Lunch, Coffee…"
          style={{ maxWidth: 280 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Days</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DAYS.map((d, i) => (
            <button
              key={i}
              className={`day-pill${edit.days.includes(i) ? ' active' : ''}`}
              onClick={() => toggleDay(i)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label className="field-label">Time slots (HH:MM)</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {edit.slots.map((s) => (
            <span key={s} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, background: '#141414', border: '1px solid var(--border)',
              padding: '3px 10px', borderRadius: 6,
            }}>
              <code>{s}</code>
              <button onClick={() => removeSlot(s)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="time"
            value={edit.newSlot}
            onChange={(e) => setEdit((prev) => ({ ...prev, newSlot: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') addSlot(); }}
            style={{ maxWidth: 140 }}
          />
          <button className="btn-ghost" onClick={addSlot} style={{ fontSize: 12 }}>+ Add</button>
        </div>
      </div>

      <div style={{ marginBottom: 20, maxWidth: 200 }}>
        <label className="field-label">Duration (minutes)</label>
        <input
          type="number"
          min={5}
          max={480}
          value={edit.durationMinutes}
          onChange={(e) => setEdit((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" onClick={onSave} disabled={saving} style={{ minWidth: 100 }}>
          {saving ? 'Saving…' : 'Save plan'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
