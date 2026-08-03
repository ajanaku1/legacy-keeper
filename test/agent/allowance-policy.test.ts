import { describe, expect, it } from 'vitest';
import {
  approveAllowancePayment,
  consumeAllowanceResult,
  type AllowanceQuery,
  type PaymentChallenge,
  type SpendingPolicy,
} from '../../agent/payments/allowance-policy';

const query: AllowanceQuery = {
  origin: 'https://api.onesource.io',
  path: '/api/chain/allowance',
  network: 'sepolia',
  token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  owner: '0x34b0Ba20669f3ec4F1056853780c381e5e35F724',
  spender: '0x0f92268dC069f40e9e6A37BF36dc49D60377f4bA',
};

const challenge: PaymentChallenge = {
  protocol: 'x402',
  paymentNetwork: 'eip155:8453',
  amountAtomic: '3000',
  costUsd: 0.003,
};

const policy: SpendingPolicy = {
  allowedOrigin: query.origin,
  allowedPath: query.path,
  allowedQueryNetwork: 'sepolia',
  allowedSpender: query.spender,
  allowedPaymentNetworks: ['eip155:8453'],
  maxUsd: 0.005,
};

describe('LegacyKeeper paid allowance policy', () => {
  it('approves only the exact product query beneath the spend ceiling', () => {
    expect(approveAllowancePayment(policy, query, challenge)).toEqual({
      approved: true,
      costUsd: 0.003,
      maxUsd: 0.005,
    });
  });

  it.each([
    [{ ...query, origin: 'https://lookalike.example' }, challenge],
    [{ ...query, spender: '0x1111111111111111111111111111111111111111' }, challenge],
    [query, { ...challenge, costUsd: 0.006 }],
    [query, { ...challenge, amountAtomic: '6000' }],
    [query, { ...challenge, protocol: 'mpp' as const }],
  ])('rejects a request or challenge outside policy', (candidate, terms) => {
    expect(() => approveAllowancePayment(policy, candidate, terms)).toThrow();
  });

  it('consumes a bound zero-allowance result as a LegacyKeeper warning', () => {
    const decision = consumeAllowanceResult(query, {
      allowance: '0x0',
      decimals: 6,
      owner: query.owner,
      spender: query.spender,
      token: query.token,
    }, []);

    expect(decision).toEqual({
      allowanceAtomic: '0',
      status: 'at-risk',
      tracked: false,
      reason: 'USDC is not tracked and its allowance to LegacyKeeper is zero',
    });
  });

  it('rejects a paid response that is not bound to the requested addresses', () => {
    expect(() => consumeAllowanceResult(query, {
      allowance: '0x1',
      decimals: 6,
      owner: query.owner,
      spender: query.spender,
      token: '0x1111111111111111111111111111111111111111',
    }, [query.token])).toThrow('token');
  });
});
