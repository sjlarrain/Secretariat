import { describe, it, expect, beforeEach } from 'vitest';
import { FakeRedis, resetFakeRedis } from './helpers/fake-redis';
import { encryptWithKey, decryptWithKey, deriveAccountKey } from '../shared/utils/encrypt';
import {
  runMigration,
  migrateSettings,
  migrateAccount,
  rewriteQueuedUrl,
  rewriteQueuedBody,
  highestNumericId,
  parseArgs,
  type QueueLike,
  type QueuedMessage,
} from '../scripts/migrate-v1-user';

// The migration is the one piece of code that writes a whole namespace in a
// single pass, against a database the app has never seen. Its failure mode is
// silent — an unseeded `:seq` counter doesn't error, it lets the next create
// overwrite a real item — so these tests drive the real `runMigration` against
// the FakeRedis helper rather than asserting on a re-implementation.

const USER = '+56991296313';
const V1_KEY = 'x'.repeat(32);
const V2_KEY = 'y'.repeat(32);
const V2_BASE = 'https://v2.example.com';
const NOW = Date.parse('2026-08-24T12:00:00Z');

interface FakeQueue {
  client: QueueLike;
  /** `messageId` is the id handed back for that publish, so assertions don't depend on call order. */
  published: { url: string; body: string; delay: number; messageId: string }[];
  cancelled: string[];
}

function makeQueue(seed: Record<string, QueuedMessage> = {}): FakeQueue {
  const messages = new Map(Object.entries(seed));
  const published: { url: string; body: string; delay: number; messageId: string }[] = [];
  const cancelled: string[] = [];
  let counter = 0;

  return {
    published,
    cancelled,
    client: {
      async publish(request) {
        const messageId = `v2-msg-${++counter}`;
        published.push({ url: request.url, body: request.body, delay: request.delay, messageId });
        return { messageId };
      },
      async get(messageId) {
        return messages.get(messageId) ?? null;
      },
      async cancel(messageId) {
        cancelled.push(messageId);
        // Mirrors reality: a cancelled message is no longer retrievable, which
        // is exactly what makes a second run detect "already migrated".
        messages.delete(messageId);
        return {};
      },
    },
  };
}

// ─── Pure transforms ─────────────────────────────────────────────────────────

describe('migrateSettings', () => {
  it('renames uclaReminder to mbaReminder', () => {
    const out = migrateSettings({ uclaReminder: { enabled: true, time: '07:15' } })!;
    expect(out.mbaReminder).toEqual({ enabled: true, time: '07:15' });
    expect(out.uclaReminder).toBeUndefined();
  });

  it('strips every scheduleId — they name crons inside v1s QStash project', () => {
    const out = migrateSettings({
      morningDigest: { enabled: true, time: '08:30', days: [1], scheduleId: 'scd_1' },
      healthCheck: { enabled: true, time: '23:00', scheduleId: 'scd_2' },
    })!;
    expect(out.morningDigest).not.toHaveProperty('scheduleId');
    expect(out.healthCheck).not.toHaveProperty('scheduleId');
    expect(out.morningDigest).toMatchObject({ enabled: true, time: '08:30' });
  });

  it('forces reminderPromoter.enabled true even when v1 stored false', () => {
    // Deferred reminders have no queued message; the promoter is the only thing
    // that ever queues them, so a stored `false` must not survive the move.
    const out = migrateSettings({ reminderPromoter: { enabled: false, time: '08:00' } })!;
    expect(out.reminderPromoter).toEqual({ enabled: true, time: '08:00' });
  });

  it('returns null when v1 had no settings', () => {
    expect(migrateSettings(null)).toBeNull();
  });
});

describe('migrateAccount', () => {
  const tokens = JSON.stringify({ access_token: 'at', refresh_token: 'rt' });

  it('re-encrypts under v2s master key when the keys differ', () => {
    const account = {
      id: 'acc-1',
      encryptedTokens: encryptWithKey(tokens, deriveAccountKey(V1_KEY, 'acc-1')),
    };
    const migrated = migrateAccount(account, V1_KEY, V2_KEY);

    expect(migrated.encryptedTokens).not.toBe(account.encryptedTokens);
    expect(decryptWithKey(migrated.encryptedTokens, deriveAccountKey(V2_KEY, 'acc-1'))).toBe(tokens);
  });

  it('copies the ciphertext verbatim when the keys match', () => {
    const account = {
      id: 'acc-1',
      encryptedTokens: encryptWithKey(tokens, deriveAccountKey(V1_KEY, 'acc-1')),
    };
    expect(migrateAccount(account, V1_KEY, V1_KEY).encryptedTokens).toBe(account.encryptedTokens);
  });
});

