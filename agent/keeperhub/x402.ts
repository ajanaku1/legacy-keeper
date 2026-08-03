/**
 * x402 / MPP paid-workflow client.
 *
 * ## Why LegacyKeeper pays for anything at all
 *
 * The ERC-20 half of this product rests on one assumption: the owner's
 * allowance to this contract is still valid. Nothing in our system notices if
 * the owner revokes it, a token upgrade clears it, or a wallet UI "cleans up"
 * approvals. The estate would then be undistributable, and we would find out
 * at execution time — the one moment nobody is available to fix it.
 *
 * This module retains support for KeeperHub marketplace listings. The active
 * product-linked allowance monitor lives in `agent/payments`: it buys a $0.003
 * OneSource read with explicit owner, token, spender, and Sepolia inputs.
 *
 * ## Protocol shape (captured from a real 402)
 *
 *   {"x402Version":2,"accepts":[{"scheme":"exact",
 *     "network":"eip155:8453",                  // Base mainnet
 *     "asset":"0x833589fC…2913",                // USDC
 *     "amount":"3000",                          // 0.003 USDC, 6dp
 *     "payTo":"0xc7d9…4dc5","maxTimeoutSeconds":300}]}
 *
 * The MCP tool does not auto-pay. Settlement goes through a wallet that can
 * sign an x402 payment — `@keeperhub/wallet` or agentcash.
 */

import { McpClient } from './mcp-client';

export interface PaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  /** Atomic units. USDC is 6dp, so 10000 = $0.01. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
}

export interface X402Challenge {
  x402Version: number;
  resourceUrl?: string;
  accepts: PaymentRequirement[];
  raw: string;
}

export class PaymentRequired extends Error {
  constructor(readonly challenge: X402Challenge) {
    const a = challenge.accepts[0];
    super(
      `payment required: ${a ? `${a.amount} atomic of ${a.asset} on ${a.network}` : 'unknown terms'}`
    );
    this.name = 'PaymentRequired';
  }
}

export interface PaidCallResult {
  paid: boolean;
  challenge?: X402Challenge;
  /** Present only when settlement actually happened. */
  result?: unknown;
  executionId?: string;
}

/** Human-readable amount. Assumes 6dp, which holds for USDC and USDC.e. */
export function formatAmount(req: PaymentRequirement): string {
  const value = Number(req.amount) / 1e6;
  return `${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} USDC`;
}

export function parseChallenge(text: string): X402Challenge | null {
  const start = text.indexOf('{"x402Version"');
  if (start === -1) return null;

  // The challenge is embedded in a longer error string; find its extent.
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return {
            x402Version: parsed.x402Version,
            resourceUrl: parsed.resource?.url,
            accepts: parsed.accepts ?? [],
            raw: slice,
          };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export class PaidWorkflowClient {
  constructor(private readonly mcp: McpClient) {}

  /**
   * Call a marketplace workflow. Free listings return their result. Paid ones
   * raise the challenge rather than silently spending: money moves only when
   * the caller decides it should.
   */
  async call(slug: string, inputs: Record<string, unknown> = {}): Promise<PaidCallResult> {
    try {
      const text = await this.mcp.callTool('call_workflow', { slug, inputs });
      return { paid: false, result: safeJson(text), executionId: extractExecutionId(text) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const challenge = parseChallenge(message);
      if (challenge) throw new PaymentRequired(challenge);
      throw error;
    }
  }

  /** Discover the terms of a paid listing without committing to them. */
  async quote(slug: string): Promise<X402Challenge | null> {
    try {
      await this.call(slug, {});
      return null; // free
    } catch (error) {
      if (error instanceof PaymentRequired) return error.challenge;
      throw error;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractExecutionId(text: string): string | undefined {
  return text.match(/"executionId"\s*:\s*"([^"]+)"/)?.[1];
}
