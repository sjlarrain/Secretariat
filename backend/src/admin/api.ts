import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../env';
import {
  getAllAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  getSettings,
  saveSettings,
} from '../integrations/token-store';
import { setDefault } from '../integrations/registry';
import { scheduleCron, deleteSchedule } from '../qstash/client';
import { whitelistedNumbers } from '../env';
import {
  getIdeas,
  addIdea,
  updateIdea,
  deleteIdea,
  getProjects,
  findOrCreateProject,
  updateProject,
  deleteProject,
  getDefaultProject,
  getTrashedIdeas,
  restoreIdea,
  permanentlyDeleteIdea,
  emptyTrash,
} from '../integrations/local/ideas';
import { resolveAccount } from '../integrations/registry';
import { getEventsForDate, listCalendars } from '../integrations/google/calendar';
import { getPendingTasks } from '../integrations/google/tasks';
import { COMMANDS } from '../registries/commands.registry';
import { FLAGS } from '../registries/flags.registry';
import { getPlans, getPlan, createPlan, updatePlan, deletePlan } from '../integrations/local/plans';
import { getReminders, removeReminder } from '../integrations/local/reminders';
import { cancelMessage } from '../qstash/client';

const router = Router();

// --- Session auth middleware ---
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as { authenticated?: boolean }).authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// --- Auth ---
router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD) {
    (req.session as { authenticated?: boolean }).authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// --- Accounts ---
router.get('/accounts', requireAuth, async (_req, res) => {
  const accounts = (await getAllAccounts()).map((a) => ({
    id: a.id,
    alias: a.alias,
    provider: a.provider,
    type: a.type,
    isDefault: a.isDefault,
  }));
  res.json({ accounts });
});

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  await deleteAccount(String(req.params.id));
  res.json({ ok: true });
});

router.patch('/accounts/:id', requireAuth, async (req, res) => {
  const account = await getAccount(String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const body = req.body as { alias?: string; isDefault?: boolean };

  if (body.alias) account.alias = body.alias;
  if (body.isDefault === true) {
    await setDefault(account.id);
    res.json({ ok: true });
    return;
  }

  await saveAccount(account);
  res.json({ ok: true });
});

router.get('/accounts/:id/calendars', requireAuth, async (req, res) => {
  const account = await getAccount(String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const calendars = await listCalendars(account);
  res.json({ calendars, enabledCalendarIds: account.enabledCalendarIds ?? ['primary'] });
});

router.patch('/accounts/:id/calendars', requireAuth, async (req, res) => {
  const account = await getAccount(String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const { calendarIds, calendarNames } = req.body as { calendarIds: string[]; calendarNames?: Record<string, string> };
  account.enabledCalendarIds = calendarIds;
  if (calendarNames) account.calendarNames = calendarNames;
  await saveAccount(account);
  res.json({ ok: true });
});

// --- Whitelist (persisted in settings) ---
router.get('/whitelist', requireAuth, (_req, res) => {
  res.json({ numbers: whitelistedNumbers });
});

// Note: In v1 the whitelist is managed via the WHITELISTED_NUMBERS env var and
// cannot be changed at runtime without a redeploy. This endpoint is read-only.
router.post('/whitelist', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'Runtime whitelist modification not supported in v1. Update WHITELISTED_NUMBERS env var and redeploy.',
  });
});

router.delete('/whitelist/:number', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'Runtime whitelist modification not supported in v1. Update WHITELISTED_NUMBERS env var and redeploy.',
  });
});

// --- Settings ---
router.get('/settings', requireAuth, async (_req, res) => {
  res.json(await getSettings());
});

router.put('/settings', requireAuth, async (req, res) => {
  const body = req.body as Parameters<typeof saveSettings>[0];
  const current = await getSettings();
  const next = { ...current, ...body };

  // Handle morning digest cron
  const prevMorning = current.morningDigest;
  const nextMorning = next.morningDigest;

  if (prevMorning.scheduleId && (!nextMorning.enabled || JSON.stringify(prevMorning) !== JSON.stringify(nextMorning))) {
    try { await deleteSchedule(prevMorning.scheduleId); } catch { /* ignore */ }
    nextMorning.scheduleId = undefined;
  }

  if (nextMorning.enabled && !nextMorning.scheduleId) {
    const [hh, mm] = nextMorning.time.split(':');
    const dayCron = nextMorning.days.join(',');
    const cron = `${mm} ${hh} * * ${dayCron}`;
    try {
      nextMorning.scheduleId = await scheduleCron('/internal/digest/morning', cron, {});
    } catch (err) {
      console.error('Failed to create morning digest schedule:', err);
    }
  }

  // Handle weekly summary cron
  const prevWeekly = current.weeklySummary;
  const nextWeekly = next.weeklySummary;

  if (prevWeekly.scheduleId && (!nextWeekly.enabled || JSON.stringify(prevWeekly) !== JSON.stringify(nextWeekly))) {
    try { await deleteSchedule(prevWeekly.scheduleId); } catch { /* ignore */ }
    nextWeekly.scheduleId = undefined;
  }

  if (nextWeekly.enabled && !nextWeekly.scheduleId) {
    const [hh, mm] = nextWeekly.time.split(':');
    const cron = `${mm} ${hh} * * ${nextWeekly.day}`;
    try {
      nextWeekly.scheduleId = await scheduleCron('/internal/digest/weekly', cron, {});
    } catch (err) {
      console.error('Failed to create weekly summary schedule:', err);
    }
  }

  await saveSettings(next);
  res.json({ ok: true, settings: next });
});

