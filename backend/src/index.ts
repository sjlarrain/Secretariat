import './env'; // validate env vars first — crashes on missing
import express from 'express';
import session from 'express-session';
import path from 'path';
import { env } from './env';
import webhookRouter from './routes/webhook';
import internalRouter from './routes/internal';
import authRouter from './routes/auth';
import adminRouter from './admin/api';

const app = express();

// Render terminates TLS at its load balancer — trust the X-Forwarded-Proto header
// so that secure session cookies are set correctly over HTTPS
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: env.ADMIN_PASSWORD,
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
app.use('/auth', authRouter);
app.use('/api/admin', adminRouter);

// Serve admin panel static files
app.use(express.static(path.join(__dirname, '../../admin/dist')));

// SPA fallback
app.get('*', (req, res) => {
  if (
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/webhook') &&
    !req.path.startsWith('/internal') &&
    !req.path.startsWith('/auth')
  ) {
    res.sendFile(path.join(__dirname, '../../admin/dist/index.html'));
  }
});

app.listen(env.PORT, () => {
  console.log(`Secretariat listening on port ${env.PORT} (${env.NODE_ENV})`);
});
