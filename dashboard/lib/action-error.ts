export type ActionErrorCode =
  | "INVALID_REQUEST"
  | "WRONG_NETWORK"
  | "SIGNATURE_EXPIRED"
  | "HEARTBEAT_COOLDOWN"
  | "PLAN_ALREADY_EXISTS"
  | "PLAN_NOT_FOUND"
  | "PLAN_MISMATCH"
  | "WRONG_OWNER"
  | "WRONG_SIGNER"
  | "KEEPERHUB_REJECTED"
  | "KEEPERHUB_UNSETTLED"
  | "UNVERIFIED_RESULT";

export interface ActionErrorEvidence {
  executionId?: string;
  txHash?: `0x${string}`;
}

export class ActionError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
    readonly evidence: ActionErrorEvidence = {},
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export async function withActionEvidence<Result>(
  evidence: ActionErrorEvidence,
  execute: () => Promise<Result>,
): Promise<Result> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof ActionError) {
      throw new ActionError(error.code, error.message, {
        ...error.evidence,
        ...evidence,
      });
    }
    throw new ActionError(
      "KEEPERHUB_REJECTED",
      error instanceof Error ? error.message : "Execution failed",
      evidence,
    );
  }
}

export function actionErrorBody(error: unknown): {
  stage: "failed";
  code: ActionErrorCode;
  error: string;
} {
  if (error instanceof ActionError) {
    return { stage: "failed", code: error.code, error: error.message };
  }
  return {
    stage: "failed",
    code: "KEEPERHUB_REJECTED",
    error: error instanceof Error ? error.message : "Execution failed",
  };
}
