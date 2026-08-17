import { useEffect, useState } from 'react';
import { api, UnrecognizedSender, BlockedSender } from '../api/client';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function UnrecognizedSenders() {
  const [unrecognized, setUnrecognized] = useState<UnrecognizedSender[]>([]);
  const [blocked, setBlocked] = useState<BlockedSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [u, b] = await Promise.all([api.getUnrecognizedSenders(), api.getBlockedSenders()]);
    setUnrecognized(u);
    setBlocked(b);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleBlock(phone: string) {
    if (!confirm(`Block ${phone}? They'll stop being logged here — messages from them will be silently ignored.`)) return;
    setBusy(phone);
    try {
      await api.blockSender(phone);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function handleUnblock(phone: string) {
    setBusy(phone);
    try {
      await api.unblockSender(phone);
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
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Unrecognized senders</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Numbers that have messaged the bot without being registered. They never get a reply.
        </p>
      </div>

      {unrecognized.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px', marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>👋</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No unrecognized senders right now.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {unrecognized.map((s) => (
            <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
                  fontSize: 13.5, fontWeight: 600,
                }}>
                  {s.id}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {s.messageCount} message{s.messageCount === 1 ? '' : 's'} · first {formatDate(s.firstSeenAt)} · last {formatDate(s.lastSeenAt)}
                </div>
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, color: 'var(--red)' }}
                disabled={busy === s.id}
                onClick={() => handleBlock(s.id)}
              >
                Block
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px' }}>Blocked</h3>
      </div>

      {blocked.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nobody is blocked.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {blocked.map((b) => (
            <div key={b.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                flex: 1,
                fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
                fontSize: 13.5,
              }}>
                {b.id}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>blocked {formatDate(b.blockedAt)}</div>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={busy === b.id} onClick={() => handleUnblock(b.id)}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
