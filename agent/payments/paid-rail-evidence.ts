import {
  approveAllowancePayment,
  consumeAllowanceResult,
  type AllowanceQuery,
  type AllowanceServiceResult,
} from './allowance-policy';

interface AgentCashPaidResponse {
  success: boolean;
  data: {
    data: AllowanceServiceResult;
    meta: { endpoint: string; request_id: string };
  };
  metadata: {
    protocol: string;
    network: string;
    price: string;
    payment: { success: boolean; transactionHash?: string };
  };
}

interface EvidenceInput {
  query: AllowanceQuery;
  paidResponse: AgentCashPaidResponse;
  trackedTokens: string[];
  maxUsd: number;
  challengeObserved: boolean;
  mppBlocker: string;
  generatedAt: string;
}

export function buildPaidRailEvidence(input: EvidenceInput) {
  const response = input.paidResponse;
  requirePaidResponseBinding(input);
  const paymentTx = requireSuccessfulPayment(response);
  const costUsd = parsePrice(response.metadata.price);
  const approval = approveEvidencePayment(input, costUsd);
  const decision = consumeAllowanceResult(
    input.query,
    response.data.data,
    input.trackedTokens,
  );

  return {
    generatedAt: input.generatedAt,
    product: { query: input.query, decision },
    x402: x402Evidence(input, paymentTx, costUsd, approval.maxUsd),
    mpp: { demonstrated: false, blocker: input.mppBlocker },
  };
}

function approveEvidencePayment(input: EvidenceInput, costUsd: number) {
  return approveAllowancePayment({
    allowedOrigin: input.query.origin,
    allowedPath: input.query.path,
    allowedQueryNetwork: 'sepolia',
    allowedSpender: input.query.spender,
    allowedPaymentNetworks: ['eip155:8453'],
    maxUsd: input.maxUsd,
  }, input.query, {
    protocol: 'x402',
    paymentNetwork: networkId(input.paidResponse.metadata.network),
    amountAtomic: String(Math.round(costUsd * 1e6)),
    costUsd,
  });
}

function x402Evidence(
  input: EvidenceInput,
  paymentTx: string,
  costUsd: number,
  maxUsd: number,
) {
  return {
    challenge: input.challengeObserved,
    policyApproved: true,
    paymentTx,
    retried: input.challengeObserved && input.paidResponse.success,
    resultConsumed: true,
    costUsd,
    maxUsd,
    requestId: input.paidResponse.data.meta.request_id,
    paymentNetwork: input.paidResponse.metadata.network,
  };
}

function requirePaidResponseBinding(input: EvidenceInput): void {
  if (!input.challengeObserved) throw new Error('payment challenge was not observed');
  if (!input.paidResponse.success) throw new Error('paid request failed');
  if (input.paidResponse.metadata.protocol !== 'x402') {
    throw new Error('paid response did not use x402');
  }
  if (input.paidResponse.data.meta.endpoint !== input.query.path) {
    throw new Error('paid response endpoint does not match request');
  }
}

function requireSuccessfulPayment(response: AgentCashPaidResponse): string {
  const payment = response.metadata.payment;
  if (!payment.success || !payment.transactionHash) {
    throw new Error('payment receipt is missing or unsuccessful');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(payment.transactionHash)) {
    throw new Error('payment transaction hash is malformed');
  }
  return payment.transactionHash;
}

function parsePrice(price: string): number {
  const value = Number(price.replace(/^\$/, ''));
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid price: ${price}`);
  return value;
}

function networkId(network: string): string {
  if (network === 'base') return 'eip155:8453';
  throw new Error(`unsupported payment network: ${network}`);
}
