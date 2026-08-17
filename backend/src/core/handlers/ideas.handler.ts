import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../../shared/kapso/client';
import { Ctx } from '../../shared/ctx';
import {
  getIdeas,
  addIdea,
  getProjects,
  getDefaultProject,
  findOrCreateProject,
} from '../integrations/local/ideas';

export async function ideasHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const text = parsed.extraArgs.join(' ').trim();
  // undefined = --project not used; '' = --project with no value; 'X' = --project X
  const projectFlag = parsed.flags['project'] as string | undefined;

  try {
    // /ideas --project  →  list all projects
    if (projectFlag === '') {
      const projects = await getProjects(ctx.userId);
      const ideas = await getIdeas(ctx.userId);
      const lines = projects.map((p) => {
        const count = ideas.filter((i) => i.projectId === p.id).length;
        const tag = p.isDefault ? ' _(default)_' : '';
        return `📁 ${p.name}${tag} — ${count} idea${count !== 1 ? 's' : ''}`;
      });
      await sendMessage(from, `📁 *Your projects:*\n\n${lines.join('\n')}`);
      return;
    }

    // /ideas --project Work  →  list ideas in that project
    if (projectFlag !== undefined && text === '') {
      const projects = await getProjects(ctx.userId);
      const project = projects.find((p) => p.name.toLowerCase() === projectFlag.toLowerCase());
      if (!project) {
        await sendMessage(from, `❌ Project "${projectFlag}" not found. Send \`/ideas --project\` to see your projects.`);
        return;
      }
      const ideas = (await getIdeas(ctx.userId)).filter((i) => i.projectId === project.id);
      if (ideas.length === 0) {
        await sendMessage(from, `💡 No ideas in *${project.name}* yet.`);
        return;
      }
      const lines = ideas.map((i) => `${i.id}. ${i.text}`).join('\n');
      await sendMessage(from, `💡 *${project.name}:*\n${lines}`);
      return;
    }

    // /ideas <text> [--project Name]  →  save idea
    if (text) {
      const project = projectFlag
        ? await findOrCreateProject(ctx.userId, projectFlag)
        : await getDefaultProject(ctx.userId);
      const idea = await addIdea(ctx.userId, text, project.id);
      const projectLabel = project.isDefault ? '' : ` in *${project.name}*`;
      await sendMessage(from, `✅ Idea saved! (#${idea.id})${projectLabel}`);
      return;
    }

    // /ideas  →  list all ideas across all projects
    const ideas = await getIdeas(ctx.userId);
    if (ideas.length === 0) {
      await sendMessage(from, '💡 No ideas saved yet. Send `/ideas your idea` to add one.');
      return;
    }
    const projects = await getProjects(ctx.userId);
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
    const lines = ideas
      .map((i) => `${i.id}. ${i.text} _(${projectMap[i.projectId] ?? 'Ideas'})_`)
      .join('\n');
    await sendMessage(from, `💡 *All ideas:*\n\n${lines}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
