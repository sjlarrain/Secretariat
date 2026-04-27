import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Whitelist from './pages/Whitelist';
import Digests from './pages/Digests';
import { api } from './api/client';

const NAV_LINKS = [
  { to: '/', label: '⌂ Dashboard', end: true },
  { to: '/accounts', label: '🔗 Accounts' },
  { to: '/whitelist', label: '📋 Whitelist' },
  { to: '/digests', label: '⏰ Digests' },
];

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{
        width: 220, background: '#111', borderRight: '1px solid #222',
        padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ padding: '0 16px 20px', fontWeight: 700, fontSize: 18, color: '#60a5fa' }}>
          Secretariat
        </div>
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            style={({ isActive }) => ({
              display: 'block',
              padding: '9px 16px',
              color: isActive ? '#fff' : '#9ca3af',
              background: isActive ? '#1f2937' : 'transparent',
              borderLeft: isActive ? '3px solid #2563eb' : '3px solid transparent',
              fontSize: 14,
            })}
          >
            {link.label}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', padding: '0 16px' }}>
          <button className="btn-ghost" style={{ width: '100%' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
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
        <Route path="/accounts" element={<Layout><Accounts /></Layout>} />
        <Route path="/whitelist" element={<Layout><Whitelist /></Layout>} />
        <Route path="/digests" element={<Layout><Digests /></Layout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
