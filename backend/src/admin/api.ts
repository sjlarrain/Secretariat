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
import { getThirdPartyContacts, addThirdPartyContact, removeThirdPartyContact } from '../integrations/local/third-party';
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
import { getUclaItems, getDoneUclaItems, addUclaItem, markUclaItemDone, deleteUclaItem, getUclaItem, updateUclaItem, updateUclaItemReminder } from '../integrations/local/ucla';
import { getHealthAlerts } from '../integrations/local/health-alerts';
import { getTasks, getDoneTasks, addTask, markTaskDone, deleteTask, updateTaskQStashId } from '../integrations/local/tasks';
import { cancelMessage } from '../qstash/client';
import { getSnoozeDate, SnoozeOption } from '../utils/snooze';
import { parseZoneInput } from '../utils/timezone';
import { reconcileSchedules } from '../qstash/schedules';

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

// --- Third-party contacts ---
router.get('/third-party-contacts', requireAuth, async (_req, res) => {
  const contacts = await getThirdPartyContacts();
  res.json({ contacts });
});

router.post('/third-party-contacts', requireAuth, async (req, res) => {
  const { number, alias } = req.body as { number?: string; alias?: string };
  if (!number || !alias) {
    res.status(400).json({ error: 'number and alias are required' });
    return;
  }
  const normalized = number.startsWith('+') ? number : `+${number}`;
  await addThirdPartyContact({ number: normalized, alias: alias.trim() });
  res.json({ ok: true });
});

router.delete('/third-party-contacts/:number', requireAuth, async (req, res) => {
  const number = decodeURIComponent(req.params['number'] as string);
  const removed = await removeThirdPartyContact(number);
  if (!removed) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }
  res.json({ ok: true });
});

// --- Settings ---
router.get('/settings', requireAuth, async (_req, res) => {
  res.json(await getSettings());
});

router.put('/settings', requireAuth, async (req, res) => {
  const body = req.body as Parameters<typeof saveSettings>[0];
  const current = await getSettings();
  const next = { ...current, ...body };

  // Normalize here rather than only in the /zone handler, so the panel accepts
  // the same inputs WhatsApp does (IANA name or GMT±N) and both paths store the
  // identical canonical zone.
  const zone = parseZoneInput(next.timezone);
  if (!zone) {
    res.status(400).json({ error: `Unknown timezone: "${next.timezone}". Use a city name like America/Santiago, or an offset like GMT-3.` });
    return;
  }
  next.timezone = zone;

  const reconciled = await reconcileSchedules(current, next);
  await saveSettings(reconciled);
  res.json({ ok: true, settings: reconciled });
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

// --- UCLA ---
router.get('/ucla', requireAuth, async (_req, res) => {
  const items = await getUclaItems();
  res.json({ items });
});

router.get('/ucla/done', requireAuth, async (_req, res) => {
  const items = await getDoneUclaItems();
  res.json({ items });
});

router.post('/ucla', requireAuth, async (req, res) => {
  const { text, dueDate } = req.body as { text?: string; dueDate?: string };
  if (!text?.trim()) { res.status(400).json({ error: 'text required' }); return; }

  let due: string | undefined;
  if (dueDate) {
    const parsedDue = new Date(dueDate);
    if (isNaN(parsedDue.getTime())) { res.status(400).json({ error: 'dueDate must be a valid datetime' }); return; }
    due = parsedDue.toISOString();
  }

  const item = await addUclaItem(text.trim(), { dueDate: due });

  // Mirror the WhatsApp flow: a due date schedules the automatic 24h reminder.
  if (due) {
    const owner = ownerPhone();
    const fireAt = new Date(due).getTime() - 24 * 60 * 60 * 1000;
    const delaySeconds = Math.floor((fireAt - Date.now()) / 1000);
    if (owner && delaySeconds > 0) {
      const dueReminderId = await scheduleOnce('/internal/ucla/due/fire', delaySeconds, {
        uclaItemId: item.id,
        text: item.text,
        dueAt: due,
        phoneNumber: owner,
      });
      await updateUclaItem(item.id, { dueReminderId });
      item.dueReminderId = dueReminderId;
    }
  }

  res.json({ item });
});

router.patch('/ucla/:id/done', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const item = await markUclaItemDone(id);
  if (!item) { res.status(404).json({ error: 'UCLA item not found' }); return; }
  for (const messageId of [item.qstashMessageId, item.dueReminderId]) {
    if (messageId) await cancelMessage(messageId).catch(() => {});
  }
  res.json({ ok: true });
});

router.delete('/ucla/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const item = await getUclaItem(id);
  for (const messageId of [item?.qstashMessageId, item?.dueReminderId]) {
    if (messageId) await cancelMessage(messageId).catch(() => {});
  }
  const ok = await deleteUclaItem(id);
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
  if (option === '1h' || option === '1d' || option === 'monday') return option;
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
  const fireAt = getSnoozeDate(option, settings.timezone);
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
  const fireAt = getSnoozeDate(option, settings.timezone);
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
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: ownerPhone(),
  });
  await updateTaskQStashId(id, newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// UCLA — snooze existing reminder
router.post('/ucla/:id/snooze', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getUclaItem(id);
  if (!item) { res.status(404).json({ error: 'UCLA item not found' }); return; }

  if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => {});

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/ucla/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    uclaItemId: id,
    text: item.text,
    phoneNumber: ownerPhone(),
  });
  await updateUclaItemReminder(id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — update reminder to a specific date/time
router.put('/tasks/:id/reminder', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { fireAt } = req.body as { fireAt?: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Invalid or past date' }); return;
  }
  const tasks = await getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.qstashMessageId) await cancelMessage(task.qstashMessageId).catch(() => {});
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((newFireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: ownerPhone(),
  });
  await updateTaskQStashId(id, newMessageId);
  res.json({ ok: true, fireAt: newFireAt.toISOString() });
});

// UCLA — add reminder for items without one
router.post('/ucla/:id/remind', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getUclaItem(id);
  if (!item) { res.status(404).json({ error: 'UCLA item not found' }); return; }

  const settings = await getSettings();
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/ucla/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    uclaItemId: id,
    text: item.text,
    phoneNumber: ownerPhone(),
  });
  await updateUclaItemReminder(id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// --- Health alerts (nightly health check) ---
router.get('/health-alerts', requireAuth, async (_req, res) => {
  const [alerts, settings] = await Promise.all([getHealthAlerts(), getSettings()]);
  res.json({ alerts, lastRunAt: settings.healthCheck?.lastRunAt ?? null });
});

// UCLA — update reminder to a specific date/time
router.put('/ucla/:id/reminder', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { fireAt } = req.body as { fireAt?: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Invalid or past date' }); return;
  }
  const item = await getUclaItem(id);
  if (!item) { res.status(404).json({ error: 'UCLA item not found' }); return; }
  if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => {});
  const newMessageId = await scheduleOnce('/internal/ucla/reminder/fire', Math.floor((newFireAt.getTime() - Date.now()) / 1000), {
    uclaItemId: id,
    text: item.text,
    phoneNumber: ownerPhone(),
  });
  await updateUclaItemReminder(id, newFireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: newFireAt.toISOString() });
});

// --- Google OAuth start (proxy from admin panel) ---
router.get('/auth/google/start', requireAuth, (req, res) => {
  const alias = req.query['alias'] as string || 'default';
  const type = req.query['type'] as string || 'calendar';
  res.redirect(`/auth/google/start?alias=${encodeURIComponent(alias)}&type=${encodeURIComponent(type)}`);
});

export default router;
