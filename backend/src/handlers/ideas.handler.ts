import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { getIdeas, addIdea } from '../integrations/local/ideas';

export async function ideasHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const text = parsed.extraArgs.join(' ').trim();
  try {
    if (!text) {
      const ideas = await getIdeas();
      if (ideas.length === 0) {
        await sendMessage(from, '💡 No ideas saved yet. Send `/ideas your idea` to add one.');
        return;
      }
      const lines = ideas.map((i) => `${i.id}. ${i.text}`).join('\n');
      await sendMessage(from, `💡 *Your ideas:*\n${lines}`);
    } else {
      const idea = await addIdea(text);
      await sendMessage(from, `✅ Idea saved! (#${idea.id})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
