import { Redis } from '@upstash/redis';
import { env } from '../../env';
import { userKey, userSeqKey } from '../../redis/keys';
import { HashCollection, byId } from '../../redis/hash-collection';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Project {
  id: number;
  name: string;
  createdAt: string;
  isDefault: boolean;
}

export interface Idea {
  id: number;
  text: string;
  createdAt: string;
  projectId: number;
  updatedAt?: string;
  deletedAt?: string;
  usedAt?: string; // marked as "done/used" — distinct from trash
}

function projects(userId: string): HashCollection<Project> {
  return new HashCollection<Project>(redis, userKey(userId, 'projects'), userSeqKey(userId, 'projects'));
}

function ideas(userId: string): HashCollection<Idea> {
  return new HashCollection<Idea>(redis, userKey(userId, 'ideas'), userSeqKey(userId, 'ideas'));
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function getAllIdeasRaw(userId: string): Promise<Idea[]> {
  const raw = await ideas(userId).getAll(byId);
  return raw.map((i) => ({ ...i, projectId: i.projectId ?? 1 }));
}

// ── Projects ──────────────────────────────────────────────────────────────────

async function ensureDefaultProject(userId: string, existing: Project[]): Promise<Project[]> {
  if (existing.length > 0) return existing;
  const defaultProject: Project = {
    id: 1,
    name: 'Ideas',
    createdAt: new Date().toISOString(),
    isDefault: true,
  };
  await projects(userId).set(defaultProject);
  return [defaultProject];
}

export async function getProjects(userId: string): Promise<Project[]> {
  const raw = await projects(userId).getAll(byId);
  return ensureDefaultProject(userId, raw);
}

export async function getDefaultProject(userId: string): Promise<Project> {
  const all = await getProjects(userId);
  return all.find((p) => p.isDefault)!;
}

export async function findOrCreateProject(userId: string, name: string): Promise<Project> {
  const all = await getProjects(userId);
  const normalized = name.trim().toLowerCase();
  const existing = all.find((p) => p.name.toLowerCase() === normalized);
  if (existing) return existing;
  const id = await projects(userId).nextId();
  const project: Project = { id, name: name.trim(), createdAt: new Date().toISOString(), isDefault: false };
  await projects(userId).set(project);
  return project;
}

export async function updateProject(userId: string, id: number, name: string): Promise<boolean> {
  const project = await projects(userId).get(id);
  if (!project) return false;
  project.name = name.trim();
  await projects(userId).set(project);
  return true;
}

export async function deleteProject(userId: string, id: number): Promise<{ ok: boolean; error?: string }> {
  const all = await getProjects(userId);
  const project = all.find((p) => p.id === id);
  if (!project) return { ok: false, error: 'Project not found' };
  if (project.isDefault) return { ok: false, error: 'Cannot delete the default project' };

  const defaultProject = all.find((p) => p.isDefault)!;
  // Reassign all ideas (including trashed) from this project to the default project.
  const allIdeas = await getAllIdeasRaw(userId);
  const toReassign = allIdeas.filter((i) => i.projectId === id);
  await Promise.all(toReassign.map((i) => ideas(userId).set({ ...i, projectId: defaultProject.id })));
  await projects(userId).remove(id);
  return { ok: true };
}

// ── Ideas — active ────────────────────────────────────────────────────────────

export async function getIdeas(userId: string): Promise<Idea[]> {
  const all = await getAllIdeasRaw(userId);
  return all.filter((i) => !i.deletedAt && !i.usedAt);
}

export async function getDoneIdeas(userId: string): Promise<Idea[]> {
  const all = await getAllIdeasRaw(userId);
  return all.filter((i) => !!i.usedAt && !i.deletedAt);
}

export async function markIdeaAsDone(userId: string, id: number): Promise<boolean> {
  const idea = await ideas(userId).get(id);
  if (!idea || idea.deletedAt || idea.usedAt) return false;
  idea.usedAt = new Date().toISOString();
  await ideas(userId).set(idea);
  return true;
}

export async function addIdea(userId: string, text: string, projectId: number): Promise<Idea> {
  const id = await ideas(userId).nextId();
  const idea: Idea = { id, text: text.trim(), createdAt: new Date().toISOString(), projectId };
  await ideas(userId).set(idea);
  return idea;
}

export async function updateIdea(userId: string, id: number, data: { text?: string; projectId?: number }): Promise<boolean> {
  const idea = await ideas(userId).get(id);
  if (!idea || idea.deletedAt) return false;
  if (data.text !== undefined) idea.text = data.text.trim();
  if (data.projectId !== undefined) idea.projectId = data.projectId;
  idea.updatedAt = new Date().toISOString();
  await ideas(userId).set(idea);
  return true;
}

/** Soft delete — moves idea to trash */
export async function deleteIdea(userId: string, id: number): Promise<boolean> {
  const idea = await ideas(userId).get(id);
  if (!idea || idea.deletedAt) return false;
  idea.deletedAt = new Date().toISOString();
  await ideas(userId).set(idea);
  return true;
}

// ── Ideas — trash ─────────────────────────────────────────────────────────────

/** Returns trashed ideas, auto-purging any older than 30 days */
export async function getTrashedIdeas(userId: string): Promise<Idea[]> {
  const all = await getAllIdeasRaw(userId);
  const now = Date.now();
  const trashed = all.filter((i) => !!i.deletedAt);
  const expired = trashed.filter((i) => now - new Date(i.deletedAt!).getTime() > TRASH_TTL_MS);

  if (expired.length > 0) {
    await Promise.all(expired.map((i) => ideas(userId).remove(i.id)));
    const expiredIds = new Set(expired.map((i) => i.id));
    return trashed.filter((i) => !expiredIds.has(i.id));
  }

  return trashed;
}

export async function restoreIdea(userId: string, id: number): Promise<boolean> {
  const idea = await ideas(userId).get(id);
  if (!idea || !idea.deletedAt) return false;
  delete idea.deletedAt;
  await ideas(userId).set(idea);
  return true;
}

export async function permanentlyDeleteIdea(userId: string, id: number): Promise<boolean> {
  return ideas(userId).remove(id);
}

export async function emptyTrash(userId: string): Promise<void> {
  const all = await getAllIdeasRaw(userId);
  const trashed = all.filter((i) => !!i.deletedAt);
  await Promise.all(trashed.map((i) => ideas(userId).remove(i.id)));
}
