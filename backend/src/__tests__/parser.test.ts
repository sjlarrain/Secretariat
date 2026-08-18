import { describe, it, expect } from 'vitest';
import { parseCommand } from '../core/parser/command.parser';

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

  it('handles em-dash for /mba --done', () => {
    const r = ok('/mba —done 2');
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

  it('accepts @day shorthand for --at (all-day marker)', () => {
    const r = ok('/schedule Offsite --for tomorrow @day');
    expect(r.flags['at']).toBe('day');
  });

  it('accepts @day case-insensitively', () => {
    const r = ok('/schedule Offsite --for tomorrow @DAY');
    expect(r.flags['at']).toBe('day');
  });

  it('accepts --duration with a value', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 --duration 2');
    expect(r.flags['duration']).toBe('2');
  });

  it('accepts -d shorthand for --duration', () => {
    const r = ok('/schedule Meeting --for tomorrow --at 09:00 -d 2.5');
    expect(r.flags['duration']).toBe('2.5');
  });

  it('accepts --duration combined with @day', () => {
    const r = ok('/schedule Offsite --for tomorrow @day --duration 3');
    expect(r.flags['at']).toBe('day');
    expect(r.flags['duration']).toBe('3');
  });
});

// ─── /gtask is retired (v1.14) ────────────────────────────────────────────────

describe('/gtask (retired)', () => {
  it('is no longer a known command', () => {
    expect(fail('/gtask Call Isabel')).toMatch(/unknown command/i);
  });
});

// ─── /task (local task manager) ──────────────────────────────────────────────

describe('/task', () => {
  it('succeeds with no arguments — list all open tasks', () => {
    const r = ok('/task');
    expect(r.command).toBe('task');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures title text in extraArgs', () => {
    const r = ok('/task Buy milk');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags).toEqual({});
  });

  it('captures multi-word title in extraArgs', () => {
    const r = ok('/task Call the dentist');
    expect(r.extraArgs).toEqual(['Call', 'the', 'dentist']);
  });

  it('"done <id>" lands in extraArgs for mark-done flow', () => {
    const r = ok('/task done 3');
    expect(r.extraArgs).toEqual(['done', '3']);
    expect(r.flags).toEqual({});
  });

  it('"done" alone lands in extraArgs', () => {
    const r = ok('/task done');
    expect(r.extraArgs).toEqual(['done']);
  });

  it('accepts --project with a name', () => {
    const r = ok('/task Buy milk --project groceries');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['project']).toBe('groceries');
  });

  it('accepts -p shorthand for --project', () => {
    const r = ok('/task Buy milk -p groceries');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['project']).toBe('groceries');
  });

  it('accepts # alias for --project', () => {
    const r = ok('/task Buy milk #groceries');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['project']).toBe('groceries');
  });

  it('accepts # alias with no preceding title (list by project)', () => {
    const r = ok('/task #groceries');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags['project']).toBe('groceries');
  });

  it('accepts -p with no value (list all projects)', () => {
    const r = ok('/task -p');
    expect(r.flags['project']).toBe('');
  });

  it('accepts --project with no value (list all projects)', () => {
    const r = ok('/task --project');
    expect(r.flags['project']).toBe('');
  });

  it('accepts --for date', () => {
    const r = ok('/task Buy milk --for friday');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['for']).toBe('friday');
  });

  it('accepts -f shorthand for --for', () => {
    const r = ok('/task Buy milk -f next monday');
    expect(r.flags['for']).toBe('next monday');
  });

  it('accepts --at time', () => {
    const r = ok('/task Buy milk --for friday --at 15:00');
    expect(r.flags['for']).toBe('friday');
    expect(r.flags['at']).toBe('15:00');
  });

  it('accepts -a shorthand for --at', () => {
    const r = ok('/task Buy milk --for friday -a 15:00');
    expect(r.flags['at']).toBe('15:00');
  });

  it('accepts @ alias for --at', () => {
    const r = ok('/task Buy milk --for friday @15:00');
    expect(r.flags['for']).toBe('friday');
    expect(r.flags['at']).toBe('15:00');
  });

  it('accepts # project combined with --for and @time', () => {
    const r = ok('/task Buy milk #groceries --for friday @10:00');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['project']).toBe('groceries');
    expect(r.flags['for']).toBe('friday');
    expect(r.flags['at']).toBe('10:00');
  });

  it('accepts -p combined with -f and -a', () => {
    const r = ok('/task Submit report -p work -f next monday -a 09:00');
    expect(r.extraArgs).toEqual(['Submit', 'report']);
    expect(r.flags['project']).toBe('work');
    expect(r.flags['for']).toBe('next monday');
    expect(r.flags['at']).toBe('09:00');
  });

  it('accepts -p (list projects) with no title', () => {
    const r = ok('/task -p work');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags['project']).toBe('work');
  });

  it('normalizes em-dash before flags', () => {
    const r = ok('/task Buy milk —for friday');
    expect(r.flags['for']).toBe('friday');
  });

  // v1.14: /gtask was retired and its --notes support folded into /task.
  it('accepts --notes', () => {
    const r = ok('/task Buy milk --notes extra info');
    expect(r.extraArgs).toEqual(['Buy', 'milk']);
    expect(r.flags['notes']).toBe('extra info');
  });

  it('accepts -n shorthand for --notes', () => {
    const r = ok('/task Send report -f tomorrow -n include Q1 numbers');
    expect(r.flags['notes']).toBe('include Q1 numbers');
  });

  it('rejects --invite (not accepted by /task)', () => {
    expect(fail('/task Buy milk --invite a@b.com')).toMatch(/unknown flag/i);
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

  it('accepts --name with a multi-word value', () => {
    const r = ok('/links #2 --name Great article on fintech');
    expect(r.extraArgs[0]).toBe('#2');
    expect(r.flags['name']).toBe('Great article on fintech');
  });

  it('accepts -n shorthand for --name', () => {
    const r = ok('/links #2 -n Great article');
    expect(r.flags['name']).toBe('Great article');
  });

  it('captures link # index alone as a bare lookup', () => {
    const r = ok('/links #2');
    expect(r.extraArgs[0]).toBe('#2');
    expect(r.flags).toEqual({});
  });
});

