import { afterEach, describe, expect, it } from 'vitest';
import { AuditLedger } from '../../agent/audit/ledger';
import { KeeperHubExecutor } from '../../agent/executor/keeperhub';
import { McpClient } from '../../agent/keeperhub/mcp-client';
import { FakeHandle, startFakeKeeperHub } from './fake-keeperhub';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TX_HASH = `0x${'1'.repeat(64)}`;

let fake: FakeHandle | null = null;

afterEach(async () => {
  await fake?.close();
  fake = null;
});

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lk-integrity-')), 'audit.jsonl');
}

function client(url: string): McpClient {
  return new McpClient({ url, apiKey: 'kh_test', baseDelayMs: 1 });
}

interface VerificationRequest {
  action: string;
  args: unknown[];
  txHash: string;
}

interface VerificationResult {
  verified: boolean;
  blockNumber?: number;
  gasUsed?: string;
  event?: string;
  resultingState?: string;
  error?: string;
}

interface TestVerifier {
  verify(request: VerificationRequest): Promise<VerificationResult>;
}

type ExecutorConstructor = new (
  mcp: McpClient,
  ledger: AuditLedger,
  chainId: number,
  contractAddress: string,
  verifier: TestVerifier
) => KeeperHubExecutor;

function executorWithVerifier(
  mcp: McpClient,
  ledger: AuditLedger,
  verifier: TestVerifier
): KeeperHubExecutor {
  const Constructor = KeeperHubExecutor as unknown as ExecutorConstructor;
  return new Constructor(
    mcp,
    ledger,
    11155111,
    '0x0000000000000000000000000000000000000001',
    verifier
  );
}

const verified: TestVerifier = {
  verify: async () => ({
    verified: true,
    event: 'VerifiedEvent',
    resultingState: 'verified=true',
  }),
};

describe('Executor integrity — acceptance is not success', () => {
  it('retries a transient HTTP 500 and succeeds on the next transport attempt', async () => {
    fake = await startFakeKeeperHub({ transportFailTimes: 1 });
    const mcp = client(fake.url);
    await mcp.connect();

    await expect(mcp.callTool('execute_contract_call', {})).resolves.toContain(
      'exec-fake-1'
    );
    expect(fake.transportRequests()).toBe(2);
  });

  it('retries HTTP 429 rate limits and succeeds on the next transport attempt', async () => {
    fake = await startFakeKeeperHub({
      transportFailTimes: 1,
      transportStatus: 429,
    });
    const mcp = client(fake.url);
    await mcp.connect();

    await expect(mcp.callTool('execute_contract_call', {})).resolves.toContain(
      'exec-fake-1'
    );
    expect(fake.transportRequests()).toBe(2);
  });

  it('rejects malformed inner tool JSON instead of treating it as acceptance', async () => {
    fake = await startFakeKeeperHub({ submissionText: '{not-json' });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(
      mcp,
      new AuditLedger(ledgerPath()),
      verified
    );

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/non-JSON|malformed|parse/i);
  });

  it('fails closed when KeeperHub accepts a request without an execution id', async () => {
    fake = await startFakeKeeperHub({ submissionResult: { status: 'completed' } });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(
      mcp,
      new AuditLedger(ledgerPath()),
      verified
    );

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing.*execution/i);
    expect(result.attempts).toBe(1);
  });

  it('fails closed when settlement reports success without a transaction hash', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: { status: 'completed', result: { success: true } },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(
      mcp,
      new AuditLedger(ledgerPath()),
      verified
    );

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/transaction hash/i);
  });

  it('fails closed when completed settlement has no explicit success signal', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: { status: 'completed', transactionHash: TX_HASH },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(
      mcp,
      new AuditLedger(ledgerPath()),
      verified
    );

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/explicit success/i);
  });

  it('reports the number of attempts actually made after a non-retryable rejection', async () => {
    fake = await startFakeKeeperHub({ submissionResult: { status: 'completed' } });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(
      mcp,
      new AuditLedger(ledgerPath()),
      verified
    );

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 3 }
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fake.idempotencyKeys).toHaveLength(1);
  });

  it('fails when the chain receipt is unsuccessful even if KeeperHub reports success', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: {
        status: 'completed',
        result: { success: true },
        transactionHash: TX_HASH,
      },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(mcp, new AuditLedger(ledgerPath()), {
      verify: async () => ({
        verified: false,
        error: 'chain receipt status is failed',
      }),
    });

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/receipt/i);
  });

  it('fails when the expected event or resulting state cannot be verified', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: {
        status: 'completed',
        result: { success: true },
        transactionHash: TX_HASH,
      },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const executor = executorWithVerifier(mcp, new AuditLedger(ledgerPath()), {
      verify: async () => ({
        verified: false,
        error: 'expected event present but resulting state did not change',
      }),
    });

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/resulting state/i);
  });

  it('records receipt, event, and product state verification before success', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: {
        status: 'completed',
        result: { success: true },
        transactionHash: TX_HASH,
      },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const ledger = new AuditLedger(ledgerPath());
    const requests: VerificationRequest[] = [];
    const executor = executorWithVerifier(mcp, ledger, {
      verify: async (request) => {
        requests.push(request);
        return {
          verified: true,
          blockNumber: 123,
          gasUsed: '456',
          event: 'InheritanceExecuted',
          resultingState: 'inheritanceExecuted=true',
        };
      },
    });

    const result = await executor.executeInheritance(
      { type: 'manual', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    expect(result.success).toBe(true);
    expect(requests).toEqual([
      { action: 'executeInheritance', args: [], txHash: TX_HASH },
    ]);
    expect(ledger.all()[0].verification).toMatchObject({
      receipt: true,
      event: 'InheritanceExecuted',
      resultingState: 'inheritanceExecuted=true',
    });
  });

  it('does not claim a private route when no private route parameter is transmitted', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: {
        status: 'completed',
        result: { success: true },
        transactionHash: TX_HASH,
      },
    });
    const mcp = client(fake.url);
    await mcp.connect();
    const ledger = new AuditLedger(ledgerPath());
    const executor = executorWithVerifier(mcp, ledger, {
      verify: async () => ({
        verified: true,
        event: 'EvacuationTriggered',
        resultingState: 'evacuationExecuted=true',
      }),
    });

    await executor.executeEvacuation(
      { nonce: 1, deadline: 2, signature: '0x' },
      { type: 'panic', source: 'integrity-test' },
      { maxAttempts: 1 }
    );

    const submitted = fake.calls.find(
      (call) => call.name === 'execute_contract_call'
    );
    expect(submitted?.args).not.toHaveProperty('private');
    expect(ledger.all()[0].route?.requested).toBe('default');
  });
});
