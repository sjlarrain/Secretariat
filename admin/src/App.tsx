import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Whitelist from './pages/Whitelist';
import CronManager from './pages/CronManager';
import Ideas from './pages/Ideas';
import Links from './pages/Links';
import Commands from './pages/Commands';
import Plans from './pages/Plans';
import SettingsPage from './pages/Settings';
import TimeConfig from './pages/TimeConfig';
import UclaPage from './pages/Ucla';
import RemindersPage from './pages/Reminders';
import TasksPage from './pages/Tasks';
import HealthBanner from './components/HealthBanner';
import { api } from './api/client';
import { useIsMobile } from './hooks/useIsMobile';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/ideas', label: 'Ideas', icon: '💡' },
  { to: '/links', label: 'Links', icon: '🌐' },
  { to: '/reminders', label: 'Reminders', icon: '⏰' },
  { to: '/tasks', label: 'Tasks', icon: '📋' },
  { to: '/ucla', label: 'UCLA', icon: '🎓' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const MOBILE_NAV = [
  { to: '/ideas', label: 'Ideas', icon: '💡' },
  { to: '/links', label: 'Links', icon: '🌐' },
  { to: '/reminders', label: 'Reminders', icon: '⏰' },
  { to: '/tasks', label: 'Tasks', icon: '📋' },
  { to: '/ucla', label: 'UCLA', icon: '🎓' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

// ── Desktop layout ─────────────────────────────────────────
function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: 210,
        background: 'var(--bg-nav)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{
          padding: '18px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32, height: 32,
            background: 'var(--blue-dim)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>
            🤖
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px' }}>
              Secretariat
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>v1.8</div>
          </div>
        </div>

        <div style={{ flex: 1, padding: '8px 0' }}>
          <div style={{
            padding: '10px 16px 4px',
            fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--text-dim)',
          }}>
            Menu
          </div>
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                margin: '1px 8px',
                borderRadius: 7,
                color: isActive ? '#fff' : 'var(--text-muted)',
                background: isActive ? '#151e30' : 'transparent',
                border: isActive ? '1px solid rgba(59,130,246,0.12)' : '1px solid transparent',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                textDecoration: 'none',
                transition: 'all 0.12s',
              })}
            >
              {({ isActive }) => (
                <>
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', opacity: isActive ? 1 : 0.5 }}>
                    {link.icon}
                  </span>
                  {link.label}
                </>
              )}
            </NavLink>
          ))}
        </div>

        <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn-ghost"
            style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6 }}
            onClick={handleLogout}
          >
            ↩ Sign out
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: '32px 36px', overflowY: 'auto', background: 'var(--bg)' }}>
        {children}
      </main>
    </div>
  );
}

// ── Mobile home (root nav screen) ─────────────────────────
function MobileHome({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ padding: '28px 20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44,
            background: 'var(--blue-dim)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>🤖</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px' }}>Secretariat</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>v1.8</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {MOBILE_NAV.map((item) => (
          <button
            key={item.to}
            onClick={() => navigate(item.to)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 16,
              padding: '18px 20px',
              background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--text)', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{item.icon}</span>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 500 }}>{item.label}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn-ghost"
          style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: 6 }}
          onClick={onLogout}
        >
          ↩ Sign out
        </button>
      </div>
    </div>
  );
}

// ── Mobile sub-page layout ─────────────────────────────────
function MobileLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 8px',
        height: 52,
        background: 'var(--bg-nav)', borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--blue-bright)', fontSize: 24, padding: '8px 10px',
            lineHeight: 1, display: 'flex', alignItems: 'center',
          }}
        >
          ‹
        </button>
        <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.2px' }}>{title}</span>
      </div>

      <main style={{ flex: 1, padding: '20px 16px' }}>
        {children}
      </main>
    </div>
  );
}

// ── Route tree ────────────────────────────────────────────
function AppInner() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate('/login');
  }

  if (isMobile) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<MobileHome onLogout={handleLogout} />} />
        <Route path="/ideas" element={<MobileLayout title="Ideas"><Ideas /></MobileLayout>} />
        <Route path="/links" element={<MobileLayout title="Links"><Links /></MobileLayout>} />
        <Route path="/reminders" element={<MobileLayout title="Reminders"><RemindersPage /></MobileLayout>} />
        <Route path="/tasks" element={<MobileLayout title="Tasks"><TasksPage /></MobileLayout>} />
        <Route path="/ucla" element={<MobileLayout title="UCLA"><UclaPage /></MobileLayout>} />
        <Route path="/settings" element={<MobileLayout title="Settings"><SettingsPage /></MobileLayout>} />
        <Route path="/settings/accounts" element={<MobileLayout title="Accounts"><Accounts /></MobileLayout>} />
        <Route path="/settings/plans" element={<MobileLayout title="Plans"><Plans /></MobileLayout>} />
        <Route path="/settings/time" element={<MobileLayout title="Time Config"><TimeConfig /></MobileLayout>} />
        <Route path="/settings/cron" element={<MobileLayout title="Cron Manager"><CronManager /></MobileLayout>} />
        <Route path="/settings/whitelist" element={<Navigate to="/settings" replace />} />
        <Route path="/settings/commands" element={<Navigate to="/settings" replace />} />
        {/* Pre-v1.14 paths */}
        <Route path="/cron" element={<Navigate to="/reminders" replace />} />
        <Route path="/work" element={<Navigate to="/ucla" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Layout><Dashboard /></Layout>} />
      <Route path="/ideas" element={<Layout><Ideas /></Layout>} />
      <Route path="/links" element={<Layout><Links /></Layout>} />
      <Route path="/reminders" element={<Layout><RemindersPage /></Layout>} />
      <Route path="/tasks" element={<Layout><TasksPage /></Layout>} />
      <Route path="/ucla" element={<Layout><UclaPage /></Layout>} />

      <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
      <Route path="/settings/accounts" element={<Layout><Accounts /></Layout>} />
      <Route path="/settings/whitelist" element={<Layout><Whitelist /></Layout>} />
      <Route path="/settings/plans" element={<Layout><Plans /></Layout>} />
      <Route path="/settings/commands" element={<Layout><Commands /></Layout>} />
      <Route path="/settings/time" element={<Layout><TimeConfig /></Layout>} />
      <Route path="/settings/cron" element={<Layout><CronManager /></Layout>} />

      <Route path="/accounts" element={<Navigate to="/settings/accounts" replace />} />
      <Route path="/whitelist" element={<Navigate to="/settings/whitelist" replace />} />
      <Route path="/plans" element={<Navigate to="/settings/plans" replace />} />
      <Route path="/commands" element={<Navigate to="/settings/commands" replace />} />

      {/* Pre-v1.14 paths: /cron split into /reminders + /settings/cron; /work became /ucla */}
      <Route path="/cron" element={<Navigate to="/reminders" replace />} />
      <Route path="/work" element={<Navigate to="/ucla" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <HealthBanner />
      <AppInner />
    </BrowserRouter>
  );
}
