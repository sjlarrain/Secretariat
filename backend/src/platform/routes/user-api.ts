import { Router, Request, Response } from 'express';
import { requireUserSession, UserSessionRequest } from '../../auth/middleware/user-session';
import { getRegisteredUser } from '../../auth/users';
import {
  getAllAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  getSettings,
  saveSettings,
  normalizeSettings,
} from '../../core/integrations/token-store';
import { setDefault, resolveAccount } from '../../core/integrations/registry';
import { getEventsForDate, listCalendars } from '../../core/integrations/google/calendar';
import { getThirdPartyContacts, addThirdPartyContact, removeThirdPartyContact } from '../../core/integrations/local/third-party';
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
} from '../../core/integrations/local/ideas';
import { getLinks, getReadLinks, addLink, markLinkRead, deleteLink, updateLink } from '../../core/integrations/local/links';
import { getPlans, createPlan, updatePlan, deletePlan } from '../../core/integrations/local/plans';
import { getReminders, removeReminder, updateReminder } from '../../core/integrations/local/reminders';
import {
  getMbaItems,
  getDoneMbaItems,
  addMbaItem,
  markMbaItemDone,
  deleteMbaItem,
  getMbaItem,
  updateMbaItem,
  updateMbaItemReminder,
} from '../../core/integrations/local/mba';
import { getTasks, getDoneTasks, addTask, markTaskDone, deleteTask, updateTaskQStashId } from '../../core/integrations/local/tasks';
import { scheduleOnce, cancelMessage } from '../../shared/qstash/client';
import { getSnoozeDate, SnoozeOption } from '../../shared/utils/snooze';
import { parseZoneInput } from '../../shared/utils/timezone';
import { COMMANDS } from '../../core/registries/commands.registry';
import { FLAGS } from '../../core/registries/flags.registry';

// The per-user panel API (docs/v2-plan.md §A/§B.4/§C.6) — everything a
// registered user manages about their own account: connected calendars,
// ideas, links, plans, tasks, reminders, settings. Every route resolves data
// from `req.userCtx.userId`, which `requireUserSession` derives from the
// session cookie — never from a URL or body parameter, so a session cannot
// be pointed at another user's namespace by editing the request.
//
// This is the v2 home for what ops/api.ts served in v1 under a single
// global operator login. Ops-only concerns (invites, the user registry,
// unrecognized senders, system health) stay in ops/api.ts.

const router = Router();

// Public — destroys whatever session cookie is presented, valid or not, so
// it must come before the session gate below.
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.use(requireUserSession);

function uid(req: Request): string {
  return (req as UserSessionRequest).userCtx.userId;
}

// Static reference data, identical for every user — no session data in the
// response, so it's safe to leave gated only for consistency with the rest
// of this router rather than for any confidentiality reason.
router.get('/commands', (_req: Request, res: Response) => {
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

router.get('/me', async (req: Request, res: Response) => {
  const user = await getRegisteredUser(uid(req));
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    name: user.name,
    timezone: user.timezone,
    email: user.email ?? null,
    calendarAccess: user.calendarAccess ?? null,
  });
});

// --- Settings ---
router.get('/settings', async (req: Request, res: Response) => {
  res.json(await getSettings(uid(req)));
});

router.put('/settings', async (req: Request, res: Response) => {
  const userId = uid(req);
  const body = req.body as Parameters<typeof saveSettings>[1];
  const current = await getSettings(userId);
  const next = { ...current, ...body };

  const zone = parseZoneInput(next.timezone);
  if (!zone) {
    res.status(400).json({ error: `Unknown timezone: "${next.timezone}". Use a city name like America/Santiago, or an offset like GMT-3.` });
    return;
  }
  next.timezone = zone;

  const normalized = normalizeSettings(next);
  await saveSettings(userId, normalized);
  res.json({ ok: true, settings: normalized });
});

// --- Accounts ---
router.get('/accounts', async (req: Request, res: Response) => {
  const accounts = (await getAllAccounts(uid(req))).map((a) => ({
    id: a.id,
    alias: a.alias,
    provider: a.provider,
    type: a.type,
    isDefault: a.isDefault,
    isDisconnected: a.isDisconnected ?? false,
  }));
  res.json({ accounts });
});

