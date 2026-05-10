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
import WorkPage from './pages/Work';
import { api } from './api/client';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/ideas', label: 'Ideas', icon: '💡' },
  { to: '/links', label: 'Links', icon: '🌐' },
  { to: '/cron', label: 'Cron Manager', icon: '⏰' },
  { to: '/work', label: 'Work', icon: '🗂️' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={{
        width: 210,
        background: 'var(--bg-nav)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* Brand */}
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
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>v1.4</div>
          </div>
        </div>

        {/* Nav links */}
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

        {/* Footer */}
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

      {/* Main */}
      <main style={{ flex: 1, padding: '32px 36px', overflowY: 'auto', background: 'var(--bg)' }}>
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout><Dashboard /></Layout>} />
        <Route path="/ideas" element={<Layout><Ideas /></Layout>} />
        <Route path="/links" element={<Layout><Links /></Layout>} />
        <Route path="/cron" element={<Layout><CronManager /></Layout>} />
        <Route path="/work" element={<Layout><WorkPage /></Layout>} />

        {/* Settings hub + sub-pages */}
        <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
        <Route path="/settings/accounts" element={<Layout><Accounts /></Layout>} />
        <Route path="/settings/whitelist" element={<Layout><Whitelist /></Layout>} />
        <Route path="/settings/plans" element={<Layout><Plans /></Layout>} />
        <Route path="/settings/commands" element={<Layout><Commands /></Layout>} />
        <Route path="/settings/time" element={<Layout><TimeConfig /></Layout>} />

        {/* Legacy redirects */}
        <Route path="/accounts" element={<Navigate to="/settings/accounts" replace />} />
        <Route path="/whitelist" element={<Navigate to="/settings/whitelist" replace />} />
        <Route path="/plans" element={<Navigate to="/settings/plans" replace />} />
        <Route path="/commands" element={<Navigate to="/settings/commands" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