describe('rewriteQueuedUrl', () => {
  it('swaps the origin and maps /internal/ucla/ to /internal/mba/', () => {
    expect(rewriteQueuedUrl('https://v1.example.com/internal/ucla/due/fire', V2_BASE)).toBe(
      'https://v2.example.com/internal/mba/due/fire'
    );
  });

  it('leaves unrelated paths alone', () => {
    expect(rewriteQueuedUrl('https://v1.example.com/internal/reminder/fire', V2_BASE)).toBe(
      'https://v2.example.com/internal/reminder/fire'
    );
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(rewriteQueuedUrl('https://v1.example.com/internal/reminder/fire', 'https://v2.example.com/')).toBe(
      'https://v2.example.com/internal/reminder/fire'
    );
  });
});

describe('rewriteQueuedBody', () => {
  it('renames uclaItemId to mbaItemId and stamps the owner', () => {
    const out = rewriteQueuedBody(JSON.stringify({ uclaItemId: 3, text: 'thesis' }), USER);
    expect(out).toEqual({ mbaItemId: 3, text: 'thesis', userId: USER });
  });

  it('also handles the pre-v1.14 workItemId payload', () => {
    const out = rewriteQueuedBody(JSON.stringify({ workItemId: 9, text: 'old' }), USER);
    expect(out.mbaItemId).toBe(9);
    expect(out).not.toHaveProperty('workItemId');
  });

  it('survives an unparseable body', () => {
    expect(rewriteQueuedBody('not json', USER)).toEqual({ userId: USER });
  });
});

describe('highestNumericId', () => {
  it('returns the highest id, not the count — ids are sparse after deletes', () => {
    expect(highestNumericId([{ id: 1 }, { id: 2 }, { id: 40 }])).toBe(40);
  });

  it('returns 0 for an empty collection', () => {
    expect(highestNumericId([])).toBe(0);
  });
});

describe('parseArgs', () => {
  const base = ['--from', 'a.env', '--to', 'b.env'];

  it('rejects a number without the leading +', () => {
    expect(() => parseArgs(['--user', '56991296313', ...base])).toThrow(/E\.164/);
  });

  it('rejects a missing env file argument', () => {
    expect(() => parseArgs(['--user', USER])).toThrow(/Usage/);
  });

  it('accepts a valid invocation and defaults to a dry run', () => {
    const args = parseArgs(['--user', USER, ...base]);
    expect(args.apply).toBe(false);
    expect(args.user).toBe(USER);
  });
});

// ─── End to end ──────────────────────────────────────────────────────────────

