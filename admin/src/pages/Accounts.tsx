import { useEffect, useState } from 'react';
import { api, googleAuthStartUrl, Account, GoogleCalendar } from '../api/client';

const TYPE_ACCENT: Record<string, string> = {
  calendar: 'var(--green)',
  tasks: 'var(--orange)',
};

interface CalendarPanelState {
  open: boolean;
  loading: boolean;
  error: string;
  calendars: GoogleCalendar[];
  enabledIds: string[];
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [calPanels, setCalPanels] = useState<Record<string, CalendarPanelState>>({});

  async function load() {
    setLoading(true);
    const data = await api.getAccounts();
    setAccounts(data.accounts);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this account?')) return;
    await api.deleteAccount(id);
    setMsg('Account disconnected.');
    load();
  }

  async function handleSetDefault(id: string) {
    await api.patchAccount(id, { isDefault: true });
    setMsg('Default updated.');
    load();
  }

  async function toggleCalendarPanel(id: string) {
    const current = calPanels[id];
    if (current?.open) {
      setCalPanels((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
      return;
    }
    setCalPanels((prev) => ({
      ...prev,
      [id]: { open: true, loading: true, error: '', calendars: [], enabledIds: [] },
    }));
    try {
      const data = await api.getAccountCalendars(id);
      setCalPanels((prev) => ({
        ...prev,
        [id]: { open: true, loading: false, error: '', calendars: data.calendars, enabledIds: data.enabledCalendarIds },
      }));
    } catch (err) {
      setCalPanels((prev) => ({
        ...prev,
        [id]: { open: true, loading: false, error: (err as Error).message, calendars: [], enabledIds: [] },
      }));
    }
  }

  async function handleCalendarToggle(accountId: string, calendarId: string, checked: boolean) {
    const panel = calPanels[accountId];
    if (!panel) return;
    const newIds = checked
      ? [...panel.enabledIds, calendarId]
      : panel.enabledIds.filter((id) => id !== calendarId);
    setCalPanels((prev) => ({ ...prev, [accountId]: { ...prev[accountId], enabledIds: newIds } }));
    const newNames: Record<string, string> = {};
    for (const id of newIds) {
      const cal = panel.calendars.find((c) => c.id === id);
      if (cal) newNames[id] = cal.summary;
    }
    try {
      await api.saveAccountCalendars(accountId, newIds, newNames);
    } catch (err) {
      setCalPanels((prev) => ({
        ...prev,
        [accountId]: { ...prev[accountId], error: (err as Error).message, enabledIds: panel.enabledIds },
      }));
    }
  }

  function connectGoogle(type: 'calendar' | 'tasks') {
    const alias = prompt(`Alias for this ${type} account (e.g. "personal", "work"):`);
    if (!alias) return;
    window.location.href = googleAuthStartUrl(alias, type);
  }

  function reconnectGoogle(acc: Account) {
    window.location.href = googleAuthStartUrl(acc.alias, acc.type);
  }

  if (loading) {
    return (
      <div className="loading-wrap">
        <span className="spinner" />
        Loading…
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>Accounts</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
            Connected Google integrations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => connectGoogle('tasks')}>
            + Google Tasks
          </button>
          <button className="btn-primary" onClick={() => connectGoogle('calendar')}>
            + Google Calendar
          </button>
        </div>
      </div>

      {msg && (
        <p className="success-msg" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          ✓ {msg}
        </p>
      )}

      {accounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 32, marginBottom: 14 }}>🔗</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No accounts connected</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Connect Google Calendar or Tasks using the buttons above.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {accounts.map((acc) => {
            const panel = calPanels[acc.id];
            return (
              <div key={acc.id} style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  className="card card-interactive"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    borderLeft: `3px solid ${TYPE_ACCENT[acc.type] ?? 'var(--blue-bright)'}`,
                    paddingLeft: 16,
                    borderBottomLeftRadius: panel?.open ? 0 : undefined,
                    borderBottomRightRadius: panel?.open ? 0 : undefined,
                  }}
                >
                  {/* Info */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{acc.alias}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <span className={`badge badge-${acc.provider}`}>{acc.provider}</span>
                      <span className={`badge badge-${acc.type}`}>{acc.type}</span>
                      {acc.isDefault && <span className="badge badge-default">default</span>}
                      {acc.isDisconnected && (
                        <span className="badge" style={{ background: 'var(--orange, #e5a550)', color: '#fff' }}>
                          disconnected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {acc.isDisconnected ? (
                      <button className="btn-primary" style={{ fontSize: 12 }} onClick={() => reconnectGoogle(acc)}>
                        Reconnect
                      </button>
                    ) : (
                      <>
                        {acc.type === 'calendar' && (
                          <button
                            className="btn-ghost"
                            style={{ fontSize: 12, opacity: panel?.open ? 1 : 0.75 }}
                            onClick={() => toggleCalendarPanel(acc.id)}
                          >
                            {panel?.open ? 'Hide calendars' : 'Manage calendars'}
                          </button>
                        )}
                        {!acc.isDefault && (
                          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => handleSetDefault(acc.id)}>
                            Set default
                          </button>
                        )}
                      </>
                    )}
                    <button className="btn-danger" style={{ fontSize: 12 }} onClick={() => handleDisconnect(acc.id)}>
                      Disconnect
                    </button>
                  </div>
                </div>

                {/* Calendar sub-panel */}
                {panel?.open && (
                  <div
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderTop: 'none',
                      borderBottomLeftRadius: 8,
                      borderBottomRightRadius: 8,
                      padding: '12px 16px',
                    }}
                  >
                    {panel.loading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                        <span className="spinner" style={{ width: 14, height: 14 }} />
                        Loading calendars…
                      </div>
                    )}
                    {panel.error && (
                      <div style={{ fontSize: 12, color: 'var(--red, #e06c75)' }}>{panel.error}</div>
                    )}
                    {!panel.loading && !panel.error && panel.calendars.length === 0 && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No calendars found.</div>
                    )}
                    {!panel.loading && panel.calendars.map((cal) => (
                      <label
                        key={cal.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 0',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={panel.enabledIds.includes(cal.id)}
                          onChange={(e) => handleCalendarToggle(acc.id, cal.id, e.target.checked)}
                          style={{ accentColor: cal.backgroundColor ?? 'var(--blue-bright)', width: 15, height: 15 }}
                        />
                        {cal.backgroundColor && (
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: cal.backgroundColor,
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span>{cal.summary}</span>
                        {cal.primary && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>(primary)</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
