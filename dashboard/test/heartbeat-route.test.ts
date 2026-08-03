import { describe, expect, it, vi } from 'vitest';
import {
  executeSignedHeartbeat,
  parseHeartbeatRequest,
  type HeartbeatDependencies,
} from '../lib/heartbeat-route';
import { prepareHeartbeatMessage } from '../lib/heartbeat-client';
import {
  parseKeeperHubExecution,
  parseWebhookExecutionId,
} from '../lib/keeperhub-server';

const OWNER = '0x1111111111111111111111111111111111111111';
const TX_HASH = `0x${'a'.repeat(64)}` as const;

function dependencies(
  overrides: Partial<HeartbeatDependencies> = {}
): HeartbeatDependencies {
  return {
    nowSeconds: () => 1_000,
    readOwner: vi.fn().mockResolvedValue(OWNER),
    readLastHeartbeat: vi.fn().mockResolvedValue(100n),
    recoverSigner: vi.fn().mockResolvedValue(OWNER),
    submitToKeeperHub: vi.fn().mockResolvedValue({ executionId: 'kh_123' }),
    awaitSettlement: vi.fn().mockResolvedValue({
      status: 'success',
      txHash: TX_HASH,
      sponsored: true,
    }),
    verifyOnchain: vi.fn().mockResolvedValue({
      receiptStatus: 'success',
      event: 'HeartbeatRecorded',
      lastHeartbeat: 101n,
    }),
    ...overrides,
  };
}

describe('heartbeat route boundary', () => {
  it('accepts only nonce, deadline, and signature', () => {
    expect(
      parseHeartbeatRequest({ nonce: '12', deadline: '1300', signature: '0xsig' })
    ).toEqual({ nonce: '12', deadline: '1300', signature: '0xsig' });

    expect(() =>
      parseHeartbeatRequest({
        nonce: '12',
        deadline: '1300',
        signature: '0xsig',
        apiKey: 'must-not-cross-the-browser-boundary',
      })
    ).toThrow(/unexpected field/i);
  });

  it('submits the exact signed request and returns independently verified evidence', async () => {
    const deps = dependencies();
    const request = { nonce: '12', deadline: '1300', signature: '0xsig' };

    const result = await executeSignedHeartbeat(request, deps);

    expect(deps.submitToKeeperHub).toHaveBeenCalledWith(request);
    expect(result).toEqual({
      stage: 'verified',
      executionId: 'kh_123',
      txHash: TX_HASH,
      sponsored: true,
      receiptStatus: 'success',
      event: 'HeartbeatRecorded',
      lastHeartbeat: '101',
      routeConfidence: 'unavailable',
    });
  });

  it('rejects a non-owner signature before KeeperHub submission', async () => {
    const deps = dependencies({
      recoverSigner: vi
        .fn()
        .mockResolvedValue('0x2222222222222222222222222222222222222222'),
    });

    await expect(
      executeSignedHeartbeat(
        { nonce: '12', deadline: '1300', signature: '0xsig' },
        deps
      )
    ).rejects.toThrow(/owner/i);
    expect(deps.submitToKeeperHub).not.toHaveBeenCalled();
  });

  it('rejects expired or long-lived requests', async () => {
    const deps = dependencies();

    await expect(
      executeSignedHeartbeat(
        { nonce: '12', deadline: '999', signature: '0xsig' },
        deps
      )
    ).rejects.toThrow(/deadline/i);
    await expect(
      executeSignedHeartbeat(
        { nonce: '12', deadline: '1601', signature: '0xsig' },
        deps
      )
    ).rejects.toThrow(/deadline/i);
  });

  it('fails closed when settlement or resulting state evidence is missing', async () => {
    const missingHash = dependencies({
      awaitSettlement: vi.fn().mockResolvedValue({ status: 'success' }),
    });
    await expect(
      executeSignedHeartbeat(
        { nonce: '12', deadline: '1300', signature: '0xsig' },
        missingHash
      )
    ).rejects.toThrow(/transaction hash/i);

    const staleState = dependencies({
      verifyOnchain: vi.fn().mockResolvedValue({
        receiptStatus: 'success',
        event: 'HeartbeatRecorded',
        lastHeartbeat: 100n,
      }),
    });
    await expect(
      executeSignedHeartbeat(
        { nonce: '12', deadline: '1300', signature: '0xsig' },
        staleState
      )
    ).rejects.toThrow(/did not advance/i);
  });
});

describe('heartbeat client message', () => {
  it('derives a uint256 nonce from 32 random bytes and uses a short deadline', () => {
    const random = new Uint8Array(32);
    random[31] = 42;

    expect(prepareHeartbeatMessage(random, 1_000)).toEqual({
      nonce: 42n,
      deadline: 1_300n,
    });
  });

  it('rejects nonce sources that are not exactly 32 bytes', () => {
    expect(() => prepareHeartbeatMessage(new Uint8Array(16), 1_000)).toThrow(
      /32 random bytes/i
    );
  });
});

describe('KeeperHub server response parsing', () => {
  it('extracts the webhook execution ID without trusting HTTP status alone', () => {
    expect(parseWebhookExecutionId({ executionId: 'kh_webhook_1' })).toBe(
      'kh_webhook_1'
    );
    expect(() => parseWebhookExecutionId({ accepted: true })).toThrow(
      /execution ID/i
    );
  });

  it('extracts terminal settlement evidence from get_execution', () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: {
            status: 'success',
            transactionHashes: [{ hash: TX_HASH }],
            sponsored: true,
          },
        },
      })
    ).toEqual({ status: 'success', txHash: TX_HASH, sponsored: true });
  });

  it('reads sponsorship from the live KeeperHub execution output shape', () => {
    expect(
      parseKeeperHubExecution({
        logs: {
          execution: {
            status: 'success',
            transactionHashes: [{ hash: TX_HASH }],
            output: { sponsored: true },
          },
        },
      })
    ).toEqual({ status: 'success', txHash: TX_HASH, sponsored: true });
  });
});
