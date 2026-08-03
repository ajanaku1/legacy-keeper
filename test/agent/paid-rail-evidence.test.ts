import { describe, expect, it } from 'vitest';
import { buildPaidRailEvidence } from '../../agent/payments/paid-rail-evidence';

const query = {
  origin: 'https://api.onesource.io',
  path: '/api/chain/allowance',
  network: 'sepolia',
  token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  owner: '0x34b0Ba20669f3ec4F1056853780c381e5e35F724',
  spender: '0x0f92268dC069f40e9e6A37BF36dc49D60377f4bA',
};

const paidResponse = {
  success: true,
  data: {
    data: {
      owner: query.owner,
      spender: query.spender,
      token: query.token,
      allowance: '0',
      decimals: 6,
    },
    meta: { endpoint: query.path, request_id: 'request-1' },
  },
  metadata: {
    protocol: 'x402',
    network: 'base',
    price: '$0.003',
    payment: {
      success: true,
      transactionHash: `0x${'a'.repeat(64)}`,
    },
  },
};

describe('paid-rail evidence', () => {
  it('links the challenge, payment retry, and consumed product decision', () => {
    const evidence = buildPaidRailEvidence({
      query,
      paidResponse,
      trackedTokens: [],
      maxUsd: 0.005,
      challengeObserved: true,
      mppBlocker: 'AgentCash Tempo balance is 0',
      generatedAt: '2026-08-02T01:28:05.000Z',
    });

    expect(evidence.x402).toMatchObject({
      challenge: true,
      policyApproved: true,
      paymentTx: `0x${'a'.repeat(64)}`,
      retried: true,
      resultConsumed: true,
      costUsd: 0.003,
      maxUsd: 0.005,
    });
    expect(evidence.product.decision.status).toBe('at-risk');
    expect(evidence.mpp).toEqual({
      demonstrated: false,
      blocker: 'AgentCash Tempo balance is 0',
    });
  });

  it('rejects a response without a successful payment receipt', () => {
    const failed = {
      ...paidResponse,
      metadata: { ...paidResponse.metadata, payment: { success: false } },
    };

    expect(() => buildPaidRailEvidence({
      query,
      paidResponse: failed,
      trackedTokens: [],
      maxUsd: 0.005,
      challengeObserved: true,
      mppBlocker: 'unfunded',
      generatedAt: '2026-08-02T01:28:05.000Z',
    })).toThrow('payment');
  });
});
