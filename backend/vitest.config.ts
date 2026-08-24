import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Source only. `npm run build` emits compiled copies of every suite into
    // dist/, and those re-import vitest through require(), which throws. They
    // also linger after a file is deleted — a run once collected a suite for
    // `v1-proxy`, a module removed from src long ago.
    include: ['src/**/*.test.ts'],

    // Two suites (admin-ops, panel-session-isolation) boot a real Express
    // server and dynamically import a large module graph inside `beforeAll`.
    // Alone that takes ~4s, but every test file is transformed in parallel, and
    // under the full suite those hooks were exceeding vitest's 10s default and
    // failing as timeouts — with no assertion error, so it read as a code bug
    // rather than a scheduling one. The work is genuinely that slow on a cold
    // transform; the default is simply too tight for it.
    hookTimeout: 30_000,
  },
});
