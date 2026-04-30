import { useEffect, useState } from 'react';
import { api, Project, Idea } from '../api/client';

type View = 'all' | number; // 'all' or a project id

export default function IdeasPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [view, setView] = useState<View>('all');
  const [loading, setLoading] = useState(true);

  // New idea form
  const [newText, setNewText] = useState('');
  const [newProjectId, setNewProjectId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Inline editing
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editProjectId, setEditProjectId] = useState<number>(0);

  // New project form
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  // Rename project
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    const [pRes, iRes] = await Promise.all([api.getProjects(), api.getIdeas()]);
    setProjects(pRes.projects);
    setIdeas(iRes.ideas);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function flash(message: string, isErr = false) {
    if (isErr) { setErr(message); setMsg(''); }
    else { setMsg(message); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, 3000);
  }

  const defaultProject = projects.find((p) => p.isDefault);

  const visibleIdeas = view === 'all'
    ? ideas
    : ideas.filter((i) => i.projectId === view);

  const activeProject = view !== 'all' ? projects.find((p) => p.id === view) : null;

  // --- Idea actions ---
  async function handleCreateIdea(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setSaving(true);
    try {
      const pid = newProjectId ?? (view !== 'all' ? view : defaultProject?.id ?? 1);
      const res = await api.createIdea(newText.trim(), pid);
      setIdeas((prev) => [...prev, res.idea]);
      setProjects((prev) => prev.map((p) => p.id === pid ? { ...p, ideaCount: p.ideaCount + 1 } : p));
      setNewText('');
      flash('Idea saved.');
    } catch {
      flash('Failed to save idea.', true);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(idea: Idea) {
    setEditingId(idea.id);
    setEditText(idea.text);
    setEditProjectId(idea.projectId);
  }

  async function handleSaveEdit(id: number) {
    const original = ideas.find((i) => i.id === id);
    if (!original) return;
    try {
      await api.updateIdea(id, { text: editText, projectId: editProjectId });
      setIdeas((prev) => prev.map((i) => i.id === id
        ? { ...i, text: editText, projectId: editProjectId, updatedAt: new Date().toISOString() }
        : i
      ));
      // Update project counts if project changed
      if (original.projectId !== editProjectId) {
        setProjects((prev) => prev.map((p) => {
          if (p.id === original.projectId) return { ...p, ideaCount: Math.max(0, p.ideaCount - 1) };
          if (p.id === editProjectId) return { ...p, ideaCount: p.ideaCount + 1 };
          return p;
        }));
      }
      setEditingId(null);
      flash('Idea updated.');
    } catch {
      flash('Failed to update idea.', true);
    }
  }

  async function handleDeleteIdea(id: number) {
    if (!confirm('Delete this idea?')) return;
    try {
      const idea = ideas.find((i) => i.id === id);
      await api.deleteIdea(id);
      setIdeas((prev) => prev.filter((i) => i.id !== id));
      if (idea) {
        setProjects((prev) => prev.map((p) => p.id === idea.projectId
          ? { ...p, ideaCount: Math.max(0, p.ideaCount - 1) }
          : p
        ));
      }
    } catch {
      flash('Failed to delete idea.', true);
    }
  }

  // --- Project actions ---
  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setAddingProject(true);
    try {
      const res = await api.createProject(newProjectName.trim());
      setProjects((prev) => [...prev, res.project]);
      setNewProjectName('');
      flash(`Project "${res.project.name}" created.`);
    } catch {
      flash('Failed to create project.', true);
    } finally {
      setAddingProject(false);
    }
  }

  async function handleRenameProject(id: number) {
    if (!renameValue.trim()) return;
    try {
      await api.renameProject(id, renameValue.trim());
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name: renameValue.trim() } : p));
      setRenamingId(null);
      flash('Project renamed.');
    } catch {
      flash('Failed to rename project.', true);
    }
  }

  async function handleDeleteProject(id: number, name: string) {
    const project = projects.find((p) => p.id === id);
    const count = project?.ideaCount ?? 0;
    const confirmMsg = count > 0
      ? `Delete project "${name}"? Its ${count} idea${count !== 1 ? 's' : ''} will move to the default project.`
      : `Delete project "${name}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      await api.deleteProject(id);
      if (view === id) setView('all');
      // Move ideas locally
      const defId = defaultProject?.id ?? 1;
      setIdeas((prev) => prev.map((i) => i.projectId === id ? { ...i, projectId: defId } : i));
      setProjects((prev) => {
        const filtered = prev.filter((p) => p.id !== id);
        return filtered.map((p) => p.id === defId ? { ...p, ideaCount: p.ideaCount + count } : p);
      });
      flash('Project deleted.');
    } catch {
      flash('Failed to delete project.', true);
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
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minHeight: '70vh' }}>

      {/* ── Left: Project folders ─────────────────────── */}
      <div style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px' }}>💡 Ideas</div>
        </div>

        {/* All Ideas */}
        <button
          onClick={() => setView('all')}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 14px',
            background: view === 'all' ? '#151e30' : 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--border)',
            color: view === 'all' ? '#fff' : 'var(--text-muted)',
            fontSize: 13,
            fontWeight: view === 'all' ? 600 : 400,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ opacity: 0.6 }}>🗂</span>
          <span style={{ flex: 1 }}>All ideas</span>
          <span style={{
            fontSize: 11, fontWeight: 600,
            background: view === 'all' ? 'rgba(59,130,246,0.2)' : '#1c1c1c',
            color: view === 'all' ? 'var(--blue-bright)' : 'var(--text-dim)',
            padding: '1px 6px', borderRadius: 99,
          }}>
            {ideas.length}
          </span>
        </button>

        {/* Project list */}
        <div style={{ padding: '6px 0' }}>
          <div style={{
            padding: '6px 14px 4px',
            fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--text-dim)',
          }}>
            Projects
          </div>

          {projects.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              {renamingId === p.id ? (
                <div style={{ padding: '4px 10px', display: 'flex', gap: 4 }}>
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameProject(p.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    autoFocus
                  />
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => handleRenameProject(p.id)}
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setView(p.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    background: view === p.id ? '#151e30' : 'transparent',
                    border: 'none',
                    color: view === p.id ? '#fff' : 'var(--text-muted)',
                    fontSize: 13,
                    fontWeight: view === p.id ? 600 : 400,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                >
                  <span style={{ opacity: 0.5, fontSize: 13 }}>📁</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    background: view === p.id ? 'rgba(59,130,246,0.2)' : '#1c1c1c',
                    color: view === p.id ? 'var(--blue-bright)' : 'var(--text-dim)',
                    padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                  }}>
                    {p.ideaCount}
                  </span>
                </button>
              )}

              {/* Hover actions for project (rename / delete) */}
              {view === p.id && renamingId !== p.id && (
                <div style={{
                  display: 'flex', gap: 2,
                  padding: '0 8px 6px',
                }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: 10, padding: '2px 8px', flex: 1 }}
                    onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                  >
                    Rename
                  </button>
                  {!p.isDefault && (
                    <button
                      className="btn-danger"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => handleDeleteProject(p.id, p.name)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* New project form */}
        <div style={{ padding: '8px 10px 12px', borderTop: '1px solid var(--border)' }}>
          <form onSubmit={handleCreateProject} style={{ display: 'flex', gap: 4 }}>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="New project…"
              style={{ fontSize: 12, padding: '5px 8px' }}
            />
            <button
              type="submit"
              className="btn-ghost"
              style={{ fontSize: 11, padding: '5px 8px', flexShrink: 0 }}
              disabled={addingProject || !newProjectName.trim()}
            >
              +
            </button>
          </form>
        </div>
      </div>

      {/* ── Right: Ideas list ─────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
              {view === 'all' ? 'All ideas' : (activeProject?.name ?? 'Project')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
              {visibleIdeas.length} idea{visibleIdeas.length !== 1 ? 's' : ''}
              {view === 'all' && ` across ${projects.length} project${projects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
        {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

        {/* New idea form */}
        <form
          onSubmit={handleCreateIdea}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 16,
            marginBottom: 16,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: 1 }}>
            <label className="field-label">New idea</label>
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="What's the idea?"
            />
          </div>
          {view === 'all' && (
            <div style={{ width: 160 }}>
              <label className="field-label">Project</label>
              <select
                value={newProjectId ?? defaultProject?.id ?? ''}
                onChange={(e) => setNewProjectId(Number(e.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !newText.trim()}
            style={{ flexShrink: 0 }}
          >
            {saving ? 'Saving…' : 'Add idea'}
          </button>
        </form>

        {/* Ideas list */}
        {visibleIdeas.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>💡</div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No ideas here yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Add one above or send <code>/ideas your idea</code> from WhatsApp.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleIdeas.map((idea) => {
              const project = projects.find((p) => p.id === idea.projectId);
              const isEditing = editingId === idea.id;

              return (
                <div
                  key={idea.id}
                  className="card"
                  style={{ padding: '14px 18px' }}
                >
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <input
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <label className="field-label">Project</label>
                          <select
                            value={editProjectId}
                            onChange={(e) => setEditProjectId(Number(e.target.value))}
                          >
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 18 }}>
                          <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => handleSaveEdit(idea.id)}>
                            Save
                          </button>
                          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{idea.text}</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                          {view === 'all' && project && (
                            <span style={{
                              fontSize: 11, color: 'var(--blue-bright)',
                              background: 'var(--blue-dim)',
                              border: '1px solid rgba(96,165,250,0.15)',
                              padding: '1px 7px', borderRadius: 99,
                              fontWeight: 500,
                            }}>
                              📁 {project.name}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                            {new Date(idea.updatedAt ?? idea.createdAt).toLocaleDateString('en-GB', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                            {idea.updatedAt ? ' · edited' : ''}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn-ghost"
                          style={{ fontSize: 12 }}
                          onClick={() => startEdit(idea)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-danger"
                          style={{ fontSize: 12 }}
                          onClick={() => handleDeleteIdea(idea.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
