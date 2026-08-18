import { useNavigate } from 'react-router-dom';

// The per-user counterpart to Settings.tsx's hub. Same shape, but the tile
// list drops "Whitelist Numbers" (that's the ops-only WHITELISTED_NUMBERS
// env var, not anything a user manages) in favor of "Contacts" pointing at
// ThirdPartyContacts.tsx.
const SECTIONS = [
  {
    to: '/app/settings/accounts',
    icon: '🔗',
    title: 'Accounts',
    description: 'Connect and manage your Google Calendar and Tasks accounts',
  },
  {
    to: '/app/settings/contacts',
    icon: '👤',
    title: 'Contacts',
    description: 'People who can send /set and /menu to create events for you',
  },
  {
    to: '/app/settings/plans',
    icon: '📋',
    title: 'Plans',
    description: 'Create and manage meeting plan types for availability checks',
  },
  {
    to: '/app/settings/commands',
    icon: '📖',
    title: 'Commands',
    description: 'Reference for all available WhatsApp commands and flags',
  },
  {
    to: '/app/settings/time',
    icon: '🌍',
    title: 'Time Configuration',
    description: 'Your timezone and current local time',
  },
  {
    to: '/app/settings/cron',
    icon: '⏰',
    title: 'Digests',
    description: 'Digests, MBA reminder, and task sync schedules',
  },
];

export default function UserSettings() {
  const navigate = useNavigate();

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Manage your own accounts, plans, and preferences
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
              color: 'var(--text)',
              whiteSpace: 'normal',
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, wordBreak: 'break-word' }}>{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
