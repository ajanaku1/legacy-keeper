import { describe, expect, it } from 'vitest';
import { ActionError } from '../lib/action-error';
import { runAuditedAction } from '../lib/action-audit';

const REQUEST = {
  owner: '0x1111111111111111111111111111111111111111',
  nonce: '42',
  signature: '0xsecret-signature',
};

describe('action audit ledger', () => {
  it('preserves a failed attempt and its later successful recovery as one story', async () => {
    const recorder = recordingRepository();
    await expect(
      runAuditedAction(
        'heartbeatBySig',
        REQUEST,
        async () => {
          throw new ActionError(
            'KEEPERHUB_UNSETTLED',
            'Settlement timed out.',
            { executionId: 'kh_failed' }
          );
        },
        { repository: recorder }
      )
    ).rejects.toMatchObject({ code: 'KEEPERHUB_UNSETTLED' });

    await runAuditedAction(
      'heartbeatBySig',
      REQUEST,
      async () => ({
        executionId: 'kh_123',
        txHash: `0x${'a'.repeat(64)}`,
      }),
      { repository: recorder }
    );

    expect(recorder.entries).toMatchObject([
      {
        executionKey: `heartbeatBySig:${REQUEST.owner}:42`,
        owner: REQUEST.owner,
        outcome: 'failed',
        errorCode: 'KEEPERHUB_UNSETTLED',
        keeperhubExecutionId: 'kh_failed',
      },
      {
        executionKey: `heartbeatBySig:${REQUEST.owner}:42`,
        owner: REQUEST.owner,
        outcome: 'success',
        keeperhubExecutionId: 'kh_123',
      },
    ]);
  });

  it('never writes signatures or arbitrary request fields to the ledger', async () => {
    const recorder = recordingRepository();
    await runAuditedAction(
      'createPlan',
      { ...REQUEST, apiKey: 'browser-secret', config: { sensitive: true } },
      async () => ({ executionId: 'kh_plan', txHash: `0x${'b'.repeat(64)}` }),
      { repository: recorder }
    );

    const stored = JSON.stringify(recorder.entries);
    expect(stored).not.toContain('0xsecret-signature');
    expect(stored).not.toContain('browser-secret');
    expect(stored).not.toContain('sensitive');
  });

  it('uses durable repository storage instead of the serverless filesystem', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../lib/action-audit.ts', import.meta.url), 'utf8')
    );

    expect(source).not.toContain("from 'node:fs/promises'");
    expect(source).not.toContain('audit.jsonl');
  });
});

function recordingRepository() {
  const entries: unknown[] = [];
  return {
    entries,
    append: async (entry: unknown) => {
      entries.push(entry);
    },
    listByOwner: async () => ({
      entries: [],
      page: 1,
      pageSize: 5,
      total: 0,
      totalPages: 1,
    }),
  };
}
