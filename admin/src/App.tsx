import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import SignIn from './pages/SignIn';
import Register from './pages/Register';
import Welcome from './pages/Welcome';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Whitelist from './pages/Whitelist';
import ThirdPartyContacts from './pages/ThirdPartyContacts';
import CronManager from './pages/CronManager';
import Ideas from './pages/Ideas';
import Links from './pages/Links';
import Commands from './pages/Commands';
import Plans from './pages/Plans';
import SettingsPage from './pages/Settings';
import UserSettings from './pages/UserSettings';
import Invites from './pages/Invites';
import Users from './pages/Users';
import UnrecognizedSenders from './pages/UnrecognizedSenders';
import TimeConfig from './pages/TimeConfig';
import MbaPage from './pages/Mba';
import RemindersPage from './pages/Reminders';
import TasksPage from './pages/Tasks';
import HealthBanner from './components/HealthBanner';
import { api, setActiveClient } from './api/client';
import { useIsMobile } from './hooks/useIsMobile';

interface NavLinkItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV_LINKS: NavLinkItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/ideas', label: 'Ideas', icon: '💡' },
  { to: '/links', label: 'Links', icon: '🌐' },
  { to: '/reminders', label: 'Reminders', icon: '⏰' },
  { to: '/tasks', label: 'Tasks', icon: '📋' },
  { to: '/mba', label: 'MBA', icon: '🎓' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const MOBILE_NAV: NavLinkItem[] = [
  { to: '/ideas', label: 'Ideas', icon: '💡' },
  { to: '/links', label: 'Links', icon: '🌐' },
  { to: '/reminders', label: 'Reminders', icon: '⏰' },
  { to: '/tasks', label: 'Tasks', icon: '📋' },
  { to: '/mba', label: 'MBA', icon: '🎓' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

// Same shape, pointed at the per-user panel's routes under /app.
const USER_NAV_LINKS: NavLinkItem[] = NAV_LINKS.map((l) => ({ ...l, to: l.to === '/dashboard' ? '/app' : `/app${l.to}` }));
const USER_MOBILE_NAV: NavLinkItem[] = MOBILE_NAV.map((l) => ({ ...l, to: `/app${l.to}` }));

// ── Desktop layout ─────────────────────────────────────────
// Shared by both panels — admin (username/password, brand "Secretariat" /
// v1.8) and the per-user panel (WhatsApp-link session, brand "Secretariat" /
// "Your Panel"). Which nav links, tagline, and sign-out destination it uses
// is passed in rather than forked into a second copy of this component.
function Layout({ children, navLinks, tagline, signOutTo }: {
  children: React.ReactNode;
  navLinks: NavLinkItem[];
  tagline: string;
  signOutTo: string;
}) {
  const navigate = useNavigate();

  async function handleLogout() {
    await api.logout();
    navigate(signOutTo);
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
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{tagline}</div>
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
          {navLinks.map((link) => (
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
function MobileHome({ onLogout, navLinks, tagline }: {
  onLogout: () => void;
  navLinks: NavLinkItem[];
  tagline: string;
}) {
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{tagline}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {navLinks.map((item) => (
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

/**
 * Where the back arrow goes: one level up the URL, or the panel's home when
 * already at the top level. Deliberately not `navigate(-1)` — history-based
 * back lands wherever the user happened to come from, so arriving at a page
 * from the public Welcome page (or straight from the panel sign-in redirect)
 * sent "back" to Welcome instead of the console.
 *
 * `/app` prefixed paths are the per-user panel and keep that prefix, matching
 * how AppInner picks which API client to use.
 */
function parentPath(pathname: string): string {
  const inUserPanel = pathname.startsWith('/app');
  const home = inUserPanel ? '/app' : '/dashboard';

  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  // The panel prefix itself is not a level you can go up from.
  const topLevel = inUserPanel ? 2 : 1;
  if (segments.length <= topLevel) return home;

  return '/' + segments.slice(0, -1).join('/');
}

// ── Mobile sub-page layout ─────────────────────────────────
function MobileLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const navigate = useNavigate();
  const location = useLocation();

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
          onClick={() => navigate(parentPath(location.pathname))}
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
  const location = useLocation();

  // Every page below calls the bare `api` export without knowing which panel
  // it's running in — this is what decides, once per navigation, which
  // backend (and which "not signed in" destination) those calls resolve to.
  // A plain synchronous assignment rather than state/context because it has
  // to take effect before this render's children mount their data-fetching
  // effects, and it's idempotent so React re-invoking this body (StrictMode,
  // concurrent rendering) is harmless.
  const inUserPanel = location.pathname.startsWith('/app');
  setActiveClient(inUserPanel ? 'user' : 'admin');

  async function handleLogout() {
    await api.logout();
    navigate('/login');
  }

  async function handleUserLogout() {
    await api.logout();
    navigate('/app/signin');
  }

  if (isMobile) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Welcome />} />
        <Route path="/welcome" element={<Navigate to="/" replace />} />
        <Route path="/register/:token" element={<Register />} />
        <Route path="/dashboard" element={<MobileHome onLogout={handleLogout} navLinks={MOBILE_NAV} tagline="v1.8" />} />
        <Route path="/ideas" element={<MobileLayout title="Ideas"><Ideas /></MobileLayout>} />
        <Route path="/links" element={<MobileLayout title="Links"><Links /></MobileLayout>} />
        <Route path="/reminders" element={<MobileLayout title="Reminders"><RemindersPage /></MobileLayout>} />
        <Route path="/tasks" element={<MobileLayout title="Tasks"><TasksPage /></MobileLayout>} />
        <Route path="/mba" element={<MobileLayout title="MBA"><MbaPage /></MobileLayout>} />
        <Route path="/settings" element={<MobileLayout title="Settings"><SettingsPage /></MobileLayout>} />
        <Route path="/settings/accounts" element={<MobileLayout title="Accounts"><Accounts /></MobileLayout>} />
        <Route path="/settings/plans" element={<MobileLayout title="Plans"><Plans /></MobileLayout>} />
        <Route path="/settings/time" element={<MobileLayout title="Time Config"><TimeConfig /></MobileLayout>} />
        <Route path="/settings/cron" element={<MobileLayout title="Cron Manager"><CronManager /></MobileLayout>} />
        <Route path="/settings/invites" element={<MobileLayout title="Invites"><Invites /></MobileLayout>} />
        <Route path="/settings/users" element={<MobileLayout title="Users"><Users /></MobileLayout>} />
        <Route path="/settings/unrecognized" element={<MobileLayout title="Unrecognized"><UnrecognizedSenders /></MobileLayout>} />
        <Route path="/settings/whitelist" element={<Navigate to="/settings" replace />} />
        <Route path="/settings/commands" element={<Navigate to="/settings" replace />} />
        {/* Pre-v1.14 path: /cron split into /reminders + /settings/cron */}
        <Route path="/cron" element={<Navigate to="/reminders" replace />} />

        {/* Per-user panel */}
        <Route path="/app/signin" element={<SignIn />} />
        <Route path="/app" element={<MobileHome onLogout={handleUserLogout} navLinks={USER_MOBILE_NAV} tagline="Your Panel" />} />
        <Route path="/app/ideas" element={<MobileLayout title="Ideas"><Ideas /></MobileLayout>} />
        <Route path="/app/links" element={<MobileLayout title="Links"><Links /></MobileLayout>} />
        <Route path="/app/reminders" element={<MobileLayout title="Reminders"><RemindersPage /></MobileLayout>} />
        <Route path="/app/tasks" element={<MobileLayout title="Tasks"><TasksPage /></MobileLayout>} />
        <Route path="/app/mba" element={<MobileLayout title="MBA"><MbaPage /></MobileLayout>} />
        <Route path="/app/settings" element={<MobileLayout title="Settings"><UserSettings /></MobileLayout>} />
        <Route path="/app/settings/accounts" element={<MobileLayout title="Accounts"><Accounts /></MobileLayout>} />
        <Route path="/app/settings/contacts" element={<MobileLayout title="Contacts"><ThirdPartyContacts /></MobileLayout>} />
        <Route path="/app/settings/plans" element={<MobileLayout title="Plans"><Plans /></MobileLayout>} />
        <Route path="/app/settings/commands" element={<MobileLayout title="Commands"><Commands /></MobileLayout>} />
        <Route path="/app/settings/time" element={<MobileLayout title="Time Config"><TimeConfig /></MobileLayout>} />
        <Route path="/app/settings/cron" element={<MobileLayout title="Digests"><CronManager /></MobileLayout>} />
        <Route path="/app/*" element={<Navigate to="/app" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Welcome />} />
      <Route path="/welcome" element={<Navigate to="/" replace />} />
      <Route path="/register/:token" element={<Register />} />
      <Route path="/dashboard" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Dashboard /></Layout>} />
      <Route path="/ideas" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Ideas /></Layout>} />
      <Route path="/links" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Links /></Layout>} />
      <Route path="/reminders" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><RemindersPage /></Layout>} />
      <Route path="/tasks" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><TasksPage /></Layout>} />
      <Route path="/mba" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><MbaPage /></Layout>} />

      <Route path="/settings" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><SettingsPage /></Layout>} />
      <Route path="/settings/accounts" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Accounts /></Layout>} />
      <Route path="/settings/whitelist" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Whitelist /></Layout>} />
      <Route path="/settings/plans" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Plans /></Layout>} />
      <Route path="/settings/commands" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Commands /></Layout>} />
      <Route path="/settings/time" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><TimeConfig /></Layout>} />
      <Route path="/settings/cron" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><CronManager /></Layout>} />
      <Route path="/settings/invites" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Invites /></Layout>} />
      <Route path="/settings/users" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><Users /></Layout>} />
      <Route path="/settings/unrecognized" element={<Layout navLinks={NAV_LINKS} tagline="v1.8" signOutTo="/login"><UnrecognizedSenders /></Layout>} />

      <Route path="/accounts" element={<Navigate to="/settings/accounts" replace />} />
      <Route path="/whitelist" element={<Navigate to="/settings/whitelist" replace />} />
      <Route path="/plans" element={<Navigate to="/settings/plans" replace />} />
      <Route path="/commands" element={<Navigate to="/settings/commands" replace />} />

      {/* Pre-v1.14 path: /cron split into /reminders + /settings/cron */}
      <Route path="/cron" element={<Navigate to="/reminders" replace />} />

      {/* Per-user panel — same pages, /api/user instead of /api/admin (see api/client.ts) */}
      <Route path="/app/signin" element={<SignIn />} />
      <Route path="/app" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Dashboard /></Layout>} />
      <Route path="/app/ideas" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Ideas /></Layout>} />
      <Route path="/app/links" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Links /></Layout>} />
      <Route path="/app/reminders" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><RemindersPage /></Layout>} />
      <Route path="/app/tasks" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><TasksPage /></Layout>} />
      <Route path="/app/mba" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><MbaPage /></Layout>} />

      <Route path="/app/settings" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><UserSettings /></Layout>} />
      <Route path="/app/settings/accounts" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Accounts /></Layout>} />
      <Route path="/app/settings/contacts" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><ThirdPartyContacts /></Layout>} />
      <Route path="/app/settings/plans" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Plans /></Layout>} />
      <Route path="/app/settings/commands" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><Commands /></Layout>} />
      <Route path="/app/settings/time" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><TimeConfig /></Layout>} />
      <Route path="/app/settings/cron" element={<Layout navLinks={USER_NAV_LINKS} tagline="Your Panel" signOutTo="/app/signin"><CronManager /></Layout>} />
      <Route path="/app/*" element={<Navigate to="/app" replace />} />

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
