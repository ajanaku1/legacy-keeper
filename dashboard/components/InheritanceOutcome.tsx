"use client";

import Link from "next/link";
import type { TrackedAssetState } from "@/lib/useTrackedAssets";

interface Props {
  executedAt: number;
  beneficiaryCount: number;
  assets: TrackedAssetState;
}

export function InheritanceOutcome({
  executedAt,
  beneficiaryCount,
  assets,
}: Props) {
  const distributedTokens = assets.assets.filter(
    (asset) => asset.distributed,
  ).length;

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
        <Link href="/activity">Open verified execution evidence ↗</Link>
      </div>
      <InheritanceMetrics
        executedAt={executedAt}
        beneficiaryCount={beneficiaryCount}
        tokenCount={assets.assets.length}
        distributedTokens={distributedTokens}
      />
    </section>
  );
}

function InheritanceMetrics(props: {
  executedAt: number;
  beneficiaryCount: number;
  tokenCount: number;
  distributedTokens: number;
}) {
  return (
    <dl className="inheritance-metrics">
      <OutcomeMetric
        label="Executed"
        value={formatTimestamp(props.executedAt)}
      />
      <OutcomeMetric
        label="Beneficiaries"
        value={String(props.beneficiaryCount)}
      />
      <OutcomeMetric
        label="Token distributions"
        value={tokenProgress(props.tokenCount, props.distributedTokens)}
        warning={props.distributedTokens < props.tokenCount}
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
