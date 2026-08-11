import { resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";
import { inheritanceWatcherToken } from "./inheritance-watcher";
import type { InheritanceWatchInput } from "./inheritance-watcher-server";
import {
  inheritanceWatcher,
  type InheritanceWatchSignal,
} from "../workflows/inheritance-watcher";

export type InheritanceWatcherControlResult =
  | { status: "started" | "signaled"; runId: string }
  | { status: "unavailable"; error: string };

export async function startInheritanceWatcher(
  input: InheritanceWatchInput,
): Promise<InheritanceWatcherControlResult> {
  try {
    const run = await start(inheritanceWatcher, [input]);
    return { status: "started", runId: run.runId };
  } catch (error) {
    console.error("Unable to start inheritance watcher.", error);
    return unavailable(error);
  }
}

export async function signalInheritanceWatcher(
  input: InheritanceWatchInput,
  reason: InheritanceWatchSignal["reason"],
): Promise<InheritanceWatcherControlResult> {
  const token = inheritanceWatcherToken(input.owner, input.plan);
  try {
    const hook = await resumeHook(token, {
      reason,
      timestamp: Date.now(),
    } satisfies InheritanceWatchSignal);
    return { status: "signaled", runId: hook.runId };
  } catch (error) {
    if (HookNotFoundError.is(error)) return startInheritanceWatcher(input);
    console.error("Unable to signal inheritance watcher.", error);
    return unavailable(error);
  }
}

function unavailable(error: unknown): InheritanceWatcherControlResult {
  return {
    status: "unavailable",
    error: error instanceof Error ? error.message : String(error),
  };
}
