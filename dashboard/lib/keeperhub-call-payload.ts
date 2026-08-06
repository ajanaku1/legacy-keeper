import type { ConfigurationRequest } from './configuration-route';
import type { HeartbeatRequest } from './heartbeat-route';
import type { PlanCreationRequest } from './plan-route';

interface WorkflowPayload {
  owner?: string;
  plan?: string;
  action?: string;
  functionArgs: string;
}

export function planWorkflowPayload(
  request: PlanCreationRequest
): WorkflowPayload {
  return {
    functionArgs: JSON.stringify([
      request.owner,
      request.config,
      request.nonce,
      request.deadline,
      request.signature,
    ]),
  };
}

export function configurationWorkflowPayload(
  request: ConfigurationRequest
): WorkflowPayload {
  return {
    owner: request.owner,
    plan: request.plan,
    action: request.action,
    functionArgs: JSON.stringify(configurationArgs(request)),
  };
}

export function heartbeatWorkflowPayload(
  request: HeartbeatRequest
): WorkflowPayload {
  return signedPlanPayload(request);
}

export function evacuationWorkflowPayload(
  request: HeartbeatRequest
): WorkflowPayload {
  return signedPlanPayload(request);
}

function signedPlanPayload(request: HeartbeatRequest): WorkflowPayload {
  return {
    owner: request.owner,
    plan: request.plan,
    functionArgs: JSON.stringify([
      request.nonce,
      request.deadline,
      request.signature,
    ]),
  };
}

function configurationArgs(request: ConfigurationRequest): unknown[] {
  const { payload, nonce, deadline, signature } = request;
  if ('wallets' in payload)
    return [payload.wallets, payload.shares, nonce, deadline, signature];
  if ('heartbeatInterval' in payload)
    return [
      payload.heartbeatInterval,
      payload.timeoutDuration,
      payload.gracePeriod,
      nonce,
      deadline,
      signature,
    ];
  if ('recoveryKey' in payload)
    return [
      payload.recoveryKey,
      payload.safeVault,
      payload.allowSharedRecovery,
      nonce,
      deadline,
      signature,
    ];
  return [payload.tokens, nonce, deadline, signature];
}
