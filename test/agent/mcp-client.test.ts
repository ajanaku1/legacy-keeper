/**
 * Agent reliability tests.
 *
 * Each case here corresponds to something that actually went wrong, or could:
 * the handshake's header-borne session id, SSE framing, -32003 expiry,
 * 402 challenges, per-attempt idempotency, and the settlement/receipt
 * disagreement that once made the agent report failure for a transaction that
 * had already landed.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { McpClient, McpError } from '../../agent/keeperhub/mcp-client';
import { KeeperHubExecutor } from '../../agent/executor/keeperhub';
import { AuditLedger } from '../../agent/audit/ledger';
import { startFakeKeeperHub, FakeHandle } from './fake-keeperhub';
import { chooseRoute, confirmRoute, assertRoutesExclusive } from '../../agent/keeperhub/route-policy';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fake: FakeHandle | null = null;
afterEach(async () => { await fake?.close(); fake = null; });

const ledgerPath = () => join(mkdtempSync(join(tmpdir(), 'lk-')), 'audit.jsonl');
const client = (url: string, extra = {}) =>
  new McpClient({ url, apiKey: 'kh_test', baseDelayMs: 1, ...extra });

describe('MCP client — handshake', () => {
  it('reads the session id from the response header, not the body', async () => {
    fake = await startFakeKeeperHub();
    const c = client(fake.url);
    const server = await c.connect();
    expect(server.name).toBe('fake-keeperhub');
    expect(c.connected).toBe(true);
  });

  it('fails loudly when the session header is missing', async () => {
    fake = await startFakeKeeperHub({ omitSessionHeader: true });
    await expect(client(fake.url).connect()).rejects.toThrow(/Mcp-Session-Id/);
  });

  it('parses SSE-framed replies as well as plain JSON', async () => {
    fake = await startFakeKeeperHub({ sse: true });
    const c = client(fake.url);
    await c.connect();
    expect(await c.listTools()).toContain('execute_contract_call');
  });

  it('re-handshakes and recovers when the session expires mid-call', async () => {
    fake = await startFakeKeeperHub({ expireSessionTimes: 1 });
    const c = client(fake.url);
    await c.connect();
    // -32003 is retryable: the client must re-initialise rather than surface it.
    await expect(c.callTool('execute_contract_call', {})).resolves.toBeTruthy();
  });

  it('gives up after maxAttempts on persistent transport failure', async () => {
    fake = await startFakeKeeperHub({ transportFailTimes: 99 });
    const c = client(fake.url, { maxAttempts: 2 });
    await c.connect();
    await expect(c.callTool('execute_contract_call', {})).rejects.toThrow();
  });

  it('surfaces a 402 challenge instead of treating it as success', async () => {
    fake = await startFakeKeeperHub({ paymentRequired: true });
    const c = client(fake.url);
    await c.connect();
    await expect(c.callTool('call_workflow', {})).rejects.toThrow(/402|Payment/i);
  });

  it('rejects a malformed body rather than inventing a result', async () => {
    fake = await startFakeKeeperHub({ malformed: true });
    const c = client(fake.url);
    await c.connect();
    await expect(c.callTool('execute_contract_call', {})).rejects.toBeInstanceOf(McpError);
  });
});

describe('Executor — settlement semantics', () => {
  it('treats status "completed" with success:true as a real success', async () => {
    fake = await startFakeKeeperHub({
      executionStatus: { status: 'completed', result: { success: true, reverted: false }, transactionHash: '0xabc', gasUsedWei: '146484' },
    });
    const c = client(fake.url); await c.connect();
    const ledger = new AuditLedger(ledgerPath());
    const ex = new KeeperHubExecutor(c, ledger, 11155111, '0xcontract');

    const r = await ex.executeInheritance({ type: 'manual', source: 'test' }, { maxAttempts: 1 });
    expect(r.success).toBe(true);
    expect(r.txHash).toBe('0xabc');
    expect(r.gasUsed).toBe('146484');
  });

  it('treats "completed" with reverted:true as a FAILURE', async () => {
    // The dangerous case: settled is not the same as succeeded. Reading only
    // `status` here would report a reverted estate distribution as done.
    fake = await startFakeKeeperHub({
      executionStatus: { status: 'completed', result: { success: false, reverted: true, revertReason: 'LK: not yet due' }, transactionHash: '0xdead' },
    });
    const c = client(fake.url); await c.connect();
    const ledger = new AuditLedger(ledgerPath());
    const ex = new KeeperHubExecutor(c, ledger, 11155111, '0xcontract');

    const r = await ex.executeInheritance({ type: 'scheduled', source: 'test' }, { maxAttempts: 1 });
    expect(r.success).toBe(false);
  });

  it('uses a DISTINCT idempotency key per attempt so retries can recover', async () => {
    // Reusing one key made KeeperHub replay the first failure forever
    // (friction-log #07). Attempts must be individually keyed.
    fake = await startFakeKeeperHub({
      executionStatus: { status: 'completed', result: { success: false, reverted: true } },
    });
    const c = client(fake.url); await c.connect();
    const ledger = new AuditLedger(ledgerPath());
    const ex = new KeeperHubExecutor(c, ledger, 11155111, '0xcontract');

    await ex.executeInheritance(
      { type: 'scheduled', source: 'test' },
      { maxAttempts: 3, retryBaseDelayMs: 1 }
    );

    const keys = fake.idempotencyKeys;
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('records every attempt so a recovery is visible in the ledger', async () => {
    fake = await startFakeKeeperHub({ expireSessionTimes: 0 });
    const c = client(fake.url); await c.connect();
    const path = ledgerPath();
    const ledger = new AuditLedger(path);
    const ex = new KeeperHubExecutor(c, ledger, 11155111, '0xcontract');

    await ex.executeInheritance({ type: 'scheduled', source: 'test' }, { maxAttempts: 1 });
    const entries = ledger.all();
    expect(entries.length).toBe(1);
    expect(entries[0].trigger.type).toBe('scheduled');
    expect(entries[0].action).toBe('executeInheritance');
  });
});

describe('Audit ledger — C3 evidence', () => {
  it('identifies a failure followed by a success as recovered', () => {
    const ledger = new AuditLedger(ledgerPath());
    const base = { timestamp: new Date().toISOString(), trigger: { type: 'scheduled' as const, source: 't' }, action: 'executeInheritance', params: {} };
    ledger.append({ ...base, executionKey: 'k1', attempt: 1, outcome: 'failed' });
    ledger.append({ ...base, executionKey: 'k1', attempt: 2, outcome: 'success', gasUsed: '100' });
    ledger.append({ ...base, executionKey: 'k2', attempt: 1, outcome: 'success' });

    expect(ledger.recoveredAfterFailure()).toEqual(['k1']);
    expect(ledger.summary().recovered).toBe(1);
  });

  it('does not count a run that only ever failed', () => {
    const ledger = new AuditLedger(ledgerPath());
    const base = { timestamp: new Date().toISOString(), trigger: { type: 'scheduled' as const, source: 't' }, action: 'evacuate', params: {} };
    ledger.append({ ...base, executionKey: 'k3', attempt: 1, outcome: 'failed' });
    ledger.append({ ...base, executionKey: 'k3', attempt: 2, outcome: 'failed' });
    expect(ledger.recoveredAfterFailure()).toEqual([]);
  });
});

describe('Route policy — sponsorship and privacy are distinct', () => {
  it('routes liveness and distribution through sponsorship', () => {
    expect(chooseRoute('heartbeatBySig').route).toBe('sponsored');
    expect(chooseRoute('executeInheritance').route).toBe('sponsored');
  });

  it('routes evacuation privately', () => {
    // An evacuation transaction announces "these funds are moving". It must
    // not be broadcast publicly just because sponsorship is cheaper.
    expect(chooseRoute('evacuate').route).toBe('private');
    expect(chooseRoute('panicButton').route).toBe('private');
  });

  it('refuses to describe one execution as both sponsored and private', () => {
    expect(() => assertRoutesExclusive({ sponsored: true, privateRoute: true })).toThrow(
      /route policy violated/
    );
    expect(() => assertRoutesExclusive({ sponsored: true })).not.toThrow();
  });

  it('only marks a route confirmed when KeeperHub says so', () => {
    const intended = chooseRoute('heartbeatBySig');
    expect(intended.confirmed).toBe(false);
    expect(confirmRoute(intended, { sponsored: true }).confirmed).toBe(true);
    // Asking for a route is not evidence it was honoured.
    expect(confirmRoute(intended, {}).confirmed).toBe(false);
    expect(confirmRoute(chooseRoute('evacuate'), { sponsored: true }).confirmed).toBe(false);
  });

  it('records the requested route on every audit entry', async () => {
    fake = await startFakeKeeperHub();
    const c = client(fake.url); await c.connect();
    const ledger = new AuditLedger(ledgerPath());
    const ex = new KeeperHubExecutor(c, ledger, 11155111, '0xcontract');
    await ex.executeEvacuation(
      { nonce: 1, deadline: 2, signature: '0x' },
      { type: 'panic', source: 'test' },
      { maxAttempts: 1 }
    );
    expect(ledger.all()[0].route?.requested).toBe('private');
  });
});
