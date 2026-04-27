import { useEffect, useState } from 'react';
import { api, Account, Settings } from '../api/client';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 36, fontWeight: 700, color: '#60a5fa', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
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

  if (loading) return <p style={{ color: '#9ca3af' }}>Loading…</p>;

  const digestStatus = settings
    ? settings.morningDigest.enabled || settings.weeklySummary.enabled
      ? 'Active'
      : 'Off'
    : '—';

  return (
    <div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard
          label="Connected Accounts"
          value={accounts.length}
          sub={accounts.length === 0 ? 'Connect one in Accounts →' : accounts.map((a) => a.alias).join(', ')}
        />
        <StatCard
          label="Digests"
          value={digestStatus}
          sub={settings?.morningDigest.enabled ? `Morning ${settings.morningDigest.time}` : undefined}
        />
        <StatCard
          label="Whitelisted Numbers"
          value={whitelist.length}
          sub={whitelist[0]}
        />
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Quick Start</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 2.2, color: '#9ca3af', fontSize: 14 }}>
          <li>Go to <a href="/accounts">Accounts</a> and connect your Google Calendar + Tasks</li>
          <li>Go to <a href="/digests">Digests</a> to enable morning digest and weekly summary</li>
          <li>Send <code style={{ background: '#222', padding: '1px 6px', borderRadius: 4 }}>/start</code> from your WhatsApp to verify the bot is working</li>
        </ol>
      </div>
    </div>
  );
}
