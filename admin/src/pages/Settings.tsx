import { useNavigate } from 'react-router-dom';

const SECTIONS = [
  {
    to: '/settings/accounts',
    icon: '🔗',
    title: 'Accounts',
    description: 'Connect and manage Google Calendar and Tasks accounts',
  },
  {
    to: '/settings/whitelist',
    icon: '📱',
    title: 'Whitelist Numbers',
    description: 'View the WhatsApp numbers allowed to send commands',
  },
  {
    to: '/settings/plans',
    icon: '📋',
    title: 'Plans',
    description: 'Create and manage meeting plan types for availability checks',
  },
  {
    to: '/settings/commands',
    icon: '📖',
    title: 'Commands',
    description: 'Reference for all available WhatsApp commands and flags',
  },
  {
    to: '/settings/time',
    icon: '🌍',
    title: 'Time Configuration',
    description: 'Timezone selector and live server clock',
  },
];

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Configure integrations, permissions, and bot behaviour
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.to}
            onClick={() => navigate(s.to)}
            className="card"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              padding: '18px 20px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              borderRadius: 10,
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(59,130,246,0.4)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--blue-dim)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card)';
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 10 }}>{s.icon}</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
