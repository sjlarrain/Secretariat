import { describe, it, expect } from 'vitest';
import { parseCommand } from '../parser/command.parser';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(input: string) {
  const r = parseCommand(input);
  if (!r.success) throw new Error(`Expected success for "${input}", got: ${r.error}`);
  return r.data!;
}

function fail(input: string) {
  const r = parseCommand(input);
  if (r.success) throw new Error(`Expected failure for "${input}" but it succeeded`);
  return r.error!;
}

// ─── Em-dash / en-dash normalization ─────────────────────────────────────────

describe('em-dash normalization', () => {
  it('normalizes em-dash (—) to -- before any flag', () => {
    const r = ok('/myschedule —plan Lunch');
    expect(r.flags['plan']).toBe('Lunch');
  });

  it('normalizes en-dash (–) to -- before any flag', () => {
    const r = ok('/myschedule –plan Lunch');
    expect(r.flags['plan']).toBe('Lunch');
  });

  it('handles em-dash for /work --done', () => {
    const r = ok('/work —done 2');
    expect(r.flags['done']).toBe('2');
  });

  it('handles em-dash for /reminder flags', () => {
    const r = ok('/reminder Call doctor —for tomorrow —at 09:00');
    expect(r.flags['for']).toBe('tomorrow');
    expect(r.flags['at']).toBe('09:00');
  });
});

// ─── Not-a-command ────────────────────────────────────────────────────────────

describe('non-command input', () => {
  it('rejects plain text', () => {
    expect(fail('hello world')).toMatch(/not a command/i);
  });

  it('rejects a bare URL', () => {
    expect(fail('https://example.com')).toMatch(/not a command/i);
  });
});

// ─── Unknown command ──────────────────────────────────────────────────────────

describe('unknown command', () => {
  it('returns an error listing available commands', () => {
    const err = fail('/unknown');
    expect(err).toMatch(/unknown command/i);
    expect(err).toMatch(/\/start/);
  });
});

// ─── /start & /menu ───────────────────────────────────────────────────────────

describe('/start and /menu', () => {
  it('/start succeeds with no flags', () => {
    const r = ok('/start');
    expect(r.command).toBe('start');
    expect(r.flags).toEqual({});
    expect(r.extraArgs).toEqual([]);
  });

  it('/menu succeeds with no flags', () => {
    const r = ok('/menu');
    expect(r.command).toBe('menu');
  });

  it('/start rejects an unknown flag', () => {
    expect(fail('/start --for tomorrow')).toMatch(/unknown flag/i);
  });
});

// ─── /schedule ────────────────────────────────────────────────────────────────

describe('/schedule', () => {
  it('fails when --for and --at are both missing', () => {
    expect(fail('/schedule Breakfast')).toMatch(/missing required flags/i);
  });

  it('fails when only --for is present', () => {
    expect(fail('/schedule Breakfast --for tomorrow')).toMatch(/missing required flags/i);
  });

  it('fails when only --at is present', () => {
    expect(fail('/schedule Breakfast --at 09:00')).toMatch(/missing required flags/i);
  });

  it('succeeds with required flags', () => {
    const r = ok('/schedule Breakfast --for tomorrow --at 09:00');
    expect(r.command).toBe('schedule');
    expect(r.flags['for']).toBe('tomorrow');
    expect(r.flags['at']).toBe('09:00');
    expect(r.extraArgs).toEqual(['Breakfast']);
  });

  it('accepts @HH:MM shorthand for --at', () => {
    const r = ok('/schedule Breakfast --for tomorrow @09:00');
    expect(r.flags['at']).toBe('09:00');
  });

  it('accepts short flags -f and -a', () => {
    const r = ok('/schedule Dinner -f next friday -a 20:00');
    expect(r.flags['for']).toBe('next friday');
    expect(r.flags['at']).toBe('20:00');
  });

  it('accepts --title flag', () => {
    const r = ok('/schedule --title Board review --for 22-05-2026 --at 18:00');
    expect(r.flags['title']).toBe('Board review');
  });

  it('accepts short flag -t for title', () => {
    const r = ok('/schedule -t Board review --for tomorrow --at 10:00');
    expect(r.flags['title']).toBe('Board review');
  });

  it('accepts --invite with comma list', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 --invite ana@co.com,luis@co.com');
    expect(r.flags['invite']).toBe('ana@co.com,luis@co.com');
  });

  it('accepts -i shorthand for --invite', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 -i ana@co.com');
    expect(r.flags['invite']).toBe('ana@co.com');
  });

  it('accepts --notes multi-word', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 --notes bring the report');
    expect(r.flags['notes']).toBe('bring the report');
  });

  it('accepts -n for --notes', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 -n bring the report');
    expect(r.flags['notes']).toBe('bring the report');
  });

  it('accepts --using alias', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 --using GG');
    expect(r.flags['using']).toBe('GG');
  });

  it('accepts -u for --using', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 -u GG');
    expect(r.flags['using']).toBe('GG');
  });

  it('rejects --plan (not accepted by /schedule)', () => {
    expect(fail('/schedule Meeting --for tomorrow --at 09:00 --plan Lunch')).toMatch(/unknown flag/i);
  });
});

