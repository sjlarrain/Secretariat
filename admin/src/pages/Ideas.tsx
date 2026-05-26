import { useEffect, useState, useRef } from 'react';
import { api, Project, Idea } from '../api/client';
import { useIsMobile } from '../hooks/useIsMobile';

type View = 'all' | 'trash' | 'done' | number;
type LayoutMode = 'list' | 'grid';

export default function IdeasPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [trashed, setTrashed] = useState<Idea[]>([]);
  const [done, setDone] = useState<Idea[]>([]);
  const [view, setView] = useState<View>('all');
  const [layout, setLayout] = useState<LayoutMode>('list');
  const [loading, setLoading] = useState(true);

  const [newText, setNewText] = useState('');
  const [newProjectId, setNewProjectId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editProjectId, setEditProjectId] = useState<number>(0);

  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const isMobile = useIsMobile();

  async function load() {
    setLoading(true);
    const [pRes, iRes, tRes, dRes] = await Promise.all([
      api.getProjects(),
      api.getIdeas(),
      api.getTrashedIdeas(),
      api.getDoneIdeas(),
    ]);
    setProjects(pRes.projects);
    setIdeas(iRes.ideas);
    setTrashed(tRes.ideas);
    setDone(dRes.ideas);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (view === 'trash') {
      api.getTrashedIdeas().then((res) => setTrashed(res.ideas));
    }
  }, [view]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function flash(message: string, isErr = false) {
    if (isErr) { setErr(message); setMsg(''); }
    else { setMsg(message); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, 3000);
  }

  const defaultProject = projects.find((p) => p.isDefault);
  const activeProject = typeof view === 'number' ? projects.find((p) => p.id === view) : null;

  const visibleIdeas = view === 'all'
    ? ideas
    : typeof view === 'number'
      ? ideas.filter((i) => i.projectId === view)
      : [];

  async function handleCreateIdea(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setSaving(true);
    try {
      const pid = newProjectId ?? (typeof view === 'number' ? view : defaultProject?.id ?? 1);
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

  async function handleMarkDone(id: number) {
    try {
      const idea = ideas.find((i) => i.id === id);
      await api.markIdeaDone(id);
      setIdeas((prev) => prev.filter((i) => i.id !== id));
      if (idea) {
        setDone((prev) => [...prev, { ...idea, usedAt: new Date().toISOString() }]);
        setProjects((prev) => prev.map((p) => p.id === idea.projectId
          ? { ...p, ideaCount: Math.max(0, p.ideaCount - 1) }
          : p
        ));
      }
      flash('Idea marked as done!');
    } catch {
      flash('Failed to mark idea as done.', true);
    }
  }

  async function handleDeleteIdea(id: number) {
    if (!confirm('Move this idea to trash?')) return;
    try {
      const idea = ideas.find((i) => i.id === id);
      await api.deleteIdea(id);
      setIdeas((prev) => prev.filter((i) => i.id !== id));
      if (idea) {
        setProjects((prev) => prev.map((p) => p.id === idea.projectId
          ? { ...p, ideaCount: Math.max(0, p.ideaCount - 1) }
          : p
        ));
        setTrashed((prev) => [...prev, { ...idea, deletedAt: new Date().toISOString() }]);
      }
    } catch {
      flash('Failed to delete idea.', true);
    }
  }

  async function handleRestore(id: number) {
    try {
      await api.restoreIdea(id);
      const idea = trashed.find((i) => i.id === id);
      setTrashed((prev) => prev.filter((i) => i.id !== id));
      if (idea) {
        const restored = { ...idea, deletedAt: undefined };
        setIdeas((prev) => [...prev, restored]);
        setProjects((prev) => prev.map((p) => p.id === idea.projectId
          ? { ...p, ideaCount: p.ideaCount + 1 }
          : p
        ));
      }
      flash('Idea restored.');
    } catch {
      flash('Failed to restore idea.', true);
    }
  }

  async function handlePermanentDelete(id: number) {
    if (!confirm('Permanently delete this idea? This cannot be undone.')) return;
    try {
      await api.permanentlyDeleteIdea(id);
      setTrashed((prev) => prev.filter((i) => i.id !== id));
    } catch {
      flash('Failed to delete idea.', true);
    }
  }

  async function handleEmptyTrash() {
    if (!confirm(`Permanently delete all ${trashed.length} idea${trashed.length !== 1 ? 's' : ''} in trash? This cannot be undone.`)) return;
    try {
      await api.emptyTrash();
      setTrashed([]);
      flash('Trash emptied.');
    } catch {
      flash('Failed to empty trash.', true);
    }
  }

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
      setMenuOpenId(null);
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
      const defId = defaultProject?.id ?? 1;
      setIdeas((prev) => prev.map((i) => i.projectId === id ? { ...i, projectId: defId } : i));
      setProjects((prev) => {
        const filtered = prev.filter((p) => p.id !== id);
        return filtered.map((p) => p.id === defId ? { ...p, ideaCount: p.ideaCount + count } : p);
      });
      setMenuOpenId(null);
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

  // ── Grid view (desktop only) ───────────────────────────
  if (layout === 'grid' && view === 'all' && !isMobile) {
    const lastIdea = (p: Project) => {
      const match = [...ideas].reverse().find((i) => i.projectId === p.id);
      return match?.text ?? null;
    };

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Ideas</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
              {ideas.length} idea{ideas.length !== 1 ? 's' : ''} across {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-ghost" style={{ fontSize: 15, padding: '6px 10px' }} onClick={() => setLayout('list')} title="List view">☰</button>
            <button className="btn-ghost active" style={{ fontSize: 15, padding: '6px 10px' }} onClick={() => setLayout('grid')} title="Grid view">⊞</button>
          </div>
        </div>

        {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
        {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <button
            onClick={() => { setLayout('list'); setView('all'); }}
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer', padding: '18px 20px', border: '1px solid var(--border)' }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>🗂</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>All ideas</div>
            <div style={{ fontSize: 12, color: 'var(--blue-bright)', fontWeight: 600 }}>{ideas.length} ideas</div>
          </button>

          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { setLayout('list'); setView(p.id); }}
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer', padding: '18px 20px', border: '1px solid var(--border)' }}
            >
              <div style={{ fontSize: 22, marginBottom: 8 }}>📁</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--blue-bright)', fontWeight: 600, marginBottom: lastIdea(p) ? 8 : 0 }}>
                {p.ideaCount} idea{p.ideaCount !== 1 ? 's' : ''}
              </div>
              {lastIdea(p) && (
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4,
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  {lastIdea(p)}
                </div>
              )}
            </button>
          ))}

          <button
            onClick={() => { setLayout('list'); setView('trash'); }}
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer', padding: '18px 20px', border: '1px solid var(--border)', opacity: 0.7 }}
          >
            <div style={{ fontSize: 22, marginBottom: 8 }}>🗑</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Trash</div>
            <div style={{ fontSize: 12, color: trashed.length > 0 ? 'var(--red)' : 'var(--text-dim)', fontWeight: 600 }}>
              {trashed.length} item{trashed.length !== 1 ? 's' : ''}
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────
  return (
    <div style={{ display: isMobile ? 'block' : 'flex', gap: 24, alignItems: 'flex-start', minHeight: isMobile ? undefined : '70vh' }}>

      {isMobile ? (
        // Mobile: horizontal scrollable filter bar
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
          <button
            className={view === 'all' ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setView('all')}
          >
            🗂 All ({ideas.length})
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={view === p.id ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
              onClick={() => setView(p.id)}
            >
              📁 {p.name} ({p.ideaCount})
            </button>
          ))}
          <button
            className={view === 'done' ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setView('done')}
          >
            ✅ Done ({done.length})
          </button>
          <button
            className={view === 'trash' ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setView('trash')}
          >
            🗑 Trash ({trashed.length})
          </button>
        </div>
      ) : (
        // Desktop: left sidebar with project folders
        <div style={{
          width: 220,
          flexShrink: 0,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px' }}>💡 Ideas</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={`btn-ghost${layout === 'list' ? ' active' : ''}`} style={{ fontSize: 13, padding: '3px 6px' }} onClick={() => setLayout('list')} title="List view">☰</button>
              <button className={`btn-ghost${layout === 'grid' ? ' active' : ''}`} style={{ fontSize: 13, padding: '3px 6px' }} onClick={() => { setLayout('grid'); setView('all'); }} title="Grid view">⊞</button>
            </div>
          </div>

          <button
            onClick={() => setView('all')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px',
              background: view === 'all' ? '#151e30' : 'transparent',
              border: 'none', borderBottom: '1px solid var(--border)',
              color: view === 'all' ? '#fff' : 'var(--text-muted)',
              fontSize: 13, fontWeight: view === 'all' ? 600 : 400,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ opacity: 0.6 }}>🗂</span>
            <span style={{ flex: 1 }}>All ideas</span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              background: view === 'all' ? 'rgba(59,130,246,0.2)' : '#1c1c1c',
              color: view === 'all' ? 'var(--blue-bright)' : 'var(--text-dim)',
              padding: '1px 6px', borderRadius: 99,
            }}>{ideas.length}</span>
          </button>

          <div style={{ padding: '6px 0' }}>
            <div style={{
              padding: '6px 14px 4px', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)',
            }}>Projects</div>

            {projects.map((p) => (
              <div key={p.id}>
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
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => handleRenameProject(p.id)}>✓</button>
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setRenamingId(null)}>✕</button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setView(p.id)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px',
                        background: view === p.id ? '#151e30' : 'transparent',
                        border: 'none',
                        color: view === p.id ? '#fff' : 'var(--text-muted)',
                        fontSize: 13, fontWeight: view === p.id ? 600 : 400,
                        cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s, color 0.1s',
                      }}
                    >
                      <span style={{ opacity: 0.5, fontSize: 13 }}>📁</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        background: view === p.id ? 'rgba(59,130,246,0.2)' : '#1c1c1c',
                        color: view === p.id ? 'var(--blue-bright)' : 'var(--text-dim)',
                        padding: '1px 6px', borderRadius: 99, flexShrink: 0,
                      }}>{p.ideaCount}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === p.id ? null : p.id); }}
                        style={{
                          fontSize: 14, color: 'var(--text-dim)', padding: '0 2px',
                          opacity: view === p.id || menuOpenId === p.id ? 1 : 0,
                          transition: 'opacity 0.1s', flexShrink: 0,
                        }}
                        className="dot-menu-trigger"
                      >⋯</span>
                    </button>

                    {menuOpenId === p.id && (
                      <div ref={menuRef} style={{
                        position: 'absolute', right: 8, top: '100%', zIndex: 50,
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                        minWidth: 120, overflow: 'hidden',
                      }}>
                        <button
                          onClick={() => { setRenamingId(p.id); setRenameValue(p.name); setMenuOpenId(null); setView(p.id); }}
                          style={{
                            width: '100%', display: 'block', padding: '9px 14px',
                            background: 'none', border: 'none', textAlign: 'left',
                            fontSize: 13, color: 'var(--text)', cursor: 'pointer',
                          }}
                        >
                          Rename
                        </button>
                        {!p.isDefault && (
                          <button
                            onClick={() => handleDeleteProject(p.id, p.name)}
                            style={{
                              width: '100%', display: 'block', padding: '9px 14px',
                              background: 'none', border: 'none', textAlign: 'left',
                              fontSize: 13, color: 'var(--red)', cursor: 'pointer',
                              borderTop: '1px solid var(--border)',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ padding: '8px 10px 10px', borderTop: '1px solid var(--border)' }}>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', gap: 4 }}>
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="New project…"
                style={{ fontSize: 12, padding: '5px 8px' }}
              />
              <button type="submit" className="btn-ghost" style={{ fontSize: 11, padding: '5px 8px', flexShrink: 0 }}
                disabled={addingProject || !newProjectName.trim()}>+</button>
            </form>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', padding: '6px 0 8px' }}>
            <button
              onClick={() => setView('done')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px',
                background: view === 'done' ? 'rgba(34,197,94,0.08)' : 'transparent',
                border: 'none',
                color: view === 'done' ? 'var(--green)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: view === 'done' ? 600 : 400,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ opacity: 0.6, fontSize: 13 }}>✅</span>
              <span style={{ flex: 1 }}>Completed</span>
              {done.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  background: view === 'done' ? 'rgba(34,197,94,0.15)' : '#1c1c1c',
                  color: view === 'done' ? 'var(--green)' : 'var(--text-dim)',
                  padding: '1px 6px', borderRadius: 99,
                }}>{done.length}</span>
              )}
            </button>
            <button
              onClick={() => setView('trash')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px',
                background: view === 'trash' ? 'rgba(239,68,68,0.08)' : 'transparent',
                border: 'none',
                color: view === 'trash' ? 'var(--red)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: view === 'trash' ? 600 : 400,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ opacity: 0.6, fontSize: 13 }}>🗑</span>
              <span style={{ flex: 1 }}>Trash</span>
              {trashed.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  background: view === 'trash' ? 'rgba(239,68,68,0.15)' : '#1c1c1c',
                  color: view === 'trash' ? 'var(--red)' : 'var(--text-dim)',
                  padding: '1px 6px', borderRadius: 99,
                }}>{trashed.length}</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Right: Ideas / Trash ──────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
              {view === 'trash' ? 'Trash' : view === 'done' ? 'Completed' : view === 'all' ? 'All ideas' : (activeProject?.name ?? 'Project')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
              {view === 'trash'
                ? `${trashed.length} item${trashed.length !== 1 ? 's' : ''} · auto-deleted after 30 days`
                : view === 'done'
                  ? `${done.length} idea${done.length !== 1 ? 's' : ''} marked as done`
                  : `${visibleIdeas.length} idea${visibleIdeas.length !== 1 ? 's' : ''}${view === 'all' ? ` across ${projects.length} project${projects.length !== 1 ? 's' : ''}` : ''}`
              }
            </p>
          </div>
          {view === 'trash' && trashed.length > 0 && (
            <button className="btn-danger" style={{ fontSize: 12 }} onClick={handleEmptyTrash}>
              Empty trash
            </button>
          )}
        </div>

        {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
        {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

        {/* Done view */}
        {view === 'done' ? (
          done.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>✅</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No completed ideas yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Mark ideas as Done to move them here.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {done.map((idea) => {
                const project = projects.find((p) => p.id === idea.projectId);
                return (
                  <div key={idea.id} className="card" style={{ padding: '14px 18px', opacity: 0.75 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                          {idea.text}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                          {project && (
                            <span style={{
                              fontSize: 11, color: 'var(--text-dim)',
                              background: '#1a1a1a', border: '1px solid var(--border)',
                              padding: '1px 7px', borderRadius: 99,
                            }}>📁 {project.name}</span>
                          )}
                          {idea.usedAt && (
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                              Done {new Date(idea.usedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : view === 'trash' ? (
          trashed.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div style={{ fontSize: 32, marginBottom: 14 }}>🗑</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Trash is empty</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Deleted ideas appear here for 30 days.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trashed.map((idea) => {
                const project = projects.find((p) => p.id === idea.projectId);
                const deletedAt = idea.deletedAt ? new Date(idea.deletedAt) : null;
                const daysLeft = deletedAt
                  ? Math.max(0, 30 - Math.floor((Date.now() - deletedAt.getTime()) / 86400000))
                  : null;

                return (
                  <div key={idea.id} className="card" style={{ padding: '14px 18px', opacity: 0.85 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                          {idea.text}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                          {project && (
                            <span style={{
                              fontSize: 11, color: 'var(--text-dim)',
                              background: '#1a1a1a', border: '1px solid var(--border)',
                              padding: '1px 7px', borderRadius: 99,
                            }}>📁 {project.name}</span>
                          )}
                          {daysLeft !== null && (
                            <span style={{ fontSize: 11, color: daysLeft <= 3 ? 'var(--red)' : 'var(--text-dim)' }}>
                              {daysLeft === 0 ? 'Deletes today' : `${daysLeft}d left`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => handleRestore(idea.id)}>
                          Restore
                        </button>
                        <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handlePermanentDelete(idea.id)}>
                          Delete forever
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <>
            {/* New idea form */}
            <form
              onSubmit={handleCreateIdea}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16,
                display: 'flex', flexDirection: isMobile ? 'column' : 'row',
                gap: 10, alignItems: isMobile ? 'stretch' : 'flex-end',
              }}
            >
              <div style={{ flex: 1 }}>
                <label className="field-label">New idea</label>
                <input value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="What's the idea?" />
              </div>
              {(view === 'all' || !isMobile) && (
                <div style={{ flex: isMobile ? undefined : undefined, width: isMobile ? undefined : 160 }}>
                  <label className="field-label">Project</label>
                  <select
                    value={newProjectId ?? defaultProject?.id ?? ''}
                    onChange={(e) => setNewProjectId(Number(e.target.value))}
                  >
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <button type="submit" className="btn-primary" disabled={saving || !newText.trim()} style={{ flexShrink: 0 }}>
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
                    <div key={idea.id} className="card" style={{ padding: '14px 18px' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <input value={editText} onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); }} autoFocus />
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div style={{ flex: 1 }}>
                              <label className="field-label">Project</label>
                              <select value={editProjectId} onChange={(e) => setEditProjectId(Number(e.target.value))}>
                                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 18 }}>
                              <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => handleSaveEdit(idea.id)}>Save</button>
                              <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setEditingId(null)}>Cancel</button>
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
                                  background: 'var(--blue-dim)', border: '1px solid rgba(96,165,250,0.15)',
                                  padding: '1px 7px', borderRadius: 99, fontWeight: 500,
                                }}>📁 {project.name}</span>
                              )}
                              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                {new Date(idea.updatedAt ?? idea.createdAt).toLocaleDateString('en-GB', {
                                  day: 'numeric', month: 'short', year: 'numeric',
                                })}
                                {idea.updatedAt ? ' · edited' : ''}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: 12, color: 'var(--green)', borderColor: 'var(--green)' }}
                              onClick={() => handleMarkDone(idea.id)}
                            >✓ Done</button>
                            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => startEdit(idea)}>Edit</button>
                            <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handleDeleteIdea(idea.id)}>Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
