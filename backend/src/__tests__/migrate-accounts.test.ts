import { describe, it, expect } from 'vitest';
import { classifyAccounts } from '../scripts/migrate-v1-user';

// Connected accounts are keyed by a UUID minted at connect time and carry no
// email, so the same Google account linked in v2 *and* migrated from v1 shows
// up as two rows with the same alias and different ids. The panel renders no
// ids, so the pair cannot be told apart in the UI — which is how a real
// migration ended up with four rows for two accounts.

const V1_PERSONAL = 'ab9ab133-43e1-4126-8857-6f13ee1ac4bf';
const V1_GG = '03ca3126-95aa-4765-947b-38864c170c71';
const V2_PERSONAL = '736192e2-c118-45b1-8a37-53a4afec8b59';

const v1Accounts = [
  { id: V1_PERSONAL, alias: 'Personal', encryptedTokens: 'x' },
  { id: V1_GG, alias: 'GG', encryptedTokens: 'y' },
];

const v2Accounts = {
  [V2_PERSONAL]: { id: V2_PERSONAL, alias: 'Personal', type: 'calendar', isDefault: false },
  [V1_PERSONAL]: {
    id: V1_PERSONAL,
    alias: 'Personal',
    type: 'calendar',
    isDefault: true,
    enabledCalendarIds: ['primary', 'work@group.calendar.google.com'],
  },
  [V1_GG]: { id: V1_GG, alias: 'GG', type: 'calendar', isDefault: false },
};

describe('classifyAccounts', () => {
  const rows = classifyAccounts(v1Accounts, v2Accounts);

  it('returns one row per account in v2', () => {
    expect(rows).toHaveLength(3);
  });

  it('marks an id v1 also has as migrated', () => {
    expect(rows.find((r) => r.id === V1_PERSONAL)?.fromV1).toBe(true);
    expect(rows.find((r) => r.id === V1_GG)?.fromV1).toBe(true);
  });

  it('marks an id v1 does not have as linked in v2', () => {
    // The redundant copy — same alias, different id, no calendar selection.
    expect(rows.find((r) => r.id === V2_PERSONAL)?.fromV1).toBe(false);
  });

  it('distinguishes a duplicated alias by origin, not by name', () => {
    const personals = rows.filter((r) => r.alias === 'Personal');
    expect(personals).toHaveLength(2);
    expect(personals.map((r) => r.fromV1).sort()).toEqual([false, true]);
  });

  it('counts the sub-calendar selection that identifies the migrated row', () => {
    expect(rows.find((r) => r.id === V1_PERSONAL)?.calendars).toBe(2);
    expect(rows.find((r) => r.id === V2_PERSONAL)?.calendars).toBe(0);
  });

  it('carries the default flag through', () => {
    expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([V1_PERSONAL]);
  });

  it('treats every account as v2-only when v1 has none', () => {
    expect(classifyAccounts([], v2Accounts).every((r) => !r.fromV1)).toBe(true);
  });

  it('returns nothing when v2 has no accounts', () => {
    expect(classifyAccounts(v1Accounts, {})).toEqual([]);
  });
});
