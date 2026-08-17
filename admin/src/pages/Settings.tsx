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
  {
    to: '/settings/cron',
    icon: '⏰',
    title: 'Cron Manager',
    description: 'Digests, UCLA reminder, task sync, and nightly health check schedules',
  },
];

const OPS_SECTIONS = [
  {
    to: '/settings/invites',
    icon: '✉️',
    title: 'Invites',
    description: 'Generate and manage single-use registration links',
  },
  {
    to: '/settings/users',
    icon: '👥',
    title: 'Users',
    description: 'View the registry, disable users, approve calendar access',
  },
  {
    to: '/settings/unrecognized',
    icon: '👋',
    title: 'Unrecognized Senders',
    description: 'Numbers that messaged without registering, and blocking',
  },
];

interface Section { to: string; icon: string; title: string; description: string }

function SectionGrid({ sections, onNavigate }: { sections: Section[]; onNavigate: (to: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
      {sections.map((s) => (
        <button
          key={s.to}
          onClick={() => onNavigate(s.to)}
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
  );
}

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

      <SectionGrid sections={SECTIONS} onNavigate={navigate} />

      <div style={{ margin: '32px 0 16px' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px' }}>Ops console</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Manage who has access to the bot
        </p>
      </div>
      <SectionGrid sections={OPS_SECTIONS} onNavigate={navigate} />
    </div>
  );
}
