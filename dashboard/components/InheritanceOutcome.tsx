"use client";

import Link from "next/link";
import type { Address } from "viem";
import { EXPLORER } from "@/lib/contract";
import type { TrackedAssetState } from "@/lib/useTrackedAssets";

export interface InheritanceOutcomeState {
  plan?: Address;
  executedAt: number;
  beneficiaryCount: number;
  assets: TrackedAssetState;
}

interface Props {
  state: InheritanceOutcomeState;
}

export function InheritanceOutcome({ state }: Props) {
  const { plan, executedAt, beneficiaryCount, assets } = state;
  const distributedTokens = assets.assets.filter(
    (asset) => asset.distributed,
  ).length;
  const metrics = {
    executedAt,
    beneficiaryCount,
    tokenCount: assets.assets.length,
    distributedTokens,
  };

  return (
    <section
      className="inheritance-outcome"
      aria-labelledby="inheritance-title"
    >
      <div className="inheritance-outcome-copy">
        <span className="notice-state verified">Verified onchain</span>
        <h2 id="inheritance-title">Inheritance executed</h2>
        <p>
          Native distribution is final and owner check-ins are closed. Tracked
          ERC-20 distributions remain independently verifiable below.
        </p>
        <div className="inheritance-proof-links">
          <Link href="/activity">Open verified execution evidence ↗</Link>
          {plan && (
            <a
              href={`${EXPLORER}/address/${plan}`}
              target="_blank"
              rel="noreferrer"
            >
              View plan state ↗
            </a>
          )}
        </div>
      </div>
      <InheritanceMetrics metrics={metrics} />
    </section>
  );
}

interface InheritanceMetricState {
  executedAt: number;
  beneficiaryCount: number;
  tokenCount: number;
  distributedTokens: number;
}

function InheritanceMetrics({ metrics }: { metrics: InheritanceMetricState }) {
  return (
    <dl className="inheritance-metrics">
      <OutcomeMetric
        label="Executed"
        value={formatTimestamp(metrics.executedAt)}
      />
      <OutcomeMetric
        label="Beneficiaries"
        value={String(metrics.beneficiaryCount)}
      />
      <OutcomeMetric
        label="Token distributions"
        value={tokenProgress(metrics.tokenCount, metrics.distributedTokens)}
        warning={metrics.distributedTokens < metrics.tokenCount}
      />
    </dl>
  );
}

function OutcomeMetric(props: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd className={props.warning ? "asset-state-warning" : ""}>
        {props.value}
      </dd>
    </div>
  );
}

function tokenProgress(total: number, distributed: number): string {
  if (total === 0) return "No tracked tokens";
  return `${distributed} of ${total} complete`;
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return "Confirming block time";
  return new Date(timestamp * 1_000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