// --- Projects ---
router.get('/projects', requireAuth, async (_req, res) => {
  const [projects, ideas] = await Promise.all([getProjects(), getIdeas()]);
  const withCounts = projects.map((p) => ({
    ...p,
    ideaCount: ideas.filter((i) => i.projectId === p.id).length,
  }));
  res.json({ projects: withCounts });
});

router.post('/projects', requireAuth, async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const project = await findOrCreateProject(name);
  res.json({ project });
});

router.patch('/projects/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const ok = await updateProject(id, name);
  if (!ok) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json({ ok: true });
});

router.delete('/projects/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const result = await deleteProject(id);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

// --- Ideas ---
router.get('/ideas', requireAuth, async (_req, res) => {
  const ideas = await getIdeas();
  res.json({ ideas });
});

router.post('/ideas', requireAuth, async (req, res) => {
  const { text, projectId } = req.body as { text?: string; projectId?: number };
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  const pid = projectId ?? (await getDefaultProject()).id;
  const idea = await addIdea(text, pid);
  res.json({ idea });
});

router.patch('/ideas/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { text, projectId } = req.body as { text?: string; projectId?: number };
  const ok = await updateIdea(id, { text, projectId });
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

// Trash routes before /:id to avoid Express matching "trash" as an id
router.get('/ideas/trash', requireAuth, async (_req, res) => {
  const ideas = await getTrashedIdeas();
  res.json({ ideas });
});

router.delete('/ideas/trash', requireAuth, async (_req, res) => {
  await emptyTrash();
  res.json({ ok: true });
});

// Soft delete → trash
router.delete('/ideas/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const ok = await deleteIdea(id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

router.post('/ideas/:id/restore', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const ok = await restoreIdea(id);
  if (!ok) { res.status(404).json({ error: 'Idea not found in trash' }); return; }
  res.json({ ok: true });
});

router.delete('/ideas/:id/permanent', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const ok = await permanentlyDeleteIdea(id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

// --- Dashboard ---
router.get('/dashboard', requireAuth, async (_req, res) => {
  const settings = await getSettings();
  const tz = settings.timezone;

  const [calAccount, tasksAccount, ideasRes] = await Promise.all([
    resolveAccount('calendar'),
    resolveAccount('tasks'),
    getIdeas(),
  ]);

  const [events, tasks] = await Promise.all([
    calAccount ? getEventsForDate(calAccount, new Date(), tz).catch(() => []) : Promise.resolve([]),
    tasksAccount ? getPendingTasks(tasksAccount).catch(() => []) : Promise.resolve([]),
  ]);

  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  const recentIdeas = [...ideasRes].reverse().slice(0, 3);

  res.json({
    events: events.map((e) => ({
      title: e.title,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
    })),
    tasks: tasks.map((t) => ({
      title: t.title,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    })),
    ideas: recentIdeas,
  });
});

// --- Commands reference ---
router.get('/commands', requireAuth, (_req, res) => {
  const commands = Object.entries(COMMANDS).map(([key, cmd]) => ({
    key,
    name: cmd.name,
    description: cmd.description,
    acceptedFlags: cmd.acceptedFlags.map((f) => ({
      key: f,
      long: FLAGS[f]?.name ?? `--${f}`,
      short: FLAGS[f]?.shortAlias ? `-${FLAGS[f].shortAlias}` : null,
      description: FLAGS[f]?.description ?? '',
      optional: FLAGS[f]?.optional ?? false,
    })),
    requiredFlags: cmd.requiredFlags,
  }));
  res.json({ commands });
});

// --- Plan types ---
router.get('/plans', requireAuth, async (_req, res) => {
  const plans = await getPlans();
  res.json({ plans });
});

router.post('/plans', requireAuth, async (req, res) => {
  const { name, days, slots, durationMinutes, bufferMinutes } = req.body as Partial<{ name: string; days: number[]; slots: string[]; durationMinutes: number; bufferMinutes: number }>;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!Array.isArray(days) || days.length === 0) { res.status(400).json({ error: 'days is required' }); return; }
  if (!Array.isArray(slots) || slots.length === 0) { res.status(400).json({ error: 'slots is required' }); return; }
  if (!durationMinutes || durationMinutes < 1) { res.status(400).json({ error: 'durationMinutes is required' }); return; }
  const plan = await createPlan({ name: name.trim(), days, slots, durationMinutes, bufferMinutes: bufferMinutes ?? 30 });
  res.json({ plan });
});

router.patch('/plans/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, days, slots, durationMinutes, bufferMinutes } = req.body as Partial<{ name: string; days: number[]; slots: string[]; durationMinutes: number; bufferMinutes: number }>;
  const ok = await updatePlan(id, {
    ...(name !== undefined && { name: name.trim() }),
    ...(days !== undefined && { days }),
    ...(slots !== undefined && { slots }),
    ...(durationMinutes !== undefined && { durationMinutes }),
    ...(bufferMinutes !== undefined && { bufferMinutes }),
  });
  if (!ok) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ ok: true });
});

router.delete('/plans/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const ok = await deletePlan(id);
  if (!ok) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ ok: true });
});

// --- Pending reminders ---
router.get('/reminders', requireAuth, async (_req, res) => {
  const reminders = await getReminders();
  res.json({ reminders });
});

router.delete('/reminders/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string;
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }
  await removeReminder(id);
  await cancelMessage(reminder.messageId).catch(() => {});
  res.json({ ok: true });
});

// --- Google OAuth start (proxy from admin panel) ---
router.get('/auth/google/start', requireAuth, (req, res) => {
  const alias = req.query['alias'] as string || 'default';
  const type = req.query['type'] as string || 'calendar';
  res.redirect(`/auth/google/start?alias=${encodeURIComponent(alias)}&type=${encodeURIComponent(type)}`);
});

export default router;
