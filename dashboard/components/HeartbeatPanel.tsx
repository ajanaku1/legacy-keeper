"use client";

import { useState } from "react";
import { useSignTypedData } from "wagmi";
import type { Address } from "viem";
import { EXPLORER } from "@/lib/contract";
import { userFacingActionError } from "@/lib/client-action-error";
import { prepareHeartbeatMessage } from "@/lib/heartbeat-client";
import type { VerifiedHeartbeatEvidence } from "@/lib/heartbeat-route";
import { heartbeatCooldownRemaining } from "@/lib/heartbeat-policy";
import { SEPOLIA_CHAIN_ID } from "@/lib/onboarding-draft";
import { formatCountdown, shortAddress } from "@/lib/format";

type Stage = "idle" | "signing" | "submitting" | "verified" | "failed";
type AvailabilityCode =
  | "READY"
  | "DISCONNECTED"
  | "WRONG_NETWORK"
  | "SETUP_INCOMPLETE"
  | "WRONG_OWNER"
  | "PLAN_SETTLED"
  | "LIVENESS_INACTIVE"
  | "COOLDOWN"
  | "BUSY";

export interface CheckInState {
  connected: boolean;
  chainId?: number;
  ownerAddress?: Address;
  plan?: Address;
  planOwner?: string;
  livenessActive: boolean;
  inheritanceExecuted: boolean;
  evacuationExecuted: boolean;
  secondsUntilDue?: number;
  lastHeartbeat?: number;
}

interface Props {
  state: CheckInState;
  onVerified: () => void;
}

const STEPS = [
  "Wallet signature",
  "KeeperHub accepted",
  "Execution settled",
  "Receipt and event",
  "State advanced",
];

