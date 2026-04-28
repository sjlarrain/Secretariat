import { useEffect, useState } from 'react';
import { api, Account, Settings } from '../api/client';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  accent: string;
  accentDim: string;
}

function StatCard({ label, value, sub, icon, accent, accentDim }: StatCardProps) {
  return (
    <div className="card" style={{
      borderTop: `2px solid ${accent}`,
      padding: '20px 20px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          width: 34, height: 34,
          background: accentDim,
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent, lineHeight: 1, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getAccounts(), api.getSettings(), api.getWhitelist()])
      .then(([a, s, w]) => {
        setAccounts(a.accounts);
        setSettings(s);
        setWhitelist(w.numbers);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  const digestActive = settings
    ? settings.morningDigest.enabled || settings.weeklySummary.enabled
    : false;

  const digestSub = settings?.morningDigest.enabled
    ? `Morning at ${settings.morningDigest.time}`
    : settings?.weeklySummary.enabled
    ? `Weekly on ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][settings.weeklySummary.day]}`
    : 'No digest configured';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Dashboard</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Overview of your Secretariat bot
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard
          icon="🔗"
          accent="var(--blue-bright)"
          accentDim="var(--blue-dim)"
          label="Connected Accounts"
          value={accounts.length}
          sub={accounts.length === 0 ? 'Go to Accounts to connect' : accounts.map((a) => a.alias).join(', ')}
        />
        <StatCard
          icon="⏰"
          accent={digestActive ? 'var(--green)' : 'var(--text-muted)'}
          accentDim={digestActive ? 'var(--green-dim)' : 'rgba(90,90,90,0.1)'}
          label="Digests"
          value={digestActive ? 'Active' : 'Off'}
          sub={digestSub}
        />
        <StatCard
          icon="📱"
          accent="var(--purple)"
          accentDim="var(--purple-dim)"
          label="Whitelisted Numbers"
          value={whitelist.length}
          sub={whitelist[0] ?? 'None configured'}
        />
      </div>

      {/* Quick Start */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 15 }}>🚀</span>
          <h3 style={{ fontSize: 14, fontWeight: 600 }}>Quick Start</h3>
        </div>
        <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            <>Go to <a href="/accounts">Accounts</a> and connect your Google Calendar and Tasks</>,
            <>Go to <a href="/digests">Digests</a> to enable morning digest and weekly summary</>,
            <>Send <code>/start</code> from WhatsApp to wake the bot, then <code>/menu</code> to see all commands</>,
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{
                width: 22, height: 22, borderRadius: 6,
                background: 'var(--blue-dim)',
                border: '1px solid rgba(59,130,246,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'var(--blue-bright)',
                flexShrink: 0, marginTop: 1,
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
