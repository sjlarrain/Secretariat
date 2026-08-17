import { useEffect, useState } from 'react';
import { api, RegisteredUser } from '../api/client';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Users() {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setUsers(await api.getRegisteredUsers());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggleStatus(user: RegisteredUser) {
    const next = user.status === 'active' ? 'disabled' : 'active';
    if (next === 'disabled' && !confirm(`Disable ${user.name}? They will stop receiving replies until re-enabled.`)) return;
    setBusy(user.id);
    try {
      await api.setRegisteredUserStatus(user.id, next);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function markReady(user: RegisteredUser) {
    setBusy(user.id);
    try {
      await api.markCalendarReady(user.id);
      setMsg(`${user.name} notified — their calendar access is ready.`);
      await load();
    } finally {
      setBusy(null);
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
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Users</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Everyone registered on the bot.
        </p>
      </div>

      {msg && (
        <p className="success-msg" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ {msg}
        </p>
      )}

      {users.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>👥</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No users yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Send an invite to bring someone in.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((u) => (
            <div key={u.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</span>
                  <span className="badge" style={{
                    background: u.status === 'active' ? 'var(--green-dim, rgba(74,222,128,0.12))' : 'rgba(90,90,90,0.15)',
                    color: u.status === 'active' ? 'var(--green)' : 'var(--text-muted)',
                  }}>
                    {u.status}
                  </span>
                  {u.calendarAccess === 'pending' && (
                    <span className="badge" style={{ background: 'rgba(249,115,22,0.12)', color: 'var(--orange)' }}>
                      calendar pending
                    </span>
                  )}
                  {u.calendarAccess === 'ready' && (
                    <span className="badge" style={{ background: 'var(--blue-dim)', color: 'var(--blue-bright)' }}>
                      calendar ready
                    </span>
                  )}
                </div>
                <div style={{
                  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
                  fontSize: 12.5, color: 'var(--text-muted)',
                }}>
                  {u.id}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                  {u.timezone} · joined {formatDate(u.createdAt)}
                  {u.email && ` · ${u.email}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {u.calendarAccess === 'pending' && (
                  <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy === u.id} onClick={() => markReady(u)}>
                    Mark calendar ready
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: u.status === 'active' ? 'var(--red)' : undefined }}
                  disabled={busy === u.id}
                  onClick={() => toggleStatus(u)}
                >
                  {u.status === 'active' ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