describe('runMigration', () => {
  let v1: FakeRedis;
  let v2: FakeRedis;

  // FakeRedis shares one store across instances, which is fine here: v1 keys
  // are `secretariat:*` and v2 keys are `u:<user>:*`, so they cannot collide.
  beforeEach(async () => {
    resetFakeRedis();
    v1 = new FakeRedis();
    v2 = new FakeRedis();

    await v1.set('secretariat:ideas', [
      { id: 1, text: 'first', projectId: 1 },
      { id: 2, text: 'second', projectId: 1 },
      { id: 40, text: 'sparse after deletes', projectId: 1 },
    ]);
    await v1.set('secretariat:ucla', [{ id: 3, text: 'thesis draft', dueReminderId: 'v1-due-1' }]);
    await v1.set('secretariat:reminders', [
      { id: 'r1', title: 'Dentist', phoneNumber: USER, fireAt: '2026-08-24T14:00:00Z', messageId: 'v1-rem-1' },
      { id: 'r2', title: 'Far future', phoneNumber: USER, fireAt: '2026-12-01T09:00:00Z', messageId: '', deferred: true },
    ]);
    await v1.set('secretariat:settings', {
      timezone: 'America/Santiago',
      morningDigest: { enabled: true, time: '08:30', days: [1, 2], scheduleId: 'scd_1' },
      uclaReminder: { enabled: true, time: '09:00', scheduleId: 'scd_2' },
      reminderPromoter: { enabled: false, time: '08:00' },
    });
    await v1.set('secretariat:accounts', [
      { id: 'acc-1', alias: 'personal', encryptedTokens: encryptWithKey('{"access_token":"at"}', deriveAccountKey(V1_KEY, 'acc-1')) },
    ]);
  });

  function seededQueue(): FakeQueue {
    return makeQueue({
      'v1-due-1': {
        url: 'https://v1.example.com/internal/ucla/due/fire',
        body: JSON.stringify({ uclaItemId: 3, text: 'thesis draft', phoneNumber: USER }),
        notBefore: NOW + 3_600_000,
      },
      'v1-rem-1': {
        url: 'https://v1.example.com/internal/reminder/fire',
        body: JSON.stringify({ reminderId: 'r1', title: 'Dentist', phoneNumber: USER }),
        notBefore: NOW + 7_200_000,
      },
    });
  }

  function deps(v1Queue: FakeQueue, v2Queue: FakeQueue, apply: boolean) {
    return {
      v1Redis: v1,
      v2Redis: v2,
      v1Queue: v1Queue.client,
      v2Queue: v2Queue.client,
      userId: USER,
      v1MasterKey: V1_KEY,
      v2MasterKey: V2_KEY,
      v2BaseUrl: V2_BASE,
      apply,
      now: NOW,
    };
  }

  it('writes nothing on a dry run', async () => {
    const result = await runMigration(deps(seededQueue(), makeQueue(), false));

    expect(result.applied).toBe(false);
    expect(await v2.hgetall(`u:${USER}:ideas`)).toBeNull();
    expect(await v2.get(`u:${USER}:ideas:seq`)).toBeNull();
  });

  it('namespaces every collection under the users id', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const ideas = await v2.hgetall<{ text: string }>(`u:${USER}:ideas`);
    expect(Object.keys(ideas!).sort()).toEqual(['1', '2', '40']);
    expect(ideas!['40'].text).toBe('sparse after deletes');
  });

  it('seeds :seq to the highest id, not the item count', async () => {
    // The failure this guards: seq left at 0 means the next /ideas mints id 1
    // and the HSET silently overwrites idea 1. Three items, highest id 40.
    await runMigration(deps(seededQueue(), makeQueue(), true));
    expect(await v2.get(`u:${USER}:ideas:seq`)).toBe(40);
  });

  it('moves secretariat:ucla into the mba collection', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const mba = await v2.hgetall<{ text: string }>(`u:${USER}:mba`);
    expect(mba!['3'].text).toBe('thesis draft');
    expect(await v2.hgetall(`u:${USER}:ucla`)).toBeNull();
  });

  it('replays a queued reminder onto v2 and cancels it on v1', async () => {
    const v1Queue = seededQueue();
    const v2Queue = makeQueue();
    await runMigration(deps(v1Queue, v2Queue, true));

    const reminderPublish = v2Queue.published.find((p) => p.url.endsWith('/internal/reminder/fire'));
    expect(reminderPublish).toBeDefined();
    expect(reminderPublish!.url).toBe('https://v2.example.com/internal/reminder/fire');
    expect(JSON.parse(reminderPublish!.body).userId).toBe(USER);
    expect(reminderPublish!.delay).toBe(7200);

    expect(v1Queue.cancelled).toContain('v1-rem-1');

    const reminders = await v2.hgetall<{ messageId: string }>(`u:${USER}:reminders`);
    expect(reminders!['r1'].messageId).toBe(reminderPublish!.messageId);
  });

  it('rewrites a queued ucla due-reminder onto the mba route', async () => {
    const v1Queue = seededQueue();
    const v2Queue = makeQueue();
    await runMigration(deps(v1Queue, v2Queue, true));

    const duePublish = v2Queue.published.find((p) => p.url.includes('/mba/due/fire'));
    expect(duePublish!.url).toBe('https://v2.example.com/internal/mba/due/fire');

    const body = JSON.parse(duePublish!.body);
    expect(body.mbaItemId).toBe(3);
    expect(body).not.toHaveProperty('uclaItemId');
    expect(body.userId).toBe(USER);

    expect(v1Queue.cancelled).toContain('v1-due-1');
  });

  it('carries deferred reminders across — nothing else can ever queue them', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const reminders = await v2.hgetall<{ deferred?: boolean; messageId: string }>(`u:${USER}:reminders`);
    expect(reminders!['r2'].deferred).toBe(true);
    expect(reminders!['r2'].messageId).toBe('');
  });

  it('migrates settings: renames, strips schedule ids, forces the promoter on', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const settings = await v2.get<Record<string, Record<string, unknown>>>(`u:${USER}:settings`);
    expect(settings!.timezone).toBe('America/Santiago');
    expect(settings!.mbaReminder).toEqual({ enabled: true, time: '09:00' });
    expect(settings).not.toHaveProperty('uclaReminder');
    expect(settings!.morningDigest).not.toHaveProperty('scheduleId');
    expect(settings!.reminderPromoter.enabled).toBe(true);
  });

  it('re-encrypts accounts so v2 can actually read the tokens', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const accounts = await v2.hgetall<{ encryptedTokens: string }>(`u:${USER}:accounts`);
    const plaintext = decryptWithKey(accounts!['acc-1'].encryptedTokens, deriveAccountKey(V2_KEY, 'acc-1'));
    expect(JSON.parse(plaintext).access_token).toBe('at');
  });

  it('is idempotent: a second run neither re-publishes nor reverts message ids', async () => {
    const v1Queue = seededQueue();
    const firstV2Queue = makeQueue();
    await runMigration(deps(v1Queue, firstV2Queue, true));

    const afterFirst = await v2.hgetall<{ dueReminderId: string }>(`u:${USER}:mba`);
    const migratedId = afterFirst!['3'].dueReminderId;
    expect(migratedId).toMatch(/^v2-msg-/);

    // v1 still holds the original message id — this script never writes to v1 —
    // but that message was cancelled, so the second run must not resurrect it.
    const secondV2Queue = makeQueue();
    await runMigration(deps(v1Queue, secondV2Queue, true));

    expect(secondV2Queue.published).toHaveLength(0);
    const afterSecond = await v2.hgetall<{ dueReminderId: string }>(`u:${USER}:mba`);
    expect(afterSecond!['3'].dueReminderId).toBe(migratedId);
    expect(await v2.get(`u:${USER}:ideas:seq`)).toBe(40);
  });

  it('leaves v1 untouched', async () => {
    await runMigration(deps(seededQueue(), makeQueue(), true));

    const ideas = await v1.get<{ id: number }[]>('secretariat:ideas');
    expect(ideas).toHaveLength(3);
    expect(await v1.get('secretariat:ucla')).not.toBeNull();
  });

  it('skips the replay entirely with skipQstash, leaving v1 ids in place', async () => {
    const v1Queue = seededQueue();
    const v2Queue = makeQueue();
    await runMigration({ ...deps(v1Queue, v2Queue, true), skipQstash: true });

    expect(v2Queue.published).toHaveLength(0);
    expect(v1Queue.cancelled).toHaveLength(0);

    const mba = await v2.hgetall<{ dueReminderId: string }>(`u:${USER}:mba`);
    expect(mba!['3'].dueReminderId).toBe('v1-due-1');
  });

  it('drops a queued id whose fire time has already passed', async () => {
    const v1Queue = makeQueue({
      'v1-due-1': {
        url: 'https://v1.example.com/internal/ucla/due/fire',
        body: JSON.stringify({ uclaItemId: 3 }),
        notBefore: NOW - 60_000, // QStash is about to deliver this to v1
      },
    });
    const v2Queue = makeQueue();
    await runMigration(deps(v1Queue, v2Queue, true));

    expect(v2Queue.published).toHaveLength(0);
    const mba = await v2.hgetall<Record<string, unknown>>(`u:${USER}:mba`);
    expect(mba!['3']).not.toHaveProperty('dueReminderId');
  });
});
