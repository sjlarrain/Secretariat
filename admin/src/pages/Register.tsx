import { useEffect, useState, FormEvent } from 'react';
import { useParams } from 'react-router-dom';

// Public, unauthenticated — what a real invite link opens (docs/v2-plan.md
// §B.2). Talks directly to /api/register rather than through api/client.ts's
// adminClient/userClient: this is a third, session-less surface, and the
// token in the URL is the only credential involved.

const TIMEZONES = [
  'America/Santiago', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'Europe/London', 'Europe/Madrid', 'Europe/Paris',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Buenos_Aires',
  'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

type TokenState = 'checking' | 'valid' | 'invalid';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 0%, #0d1524 0%, var(--bg) 60%)',
      padding: 24,
    }}>
      <div style={{ width: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 52, height: 52,
            background: 'var(--blue-dim)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            marginBottom: 14,
          }}>
            🤖
          </div>
          <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px' }}>Secretariat</div>
        </div>
        <div className="card" style={{ padding: 28 }}>{children}</div>
      </div>
    </div>
  );
}

export default function Register() {
  const { token } = useParams<{ token: string }>();
  const [tokenState, setTokenState] = useState<TokenState>('checking');
  const [tokenError, setTokenError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<{ name: string; calendarPending: boolean } | null>(null);

  useEffect(() => {
    if (!token) { setTokenState('invalid'); return; }
    fetch(`/api/register/${token}`)
      .then((r) => r.json().then((body) => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (ok && body.valid) {
          setTokenState('valid');
        } else {
          setTokenState('invalid');
          setTokenError(body.error ?? 'This invite link is not valid.');
        }
      })
      .catch(() => {
        setTokenState('invalid');
        setTokenError('Could not reach the server. Check your connection and reload.');
      });
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, phone, timezone, email: email.trim() || undefined, consent }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error ?? 'Registration failed.');
        return;
      }
      setResult({ name: body.name, calendarPending: body.calendarPending });
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenState === 'checking') {
    return (
      <Shell>
        <div className="loading-wrap" style={{ padding: 0 }}>
          <span className="spinner" />
          Checking your invite…
        </div>
      </Shell>
    );
  }

  if (tokenState === 'invalid') {
    return (
      <Shell>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>This link isn't valid</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>{tokenError}</p>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Welcome, {result.name}!</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: result.calendarPending ? 12 : 0 }}>
          You're registered. Send <code>/panel</code> to Secretariat on WhatsApp any time to get your sign-in link.
        </p>
        {result.calendarPending && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Calendar linking is pending — you'll get a WhatsApp message once it's ready to connect.
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Create your account</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
        Reminders, tasks, links, calendar, and digests — all through WhatsApp.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="field-label">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">WhatsApp number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+56911111111"
            required
          />
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            International format, with country code — this is the number you'll message the bot from.
          </div>
        </div>
        <div>
          <label className="field-label">Timezone</label>
          <input
            list="tz-options"
            value={timezone}
            spellCheck={false}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/Santiago or GMT-3"
            required
          />
          <datalist id="tz-options">
            {TIMEZONES.map((tz) => <option key={tz} value={tz} />)}
          </datalist>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
            Used for digests and day boundaries — a city name tracks daylight saving automatically.
          </div>
        </div>
        <div>
          <label className="field-label">Email (optional)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Only if you want calendar linking"
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ marginTop: 2 }}
            required
          />
          I agree to be contacted by Secretariat on WhatsApp.
        </label>

        {submitError && <p className="error-msg">{submitError}</p>}

        <button type="submit" className="btn-primary" disabled={submitting} style={{ marginTop: 4, padding: '9px 14px', fontSize: 14 }}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </Shell>
  );
}