// ─── /task ────────────────────────────────────────────────────────────────────

describe('/task', () => {
  it('succeeds with just text', () => {
    const r = ok('/task Call Isabel');
    expect(r.command).toBe('task');
    expect(r.extraArgs).toEqual(['Call', 'Isabel']);
    expect(r.flags).toEqual({});
  });

  it('accepts --for date', () => {
    const r = ok('/task Send report --for next friday');
    expect(r.flags['for']).toBe('next friday');
  });

  it('accepts -f for --for', () => {
    const r = ok('/task Do thing -f 15-06-2026');
    expect(r.flags['for']).toBe('15-06-2026');
  });

  it('accepts --notes', () => {
    const r = ok('/task Report -f tomorrow -n include Q1 numbers');
    expect(r.flags['notes']).toBe('include Q1 numbers');
  });

  it('succeeds with no arguments (bare /task)', () => {
    const r = ok('/task');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });
});

// ─── /mytask ─────────────────────────────────────────────────────────────────

describe('/mytask', () => {
  it('succeeds with no arguments', () => {
    const r = ok('/mytask');
    expect(r.command).toBe('mytask');
    expect(r.extraArgs).toEqual([]);
  });

  it('rejects any flag', () => {
    expect(fail('/mytask --for tomorrow')).toMatch(/unknown flag/i);
  });
});

// ─── /reminder ───────────────────────────────────────────────────────────────

describe('/reminder', () => {
  it('fails without --for and --at', () => {
    expect(fail('/reminder Call doctor')).toMatch(/missing required flags/i);
  });

  it('fails with only --for', () => {
    expect(fail('/reminder Call doctor --for tomorrow')).toMatch(/missing required flags/i);
  });

  it('succeeds with --for and --at', () => {
    const r = ok('/reminder Call doctor --for tomorrow --at 09:00');
    expect(r.flags['for']).toBe('tomorrow');
    expect(r.flags['at']).toBe('09:00');
    expect(r.extraArgs).toEqual(['Call', 'doctor']);
  });

  it('accepts @HH:MM shorthand', () => {
    const r = ok('/reminder Submit invoice --for next monday @17:00');
    expect(r.flags['at']).toBe('17:00');
  });

  it('accepts short flags -f and -a', () => {
    const r = ok('/reminder Dentist -f 20-06-2026 -a 10:30');
    expect(r.flags['for']).toBe('20-06-2026');
    expect(r.flags['at']).toBe('10:30');
  });
});

// ─── /myschedule ─────────────────────────────────────────────────────────────

describe('/myschedule', () => {
  it('succeeds with no arguments (today)', () => {
    const r = ok('/myschedule');
    expect(r.command).toBe('myschedule');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures "week" as extraArgs', () => {
    const r = ok('/myschedule week');
    expect(r.extraArgs[0]).toBe('week');
  });

  it('accepts --for date', () => {
    const r = ok('/myschedule --for next monday');
    expect(r.flags['for']).toBe('next monday');
  });

  it('accepts -f shorthand for --for', () => {
    const r = ok('/myschedule -f tomorrow');
    expect(r.flags['for']).toBe('tomorrow');
  });

  it('accepts --plan with a value', () => {
    const r = ok('/myschedule --plan Lunch');
    expect(r.flags['plan']).toBe('Lunch');
  });

  it('accepts -p shorthand for --plan', () => {
    const r = ok('/myschedule -p Lunch');
    expect(r.flags['plan']).toBe('Lunch');
  });

  it('accepts --plan with no value (optional, lists plans)', () => {
    const r = ok('/myschedule --plan');
    expect(r.flags['plan']).toBe('');
  });

  it('accepts --plan combined with --for', () => {
    const r = ok('/myschedule --plan Lunch --for next monday');
    expect(r.flags['plan']).toBe('Lunch');
    expect(r.flags['for']).toBe('next monday');
  });

  it('normalizes em-dash before --plan', () => {
    const r = ok('/myschedule —plan Lunch');
    expect(r.flags['plan']).toBe('Lunch');
  });

  it('rejects --at (not accepted by /myschedule)', () => {
    expect(fail('/myschedule --at 09:00')).toMatch(/unknown flag/i);
  });
});

