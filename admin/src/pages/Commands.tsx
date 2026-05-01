import { useEffect, useState } from 'react';
import { api, CommandInfo } from '../api/client';

export default function Commands() {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCommands().then((res) => setCommands(res.commands)).finally(() => setLoading(false));
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
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Commands</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          All WhatsApp commands and their accepted flags
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {commands.map((cmd) => (
          <div key={cmd.key} className="card" style={{ padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: cmd.acceptedFlags.length > 0 ? 14 : 0 }}>
              <code style={{
                fontSize: 15, fontWeight: 700,
                color: 'var(--blue-bright)',
                background: 'var(--blue-dim)',
                padding: '2px 10px', borderRadius: 6,
              }}>
                {cmd.name}
              </code>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cmd.description}</span>
            </div>

            {cmd.acceptedFlags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {cmd.acceptedFlags.map((f) => {
                  const isRequired = cmd.requiredFlags.includes(f.key);
                  return (
                    <div key={f.key} style={{
                      background: '#141414',
                      border: `1px solid ${isRequired ? 'rgba(59,130,246,0.25)' : 'var(--border)'}`,
                      borderRadius: 8,
                      padding: '7px 12px',
                      minWidth: 120,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <code style={{ fontSize: 12, fontWeight: 600, color: isRequired ? 'var(--blue-bright)' : 'var(--text)' }}>
                          {f.long}
                        </code>
                        {f.short && (
                          <code style={{ fontSize: 11, color: 'var(--text-dim)', background: '#1e1e1e', padding: '0 5px', borderRadius: 4 }}>
                            {f.short}
                          </code>
                        )}
                        {isRequired && (
                          <span style={{ fontSize: 10, color: 'var(--blue-bright)', fontWeight: 600, marginLeft: 'auto' }}>required</span>
                        )}
                        {f.optional && (
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500, marginLeft: 'auto' }}>optional value</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{f.description}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
