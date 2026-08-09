import { ParsedCommand } from '../parser/command.parser';
import { sendMessage, sendMessageWithId } from '../kapso/client';
import { Ctx } from '../ctx';
import { Link, getLinks, addLink, markLinkRead, updateLink } from '../integrations/local/links';
import { storeReplyTarget } from '../integrations/local/wa-reply-map';
import { setPendingLink } from '../integrations/local/link-pending';

// All "#N" addressing (list, --read, --tags, --name, lookup) refers to this
// same 1-based position in the unread list, so the number shown anywhere is
// always the number you type back.
async function getSortedUnread(userId: string): Promise<Link[]> {
  return (await getLinks(userId)).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

export async function linksHandler(parsed: ParsedCommand, ctx: Ctx): Promise<void> {
  const from = ctx.userId;
  const url     = parsed.extraArgs[0]?.trim() ?? '';
  const readArg = parsed.flags['read'] as string | undefined;
  const tagsArg = parsed.flags['tags'] as string | undefined;
  const nameArg = parsed.flags['name'] as string | undefined;

  try {
    // /links --read N  →  archive link #N
    if (readArg !== undefined) {
      const n = parseInt(readArg, 10);
      if (isNaN(n) || n < 1) {
        await sendMessage(from, '❌ Usage: `/links --read <N>` where N is the link number.');
        return;
      }
      const unread = await getSortedUnread(ctx.userId);
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      await markLinkRead(ctx.userId, target.id);
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
      const unread = await getSortedUnread(ctx.userId);
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      const newTags = tagsArg.split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean);
      const merged = [...new Set([...target.tags, ...newTags])];
      await updateLink(ctx.userId, target.id, { tags: merged });
      await sendMessage(from, `✅ Tags updated on #${n}: ${merged.join(', ')}`);
      return;
    }

    // /links #N --name text  →  name an existing link
    if (url.startsWith('#') && nameArg !== undefined) {
      const n = parseInt(url.slice(1), 10);
      if (isNaN(n) || n < 1 || !nameArg.trim()) {
        await sendMessage(from, '❌ Usage: `/links #N --name <text>`');
        return;
      }
      const unread = await getSortedUnread(ctx.userId);
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      await updateLink(ctx.userId, target.id, { name: nameArg.trim() });
      await sendMessage(from, `✅ Link #${n} named "${nameArg.trim()}".`);
      return;
    }

    // /links #N  →  look up the URL behind a numbered (possibly named) link
    if (url.startsWith('#')) {
      const n = parseInt(url.slice(1), 10);
      if (isNaN(n) || n < 1) {
        await sendMessage(from, '❌ Usage: `/links #N` where N is the link number.');
        return;
      }
      const unread = await getSortedUnread(ctx.userId);
      const target = unread[n - 1];
      if (!target) {
        await sendMessage(from, `❌ No unread link #${n}. Send \`/links\` to see the list.`);
        return;
      }
      const label = target.name ? `*${target.name}*\n` : '';
      await sendMessage(from, `🔗 ${label}${target.url}`);
      return;
    }

    // /links <url> [--tags ...]  →  save link
    if (url) {
      const tags = tagsArg
        ? tagsArg.split(/\s+/).map((t) => t.toLowerCase()).filter(Boolean)
        : [];
      const link = await addLink(ctx.userId, url, tags);
      const unread = await getSortedUnread(ctx.userId);
      const position = unread.findIndex((l) => l.id === link.id) + 1;
      const tagLabel = tags.length ? ` — tags: ${tags.join(', ')}` : '';

      const messageId = await sendMessageWithId(
        from,
        `🔗 Link saved! (#${position})${tagLabel}\nWant to name it? Reply \`--name <text>\` or send \`/links #${position} --name <text>\`.`
      );
      if (messageId) {
        await storeReplyTarget(messageId, {
          type: 'link',
          id: String(link.id),
          title: link.url,
          phoneNumber: from,
          userId: ctx.userId,
        }).catch(() => null);
      }
      await setPendingLink(ctx.userId, link.id, position).catch(() => null);
      return;
    }

    // /links  →  list all unread links
    const unread = await getSortedUnread(ctx.userId);
    if (unread.length === 0) {
      await sendMessage(from, '🔗 No unread links. Send a URL or `/links <url>` to save one.');
      return;
    }
    const lines = unread.map((l, i) => {
      const tagLabel = l.tags.length ? ` [${l.tags.join(', ')}]` : '';
      return `${i + 1}. ${l.name ?? l.url}${tagLabel}`;
    });
    await sendMessage(from, `🔗 *Unread links:*\n\n${lines.join('\n')}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(from, `❌ Error: ${msg}`);
  }
}
