import { describe, expect, it } from 'vitest';
import {
  configurationWorkflowPayload,
  evacuationWorkflowPayload,
  heartbeatWorkflowPayload,
  planWorkflowPayload,
} from '../../dashboard/lib/keeperhub-call-payload';
import type { ConfigurationRequest } from '../../dashboard/lib/configuration-route';
import type { HeartbeatRequest } from '../../dashboard/lib/heartbeat-route';
import type { PlanCreationRequest } from '../../dashboard/lib/plan-route';

const OWNER = '0x1111111111111111111111111111111111111111' as const;
const PLAN = '0x2222222222222222222222222222222222222222' as const;
const OTHER = '0x3333333333333333333333333333333333333333' as const;

const heartbeat: HeartbeatRequest = {
  chainId: 11155111,
  owner: OWNER,
  plan: PLAN,
  nonce: '9',
  deadline: '1000',
  signature: '0xsig',
};

const plan: PlanCreationRequest = {
  chainId: 11155111,
  owner: OWNER,
  config: {
    heartbeatInterval: 86_400,
    timeoutDuration: 5_184_000,
    gracePeriod: 604_800,
    beneficiaryWallets: [OTHER],
    beneficiaryShares: [10_000],
    recoveryKey: OTHER,
    safeVault: '0x4444444444444444444444444444444444444444',
    trackedTokens: [],
    allowSharedRecovery: false,
  },
  nonce: '8',
  deadline: '1000',
  signature: '0xplan',
};

describe('KeeperHub call payloads', () => {
  it('computes factory createPlan arguments server-side', () => {
    const payload = planWorkflowPayload(plan);
    const args = JSON.parse(payload.functionArgs);

    expect(args).toEqual([
      OWNER,
      plan.config,
      '8',
      '1000',
      '0xplan',
    ]);
    expect(payload).not.toHaveProperty('factoryAddress');
  });

  it('computes action-specific configuration arguments server-side', () => {
    const request: ConfigurationRequest = {
      ...heartbeat,
      action: 'beneficiaries',
      payload: { wallets: [OTHER], shares: [10_000] },
    };
    const payload = configurationWorkflowPayload(request);

    expect(payload.action).toBe('beneficiaries');
    expect(JSON.parse(payload.functionArgs)).toEqual([
      [OTHER],
      [10_000],
      '9',
      '1000',
      '0xsig',
    ]);
  });

  it('binds heartbeat and evacuation calls to the resolved owner plan', () => {
    expect(heartbeatWorkflowPayload(heartbeat)).toEqual({
      owner: OWNER,
      plan: PLAN,
      functionArgs: JSON.stringify(['9', '1000', '0xsig']),
    });
    expect(evacuationWorkflowPayload(heartbeat)).toEqual(
      heartbeatWorkflowPayload(heartbeat)
    );
  });
});