export function checkInAvailability(
  state: CheckInState,
  busy: boolean,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { code: AvailabilityCode; reason: string } {
  if (!state.connected)
    return { code: "DISCONNECTED", reason: "Connect the plan owner wallet." };
  if (state.chainId !== SEPOLIA_CHAIN_ID)
    return { code: "WRONG_NETWORK", reason: "Switch to Sepolia to check in." };
  if (!state.plan)
    return {
      code: "SETUP_INCOMPLETE",
      reason: "Finish plan setup before checking in.",
    };
  if (!sameAddress(state.ownerAddress, state.planOwner))
    return {
      code: "WRONG_OWNER",
      reason: "Reconnect the wallet that owns this plan.",
    };
  if (state.inheritanceExecuted || state.evacuationExecuted)
    return { code: "PLAN_SETTLED", reason: "This plan has already settled." };
  if (!state.livenessActive)
    return {
      code: "LIVENESS_INACTIVE",
      reason: "Liveness is paused in plan settings.",
    };
  if (busy)
    return {
      code: "BUSY",
      reason: "A check-in attempt is already in progress.",
    };
  const cooldown = heartbeatCooldownRemaining(state.lastHeartbeat, nowSeconds);
  if (cooldown > 0) {
    return {
      code: "COOLDOWN",
      reason: `Next check-in available in ${formatCountdown(cooldown)}.`,
    };
  }
  return { code: "READY", reason: "" };
}

export function HeartbeatPanel({ state, onVerified }: Props) {
  const { signTypedDataAsync } = useSignTypedData();
  const [stage, setStage] = useState<Stage>("idle");
  const [evidence, setEvidence] = useState<VerifiedHeartbeatEvidence>();
  const [error, setError] = useState("");
  const busy = stage === "signing" || stage === "submitting";
  const availability = checkInAvailability(state, busy);

  async function checkIn(): Promise<void> {
    if (availability.code !== "READY" || !state.plan || !state.ownerAddress)
      return;
    setError("");
    setEvidence(undefined);
    try {
      setStage("signing");
      const message = prepareHeartbeatMessage(
        crypto.getRandomValues(new Uint8Array(32)),
        Math.floor(Date.now() / 1_000),
      );
      const signature = await signTypedDataAsync(
        heartbeatTypedData(state.plan, message),
      );
      setStage("submitting");
      const result = await submitHeartbeat(state, message, signature);
      setEvidence(result);
      setStage("verified");
      onVerified();
    } catch (reason) {
      setStage("failed");
      setError(reason instanceof Error ? reason.message : "Check-in failed.");
    }
  }

  return (
    <section className="heartbeat-grid" aria-label="Verified check-in">
      <article className="card heartbeat-action">
        <span className="section-label">Check-in</span>
        <h2>Keep this plan dormant.</h2>
        <strong className="heartbeat-timer">
          {formatCountdown(state.secondsUntilDue ?? 0)}
        </strong>
        <p>Time until recovery becomes eligible.</p>
        <button
          className="primary"
          disabled={availability.code !== "READY"}
          onClick={checkIn}
        >
          {buttonCopy(stage)}
        </button>
        <p
          className={
            stage === "failed" ? "disabled-reason error" : "disabled-reason"
          }
          role="status"
          aria-live="polite"
        >
          {statusCopy(stage, availability.reason, error)}
        </p>
      </article>
      <LatestProof
        evidence={evidence}
        lastHeartbeat={state.lastHeartbeat ?? 0}
      />
      <VerificationJourney stage={stage} />
    </section>
  );
}

function LatestProof({
  evidence,
  lastHeartbeat,
}: {
  evidence?: VerifiedHeartbeatEvidence;
  lastHeartbeat: number;
}) {
  return (
    <article className="card heartbeat-proof">
      <span className="section-label">Latest proof</span>
      <h2>
        {lastHeartbeat
          ? formatTimestamp(lastHeartbeat)
          : "Waiting for chain state"}
      </h2>
      <dl className="proof-list">
        <ProofLine
          label="KeeperHub"
          value={
            evidence
              ? shortAddress(evidence.executionId, 6, 4)
              : "No session proof"
          }
        />
        <ProofLine
          label="Receipt"
          value={evidence ? "Status 1" : "Not verified here"}
        />
        <ProofLine
          label="State"
          value={evidence ? "Advanced" : "On-chain read"}
        />
      </dl>
      {evidence && (
        <a
          href={`${EXPLORER}/tx/${evidence.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction proof ↗
        </a>
      )}
    </article>
  );
}

function VerificationJourney({ stage }: { stage: Stage }) {
  const active = stageIndex(stage);
  return (
    <article className="card heartbeat-journey">
      <span className="section-label">Verification route</span>
      <ol>
        {STEPS.map((label, index) => (
          <li data-state={stepState(index, active, stage)} key={label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {label}
          </li>
        ))}
      </ol>
    </article>
  );
}

function heartbeatTypedData(
  plan: Address,
  message: { nonce: bigint; deadline: bigint },
) {
  return {
    domain: {
      name: "LegacyKeeper",
      version: "1",
      chainId: SEPOLIA_CHAIN_ID,
      verifyingContract: plan,
    },
    types: {
      Heartbeat: [
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Heartbeat" as const,
    message,
  } as const;
}

async function submitHeartbeat(
  state: CheckInState,
  message: { nonce: bigint; deadline: bigint },
  signature: string,
): Promise<VerifiedHeartbeatEvidence> {
  const response = await fetch("/api/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId: state.chainId,
      owner: state.ownerAddress,
      plan: state.plan,
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
      signature,
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isEvidence(body)) {
    throw new Error(
      userFacingActionError(body, "KeeperHub could not verify this check-in."),
    );
  }
  return body;
}

function isEvidence(value: unknown): value is VerifiedHeartbeatEvidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.stage === "verified" &&
    item.event === "HeartbeatRecorded" &&
    typeof item.executionId === "string" &&
    typeof item.txHash === "string" &&
    typeof item.plan === "string"
  );
}

function statusCopy(stage: Stage, unavailable: string, error: string): string {
  if (stage === "signing")
    return "Approve one check-in signature in your wallet.";
  if (stage === "submitting")
    return "KeeperHub is settling and verifying the result.";
  if (stage === "verified") {
    const verified = "Check-in verified. On-chain liveness advanced.";
    return unavailable ? `${verified} ${unavailable}` : verified;
  }
  if (stage === "failed") return error;
  return unavailable || "Ready for a sponsored check-in.";
}

function buttonCopy(stage: Stage): string {
  if (stage === "signing") return "Waiting for signature";
  if (stage === "submitting") return "Verifying check-in";
  return "Check in now";
}

function stageIndex(stage: Stage): number {
  if (stage === "signing") return 0;
  if (stage === "submitting") return 1;
  if (stage === "verified") return STEPS.length;
  return -1;
}

function stepState(index: number, active: number, stage: Stage): string {
  if (stage === "failed" && index === Math.max(active, 0)) return "failed";
  if (index < active || active === STEPS.length) return "done";
  return index === active ? "active" : "pending";
}

function sameAddress(left?: string, right?: string): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function ProofLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const formatted = new Date(seconds * 1_000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${formatted} UTC`;
}
