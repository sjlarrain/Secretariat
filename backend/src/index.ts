import './shared/env'; // validate env vars first — crashes on missing
import express from 'express';
import session from 'express-session';
import path from 'path';
import { env } from './shared/env';
import webhookRouter from './platform/routes/webhook';
import internalRouter from './platform/routes/internal';
import authRouter from './ops/routes/google-oauth';
import userAuthRouter from './platform/routes/user-google-oauth';
import adminRouter from './ops/api';
import registerRouter from './platform/routes/register';
import panelRouter from './platform/routes/panel';
import userApiRouter from './platform/routes/user-api';
import { ensureSweeperSchedule } from './platform/ensureSweeperSchedule';

const app = express();

// Render terminates TLS at its load balancer — trust the X-Forwarded-Proto header
// so that secure session cookies are set correctly over HTTPS
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'secretariat', timestamp: new Date().toISOString() });
});

// API routes
app.use('/webhook/whatsapp', webhookRouter);
app.use('/internal', internalRouter);
// Mounted before /auth so its routes are matched first — otherwise a
// request to /auth/user/* would first be tested (and fall through) against
// authRouter's own routes before ever reaching this one.
app.use('/auth/user', userAuthRouter);
app.use('/auth', authRouter);
app.use('/api/admin', adminRouter);
// Public — invite-token gated, no session. Mounted before the SPA fallback so
// it is not swallowed by it.
app.use('/api/register', registerRouter);
// Public login page + session establishment for the per-user panel — see
// docs/v2-plan.md §B.4. Also mounted before the SPA fallback.
app.use('/panel', panelRouter);
// Per-user panel API. Every route inside is gated by requireUserSession.
app.use('/api/user', userApiRouter);

// Serve admin panel static files
app.use(express.static(path.join(__dirname, '../../admin/dist')));

// SPA fallback
app.get('*', (req, res) => {
  if (
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/webhook') &&
    !req.path.startsWith('/internal') &&
    !req.path.startsWith('/auth') &&
    !req.path.startsWith('/panel')
  ) {
    res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
  }
});

app.listen(env.PORT, () => {
  console.log(`Secretariat listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Fire-and-forget: does not block the server from accepting requests.
void ensureSweeperSchedule();
