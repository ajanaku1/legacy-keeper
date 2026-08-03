/**
 * A local stand-in for the KeeperHub MCP endpoint.
 *
 * Real failure modes are hard to provoke against a live service — you cannot
 * ask production to expire your session or hand back malformed JSON on demand.
 * This server reproduces each behaviour we actually observed (SSE framing,
 * -32003 session expiry, 402 challenges, `status: completed` that is really a
 * revert) so the client can be tested against them deterministically.
 */

import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeOptions {
  /** Frame replies as `data: ` SSE rather than plain JSON. */
  sse?: boolean;
  /** Reject the first N tools/call requests with -32003 session-expired. */
  expireSessionTimes?: number;
  /** Omit the Mcp-Session-Id header on initialize. */
  omitSessionHeader?: boolean;
  /** Fail the first N tools/call with a transport-level status. */
  transportFailTimes?: number;
  transportStatus?: number;
  /** Return a 402 challenge from tools/call. */
  paymentRequired?: boolean;
  /** Return unparseable body from tools/call. */
  malformed?: boolean;
  /** Per-execution status payloads returned by get_direct_execution_status. */
  executionStatus?: Record<string, unknown>;
  /** Payload returned when a direct execution is submitted. */
  submissionResult?: Record<string, unknown>;
  /** Raw tool text returned when a direct execution is submitted. */
  submissionText?: string;
}

export interface FakeHandle {
  url: string;
  close: () => Promise<void>;
  /** Every tools/call name received, in order. */
  calls: { name: string; args: Record<string, unknown> }[];
  idempotencyKeys: string[];
  transportRequests: () => number;
}

export async function startFakeKeeperHub(opts: FakeOptions = {}): Promise<FakeHandle> {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const idempotencyKeys: string[] = [];
  let expiries = opts.expireSessionTimes ?? 0;
  let transportFails = opts.transportFailTimes ?? 0;
  let transportRequests = 0;

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(body) as JsonRpcRequest;
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }

      const reply = (payload: unknown, status = 200) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'Content-Type': opts.sse ? 'text/event-stream' : 'application/json' });
        res.end(opts.sse ? `event: message\ndata: ${text}\n\n` : text);
      };

      if (msg.method === 'initialize') {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (!opts.omitSessionHeader) headers['Mcp-Session-Id'] = 'fake-session-1';
        res.writeHead(200, headers);
        const payload = {
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'fake-keeperhub', version: '9.9.9' },
          },
        };
        res.end(opts.sse ? `data: ${JSON.stringify(payload)}\n\n` : JSON.stringify(payload));
        return;
      }

      if (msg.method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }

      if (msg.method === 'tools/call') {
        transportRequests++;
        const name = msg.params?.name ?? '';
        const args = msg.params?.arguments ?? {};

        if (transportFails > 0) {
          transportFails--;
          res.writeHead(opts.transportStatus ?? 500).end('upstream boom');
          return;
        }
        if (expiries > 0) {
          expiries--;
          reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32003, message: 'Session not initialized' } });
          return;
        }

        calls.push({ name, args });
        if (args.idempotency_key) idempotencyKeys.push(String(args.idempotency_key));

        if (opts.malformed) {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{not json at all');
          return;
        }
        if (opts.paymentRequired) {
          reply({
            jsonrpc: '2.0', id: msg.id,
            result: {
              isError: true,
              content: [{
                type: 'text',
                text: 'API call failed: 402 Payment Required - ' + JSON.stringify({
                  x402Version: 2,
                  accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '10000' }],
                }),
              }],
            },
          });
          return;
        }

        if (name === 'get_direct_execution_status') {
          reply({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: JSON.stringify(opts.executionStatus ?? { status: 'completed', result: { success: true }, transactionHash: '0xfeed', gasUsedWei: '21000' }) }] },
          });
          return;
        }

        reply({
          jsonrpc: '2.0', id: msg.id,
          result: {
            content: [{
              type: 'text',
              text: opts.submissionText ?? JSON.stringify(
                opts.submissionResult ?? { status: 'completed', executionId: 'exec-fake-1' }
              ),
            }],
          },
        });
        return;
      }

      if (msg.method === 'tools/list') {
        reply({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'execute_contract_call',
                inputSchema: { type: 'object' },
              },
            ],
          },
        });
        return;
      }

      reply({ jsonrpc: '2.0', id: msg.id, result: {} });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    idempotencyKeys,
    transportRequests: () => transportRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface JsonRpcRequest {
  id?: number;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}