router.delete('/accounts/:id', async (req: Request, res: Response) => {
  await deleteAccount(uid(req), String(req.params.id));
  res.json({ ok: true });
});

router.patch('/accounts/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const account = await getAccount(userId, String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  const body = req.body as { alias?: string; isDefault?: boolean };

  if (body.alias) account.alias = body.alias;
  if (body.isDefault === true) {
    await setDefault(userId, account.id);
    res.json({ ok: true });
    return;
  }

  await saveAccount(userId, account);
  res.json({ ok: true });
});

router.get('/accounts/:id/calendars', async (req: Request, res: Response) => {
  const userId = uid(req);
  const account = await getAccount(userId, String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const calendars = await listCalendars(userId, account);
  res.json({ calendars, enabledCalendarIds: account.enabledCalendarIds ?? ['primary'] });
});

router.patch('/accounts/:id/calendars', async (req: Request, res: Response) => {
  const userId = uid(req);
  const account = await getAccount(userId, String(req.params.id));
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const { calendarIds, calendarNames } = req.body as { calendarIds: string[]; calendarNames?: Record<string, string> };
  account.enabledCalendarIds = calendarIds;
  if (calendarNames) account.calendarNames = calendarNames;
  await saveAccount(userId, account);
  res.json({ ok: true });
});

// --- Third-party contacts ---
router.get('/third-party-contacts', async (req: Request, res: Response) => {
  const contacts = await getThirdPartyContacts(uid(req));
  res.json({ contacts });
});

router.post('/third-party-contacts', async (req: Request, res: Response) => {
  const { number, alias } = req.body as { number?: string; alias?: string };
  if (!number || !alias) {
    res.status(400).json({ error: 'number and alias are required' });
    return;
  }
  const normalized = number.startsWith('+') ? number : `+${number}`;
  await addThirdPartyContact(uid(req), { number: normalized, alias: alias.trim() });
  res.json({ ok: true });
});

router.delete('/third-party-contacts/:number', async (req: Request, res: Response) => {
  const number = decodeURIComponent(req.params['number'] as string);
  const removed = await removeThirdPartyContact(uid(req), number);
  if (!removed) {
    res.status(404).json({ error: 'Contact not found' });
    return;
  }
  res.json({ ok: true });
});

// --- Projects ---
router.get('/projects', async (req: Request, res: Response) => {
  const userId = uid(req);
  const [projects, ideas] = await Promise.all([getProjects(userId), getIdeas(userId)]);
  const withCounts = projects.map((p) => ({
    ...p,
    ideaCount: ideas.filter((i) => i.projectId === p.id).length,
  }));
  res.json({ projects: withCounts });
});

router.post('/projects', async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const project = await findOrCreateProject(uid(req), name);
  res.json({ project });
});

router.patch('/projects/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  const ok = await updateProject(uid(req), id, name);
  if (!ok) { res.status(404).json({ error: 'Project not found' }); return; }
  res.json({ ok: true });
});

router.delete('/projects/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = await deleteProject(uid(req), id);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

// --- Ideas ---
router.get('/ideas', async (req: Request, res: Response) => {
  res.json({ ideas: await getIdeas(uid(req)) });
});

router.post('/ideas', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { text, projectId } = req.body as { text?: string; projectId?: number };
  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }
  const pid = projectId ?? (await getDefaultProject(userId)).id;
  const idea = await addIdea(userId, text, pid);
  res.json({ idea });
});

