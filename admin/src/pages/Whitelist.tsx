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

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Whitelisted Numbers</h2>
      <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 24 }}>
        Only these numbers can send commands to the bot.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        {numbers.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No whitelisted numbers.</p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {numbers.map((n) => (
              <li key={n} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 15, flex: 1 }}>{n}</span>
                <span className="badge badge-default">owner</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ background: '#1a1200', borderColor: '#422006' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#fb923c', marginBottom: 8 }}>
          How to change whitelisted numbers
        </h3>
        <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6 }}>
          In v1, the whitelist is configured via the <code style={{ background: '#222', padding: '1px 6px', borderRadius: 4 }}>WHITELISTED_NUMBERS</code> environment variable.
          Update it in your Render dashboard and redeploy to add or remove numbers.
          Format: comma-separated E.164 numbers, e.g. <code style={{ background: '#222', padding: '1px 6px', borderRadius: 4 }}>+56912345678,+56987654321</code>
        </p>
      </div>
    </div>
  );
}
