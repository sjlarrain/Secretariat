import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

const TYPE_ACCENT: Record<string, string> = {
  calendar: 'var(--green)',
  tasks: 'var(--orange)',
};

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    const data = await api.getAccounts();
    setAccounts(data.accounts);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this account?')) return;
    await api.deleteAccount(id);
    setMsg('Account disconnected.');
    load();
  }

  async function handleSetDefault(id: string) {
    await api.patchAccount(id, { isDefault: true });
    setMsg('Default updated.');
    load();
  }

  function connectGoogle(type: 'calendar' | 'tasks') {
    const alias = prompt(`Alias for this ${type} account (e.g. "personal", "work"):`);
    if (!alias) return;
    window.location.href = `/api/admin/auth/google/start?alias=${encodeURIComponent(alias)}&type=${type}`;
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
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Accounts</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            Connected Google integrations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => connectGoogle('tasks')}>
            + Google Tasks
          </button>
          <button className="btn-primary" onClick={() => connectGoogle('calendar')}>
            + Google Calendar
          </button>
        </div>
      </div>

      {msg && (
        <p className="success-msg" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ {msg}
        </p>
      )}

      {accounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>🔗</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No accounts connected</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Connect Google Calendar or Tasks using the buttons above.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="card card-interactive"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                borderLeft: `3px solid ${TYPE_ACCENT[acc.type] ?? 'var(--blue-bright)'}`,
                paddingLeft: 16,
              }}
            >
              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{acc.alias}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <span className={`badge badge-${acc.provider}`}>{acc.provider}</span>
                  <span className={`badge badge-${acc.type}`}>{acc.type}</span>
                  {acc.isDefault && <span className="badge badge-default">default</span>}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                {!acc.isDefault && (
                  <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => handleSetDefault(acc.id)}>
                    Set default
                  </button>
                )}
                <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handleDisconnect(acc.id)}>
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