router.patch('/ideas/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { text, projectId } = req.body as { text?: string; projectId?: number };
  const ok = await updateIdea(uid(req), id, { text, projectId });
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

// Trash routes before /:id to avoid Express matching "trash" as an id
router.get('/ideas/trash', async (req: Request, res: Response) => {
  res.json({ ideas: await getTrashedIdeas(uid(req)) });
});

router.delete('/ideas/trash', async (req: Request, res: Response) => {
  await emptyTrash(uid(req));
  res.json({ ok: true });
});

// Soft delete → trash
router.delete('/ideas/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = await deleteIdea(uid(req), id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

router.post('/ideas/:id/restore', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = await restoreIdea(uid(req), id);
  if (!ok) { res.status(404).json({ error: 'Idea not found in trash' }); return; }
  res.json({ ok: true });
});

router.delete('/ideas/:id/permanent', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = await permanentlyDeleteIdea(uid(req), id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

router.patch('/ideas/:id/done', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = await markIdeaAsDone(uid(req), id);
  if (!ok) { res.status(404).json({ error: 'Idea not found' }); return; }
  res.json({ ok: true });
});

router.get('/ideas/done', async (req: Request, res: Response) => {
  res.json({ ideas: await getDoneIdeas(uid(req)) });
});

// --- Dashboard ---
router.get('/dashboard', async (req: Request, res: Response) => {
  const userId = uid(req);
  const settings = await getSettings(userId);
  const tz = settings.timezone;

  const [calAccount, ideasRes, localTasks] = await Promise.all([
    resolveAccount(userId, 'calendar'),
    getIdeas(userId),
    getTasks(userId),
  ]);

  const events = calAccount
    ? await getEventsForDate(userId, calAccount, new Date(), tz).catch(() => [])
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

// --- Plan types ---
router.get('/plans', async (req: Request, res: Response) => {
  res.json({ plans: await getPlans(uid(req)) });
});

router.post('/plans', async (req: Request, res: Response) => {
  const { name, days, slots, durationMinutes, bufferMinutes } = req.body as Partial<{ name: string; days: number[]; slots: string[]; durationMinutes: number; bufferMinutes: number }>;
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  if (!Array.isArray(days) || days.length === 0) { res.status(400).json({ error: 'days is required' }); return; }
  if (!Array.isArray(slots) || slots.length === 0) { res.status(400).json({ error: 'slots is required' }); return; }
  if (!durationMinutes || durationMinutes < 1) { res.status(400).json({ error: 'durationMinutes is required' }); return; }
  const plan = await createPlan(uid(req), { name: name.trim(), days, slots, durationMinutes, bufferMinutes: bufferMinutes ?? 30 });
  res.json({ plan });
});

router.patch('/plans/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, days, slots, durationMinutes, bufferMinutes } = req.body as Partial<{ name: string; days: number[]; slots: string[]; durationMinutes: number; bufferMinutes: number }>;
  const ok = await updatePlan(uid(req), id, {
    ...(name !== undefined && { name: name.trim() }),
    ...(days !== undefined && { days }),
    ...(slots !== undefined && { slots }),
    ...(durationMinutes !== undefined && { durationMinutes }),
    ...(bufferMinutes !== undefined && { bufferMinutes }),
  });
  if (!ok) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ ok: true });
});

router.delete('/plans/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ok = await deletePlan(uid(req), id);
  if (!ok) { res.status(404).json({ error: 'Plan not found' }); return; }
  res.json({ ok: true });
});

// --- Pending reminders ---
router.get('/reminders', async (req: Request, res: Response) => {
  res.json({ reminders: await getReminders(uid(req)) });
});

router.put('/reminders/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params['id'] as string;
  const { fireAt } = req.body as { fireAt: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'fireAt must be a valid future datetime' }); return;
  }
  const reminders = await getReminders(userId);
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }
  await cancelMessage(reminder.messageId).catch(() => {});
  const delaySeconds = Math.floor((newFireAt.getTime() - Date.now()) / 1000);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', delaySeconds, {
    reminderId: id,
    title: reminder.title,
    phoneNumber: reminder.phoneNumber,
    userId,
  });
  await updateReminder(userId, id, { fireAt: newFireAt.toISOString(), messageId: newMessageId });
  res.json({ ok: true });
});

router.delete('/reminders/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params['id'] as string;
  const reminders = await getReminders(userId);
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }
  await removeReminder(userId, id);
  await cancelMessage(reminder.messageId).catch(() => {});
  res.json({ ok: true });
});

// --- Links ---
router.get('/links', async (req: Request, res: Response) => {
  const filter = (req.query as { filter?: string }).filter;
  const userId = uid(req);
  const links = filter === 'read' ? await getReadLinks(userId) : await getLinks(userId);
  res.json({ links });
});

