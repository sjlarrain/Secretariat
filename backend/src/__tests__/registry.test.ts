import { describe, it, expect } from 'vitest';
import { FLAGS } from '../registries/flags.registry';
import { COMMANDS } from '../registries/commands.registry';

// ─── Flag registry integrity ──────────────────────────────────────────────────

describe('FLAGS registry', () => {
  const flagKeys = Object.keys(FLAGS);

  it('has at least one flag defined', () => {
    expect(flagKeys.length).toBeGreaterThan(0);
  });

  it('every flag has a name starting with --', () => {
    for (const [key, def] of Object.entries(FLAGS)) {
      expect(def.name, `FLAGS.${key}.name`).toMatch(/^--/);
    }
  });

  it('every flag has a shortAlias (single lowercase letter)', () => {
    for (const [key, def] of Object.entries(FLAGS)) {
      expect(def.shortAlias, `FLAGS.${key} missing shortAlias`).toBeDefined();
      expect(def.shortAlias!.length, `FLAGS.${key}.shortAlias must be 1 char`).toBe(1);
      expect(def.shortAlias!, `FLAGS.${key}.shortAlias must be lowercase letter`).toMatch(/^[a-z]$/);
    }
  });

  it('every flag has a non-empty description', () => {
    for (const [key, def] of Object.entries(FLAGS)) {
      expect(def.description.length, `FLAGS.${key}.description is empty`).toBeGreaterThan(0);
    }
  });

  it('every flag has a valid type', () => {
    const validTypes = ['string', 'date', 'time', 'email-list', 'account-alias'];
    for (const [key, def] of Object.entries(FLAGS)) {
      expect(validTypes, `FLAGS.${key}.type "${def.type}" is invalid`).toContain(def.type);
    }
  });
});

// ─── Command registry integrity ───────────────────────────────────────────────

describe('COMMANDS registry', () => {
  const commandKeys = Object.keys(COMMANDS);

  it('has at least one command defined', () => {
    expect(commandKeys.length).toBeGreaterThan(0);
  });

  it('every command has a name starting with /', () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      expect(def.name, `COMMANDS.${key}.name`).toMatch(/^\//);
    }
  });

  it('every command name matches its key (e.g. /work → "work")', () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      expect(def.name, `COMMANDS.${key}.name`).toBe(`/${key}`);
    }
  });

  it('all acceptedFlags reference valid FLAG keys', () => {
    const flagKeys = Object.keys(FLAGS);
    for (const [cmd, def] of Object.entries(COMMANDS)) {
      for (const flag of def.acceptedFlags) {
        expect(flagKeys, `COMMANDS.${cmd} references unknown flag "${flag}"`).toContain(flag);
      }
    }
  });

  it('all requiredFlags are a subset of acceptedFlags', () => {
    for (const [cmd, def] of Object.entries(COMMANDS)) {
      for (const flag of def.requiredFlags) {
        expect(def.acceptedFlags, `COMMANDS.${cmd} required flag "${flag}" is not in acceptedFlags`).toContain(flag);
      }
    }
  });

  it('every command has a non-empty description', () => {
    for (const [key, def] of Object.entries(COMMANDS)) {
      expect(def.description.length, `COMMANDS.${key}.description is empty`).toBeGreaterThan(0);
    }
  });
});

// ─── Cross-registry: expected commands exist ──────────────────────────────────

describe('expected commands are registered', () => {
  const requiredCommands = ['start', 'menu', 'schedule', 'task', 'gtask', 'mytask', 'reminder', 'myschedule', 'ideas', 'links', 'work'];

  for (const cmd of requiredCommands) {
    it(`/${cmd} is in COMMANDS`, () => {
      expect(COMMANDS[cmd]).toBeDefined();
    });
  }
});

// ─── Cross-registry: expected flags exist ────────────────────────────────────

describe('expected flags are registered', () => {
  const requiredFlags = ['title', 'for', 'at', 'invite', 'using', 'notes', 'project', 'plan', 'read', 'tags', 'done'];

  for (const flag of requiredFlags) {
    it(`--${flag} is in FLAGS`, () => {
      expect(FLAGS[flag]).toBeDefined();
    });
  }
});

// ─── Short alias coverage per command ─────────────────────────────────────────

describe('short alias resolution (per-command scope)', () => {
  it('/schedule: -f resolves to "for", -a resolves to "at"', () => {
    const accepted = COMMANDS['schedule'].acceptedFlags;
    const forFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'f');
    const atFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'a');
    expect(forFlag).toBe('for');
    expect(atFlag).toBe('at');
  });

  it('/myschedule: -p resolves to "plan"', () => {
    const accepted = COMMANDS['myschedule'].acceptedFlags;
    const planFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'p');
    expect(planFlag).toBe('plan');
  });

  it('/ideas: -p resolves to "project"', () => {
    const accepted = COMMANDS['ideas'].acceptedFlags;
    const projectFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'p');
    expect(projectFlag).toBe('project');
  });

  it('/links: -r resolves to "read", -t resolves to "tags"', () => {
    const accepted = COMMANDS['links'].acceptedFlags;
    const readFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'r');
    const tagsFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 't');
    expect(readFlag).toBe('read');
    expect(tagsFlag).toBe('tags');
  });

  it('/work: -d resolves to "done"', () => {
    const accepted = COMMANDS['work'].acceptedFlags;
    const doneFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'd');
    expect(doneFlag).toBe('done');
  });

  it('/task: -p resolves to "project"', () => {
    const accepted = COMMANDS['task'].acceptedFlags;
    const projectFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'p');
    expect(projectFlag).toBe('project');
  });

  it('/task: -f resolves to "for"', () => {
    const accepted = COMMANDS['task'].acceptedFlags;
    const forFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'f');
    expect(forFlag).toBe('for');
  });

  it('/task: -a resolves to "at"', () => {
    const accepted = COMMANDS['task'].acceptedFlags;
    const atFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'a');
    expect(atFlag).toBe('at');
  });

  it('/reminder: -f → "for", -a → "at"', () => {
    const accepted = COMMANDS['reminder'].acceptedFlags;
    const forFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'f');
    const atFlag = accepted.find((k) => FLAGS[k]?.shortAlias === 'a');
    expect(forFlag).toBe('for');
    expect(atFlag).toBe('at');
  });
});

// ─── Required flags per command ───────────────────────────────────────────────

describe('required flags contract', () => {
  it('/schedule requires "for" and "at"', () => {
    expect(COMMANDS['schedule'].requiredFlags).toContain('for');
    expect(COMMANDS['schedule'].requiredFlags).toContain('at');
  });

  it('/reminder requires "for" and "at"', () => {
    expect(COMMANDS['reminder'].requiredFlags).toContain('for');
    expect(COMMANDS['reminder'].requiredFlags).toContain('at');
  });

  it('/work has no required flags', () => {
    expect(COMMANDS['work'].requiredFlags).toHaveLength(0);
  });

  it('/myschedule has no required flags', () => {
    expect(COMMANDS['myschedule'].requiredFlags).toHaveLength(0);
  });

  it('/task has no required flags', () => {
    expect(COMMANDS['task'].requiredFlags).toHaveLength(0);
  });

  it('/gtask has no required flags', () => {
    expect(COMMANDS['gtask'].requiredFlags).toHaveLength(0);
  });

  it('/ideas has no required flags', () => {
    expect(COMMANDS['ideas'].requiredFlags).toHaveLength(0);
  });

  it('/links has no required flags', () => {
    expect(COMMANDS['links'].requiredFlags).toHaveLength(0);
  });
});
