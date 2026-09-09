import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ForkFs } from '../core';

/** Run `fn`, returning `fallback` if it throws (missing path, permission, not a repo). */
function orElse<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Real-filesystem {@link ForkFs} rooted at one workspace folder.
 *
 * This is the whole "adapter substitutes a real FS" half of issue #23 — every
 * rule lives in the pure core; here we only answer its questions with `node:fs`
 * and one `git ls-files` call. All operations are synchronous: they run at
 * activation over a handful of paths, and detection must produce a result before
 * the panel can render.
 */
export function createForkFs(rootPath: string): ForkFs {
  const abs = (relPath: string): string => path.join(rootPath, relPath);

  return {
    dirExists: (relPath) => orElse(() => fs.statSync(abs(relPath)).isDirectory(), false),
    readFile: (relPath) => orElse<string | undefined>(() => fs.readFileSync(abs(relPath), 'utf8'), undefined),
    listDir: (relPath) => orElse<string[]>(() => fs.readdirSync(abs(relPath)), []),
    mtimeMs: (relPath) => orElse<number | undefined>(() => fs.statSync(abs(relPath)).mtimeMs, undefined),

    // `git -C <root> ls-files -- <relPath>` prints paths relative to <root> (its
    // cwd), which is exactly what `mtimeMs` expects — so this stays correct even
    // when the fork root sits inside a larger repo. `undefined` (git missing or
    // not a repo) means staleness is unprovable.
    gitLsFiles: (relPath) =>
      orElse<string[] | undefined>(() => {
        const stdout = execFileSync('git', ['-C', rootPath, 'ls-files', '-z', '--', relPath], {
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
          // Runs on the extension-host thread; never let a wedged git freeze it.
          timeout: 10_000,
        });
        return stdout.split('\0').filter((entry) => entry.length > 0);
      }, undefined),
  };
}