router.post('/links', async (req: Request, res: Response) => {
  const { url, tags, name } = req.body as { url?: string; tags?: string[]; name?: string };
  if (!url?.trim()) { res.status(400).json({ error: 'url is required' }); return; }
  res.json({ link: await addLink(uid(req), url, tags ?? [], name) });
});

router.patch('/links/:id', async (req: Request, res: Response) => {
  const ok = await updateLink(uid(req), Number(req.params['id']), req.body as { url?: string; tags?: string[]; name?: string });
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

router.post('/links/:id/read', async (req: Request, res: Response) => {
  const ok = await markLinkRead(uid(req), Number(req.params['id']));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found or already read' });
});

router.delete('/links/:id', async (req: Request, res: Response) => {
  const ok = await deleteLink(uid(req), Number(req.params['id']));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

// --- MBA ---
router.get('/mba', async (req: Request, res: Response) => {
  res.json({ items: await getMbaItems(uid(req)) });
});

router.get('/mba/done', async (req: Request, res: Response) => {
  res.json({ items: await getDoneMbaItems(uid(req)) });
});

router.post('/mba', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { text, dueDate } = req.body as { text?: string; dueDate?: string };
  if (!text?.trim()) { res.status(400).json({ error: 'text required' }); return; }

  let due: string | undefined;
  if (dueDate) {
    const parsedDue = new Date(dueDate);
    if (isNaN(parsedDue.getTime())) { res.status(400).json({ error: 'dueDate must be a valid datetime' }); return; }
    due = parsedDue.toISOString();
  }

  const item = await addMbaItem(userId, text.trim(), { dueDate: due });

  // Mirror the WhatsApp flow: a due date schedules the automatic 24h reminder.
  if (due) {
    const fireAt = new Date(due).getTime() - 24 * 60 * 60 * 1000;
    const delaySeconds = Math.floor((fireAt - Date.now()) / 1000);
    if (delaySeconds > 0) {
      const dueReminderId = await scheduleOnce('/internal/mba/due/fire', delaySeconds, {
        mbaItemId: item.id,
        text: item.text,
        dueAt: due,
        phoneNumber: userId,
        userId,
      });
      await updateMbaItem(userId, item.id, { dueReminderId });
      item.dueReminderId = dueReminderId;
    }
  }

  res.json({ item });
});

router.patch('/mba/:id/done', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const item = await markMbaItemDone(userId, id);
  if (!item) { res.status(404).json({ error: 'MBA item not found' }); return; }
  for (const messageId of [item.qstashMessageId, item.dueReminderId]) {
    if (messageId) await cancelMessage(messageId).catch(() => {});
  }
  res.json({ ok: true });
});

router.delete('/mba/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const item = await getMbaItem(userId, id);
  for (const messageId of [item?.qstashMessageId, item?.dueReminderId]) {
    if (messageId) await cancelMessage(messageId).catch(() => {});
  }
  const ok = await deleteMbaItem(userId, id);
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

// --- Local Tasks ---
router.get('/tasks', async (req: Request, res: Response) => {
  res.json({ items: await getTasks(uid(req)) });
});

router.get('/tasks/done', async (req: Request, res: Response) => {
  res.json({ items: await getDoneTasks(uid(req)) });
});

router.post('/tasks', async (req: Request, res: Response) => {
  const { title, project } = req.body as { title?: string; project?: string };
  if (!title?.trim()) { res.status(400).json({ error: 'title required' }); return; }
  const item = await addTask(uid(req), { title: title.trim(), project });
  res.json({ item });
});

router.patch('/tasks/:id/done', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const task = await markTaskDone(uid(req), id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.qstashMessageId) {
    await cancelMessage(task.qstashMessageId).catch(() => null);
  }
  res.json({ ok: true });
});

router.delete('/tasks/:id', async (req: Request, res: Response) => {
  const ok = await deleteTask(uid(req), Number(req.params.id));
  ok ? res.json({ ok }) : res.status(404).json({ error: 'not found' });
});

function parseSnoozeOption(body: unknown): SnoozeOption | null {
  const option = (body as { option?: string }).option;
  if (option === '1h' || option === '1d' || option === 'monday') return option;
  return null;
}

// Reminders — snooze
router.post('/reminders/:id/snooze', async (req: Request, res: Response) => {
  const userId = uid(req);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const settings = await getSettings(userId);
  const reminders = await getReminders(userId);
  const reminder = reminders.find((r) => r.id === req.params.id);
  if (!reminder) { res.status(404).json({ error: 'Reminder not found' }); return; }

  await cancelMessage(reminder.messageId).catch(() => {});
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    reminderId: reminder.id,
    title: reminder.title,
    phoneNumber: reminder.phoneNumber,
    userId,
  });
  await updateReminder(userId, reminder.id, { fireAt: fireAt.toISOString(), messageId: newMessageId });
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — snooze existing reminder
router.post('/tasks/:id/snooze', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const tasks = await getTasks(userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  if (task.qstashMessageId) await cancelMessage(task.qstashMessageId).catch(() => {});

  const settings = await getSettings(userId);
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: userId,
    userId,
  });
  await updateTaskQStashId(userId, id, newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — add reminder for tasks without one
router.post('/tasks/:id/remind', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const tasks = await getTasks(userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const settings = await getSettings(userId);
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: userId,
    userId,
  });
  await updateTaskQStashId(userId, id, newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// MBA — snooze existing reminder
router.post('/mba/:id/snooze', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getMbaItem(userId, id);
  if (!item) { res.status(404).json({ error: 'MBA item not found' }); return; }

  if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => {});

  const settings = await getSettings(userId);
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/mba/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    mbaItemId: id,
    text: item.text,
    phoneNumber: userId,
    userId,
  });
  await updateMbaItemReminder(userId, id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// Tasks — update reminder to a specific date/time
router.put('/tasks/:id/reminder', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const { fireAt } = req.body as { fireAt?: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Invalid or past date' }); return;
  }
  const tasks = await getTasks(userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.qstashMessageId) await cancelMessage(task.qstashMessageId).catch(() => {});
  const newMessageId = await scheduleOnce('/internal/task/reminder/fire', Math.floor((newFireAt.getTime() - Date.now()) / 1000), {
    taskId: id,
    title: task.title,
    phoneNumber: userId,
    userId,
  });
  await updateTaskQStashId(userId, id, newMessageId);
  res.json({ ok: true, fireAt: newFireAt.toISOString() });
});

// MBA — add reminder for items without one
router.post('/mba/:id/remind', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const option = parseSnoozeOption(req.body);
  if (!option) { res.status(400).json({ error: 'Invalid snooze option' }); return; }

  const item = await getMbaItem(userId, id);
  if (!item) { res.status(404).json({ error: 'MBA item not found' }); return; }

  const settings = await getSettings(userId);
  const fireAt = getSnoozeDate(option, settings.timezone);
  const newMessageId = await scheduleOnce('/internal/mba/reminder/fire', Math.floor((fireAt.getTime() - Date.now()) / 1000), {
    mbaItemId: id,
    text: item.text,
    phoneNumber: userId,
    userId,
  });
  await updateMbaItemReminder(userId, id, fireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: fireAt.toISOString() });
});

// MBA — update reminder to a specific date/time
router.put('/mba/:id/reminder', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = Number(req.params.id);
  const { fireAt } = req.body as { fireAt?: string };
  if (!fireAt) { res.status(400).json({ error: 'Missing fireAt' }); return; }
  const newFireAt = new Date(fireAt);
  if (isNaN(newFireAt.getTime()) || newFireAt.getTime() <= Date.now()) {
    res.status(400).json({ error: 'Invalid or past date' }); return;
  }
  const item = await getMbaItem(userId, id);
  if (!item) { res.status(404).json({ error: 'MBA item not found' }); return; }
  if (item.qstashMessageId) await cancelMessage(item.qstashMessageId).catch(() => {});
  const newMessageId = await scheduleOnce('/internal/mba/reminder/fire', Math.floor((newFireAt.getTime() - Date.now()) / 1000), {
    mbaItemId: id,
    text: item.text,
    phoneNumber: userId,
    userId,
  });
  await updateMbaItemReminder(userId, id, newFireAt.toISOString(), newMessageId);
  res.json({ ok: true, fireAt: newFireAt.toISOString() });
});

export default router;
