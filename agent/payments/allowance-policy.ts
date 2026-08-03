export interface AllowanceQuery {
  origin: string;
  path: string;
  network: string;
  token: string;
  owner: string;
  spender: string;
}

export interface PaymentChallenge {
  protocol: 'x402' | 'mpp';
  paymentNetwork: string;
  amountAtomic: string;
  costUsd: number;
}

export interface SpendingPolicy {
  allowedOrigin: string;
  allowedPath: string;
  allowedQueryNetwork: string;
  allowedSpender: string;
  allowedPaymentNetworks: string[];
  maxUsd: number;
}

export interface PolicyApproval {
  approved: true;
  costUsd: number;
  maxUsd: number;
}

export interface AllowanceServiceResult {
  allowance: string;
  decimals: number;
  owner: string;
  spender: string;
  token: string;
}

export interface AllowanceDecision {
  allowanceAtomic: string;
  status: 'protected' | 'at-risk';
  tracked: boolean;
  reason: string;
}

export function approveAllowancePayment(
  policy: SpendingPolicy,
  query: AllowanceQuery,
  challenge: PaymentChallenge,
): PolicyApproval {
  requireEqual('origin', query.origin, policy.allowedOrigin);
  requireEqual('path', query.path, policy.allowedPath);
  requireEqual('query network', query.network, policy.allowedQueryNetwork);
  requireAddress('spender', query.spender, policy.allowedSpender);
  requireEqual('protocol', challenge.protocol, 'x402');

  if (!policy.allowedPaymentNetworks.includes(challenge.paymentNetwork)) {
    throw new Error(`payment network is outside policy: ${challenge.paymentNetwork}`);
  }
  validateCost(challenge, policy.maxUsd);

  return { approved: true, costUsd: challenge.costUsd, maxUsd: policy.maxUsd };
}

export function consumeAllowanceResult(
  query: AllowanceQuery,
  result: AllowanceServiceResult,
  trackedTokens: string[],
): AllowanceDecision {
  requireAddress('owner', result.owner, query.owner);
  requireAddress('spender', result.spender, query.spender);
  requireAddress('token', result.token, query.token);

  const allowance = parseAllowance(result.allowance);
  const tracked = trackedTokens.some((token) => sameAddress(token, query.token));
  const protectedEstate = tracked && allowance > 0n;

  return {
    allowanceAtomic: allowance.toString(),
    status: protectedEstate ? 'protected' : 'at-risk',
    tracked,
    reason: decisionReason(tracked, allowance),
  };
}

function decisionReason(tracked: boolean, allowance: bigint): string {
  if (!tracked && allowance === 0n) {
    return 'USDC is not tracked and its allowance to LegacyKeeper is zero';
  }
  if (!tracked) return 'USDC has an allowance but is not tracked by LegacyKeeper';
  if (allowance === 0n) return 'USDC is tracked but its allowance to LegacyKeeper is zero';
  return 'USDC is tracked and has a non-zero allowance to LegacyKeeper';
}

function parseAllowance(value: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch {
    throw new Error(`invalid allowance: ${value}`);
  }
}

function validateCost(challenge: PaymentChallenge, maxUsd: number): void {
  const amount = parseAtomicAmount(challenge.amountAtomic);
  const maxAtomic = BigInt(Math.floor(maxUsd * 1e6));
  const quotedAtomic = BigInt(Math.round(challenge.costUsd * 1e6));
  if (!Number.isFinite(challenge.costUsd) || amount > maxAtomic) {
    throw new Error(`payment cost exceeds ${maxUsd}`);
  }
  if (amount !== quotedAtomic) throw new Error('payment amount does not match quoted cost');
}

function parseAtomicAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`invalid payment amount: ${value}`);
  return BigInt(value);
}

function requireAddress(label: string, actual: string, expected: string): void {
  if (!sameAddress(actual, expected)) throw new Error(`${label} does not match request`);
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requireEqual(label: string, actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`${label} is outside policy: ${actual}`);
}
