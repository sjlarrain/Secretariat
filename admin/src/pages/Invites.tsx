import { useEffect, useState } from 'react';
import { api, Invite } from '../api/client';

const STATUS_COLOR: Record<Invite['status'], string> = {
  pending: 'var(--blue-bright)',
  redeemed: 'var(--green)',
  revoked: 'var(--text-dim)',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Invites() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<Invite | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setInvites(await api.getInvites());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setCreating(true);
    setError('');
    try {
      const invite = await api.createInvite(note.trim() || undefined);
      setJustCreated(invite);
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(token: string) {
    if (!confirm('Revoke this invite? The link will stop working.')) return;
    await api.revokeInvite(token);
    await load();
  }

  const inviteLink = (token: string) => `${window.location.origin}/register/${token}`;

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
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Invites</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Registration is invite-only — share a link out of band to bring someone in.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New invite</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Note (e.g. for Carla) — optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : 'Create invite'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</p>}

        {justCreated && (
          <div style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 8,
            background: 'var(--blue-dim)', border: '1px solid rgba(59,130,246,0.25)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Link created — copy it now, it's shown only once here:
            </div>
            <div style={{
              fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
              fontSize: 12.5, wordBreak: 'break-all', userSelect: 'all',
              padding: '6px 8px', background: 'var(--bg-card)', borderRadius: 6,
            }}>
              {inviteLink(justCreated.id)}
            </div>
          </div>
        )}
      </div>

      {invites.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>✉️</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No invites yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Create one above to bring someone in.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invites.map((inv) => (
            <div key={inv.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    color: STATUS_COLOR[inv.status],
                  }}>
                    {inv.status}
                  </span>
                  {inv.note && <span style={{ fontSize: 13, fontWeight: 600 }}>{inv.note}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Created {formatDate(inv.createdAt)}
                  {inv.redeemedBy && ` · redeemed by ${inv.redeemedBy}${inv.redeemedAt ? ' on ' + formatDate(inv.redeemedAt) : ''}`}
                </div>
              </div>
              {inv.status === 'pending' && (
                <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red)' }} onClick={() => handleRevoke(inv.id)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
