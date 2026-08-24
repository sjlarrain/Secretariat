import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { COMMANDS } from '../core/registries/commands.registry';

// Adding a command takes three edits: the registry, the handler, and a `case`
// in the webhook switch. Miss the third and the command still *parses* — the
// registry accepts it, flag validation runs, and then it falls off the end of
// the switch into the unknown-command reply. No error, no failing test, and the
// symptom ("/foo says it doesn't exist") looks like a parser bug.
//
// webhook.ts is read as text rather than imported: importing it pulls in the
// handlers, which pull in `shared/env`, which calls `process.exit(1)` without
// live credentials. Reading the file needs none of that.

const WEBHOOK = path.resolve(__dirname, '..', 'platform', 'routes', 'webhook.ts');

describe('webhook switch covers the command registry', () => {
  const source = fs.readFileSync(WEBHOOK, 'utf8');

  it('reads the webhook route', () => {
    // Guards the guard: a moved file would otherwise make this suite vacuous.
    expect(source).toContain('switch');
  });

  for (const key of Object.keys(COMMANDS)) {
    it(`/${key} has a case in the switch`, () => {
      const hasCase = new RegExp(`case\\s+'${key}'\\s*:`).test(source);
      expect(hasCase, `COMMANDS.${key} has no \`case '${key}':\` — it would fall through to "unknown command"`).toBe(true);
    });
  }
});
