"use client";

import { useEffect, useRef } from "react";
import type { Address } from "viem";

interface TriggerState {
  owner?: Address;
  plan?: Address;
  graceElapsed: boolean;
  settled: boolean;
}

interface Props {
  trigger: TriggerState;
  onSettled: () => void;
}

export function AutomaticInheritanceTrigger({
  trigger,
  onSettled,
}: Props): null {
  const inFlight = useRef(false);
  const { owner, plan, graceElapsed, settled } = trigger;

  useEffect(() => {
    const current = { owner, plan, graceElapsed, settled };
    if (!ready(current)) return;
    const currentOwner = current.owner;
    const currentPlan = current.plan;
    let active = true;
    async function execute(): Promise<void> {
      if (inFlight.current || !active) return;
      inFlight.current = true;
      try {
        await submitTrigger(currentOwner, currentPlan);
        if (active) onSettled();
      } catch (error) {
        console.error("Automatic inheritance submission failed.", error);
      } finally {
        inFlight.current = false;
      }
    }
    void execute();
    const retry = setInterval(() => void execute(), 30_000);
    return () => {
      active = false;
      clearInterval(retry);
    };
  }, [owner, plan, graceElapsed, settled, onSettled]);

  return null;
}

function ready(
  trigger: TriggerState,
): trigger is TriggerState & { owner: Address; plan: Address } {
  return (
    Boolean(trigger.owner && trigger.plan) &&
    trigger.graceElapsed &&
    !trigger.settled
  );
}

async function submitTrigger(owner: Address, plan: Address): Promise<void> {
  const response = await fetch("/api/inheritance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, plan }),
  });
  if (!response.ok) {
    throw new Error(`Inheritance trigger returned ${response.status}`);
  }
}
