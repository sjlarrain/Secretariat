import { describe, it, expect } from 'vitest';
import {
  userKey,
  userSeqKey,
  systemKey,
  pointKey,
  legacyWorkKey,
  type UserCollection,
} from '../redis/keys';

// Every user-owned collection. Kept as an explicit list rather than derived
// from the type so that adding a collection to `UserCollection` without
// considering its key shape fails here.
const COLLECTIONS: UserCollection[] = [
  'accounts',
  'settings',
  'ideas',
  'projects',
  'links',
  'links-pending',
  'plans',
  'reminders',
  'tasks',
  'ucla',
  'third-party-contacts',
  'third-party-pending',
  'mantis-pending',
];

const ALICE = '56911111111';
const BOB = '56922222222';

describe('userKey', () => {
  it('namespaces by user id', () => {
    expect(userKey(ALICE, 'ideas')).toBe(`u:${ALICE}:ideas`);
  });

  it('gives different users different keys for the same collection', () => {
    for (const collection of COLLECTIONS) {
      expect(userKey(ALICE, collection)).not.toBe(userKey(BOB, collection));
    }
  });

  it('gives every collection a distinct key for the same user', () => {
    const keys = COLLECTIONS.map((c) => userKey(ALICE, c));
    expect(new Set(keys).size).toBe(COLLECTIONS.length);
  });

  it('never emits a v1 single-user key', () => {
    for (const collection of COLLECTIONS) {
      expect(userKey(ALICE, collection)).not.toMatch(/^secretariat:/);
    }
  });
});

describe('userSeqKey', () => {
  // The id-minting collections built this by hand as `userKey(...) + ':seq'`
  // before it was routed through the helper. Locking the relationship keeps a
  // future change to the seq format from silently orphaning existing counters —
  // an orphaned counter restarts at 0 and mints ids that overwrite live items.
  it('is the collection key suffixed with :seq', () => {
    for (const collection of COLLECTIONS) {
      expect(userSeqKey(ALICE, collection)).toBe(`${userKey(ALICE, collection)}:seq`);
    }
  });

  it('never collides with another collection key', () => {
    const collectionKeys = new Set(COLLECTIONS.map((c) => userKey(ALICE, c)));
    for (const collection of COLLECTIONS) {
      expect(collectionKeys.has(userSeqKey(ALICE, collection))).toBe(false);
    }
  });
});

describe('systemKey / pointKey', () => {
  it('places shared state outside any user namespace', () => {
    expect(systemKey('health-alerts')).toBe('sys:health-alerts');
    expect(systemKey('health-alerts')).not.toMatch(/^u:/);
  });

  it('namespaces point keys by flow', () => {
    expect(pointKey('dedup', 'wamid.ABC')).toBe('sys:dedup:wamid.ABC');
    expect(pointKey('oauth-state', 'abc')).not.toBe(pointKey('wa-reply', 'abc'));
  });
});

describe('legacyWorkKey', () => {
  // The one intentional survivor of the v1 layout. It is read-only, single-
  // owner, and must never gain a per-user variant.
  it('is the pre-v2 single-user key', () => {
    expect(legacyWorkKey()).toBe('secretariat:work');
  });
});
