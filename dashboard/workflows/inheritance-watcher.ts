import { createHook, getStepMetadata, sleep } from "workflow";
import type { InheritanceTriggerResult } from "@/lib/inheritance-trigger";
import {
  getInheritanceWatchDecision,
  inheritanceWatcherToken,
} from "@/lib/inheritance-watcher";
import {
  executeWatchedInheritance,
  readInheritanceWatchState,
  type InheritanceWatchInput,
  type ObservedInheritanceWatchState,
} from "@/lib/inheritance-watcher-server";

export interface InheritanceWatchSignal {
  reason: "heartbeat" | "configuration";
  timestamp: number;
}

export type InheritanceWatcherResult =
  | { status: "complete"; reason: string }
  | { status: "deduplicated"; runId: string };

export async function inheritanceWatcher(
  input: InheritanceWatchInput,
): Promise<InheritanceWatcherResult> {
  "use workflow";

  using updates = createHook<InheritanceWatchSignal>({
    token: inheritanceWatcherToken(input.owner, input.plan),
  });
  const conflict = await updates.getConflict();
  if (conflict) return { status: "deduplicated", runId: conflict.runId };

  const signals = updates[Symbol.asyncIterator]();
  let nextSignal = waitForSignal(signals);
  for (;;) {
    const observed = await readInheritanceWatchStateStep(input);
    const decision = getInheritanceWatchDecision(
      observed.state,
      observed.nowSeconds,
    );
    if (decision.status === "complete") return decision;
    if (decision.status === "wait") {
      const winner = await Promise.race([
        sleep(new Date(Number(decision.deadline) * 1_000)).then(
          () => "deadline" as const,
        ),
        nextSignal,
      ]);
      if (winner === "signal") nextSignal = waitForSignal(signals);
      continue;
    }

    const result = await executeInheritanceStep(input);
    if (executionFailed(result)) await sleep("1m");
  }
}

function waitForSignal(
  signals: AsyncIterator<InheritanceWatchSignal>,
): Promise<"signal"> {
  return signals.next().then(() => "signal" as const);
}

async function readInheritanceWatchStateStep(
  input: InheritanceWatchInput,
): Promise<ObservedInheritanceWatchState> {
  "use step";
  console.info("Reading canonical inheritance state.", input);
  const observed = await readInheritanceWatchState(input);
  console.info("Canonical inheritance state read.", {
    plan: input.plan,
    nowSeconds: observed.nowSeconds.toString(),
  });
  return observed;
}

async function executeInheritanceStep(
  input: InheritanceWatchInput,
): Promise<InheritanceTriggerResult> {
  "use step";
  const { stepId, attempt } = getStepMetadata();
  console.info("Submitting due inheritance through KeeperHub.", {
    ...input,
    stepId,
    attempt,
  });
  const result = await executeWatchedInheritance(input, stepId);
  console.info("KeeperHub inheritance attempt settled.", {
    plan: input.plan,
    nativeStatus: result.native.status,
    tokenStatuses: result.tokens.map((token) => token.status),
  });
  return result;
}

function executionFailed(result: InheritanceTriggerResult): boolean {
  return (
    result.native.status === "failed" ||
    result.tokens.some((token) => token.status === "failed")
  );
}
