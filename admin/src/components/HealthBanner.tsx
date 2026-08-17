import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, HealthAlert } from '../api/client';

/**
 * Top-level banner for issues found by the nightly health check.
 *
 * This is the reliable surface for health alerts: the WhatsApp notification is
 * best-effort and can be dropped outside Meta's 24-hour session window, but the
 * banner always reflects the last run.
 */
export default function HealthBanner() {
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Never fetch from the login page — api.request() redirects to /login on a
  // 401, so an unauthenticated fetch here would reload the login page, remount
  // this banner, and loop forever. The .catch() below cannot prevent that,
  // because the redirect is a side effect inside request() that fires before
  // the promise rejects. Also skipped under the per-user panel: health alerts
  // are ops-only system state (Kapso/Google/QStash/Redis), there's no
  // /api/user equivalent, and a user session can't act on any of it anyway.
  const onLoginPage = location.pathname === '/login' || location.pathname.startsWith('/app');

  useEffect(() => {
    if (onLoginPage) return;

    let cancelled = false;
    api.getHealthAlerts()
      .then((res) => { if (!cancelled) setAlerts(res.alerts); })
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [onLoginPage]);

  if (dismissed || alerts.length === 0 || onLoginPage) return null;

  const hasError = alerts.some((a) => a.severity === 'error');

  return (
    <div style={{
      background: hasError ? 'rgba(229,83,75,0.12)' : 'rgba(234,179,8,0.12)',
      borderBottom: `1px solid ${hasError ? 'rgba(229,83,75,0.35)' : 'rgba(234,179,8,0.35)'}`,
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
    }}>
      <span style={{ fontSize: 15, lineHeight: 1.4 }}>{hasError ? '❌' : '⚠️'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: alerts.length > 1 ? 4 : 0 }}>
          {alerts.length === 1 ? 'Health check found an issue' : `Health check found ${alerts.length} issues`}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {alerts.map((a) => (
            <div key={a.id} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {a.message}
              {a.resolveLink && (
                <button
                  onClick={() => navigate(a.resolveLink!)}
                  style={{
                    background: 'none', border: 'none', padding: '0 0 0 6px',
                    color: 'var(--blue-bright)', cursor: 'pointer', fontSize: 12,
                    textDecoration: 'underline',
                  }}
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        title="Hide until reload"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}