// ─── /ideas ──────────────────────────────────────────────────────────────────

describe('/ideas', () => {
  it('succeeds with no args (list all)', () => {
    const r = ok('/ideas');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures idea text in extraArgs', () => {
    const r = ok('/ideas Build a kanban board');
    expect(r.extraArgs).toEqual(['Build', 'a', 'kanban', 'board']);
  });

  it('accepts --project with a name', () => {
    const r = ok('/ideas Some idea --project SideProject');
    expect(r.flags['project']).toBe('SideProject');
  });

  it('accepts -p shorthand for --project', () => {
    const r = ok('/ideas Some idea -p SideProject');
    expect(r.flags['project']).toBe('SideProject');
  });

  it('accepts --project with no value (list all projects)', () => {
    const r = ok('/ideas --project');
    expect(r.flags['project']).toBe('');
  });

  it('accepts -p with no value', () => {
    const r = ok('/ideas -p');
    expect(r.flags['project']).toBe('');
  });
});

// ─── /links ──────────────────────────────────────────────────────────────────

describe('/links', () => {
  it('succeeds with no args (list unread)', () => {
    const r = ok('/links');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures a URL in extraArgs', () => {
    const r = ok('/links https://example.com');
    expect(r.extraArgs[0]).toBe('https://example.com');
  });

  it('accepts --tags with multiple values', () => {
    const r = ok('/links https://example.com --tags fintech tech-news');
    expect(r.flags['tags']).toBe('fintech tech-news');
  });

  it('accepts -t shorthand for --tags', () => {
    const r = ok('/links https://example.com -t fintech tech-news');
    expect(r.flags['tags']).toBe('fintech tech-news');
  });

  it('accepts --read N', () => {
    const r = ok('/links --read 3');
    expect(r.flags['read']).toBe('3');
  });

  it('accepts -r shorthand for --read', () => {
    const r = ok('/links -r 3');
    expect(r.flags['read']).toBe('3');
  });

  it('captures link # index and tags together', () => {
    const r = ok('/links #2 --tags fintech');
    expect(r.extraArgs[0]).toBe('#2');
    expect(r.flags['tags']).toBe('fintech');
  });
});

// ─── /work ────────────────────────────────────────────────────────────────────

describe('/work', () => {
  it('succeeds with no args (list pending)', () => {
    const r = ok('/work');
    expect(r.command).toBe('work');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures item text in extraArgs', () => {
    const r = ok('/work Buy groceries for the week');
    expect(r.extraArgs).toEqual(['Buy', 'groceries', 'for', 'the', 'week']);
  });

  it('accepts --done N', () => {
    const r = ok('/work --done 2');
    expect(r.flags['done']).toBe('2');
  });

  it('accepts -d shorthand for --done', () => {
    const r = ok('/work -d 2');
    expect(r.flags['done']).toBe('2');
  });

  it('accepts --for and --at for optional reminder', () => {
    const r = ok('/work Buy groceries --for saturday --at 10:00');
    expect(r.extraArgs).toEqual(['Buy', 'groceries']);
    expect(r.flags['for']).toBe('saturday');
    expect(r.flags['at']).toBe('10:00');
  });

  it('accepts -f and -a shorthand', () => {
    const r = ok('/work Do report -f next monday -a 09:00');
    expect(r.flags['for']).toBe('next monday');
    expect(r.flags['at']).toBe('09:00');
  });

  it('accepts @ shorthand for time', () => {
    const r = ok('/work Review PR -f tomorrow @14:00');
    expect(r.flags['at']).toBe('14:00');
  });

  it('normalizes em-dash for --done', () => {
    const r = ok('/work —done 3');
    expect(r.flags['done']).toBe('3');
  });

  it('rejects --notes (not accepted by /work)', () => {
    expect(fail('/work Buy stuff --notes extra context')).toMatch(/unknown flag/i);
  });
});

// ─── Quoted values ────────────────────────────────────────────────────────────

describe('quoted values', () => {
  it('groups quoted title as single extraArg', () => {
    const r = ok('/schedule "Board review Q2" --for tomorrow --at 10:00');
    expect(r.extraArgs).toEqual(['Board review Q2']);
  });

  it('groups quoted notes as single flag value', () => {
    const r = ok('/task Report --notes "include the Q1 numbers please"');
    expect(r.flags['notes']).toBe('include the Q1 numbers please');
  });
});

// ─── Raw preservation ─────────────────────────────────────────────────────────

describe('raw field', () => {
  it('stores the normalized (em-dash replaced) input as raw', () => {
    const r = ok('/myschedule —plan Lunch');
    expect(r.raw).toBe('/myschedule --plan Lunch');
  });
});
