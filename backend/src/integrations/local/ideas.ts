import { Redis } from '@upstash/redis';
import { env } from '../../env';

const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const PROJECTS_KEY = 'secretariat:projects';
const IDEAS_KEY = 'secretariat:ideas';

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
}

async function ensureDefaultProject(projects: Project[]): Promise<Project[]> {
  if (projects.length > 0) return projects;
  const defaultProject: Project = {
    id: 1,
    name: 'Ideas',
    createdAt: new Date().toISOString(),
    isDefault: true,
  };
  await redis.set(PROJECTS_KEY, [defaultProject]);
  return [defaultProject];
}

export async function getProjects(): Promise<Project[]> {
  const raw = (await redis.get<Project[]>(PROJECTS_KEY)) ?? [];
  return ensureDefaultProject(raw);
}

export async function getDefaultProject(): Promise<Project> {
  const projects = await getProjects();
  return projects.find((p) => p.isDefault)!;
}

export async function findOrCreateProject(name: string): Promise<Project> {
  const projects = await getProjects();
  const normalized = name.trim().toLowerCase();
  const existing = projects.find((p) => p.name.toLowerCase() === normalized);
  if (existing) return existing;
  const id = Math.max(...projects.map((p) => p.id)) + 1;
  const project: Project = { id, name: name.trim(), createdAt: new Date().toISOString(), isDefault: false };
  await redis.set(PROJECTS_KEY, [...projects, project]);
  return project;
}

export async function updateProject(id: number, name: string): Promise<boolean> {
  const projects = await getProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  projects[idx].name = name.trim();
  await redis.set(PROJECTS_KEY, projects);
  return true;
}

export async function deleteProject(id: number): Promise<{ ok: boolean; error?: string }> {
  const projects = await getProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return { ok: false, error: 'Project not found' };
  if (project.isDefault) return { ok: false, error: 'Cannot delete the default project' };

  const defaultProject = projects.find((p) => p.isDefault)!;
  const ideas = await getIdeas();
  const reassigned = ideas.map((i) => (i.projectId === id ? { ...i, projectId: defaultProject.id } : i));
  await redis.set(IDEAS_KEY, reassigned);
  await redis.set(PROJECTS_KEY, projects.filter((p) => p.id !== id));
  return { ok: true };
}

export async function getIdeas(): Promise<Idea[]> {
  const raw = (await redis.get<Idea[]>(IDEAS_KEY)) ?? [];
  // Migration: assign any legacy idea (no projectId) to the default project (id=1)
  return raw.map((i) => ({ ...i, projectId: i.projectId ?? 1 }));
}

export async function addIdea(text: string, projectId: number): Promise<Idea> {
  const ideas = await getIdeas();
  const id = ideas.length ? Math.max(...ideas.map((i) => i.id)) + 1 : 1;
  const idea: Idea = { id, text: text.trim(), createdAt: new Date().toISOString(), projectId };
  await redis.set(IDEAS_KEY, [...ideas, idea]);
  return idea;
}

export async function updateIdea(id: number, data: { text?: string; projectId?: number }): Promise<boolean> {
  const ideas = await getIdeas();
  const idx = ideas.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  if (data.text !== undefined) ideas[idx].text = data.text.trim();
  if (data.projectId !== undefined) ideas[idx].projectId = data.projectId;
  ideas[idx].updatedAt = new Date().toISOString();
  await redis.set(IDEAS_KEY, ideas);
  return true;
}

export async function deleteIdea(id: number): Promise<boolean> {
  const ideas = await getIdeas();
  const filtered = ideas.filter((i) => i.id !== id);
  if (filtered.length === ideas.length) return false;
  await redis.set(IDEAS_KEY, filtered);
  return true;
}
