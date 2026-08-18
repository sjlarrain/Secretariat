// Public, unauthenticated landing page (docs/v2-plan.md §B.1), served at `/`.
// No pricing, no plans — registration isn't open from here, it requires an
// invite link shared out of band by the operator. Existing users don't sign in
// on a page at all; the entry point is the WhatsApp bot itself, which is why
// the page ends on "here is what to send", not on a login form.

const FEATURES = [
  { icon: '📅', title: 'Calendar', text: 'Schedule events, check availability, and see your day at a glance — all from a chat.' },
  { icon: '⏰', title: 'Reminders', text: 'Set a reminder in plain language and it fires on WhatsApp when it’s due.' },
  { icon: '📋', title: 'Tasks', text: 'A running task list that syncs both ways with Google Tasks.' },
  { icon: '🌐', title: 'Links', text: 'Save a URL to read later, tagged and searchable.' },
  { icon: '🎓', title: 'MBA list', text: 'Coursework with deadlines — it reminds you 24h before each one is due.' },
  { icon: '☀️', title: 'Digests', text: 'A morning summary of your day, and a weekly recap — sent automatically.' },
];

// The first three messages a new user should send, in order. Mirrors what
// `/start` replies with, so the page and the bot tell the same story.
const FIRST_STEPS = [
  { cmd: '/start', text: 'Wakes the bot and says hello.' },
  { cmd: '/example', text: 'Real examples you can copy straight into the chat — the fastest way in.' },
  { cmd: '/menu', text: 'The full command reference, with every flag.' },
];

export default function Welcome() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #0d1524 0%, var(--bg) 60%)',
      padding: '64px 24px',
    }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            width: 64, height: 64,
            background: 'var(--blue-dim)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: 16,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 32,
            marginBottom: 18,
          }}>
            🤖
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', marginBottom: 10 }}>
            Secretariat
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
            A personal assistant that lives entirely in WhatsApp — calendar, tasks, reminders, and links,
            without another app to open.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 40 }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{f.text}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: '20px 24px', marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, textAlign: 'center' }}>
            Once you’re in, start here
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 14, textAlign: 'center' }}>
            Every message to Secretariat starts with a <code>/</code>. These three get you going.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FIRST_STEPS.map((step) => (
              <div key={step.cmd} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <code style={{
                  fontSize: 13, fontWeight: 700,
                  color: 'var(--blue-bright)',
                  background: 'var(--blue-dim)',
                  padding: '2px 8px', borderRadius: 6,
                  flexShrink: 0,
                }}>
                  {step.cmd}
                </code>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  {step.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Already have an account?</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Send <code>/panel</code> to Secretariat on WhatsApp to get a link into your panel.
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-dim)', marginTop: 24, lineHeight: 1.6 }}>
          Secretariat is invite-only. If someone shared a link with you, open it to get started.
        </p>
      </div>
    </div>
  );
}
