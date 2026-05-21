import { useEffect, useState } from 'react';
import { api, LocalTask } from '../api/client';

export default function TasksPage() {
  const [items, setItems] = useState<LocalTask[]>([]);
  const [done, setDone] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newProject, setNewProject] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    const [activeRes, doneRes] = await Promise.all([api.getTasks(), api.getDoneTasks()]);
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
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await api.createTask(newTitle.trim(), newProject.trim() || undefined);
      setItems((prev) => [...prev, res.item]);
      setNewTitle('');
      setNewProject('');
      flash('Task saved.');
    } catch {
      flash('Failed to add task.', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDone(id: number) {
    try {
      const item = items.find((t) => t.id === id);
      await api.markTaskDone(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
      if (item) setDone((prev) => [...prev, { ...item, status: 'done', doneAt: new Date().toISOString() }]);
      flash('Marked as done!');
    } catch {
      flash('Failed to mark done.', true);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this task?')) return;
    try {
      await api.deleteTask(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
    } catch {
      flash('Failed to delete task.', true);
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

  const projects = [...new Set(items.map((t) => t.project ?? 'General').sort())];
  const filtered = filterProject
    ? items.filter((t) => (t.project ?? 'General') === filterProject)
    : items;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Tasks</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {items.length} open · use <code>/task</code> from WhatsApp to add tasks
          </p>
        </div>

        {/* Project filter */}
        {projects.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className={filterProject === '' ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 12 }}
              onClick={() => setFilterProject('')}
            >
              All
            </button>
            {projects.map((p) => (
              <button
                key={p}
                className={filterProject === p ? 'btn-primary' : 'btn-ghost'}
                style={{ fontSize: 12 }}
                onClick={() => setFilterProject(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
      {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

      {/* Add task form */}
      <form
        onSubmit={handleAdd}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16,
          display: 'flex', gap: 10, alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: 2 }}>
          <label className="field-label">New task</label>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What needs to be done?"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Project (optional)</label>
          <input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="e.g. Personal"
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving || !newTitle.trim()} style={{ flexShrink: 0 }}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>

      {/* Active tasks */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>📋</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
            {filterProject ? `No open tasks in ${filterProject}` : 'No open tasks'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Add one above or send <code>/task your task</code> from WhatsApp.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {filtered.map((task) => (
            <div key={task.id} className="card" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: 8 }}>#{task.id}</span>
                    {task.title}
                    {task.project && (
                      <span style={{
                        marginLeft: 8, fontSize: 11, fontWeight: 600,
                        color: 'var(--blue-bright)', background: 'var(--blue-dim)',
                        padding: '2px 7px', borderRadius: 6,
                      }}>
                        {task.project}
                      </span>
                    )}
                  </div>
                  {task.dueDate && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                      📅 {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {task.dueTime && ` at ${task.dueTime}`}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 12, color: 'var(--green)', borderColor: 'var(--green)' }}
                    onClick={() => handleDone(task.id)}
                  >✓ Done</button>
                  <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handleDelete(task.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed section */}
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
              {done.map((task) => (
                <div key={task.id} className="card" style={{ padding: '12px 18px', opacity: 0.65 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, textDecoration: 'line-through', color: 'var(--text-muted)', flex: 1 }}>
                      {task.title}
                    </span>
                    {task.project && (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{task.project}</span>
                    )}
                  </div>
                  {task.doneAt && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                      Done {new Date(task.doneAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
