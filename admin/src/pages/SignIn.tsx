// Shown at /app/signin whenever the per-user panel has no valid session —
// on first visit, or after client.ts's userClient redirects here on a 401.
// There's no password to enter: `onUnauthorized` in api/client.ts sends the
// visitor here, and the only way back in is a fresh WhatsApp link.
export default function SignIn() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at 50% 0%, #0d1524 0%, var(--bg) 60%)',
      padding: 24,
    }}>
      <div style={{ width: 360, textAlign: 'center' }}>
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
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3, marginBottom: 24 }}>Your Panel</div>

        <div className="card" style={{ padding: 24, textAlign: 'left' }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 10 }}>
            You're not signed in.
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Send <code>/panel</code> to Secretariat on WhatsApp — it'll text you a one-time
            link that signs you in here.
          </p>
        </div>
      </div>
    </div>
  );
}
