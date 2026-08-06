import type { Address } from "viem";
import { ActionError, withActionEvidence } from "./action-error";
import { HEARTBEAT_COOLDOWN_SECONDS } from "./heartbeat-policy";
import {
  assertSepolia,
  assertSettlement,
  assertSigner,
  assertSigningDeadline,
  exactObject,
  requiredAddress,
  requiredInteger,
  requiredString,
  sameAddress,
} from "./action-validation";

export interface HeartbeatRequest {
  chainId: number;
  owner: Address;
  plan: Address;
  nonce: string;
  deadline: string;
  signature: string;
}

export interface KeeperHubSubmission {
  executionId: string;
}

export interface KeeperHubSettlement {
  status: string;
  txHash?: `0x${string}`;
  sponsored?: boolean;
}

export interface HeartbeatVerification {
  receiptStatus: string;
  target?: Address;
  event?: string;
  lastHeartbeat: bigint;
}

export interface HeartbeatDependencies {
  nowSeconds: () => number;
  readRegisteredPlan: (owner: Address) => Promise<Address>;
  readOwner: (plan: Address) => Promise<Address>;
  readLastHeartbeat: (plan: Address) => Promise<bigint>;
  recoverSigner: (request: HeartbeatRequest) => Promise<Address>;
  nextIdempotencyKey: () => string;
  submitToKeeperHub: (
    request: HeartbeatRequest,
    idempotencyKey: string,
  ) => Promise<KeeperHubSubmission>;
  awaitSettlement: (executionId: string) => Promise<KeeperHubSettlement>;
  verifyOnchain: (
    plan: Address,
    txHash: `0x${string}`,
    previousHeartbeat: bigint,
  ) => Promise<HeartbeatVerification>;
}

export interface VerifiedHeartbeatEvidence {
  stage: "verified";
  executionId: string;
  idempotencyKey: string;
  txHash: `0x${string}`;
  sponsored: true;
  receiptStatus: "success";
  event: "HeartbeatRecorded";
  plan: Address;
  lastHeartbeat: string;
  routeConfidence: "unavailable";
}

const REQUEST_FIELDS = [
  "chainId",
  "owner",
  "plan",
  "nonce",
  "deadline",
  "signature",
] as const;

export function parseHeartbeatRequest(value: unknown): HeartbeatRequest {
  const request = exactObject(value, REQUEST_FIELDS, "Heartbeat request");
  return {
    chainId: requiredInteger(request.chainId, "chainId"),
    owner: requiredAddress(request.owner, "owner"),
    plan: requiredAddress(request.plan, "plan"),
    nonce: requiredString(request.nonce, "nonce"),
    deadline: requiredString(request.deadline, "deadline"),
    signature: requiredString(request.signature, "signature"),
  };
}

export async function executeSignedHeartbeat(
  rawRequest: HeartbeatRequest,
  dependencies: HeartbeatDependencies,
): Promise<VerifiedHeartbeatEvidence> {
  const request = parseHeartbeatRequest(rawRequest);
  const nowSeconds = dependencies.nowSeconds();
  assertSepolia(request.chainId);
  assertSigningDeadline(request.deadline, nowSeconds);
  const registeredPlan = await dependencies.readRegisteredPlan(request.owner);
  if (!sameAddress(registeredPlan, request.plan)) {
    throw new ActionError(
      "PLAN_MISMATCH",
      "Factory registry does not match this plan.",
    );
  }
  const owner = await dependencies.readOwner(request.plan);
  if (!sameAddress(owner, request.owner)) {
    throw new ActionError(
      "WRONG_OWNER",
      "The connected wallet does not own this plan.",
    );
  }
  assertSigner(await dependencies.recoverSigner(request), owner);
  const previousHeartbeat = await dependencies.readLastHeartbeat(request.plan);
  assertHeartbeatCooldown(previousHeartbeat, nowSeconds);
  const idempotencyKey = dependencies.nextIdempotencyKey();
  const submission = await dependencies.submitToKeeperHub(
    request,
    idempotencyKey,
  );
  if (!submission.executionId) {
    throw new ActionError(
      "KEEPERHUB_REJECTED",
      "KeeperHub returned no execution ID.",
    );
  }
  const executionEvidence = { executionId: submission.executionId };
  const settlement = await withActionEvidence(executionEvidence, async () => {
    const result = await dependencies.awaitSettlement(submission.executionId);
    assertSettlement(result);
    return result;
  });
  const verified = await withActionEvidence(
    { ...executionEvidence, txHash: settlement.txHash },
    async () => {
      const result = await dependencies.verifyOnchain(
        request.plan,
        settlement.txHash,
        previousHeartbeat,
      );
      assertHeartbeatProof(result, request.plan, previousHeartbeat);
      return result;
    },
  );
  return {
    stage: "verified",
    executionId: submission.executionId,
    idempotencyKey,
    txHash: settlement.txHash,
    sponsored: true,
    receiptStatus: "success",
    event: "HeartbeatRecorded",
    plan: request.plan,
    lastHeartbeat: verified.lastHeartbeat.toString(),
    routeConfidence: "unavailable",
  };
}

function assertHeartbeatCooldown(
  previousHeartbeat: bigint,
  nowSeconds: number,
): void {
  const nextHeartbeat = previousHeartbeat + BigInt(HEARTBEAT_COOLDOWN_SECONDS);
  if (previousHeartbeat > 0n && BigInt(nowSeconds) < nextHeartbeat) {
    throw new ActionError(
      "HEARTBEAT_COOLDOWN",
      "A plan can check in only once during each rolling 24-hour window.",
    );
  }
}

function assertHeartbeatProof(
  proof: HeartbeatVerification,
  plan: Address,
  previousHeartbeat: bigint,
): void {
  if (
    proof.receiptStatus !== "success" ||
    !sameAddress(proof.target, plan) ||
    proof.event !== "HeartbeatRecorded" ||
    proof.lastHeartbeat <= previousHeartbeat
  ) {
    throw new ActionError(
      "UNVERIFIED_RESULT",
      "Receipt, heartbeat event, target, and resulting state did not agree.",
    );
  }
}
