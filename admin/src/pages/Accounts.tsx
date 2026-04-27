import { useEffect, useState } from 'react';
import { api, Account } from '../api/client';

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
    const alias = prompt(`Enter an alias for this ${type} account (e.g. "personal", "GG"):`);
    if (!alias) return;
    window.location.href = `/api/admin/auth/google/start?alias=${encodeURIComponent(alias)}&type=${type}`;
  }

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Connected Accounts</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => connectGoogle('calendar')}>
            + Google Calendar
          </button>
          <button className="btn-secondary" onClick={() => connectGoogle('tasks')}>
            + Google Tasks
          </button>
        </div>
      </div>

      {msg && <p className="success-msg" style={{ marginBottom: 16 }}>{msg}</p>}

      {accounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          <p style={{ fontSize: 16 }}>No accounts connected yet.</p>
          <p style={{ marginTop: 8, fontSize: 14 }}>Click "Connect Google Calendar" or "Connect Google Tasks" to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {accounts.map((acc) => (
            <div key={acc.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{acc.alias}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  <span className={`badge badge-${acc.provider}`}>{acc.provider}</span>
                  <span className={`badge badge-${acc.type}`}>{acc.type}</span>
                  {acc.isDefault && <span className="badge badge-default">default</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!acc.isDefault && (
                  <button className="btn-ghost" onClick={() => handleSetDefault(acc.id)}>
                    Set default
                  </button>
                )}
                <button className="btn-danger" onClick={() => handleDisconnect(acc.id)}>
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
