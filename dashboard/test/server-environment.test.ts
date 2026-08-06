import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadProjectServerEnvironment,
  projectRootForCwd,
} from '../lib/server-environment';

const TEST_KEY = 'LEGACY_KEEPER_TEST_SERVER_KEY';

afterEach(() => {
  delete process.env[TEST_KEY];
});

describe('server environment loading', () => {
  it('resolves the repository root from the dashboard working directory', () => {
    const dashboard = join('/tmp', 'legacy-keeper', 'dashboard');

    expect(basename(projectRootForCwd(dashboard))).toBe('legacy-keeper');
    expect(projectRootForCwd('/tmp/legacy-keeper')).toBe('/tmp/legacy-keeper');
  });

  it('loads root server variables inside the API runtime', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'legacy-keeper-env-'));
    await writeFile(join(projectRoot, '.env'), `${TEST_KEY}=available\n`);

    loadProjectServerEnvironment(projectRoot);

    expect(process.env[TEST_KEY]).toBe('available');
  });
});
