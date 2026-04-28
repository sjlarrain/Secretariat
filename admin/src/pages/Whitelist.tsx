import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Whitelist() {
  const [numbers, setNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWhitelist().then((data) => {
      setNumbers(data.numbers);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Whitelist</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Only these numbers can send commands to the bot.
        </p>
      </div>

      {/* Numbers */}
      <div className="card" style={{ marginBottom: 12 }}>
        {numbers.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No whitelisted numbers configured.</p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {numbers.map((n) => (
              <li key={n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 15 }}>📱</span>
                <span style={{
                  fontFamily: "'SF Mono', 'Fira Code', Consolas, monospace",
                  fontSize: 14,
                  flex: 1,
                  color: 'var(--text)',
                  letterSpacing: '0.03em',
                }}>
                  {n}
                </span>
                <span className="badge badge-default">owner</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Info box */}
      <div className="card" style={{
        background: 'rgba(249,115,22,0.04)',
        borderColor: 'rgba(249,115,22,0.15)',
        borderLeft: '3px solid var(--orange)',
      }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>⚙️</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--orange)' }}>
            How to change the whitelist
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.65 }}>
          Update the <code>WHITELISTED_NUMBERS</code> environment variable in your Render dashboard, then redeploy.
          Format: comma-separated E.164 numbers, e.g.{' '}
          <code>+56912345678,+56987654321</code>
        </p>
      </div>
    </div>
  );
}
