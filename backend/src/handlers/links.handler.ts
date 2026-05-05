import { ParsedCommand } from '../parser/command.parser';
import { sendMessage } from '../kapso/client';
import { getLinks, addLink, markLinkRead, updateLink } from '../integrations/local/links';

export async function linksHandler(parsed: ParsedCommand, from: string): Promise<void> {
  const url     = parsed.extraArgs[0]?.trim() ?? '';
  const readArg = parsed.flags['read'] as string | undefined;
  const tagsArg = parsed.flags['tags'] as string | undefined;

  try {
    // /links --read N  →  archive link #N
    if (readArg !== undefined) {
      const n = parseInt(readArg, 10);
      if (isNaN(n) || n < 1) {
        await sendMessage(from, '❌ Usage: `/links --read <N>` where N is the link number.');
        return;
      }
      const unread = (await getLinks()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      await markLinkRead(target.id);
      await sendMessage(from, `✅ Link #${n} marked as read.`);
      return;
    }

    // /links #N -t tag1 tag2  →  add tags to existing link
    if (url.startsWith('#') && tagsArg !== undefined) {
      const n = parseInt(url.slice(1), 10);
      if (isNaN(n) || n < 1) {
        await sendMessage(from, '❌ Usage: `/links #N -t tag1 tag2`');
        return;
      }
      const unread = (await getLinks()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      const newTags = tagsArg.split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean);
      const merged = [...new Set([...target.tags, ...newTags])];
      await updateLink(target.id, { tags: merged });
      await sendMessage(from, `✅ Tags updated on #${n}: ${merged.join(', ')}`);
      return;
    }

    // /links <url> [--tags ...]  →  save link
    if (url) {
      const tags = tagsArg
        ? tagsArg.split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean)
        : [];
      const link = await addLink(url, tags);
      const tagLabel = tags.length ? ` — tags: ${tags.join(', ')}` : '';
      await sendMessage(from, `🔗 Link saved! (#${link.id})${tagLabel}`);
      return;
    }

    // /links  →  list all unread links
    const unread = (await getLinks()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    if (unread.length === 0) {
      await sendMessage(from, '🔗 No unread links. Send a URL or `/links <url>` to save one.');
      return;
    }
    const lines = unread.map((l, i) => {
      const tagLabel = l.tags.length ? ` [${l.tags.join(', ')}]` : '';
      return `${i + 1}. ${l.url}${tagLabel}`;
    });
    await sendMessage(from, `🔗 *Unread links:*\n\n${lines.join('\n')}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