// ─── /mba (v1 /work → v1.14 /ucla → v2 /mba) ─────────────────────────────────

describe('/mba', () => {
  it('succeeds with no args (list pending)', () => {
    const r = ok('/mba');
    expect(r.command).toBe('mba');
    expect(r.extraArgs).toEqual([]);
    expect(r.flags).toEqual({});
  });

  it('captures item text in extraArgs', () => {
    const r = ok('/mba Finish problem set 3');
    expect(r.extraArgs).toEqual(['Finish', 'problem', 'set', '3']);
  });

  it('accepts --done N', () => {
    const r = ok('/mba --done 2');
    expect(r.flags['done']).toBe('2');
  });

  it('accepts -d shorthand for --done', () => {
    const r = ok('/mba -d 2');
    expect(r.flags['done']).toBe('2');
  });

  it('accepts --due for a due date', () => {
    const r = ok('/mba Submit essay --due next friday');
    expect(r.extraArgs).toEqual(['Submit', 'essay']);
    expect(r.flags['due']).toBe('next friday');
  });

  it('accepts --due alongside an explicit reminder', () => {
    const r = ok('/mba Submit essay --due friday --for thursday --at 18:00');
    expect(r.flags['due']).toBe('friday');
    expect(r.flags['for']).toBe('thursday');
    expect(r.flags['at']).toBe('18:00');
  });

  it('accepts --for and --at for optional reminder', () => {
    const r = ok('/mba Read chapter --for saturday --at 10:00');
    expect(r.extraArgs).toEqual(['Read', 'chapter']);
    expect(r.flags['for']).toBe('saturday');
    expect(r.flags['at']).toBe('10:00');
  });

  it('accepts -f and -a shorthand', () => {
    const r = ok('/mba Do report -f next monday -a 09:00');
    expect(r.flags['for']).toBe('next monday');
    expect(r.flags['at']).toBe('09:00');
  });

  it('accepts @ shorthand for time', () => {
    const r = ok('/mba Review PR -f tomorrow @14:00');
    expect(r.flags['at']).toBe('14:00');
  });

  it('normalizes em-dash for --done', () => {
    const r = ok('/mba —done 3');
    expect(r.flags['done']).toBe('3');
  });

  it('normalizes em-dash for --due', () => {
    const r = ok('/mba Submit essay —due friday');
    expect(r.flags['due']).toBe('friday');
  });

  it('rejects --notes (not accepted by /mba)', () => {
    expect(fail('/mba Buy stuff --notes extra context')).toMatch(/unknown flag/i);
  });
});

// ─── /work and /ucla are retired ──────────────────────────────────────────────

describe('/work and /ucla (retired)', () => {
  it('/work is no longer a known command', () => {
    expect(fail('/work Buy groceries')).toMatch(/unknown command/i);
  });

  it('/ucla is no longer a known command', () => {
    expect(fail('/ucla Finish problem set')).toMatch(/unknown command/i);
  });
});

// ─── /zone ────────────────────────────────────────────────────────────────────

describe('/zone', () => {
  it('succeeds with no args (show current zone)', () => {
    const r = ok('/zone');
    expect(r.command).toBe('zone');
    expect(r.extraArgs).toEqual([]);
  });

  it('captures an IANA zone as a positional arg', () => {
    const r = ok('/zone America/Santiago');
    expect(r.extraArgs).toEqual(['America/Santiago']);
  });

  it('captures a GMT offset as a positional arg', () => {
    const r = ok('/zone GMT-3');
    expect(r.extraArgs).toEqual(['GMT-3']);
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

// ─── /status ──────────────────────────────────────────────────────────────────

describe('/status', () => {
  it('parses /status with no flags', () => {
    const r = ok('/status');
    expect(r.command).toBe('status');
    expect(r.flags).toEqual({});
    expect(r.extraArgs).toEqual([]);
  });
});
