import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Multi-tenancy in v2 is enforced entirely by where a value is written: every
// persisted key must come from `shared/redis/keys.ts`, so one user's data
// cannot land in another's namespace (or back in v1's flat one).
//
// Nothing checked that until now. `keys.test.ts` asserts that `userKey()`
// itself doesn't emit a `secretariat:` key, which says nothing about the ~80
// other files that could bypass the builder entirely. A hand-written
// `redis.get('secretariat:ideas')` or `` redis.hset(`u:${id}:ideas`, ...) ``
// compiles, passes every other test, and reads or writes the wrong place.

const SRC = path.resolve(__dirname, '..');

/**
 * Files allowed to contain raw key strings, each for a stated reason. Anything
 * added here should be a module that is *about* keys, not a module that got
 * inconvenient to fix.
 */
const ALLOWED = new Set([
  // The key builder itself — these literals are the definition.
  path.join('shared', 'redis', 'keys.ts'),
  // Reads v1's flat `secretariat:*` keys by design; that is its whole job.
  path.join('scripts', 'migrate-v1-user.ts'),
]);

/** The v1 single-user prefix. Any occurrence outside the allowlist is a regression. */
const V1_PREFIX = /secretariat:/;

/**
 * A per-user key built by hand instead of through `userKey()` — a string or
 * template literal opening with `u:`. Catches `` `u:${userId}:ideas` `` and
 * `'u:' + id`, which are the shapes a copied-forward v1 file turns into.
 */
const HAND_BUILT_USER_KEY = /['"`]u:/;

/**
 * Blanks out line and block comments, preserving string and template literals.
 * Both patterns above appear legitimately in prose — `keys.ts` explains the v1
 * prefix it replaced, and `users.ts` documents the `u:<userId>:*` layout — and
 * matching those would either fail the build or force a bogus allowlist entry.
 *
 * Not a full tokenizer: a regex literal containing an unescaped `/` could in
 * principle be misread as a comment. None exists here, and the failure mode is
 * a false negative in one file rather than a false positive.
 */
function stripComments(source: string): string {
  type State = 'code' | 'line' | 'block' | "'" | '"' | '`';
  let state: State = 'code';
  let out = '';

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i++; continue; }
      if (c === '/' && next === '*') { state = 'block'; i++; continue; }
      if (c === "'" || c === '"' || c === '`') state = c;
      out += c;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      continue;
    }

    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i++; }
      continue;
    }

    // Inside a string or template literal — keep everything, honour escapes.
    if (c === '\\') { out += c + (next ?? ''); i++; continue; }
    if (c === state) state = 'code';
    out += c;
  }

  return out;
}

function sourceFiles(): string[] {
  return fs
    .readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('.ts'))
    .filter((rel) => !rel.split(path.sep).includes('__tests__'))
    .filter((rel) => !ALLOWED.has(rel));
}

function offendersFor(pattern: RegExp, files: string[]): string[] {
  return files.filter((rel) => pattern.test(stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8'))));
}

describe('no raw Redis keys outside the key builder', () => {
  const files = sourceFiles();

  it('finds source files to scan', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20);
  });

  it('no file reintroduces the v1 `secretariat:` prefix', () => {
    const offenders = offendersFor(V1_PREFIX, files);
    expect(offenders, `use shared/redis/keys.ts instead of a raw v1 key in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no file hand-builds a `u:<userId>:...` key', () => {
    const offenders = offendersFor(HAND_BUILT_USER_KEY, files);
    expect(offenders, `use userKey()/userSeqKey()/pointKey() instead of a literal in: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('stripComments', () => {
  // The scan is only as trustworthy as this helper, and its whole purpose is to
  // tell prose apart from code that looks identical.
  it('drops line and block comments', () => {
    expect(stripComments('// u:${id}:ideas\nconst a = 1;')).not.toMatch(HAND_BUILT_USER_KEY);
    expect(stripComments('/* secretariat:ideas */ const a = 1;')).not.toMatch(V1_PREFIX);
  });

  it('keeps string and template literals intact', () => {
    expect(stripComments('const k = `u:${id}:ideas`;')).toMatch(HAND_BUILT_USER_KEY);
    expect(stripComments("const k = 'secretariat:ideas';")).toMatch(V1_PREFIX);
  });

  it('does not treat a URL inside a string as a comment', () => {
    expect(stripComments("const u = 'https://fake.upstash.io/path';")).toContain('upstash.io/path');
  });
});
