import { config } from 'dotenv';
import { basename, resolve } from 'node:path';

export function projectRootForCwd(cwd: string): string {
  return basename(cwd) === 'dashboard' ? resolve(cwd, '..') : cwd;
}

export function loadProjectServerEnvironment(
  projectRoot = projectRootForCwd(process.cwd())
): void {
  config({ path: resolve(projectRoot, '.env'), override: false });
}
