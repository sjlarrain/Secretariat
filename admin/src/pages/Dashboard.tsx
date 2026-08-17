import { useEffect, useState } from 'react';
import { api, isAdminMode, Account, Settings, DashboardData } from '../api/client';

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

function formatEventTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTaskDue(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function Dashboard() {
  const admin = isAdminMode();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Whitelisted numbers is ops-only config with no per-user equivalent —
    // /api/user has no such endpoint, so skip the call there rather than
    // let one 404 fail the whole Promise.all and blank the dashboard.
    Promise.all([
      api.getAccounts(),
      api.getSettings(),
      admin ? api.getWhitelist() : Promise.resolve({ numbers: [] as string[] }),
      api.getDashboard(),
    ])
      .then(([a, s, w, d]) => {
        setAccounts(a.accounts);
        setSettings(s);
        setWhitelist(w.numbers);
        setDashboard(d);
      })
      .finally(() => setLoading(false));
  }, [admin]);

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

  const sectionHeader = (icon: string, title: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 15 }}>{icon}</span>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
    </div>
  );

  const emptyState = (text: string) => (
    <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>{text}</p>
  );

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
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${admin ? 3 : 2}, 1fr)`, gap: 14, marginBottom: 28 }}>
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
        {admin && (
          <StatCard
            icon="📱"
            accent="var(--purple)"
            accentDim="var(--purple-dim)"
            label="Whitelisted Numbers"
            value={whitelist.length}
            sub={whitelist[0] ?? 'None configured'}
          />
        )}
      </div>

      {/* Bottom sections */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        {/* Today's events */}
        <div className="card">
          {sectionHeader('📅', 'Today')}
          {!dashboard || dashboard.events.length === 0
            ? emptyState('No events today.')
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dashboard.events.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--blue-bright)',
                      background: 'var(--blue-dim)', padding: '2px 7px', borderRadius: 6,
                      flexShrink: 0, marginTop: 1,
                    }}>
                      {formatEventTime(e.start)}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.4 }}>{e.title}</span>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* Pending tasks */}
        <div className="card">
          {sectionHeader('📋', 'Pending tasks')}
          {!dashboard || dashboard.tasks.length === 0
            ? emptyState('No pending tasks.')
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {dashboard.tasks.map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, lineHeight: 1.4 }}>• {t.title}</span>
                      {t.project && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 600,
                          color: 'var(--blue-bright)', background: 'var(--blue-dim)',
                          padding: '1px 5px', borderRadius: 4,
                        }}>
                          {t.project}
                        </span>
                      )}
                    </div>
                    {t.dueDate && (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
                        {formatTaskDue(t.dueDate)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          }
          {dashboard && dashboard.tasks.length > 0 && (
            <a href="/tasks" style={{ fontSize: 11, color: 'var(--blue-bright)', display: 'block', marginTop: 12 }}>
              View all tasks →
            </a>
          )}
        </div>

        {/* Recent ideas */}
        <div className="card">
          {sectionHeader('💡', 'Recent ideas')}
          {!dashboard || dashboard.ideas.length === 0
            ? emptyState('No ideas yet.')
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {dashboard.ideas.map((idea) => (
                  <div key={idea.id} style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--text)' }}>
                    {idea.text}
                  </div>
                ))}
              </div>
            )
          }
          {dashboard && dashboard.ideas.length > 0 && (
            <a href="/ideas" style={{ fontSize: 11, color: 'var(--blue-bright)', display: 'block', marginTop: 12 }}>
              View all ideas →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
