import { useEffect, useState } from 'react';
import { api, Link } from '../api/client';
import { useIsMobile } from '../hooks/useIsMobile';

type View = 'all' | 'read' | string;

export default function LinksPage() {
  const [links, setLinks] = useState<Link[]>([]);
  const [read, setRead] = useState<Link[]>([]);
  const [view, setView] = useState<View>('all');
  const [loading, setLoading] = useState(true);

  const [newUrl, setNewUrl] = useState('');
  const [newTags, setNewTags] = useState('');
  const [saving, setSaving] = useState(false);

  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [editingTagsId, setEditingTagsId] = useState<number | null>(null);
  const [editTagInput, setEditTagInput] = useState('');
  const [editTagList, setEditTagList] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  const isMobile = useIsMobile();

  async function load() {
    setLoading(true);
    const [unreadRes, readRes] = await Promise.all([api.getLinks(), api.getLinks('read')]);
    setLinks(unreadRes.links);
    setRead(readRes.links);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function flash(message: string, isErr = false) {
    if (isErr) { setErr(message); setMsg(''); }
    else { setMsg(message); setErr(''); }
    setTimeout(() => { setMsg(''); setErr(''); }, 3000);
  }

  const allTags = [...new Set(links.flatMap((l) => l.tags))].sort();

  const visibleLinks: Link[] =
    view === 'all'  ? links :
    view === 'read' ? read  :
    links.filter((l) => l.tags.includes(view));

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setSaving(true);
    try {
      const tags = newTags.trim().split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
      const res = await api.createLink(newUrl.trim(), tags);
      setLinks((prev) => [...prev, res.link]);
      setNewUrl('');
      setNewTags('');
      flash('Link saved.');
    } catch {
      flash('Failed to save link.', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkRead(id: number) {
    try {
      await api.markLinkRead(id);
      const link = links.find((l) => l.id === id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      if (link) setRead((prev) => [...prev, { ...link, readAt: new Date().toISOString() }]);
      flash('Link marked as read.');
    } catch {
      flash('Failed to mark link as read.', true);
    }
  }

  async function handleDelete(id: number, isRead: boolean) {
    if (!confirm('Delete this link permanently?')) return;
    try {
      await api.deleteLink(id);
      if (isRead) setRead((prev) => prev.filter((l) => l.id !== id));
      else setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch {
      flash('Failed to delete link.', true);
    }
  }

  function openTagEditor(link: Link) {
    setEditTagList([...link.tags]);
    setEditTagInput('');
    setEditingTagsId(link.id);
  }

  function addEditTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (tag && !editTagList.includes(tag)) setEditTagList((prev) => [...prev, tag]);
    setEditTagInput('');
  }

  function handleTagInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      addEditTag(editTagInput);
    } else if (e.key === 'Backspace' && editTagInput === '' && editTagList.length > 0) {
      setEditTagList((prev) => prev.slice(0, -1));
    }
  }

  async function handleSaveTags(id: number) {
    if (editTagInput.trim()) addEditTag(editTagInput);
    setSavingTags(true);
    try {
      const tags = editTagInput.trim()
        ? [...new Set([...editTagList, editTagInput.trim().toLowerCase()])]
        : editTagList;
      await api.updateLink(id, { tags });
      setLinks((prev) => prev.map((l) => l.id === id ? { ...l, tags } : l));
      setRead((prev) => prev.map((l) => l.id === id ? { ...l, tags } : l));
      setEditingTagsId(null);
      flash('Tags saved.');
    } catch {
      flash('Failed to save tags.', true);
    } finally {
      setSavingTags(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function shortUrl(url: string) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  if (loading) {
    return <div className="loading-wrap"><span className="spinner" />Loading…</div>;
  }

  const viewTitle =
    view === 'all'  ? 'All links' :
    view === 'read' ? 'Read archive' :
    `🏷 ${view}`;

  const viewCount = visibleLinks.length;
  const isReadView = view === 'read';

  // ── Mobile: full-width with horizontal filter bar ─────
  if (isMobile) {
    return (
      <div>
        {/* Horizontal filter bar */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
          <button
            className={view === 'all' ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setView('all')}
          >
            📥 All ({links.length})
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={view === tag ? 'btn-primary' : 'btn-ghost'}
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
              onClick={() => setView(tag)}
            >
              📁 {tag}
            </button>
          ))}
          <button
            className={view === 'read' ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setView('read')}
          >
            ✅ Read ({read.length})
          </button>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{viewTitle}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {viewCount} link{viewCount !== 1 ? 's' : ''}
          </p>
        </div>

        {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
        {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

        {/* Add link form */}
        {!isReadView && (
          <form onSubmit={handleCreateLink} className="card" style={{ padding: '14px 16px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="url"
              className="input"
              placeholder="https://example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <input
              type="text"
              className="input"
              placeholder="Tags: fintech-elements tech-news"
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <button type="submit" className="btn-primary" disabled={saving || !newUrl.trim()}>
              {saving ? 'Saving…' : 'Add link'}
            </button>
          </form>
        )}

        {/* Link list */}
        {visibleLinks.length === 0 ? (
          <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {isReadView ? 'No read links yet.' : 'No links here. Save one above or send a URL from WhatsApp.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleLinks.map((link) => (
              <div key={link.id} className="card" style={{ padding: '14px 16px' }}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--blue-bright)',
                    textDecoration: 'none', display: 'block',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginBottom: 4,
                  }}
                  title={link.url}
                >
                  {link.url}
                </a>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                  {shortUrl(link.url)} · {formatDate(isReadView && link.readAt ? link.readAt : link.createdAt)}
                </div>

                {/* Tags */}
                {editingTagsId === link.id ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 10 }}>
                    {editTagList.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px',
                          borderRadius: 99, background: 'var(--blue-dim)',
                          color: 'var(--blue-bright)', display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        {tag}
                        <span onClick={() => setEditTagList((prev) => prev.filter((t) => t !== tag))} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 11 }}>×</span>
                      </span>
                    ))}
                    <input
                      autoFocus
                      type="text"
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={handleTagInputKeyDown}
                      onBlur={() => { if (editTagInput.trim()) addEditTag(editTagInput); }}
                      placeholder="add tag…"
                      style={{ fontSize: 11, padding: '2px 6px', width: 90, borderRadius: 6 }}
                    />
                    <button className="btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} disabled={savingTags} onClick={() => handleSaveTags(link.id)}>
                      {savingTags ? '…' : 'Save'}
                    </button>
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setEditingTagsId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                    {link.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={() => setView(tag)}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 8px',
                          borderRadius: 99, background: 'var(--blue-dim)',
                          color: 'var(--blue-bright)', cursor: 'pointer',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                    <span onClick={() => openTagEditor(link)} style={{ fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer', marginLeft: 2 }} title="Edit tags">✏️</span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {!isReadView && (
                    <button className="btn-ghost" style={{ fontSize: 12, flex: 1 }} onClick={() => handleMarkRead(link.id)}>
                      Mark read
                    </button>
                  )}
                  <button className="btn-ghost" style={{ fontSize: 12, flex: 1, color: 'var(--red)' }} onClick={() => handleDelete(link.id, isReadView)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Desktop: sidebar + right pane ─────────────────────
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', minHeight: '70vh' }}>

      {/* Left sidebar */}
      <div style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px' }}>🌐 Links</div>
        </div>

        <button
          onClick={() => setView('all')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', background: view === 'all' ? '#151e30' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            color: view === 'all' ? '#fff' : 'var(--text-muted)',
            fontWeight: view === 'all' ? 600 : 400, fontSize: 13,
          }}
        >
          <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>📥</span>
          <span style={{ flex: 1 }}>All</span>
          {links.length > 0 && (
            <span style={{
              background: 'var(--blue-bright)', color: '#fff',
              borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 6px',
            }}>{links.length}</span>
          )}
        </button>

        {allTags.length > 0 && (
          <>
            <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Tags
            </div>
            {allTags.map((tag) => {
              const count = links.filter((l) => l.tags.includes(tag)).length;
              const active = view === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setView(tag)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', background: active ? '#151e30' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    color: active ? '#fff' : 'var(--text-muted)',
                    fontWeight: active ? 600 : 400, fontSize: 13,
                  }}
                >
                  <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>📁</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                  {count > 0 && (
                    <span style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)' }}>{count}</span>
                  )}
                </button>
              );
            })}
          </>
        )}

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }} />
        <button
          onClick={() => setView('read')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 14px', background: view === 'read' ? '#151e30' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            color: view === 'read' ? '#fff' : 'var(--text-muted)',
            fontWeight: view === 'read' ? 600 : 400, fontSize: 13,
          }}
        >
          <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>✅</span>
          <span style={{ flex: 1 }}>Read</span>
          {read.length > 0 && (
            <span style={{ fontSize: 11, color: view === 'read' ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)' }}>{read.length}</span>
          )}
        </button>
      </div>

      {/* Right pane */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>{viewTitle}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            {viewCount} link{viewCount !== 1 ? 's' : ''}
          </p>
        </div>

        {msg && <p className="success-msg" style={{ marginBottom: 14 }}>✓ {msg}</p>}
        {err && <p className="error-msg" style={{ marginBottom: 14 }}>✕ {err}</p>}

        {!isReadView && (
          <form onSubmit={handleCreateLink} className="card" style={{ padding: '16px 18px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="url"
              className="input"
              placeholder="https://example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="Tags: fintech-elements tech-news"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                style={{ fontSize: 13, flex: 1 }}
              />
              <button type="submit" className="btn-primary" disabled={saving || !newUrl.trim()} style={{ whiteSpace: 'nowrap' }}>
                {saving ? 'Saving…' : 'Add link'}
              </button>
            </div>
          </form>
        )}

        {visibleLinks.length === 0 ? (
          <div className="card" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {isReadView ? 'No read links yet.' : 'No links here. Save one above or send a URL from WhatsApp.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleLinks.map((link) => (
              <div key={link.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 13, fontWeight: 600, color: 'var(--blue-bright)',
                      textDecoration: 'none', display: 'block',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={link.url}
                  >
                    {link.url}
                  </a>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                    {shortUrl(link.url)} · {formatDate(isReadView && link.readAt ? link.readAt : link.createdAt)}
                  </div>
                  {editingTagsId === link.id ? (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                      {editTagList.map((tag) => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 99, background: 'var(--blue-dim)',
                            color: 'var(--blue-bright)', display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {tag}
                          <span onClick={() => setEditTagList((prev) => prev.filter((t) => t !== tag))} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 11 }}>×</span>
                        </span>
                      ))}
                      <input
                        autoFocus
                        type="text"
                        value={editTagInput}
                        onChange={(e) => setEditTagInput(e.target.value)}
                        onKeyDown={handleTagInputKeyDown}
                        onBlur={() => { if (editTagInput.trim()) addEditTag(editTagInput); }}
                        placeholder="add tag…"
                        style={{ fontSize: 11, padding: '2px 6px', width: 90, borderRadius: 6 }}
                      />
                      <button className="btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} disabled={savingTags} onClick={() => handleSaveTags(link.id)}>
                        {savingTags ? '…' : 'Save'}
                      </button>
                      <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setEditingTagsId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
                      {link.tags.map((tag) => (
                        <span
                          key={tag}
                          onClick={() => setView(tag)}
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 99, background: 'var(--blue-dim)',
                            color: 'var(--blue-bright)', cursor: 'pointer',
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      <span onClick={() => openTagEditor(link)} style={{ fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer', marginLeft: 2 }} title="Edit tags">✏️</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!isReadView && (
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleMarkRead(link.id)}>
                      Mark read
                    </button>
                  )}
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--red)' }} onClick={() => handleDelete(link.id, isReadView)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
