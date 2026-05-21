import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
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
import { scheduleCron, deleteSchedule, scheduleOnce } from '../qstash/client';
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
  markIdeaAsDone,
  getDoneIdeas,
} from '../integrations/local/ideas';
import { getLinks, getReadLinks, addLink, markLinkRead, deleteLink, updateLink } from '../integrations/local/links';
import { resolveAccount } from '../integrations/registry';
import { getEventsForDate, listCalendars } from '../integrations/google/calendar';
import { COMMANDS } from '../registries/commands.registry';
import { FLAGS } from '../registries/flags.registry';
import { getPlans, getPlan, createPlan, updatePlan, deletePlan } from '../integrations/local/plans';
import { getReminders, removeReminder, updateReminder } from '../integrations/local/reminders';
import { getWorkItems, getDoneWorkItems, addWorkItem, markWorkItemDone, deleteWorkItem, getWorkItem, updateWorkItemReminder } from '../integrations/local/work';
import { getTasks, getDoneTasks, addTask, markTaskDone, deleteTask, updateTaskQStashId } from '../integrations/local/tasks';
import { cancelMessage } from '../qstash/client';
import { getSnoozeDate, SnoozeOption } from '../utils/snooze';

const router = Router();

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// --- Session auth middleware ---
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as { authenticated?: boolean }).authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// --- Auth ---
router.post('/login', loginRateLimit, (req: Request, res: Response) => {
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
    isDisconnected: a.isDisconnected ?? false,
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

  // Handle work reminder cron (every Monday)
  const prevWork = current.workReminder ?? { enabled: false, time: '09:00' };
  const nextWork = next.workReminder ?? prevWork;

  if (prevWork.scheduleId && (!nextWork.enabled || prevWork.time !== nextWork.time)) {
    try { await deleteSchedule(prevWork.scheduleId); } catch { /* ignore */ }
    nextWork.scheduleId = undefined;
  }

  if (nextWork.enabled && !nextWork.scheduleId) {
    const [hh, mm] = nextWork.time.split(':');
    const cron = `${mm} ${hh} * * 1`; // every Monday
    try {
      nextWork.scheduleId = await scheduleCron('/internal/digest/work', cron, {});
    } catch (err) {
      console.error('Failed to create work reminder schedule:', err);
    }
  }
  next.workReminder = nextWork;

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

router.patch('/ideas/:id/done', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const ok = await markIdeaAsDone(id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

router.get('/ideas/done', requireAuth, async (_req, res) => {
  const ideas = await getDoneIdeas();
  res.json({ ideas });
});

// --- Dashboard ---
router.get('/dashboard', requireAuth, async (_req, res) => {
  const settings = await getSettings();
  const tz = settings.timezone;

  const [calAccount, ideasRes, localTasks] = await Promise.all([
    resolveAccount('calendar'),
    getIdeas(),
    getTasks(),
  ]);

  const events = calAccount
    ? await getEventsForDate(calAccount, new Date(), tz).catch(() => [])
    : [];

  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  const recentIdeas = [...ideasRes].reverse().slice(0, 3);

  res.json({
    events: events.map((e) => ({
      title: e.title,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
    })),
    tasks: localTasks.slice(0, 5).map((t) => ({
      title: t.title,
      dueDate: t.dueDate ?? null,
      project: t.project ?? null,
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

router.put('/reminders/:id', requireAuth, async (req, res) => {
  const id = req.params['id'] as string;
  const { fireAt } = req.body as { fireAt: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'fireAt must be a valid future datetime' }); return;
  }
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }
  await cancelMessage(reminder.messageId).catch(() => {});
  const delaySeconds = Math.floor((newFireAt.getTime() - Date.now()) / 1000);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
    reminderId: id,
    title: reminder.title,
    phoneNumber: reminder.phoneNumber,
  });
  await updateReminder(id, { fireAt: newFireAt.toISOString(), messageId: newMessageId });
  res.json({ ok: true });
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

// --- Links ---
router.get('/links', requireAuth, async (req, res) => {
  const filter = (req.query as { filter?: string }).filter;
  const links = filter === 'read' ? await getReadLinks() : await getLinks();
  res.json({ links });
});

router.post('/links', requireAuth, async (req, res) => {
  const { url, tags } = req.body as { url?: string; tags?: string[] };
  if (!url?.trim()) { res.status(400).json({ error: 'url is required' }); return; }
  res.json({ link: await addLink(url, tags ?? []) });
});

router.patch('/links/:id', requireAuth, async (req, res) => {
  const ok = await updateLink(Number(req.params['id']), req.body as { url?: string; tags?: string[] });
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

router.post('/links/:id/read', requireAuth, async (req, res) => {
  const ok = await markLinkRead(Number(req.params['id']));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found or already read' });
});

router.delete('/links/:id', requireAuth, async (req, res) => {
  const ok = await deleteLink(Number(req.params['id']));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

// --- Work ---
router.get('/work', requireAuth, async (_req, res) => {
  const items = await getWorkItems();
  res.json({ items });
});

router.get('/work/done', requireAuth, async (_req, res) => {
  const items = await getDoneWorkItems();
  res.json({ items });
});

router.post('/work', requireAuth, async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ error: 'text required' }); return; }
  const item = await addWorkItem(text.trim());
  res.json({ item });
});

router.patch('/work/:id/done', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const item = await markWorkItemDone(id);
  if (!item) { res.status(404).json({ error: 'Work item not found' }); return; }
  res.json({ ok: true });
});

router.delete('/work/:id', requireAuth, async (req, res) => {
  const ok = await deleteWorkItem(Number(req.params.id));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

// --- Local Tasks ---
router.get('/tasks', requireAuth, async (_req, res) => {
  const items = await getTasks();
  res.json({ items });
});

router.get('/tasks/done', requireAuth, async (_req, res) => {
  const items = await getDoneTasks();
  res.json({ items });
});

router.post('/tasks', requireAuth, async (req, res) => {
  const { title, project } = req.body as { title?: string; project?: string };
  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return; }
  const item = await addTask({ title: title.trim(), project });
  res.json({ item });
});

router.patch('/tasks/:id/done', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const task = await markTaskDone(id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.qstashMessageId) {
    await cancelMessage(task.qstashMessageId).catch(() => null);
  }
  res.json({ ok: true });
});

router.delete('/tasks/:id', requireAuth, async (req, res) => {
  const ok = await deleteTask(Number(req.params.id));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

// --- Snooze / Remind helpers ---
function ownerPhone(): string {
  return env.WHITELISTED_NUMBERS.split(',')[0].trim();
}

function parseSnoozeOption(body: unknown): SnoozeOption | null {
  const option = (body as { option?: string }).option;
  if (option === '1d' || option === '3d' || option === 'monday') return option;
  return null;
}

// Reminders — snooze
router.post('/reminders/:id/snooze', requireAuth, async (req, res) => {
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const settings = await getSettings();
  const reminders = await getReminders();
  const reminder = reminders.find((r) => r.id === req.params.id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }

  await cancelMessage(reminder.messageId).catch(() => {});
  const fireAt = getSnoozeDate(option, settings.defaultTaskTime);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    reminderId: reminder.id,
    title: reminder.title,
    phoneNumber: reminder.phoneNumber,
  });
  await updateReminder(reminder.id, { fireAt: fireAt.toISOString(), messageId: newMessageId });
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — snooze existing reminder
router.post('/tasks/:id/snooze', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  if (task.qstashMessageId) await cancelMessage(task.qstashMessageId).catch(() => {});

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.defaultTaskTime);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: ownerPhone(),
  });
  await updateTaskQStashId(id, newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — add reminder for tasks without one
router.post('/tasks/:id/remind', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.defaultTaskTime);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: ownerPhone(),
  });
  await updateTaskQStashId(id, newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Work — snooze existing reminder
router.post('/work/:id/snooze', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getWorkItem(id);
  if (!item) { res.status(404).json({ error: 'Work item not found' }); return; }

  if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => {});

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.defaultTaskTime);
  const newMessageId = await scheduleOnce('/internal/work/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    workItemId: id,
    text: item.text,
    phoneNumber: ownerPhone(),
  });
  await updateWorkItemReminder(id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Work — add reminder for items without one
router.post('/work/:id/remind', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getWorkItem(id);
  if (!item) { res.status(404).json({ error: 'Work item not found' }); return; }

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.defaultTaskTime);
  const newMessageId = await scheduleOnce('/internal/work/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    workItemId: id,
    text: item.text,
    phoneNumber: ownerPhone(),
  });
  await updateWorkItemReminder(id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// --- Google OAuth start (proxy from admin panel) ---
router.get('/auth/google/start', requireAuth, (req, res) => {
  const alias = req.query['alias'] as string || 'default';
  const type = req.query['type'] as string || 'calendar';
  res.redirect(`/auth/google/start?alias=${encodeURIComponent(alias)}&type=${encodeURIComponent(type)}`);
});

export default router;
