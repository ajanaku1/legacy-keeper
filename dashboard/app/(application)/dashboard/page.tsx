"use client";

import Link from "next/link";
import { PageHeader } from "@/components/application/PageHeader";
import { HeartbeatPanel } from "@/components/HeartbeatPanel";
import { AutomaticInheritanceTrigger } from "@/components/AutomaticInheritanceTrigger";
import { InheritanceOutcome } from "@/components/InheritanceOutcome";
import { PlanNotice } from "@/components/application/PlanNotice";
import { useApplication } from "@/components/shell/ApplicationShell";
import { TrackedAssets } from "@/components/TrackedAssets";
import { formatCountdown, shortAddress } from "@/lib/format";
import { PRODUCT_POSITIONING } from "@/lib/product-positioning";
import { useTrackedAssets } from "@/lib/useTrackedAssets";

export default function DashboardPage() {
  const app = useApplication();
  const { keeper, resolution } = app;
  const resolved = resolution.status === "resolved";
  const plan = resolved ? resolution.plan : undefined;
  const assets = useTrackedAssets(plan, keeper.owner, keeper.trackedTokens);

  return (
    <>
      <PageHeader
        eyebrow={PRODUCT_POSITIONING.category}
        title={resolved ? "Your continuity plan" : "Nothing is armed yet."}
        description="Monitors wallet liveness, coordinates KeeperHub execution, and retains every verified outcome as evidence."
        status={
          <span className={`status-chip ${resolved ? "verified" : ""}`}>
            {resolved ? "● Plan loaded" : "○ Draft"}
          </span>
        }
      />
      <PlanNotice />
      <AutomaticInheritanceTrigger
        trigger={{
          owner: keeper.owner as `0x${string}` | undefined,
          plan,
          graceElapsed: keeper.graceElapsed,
          settled: keeper.inheritanceExecuted || keeper.evacuationExecuted,
        }}
        onSettled={keeper.refetch}
      />
      {keeper.inheritanceExecuted ? (
        <InheritanceOutcome
          executedAt={keeper.inheritanceTimestamp}
          beneficiaryCount={keeper.beneficiaries.length}
          assets={assets}
        />
      ) : (
        <HeartbeatPanel
          state={{
            connected: app.connected,
            chainId: app.chainId,
            ownerAddress: app.address,
            plan,
            planOwner: keeper.owner,
            livenessActive: keeper.livenessActive,
            inheritanceExecuted: keeper.inheritanceExecuted,
            evacuationExecuted: keeper.evacuationExecuted,
            graceElapsed: keeper.graceElapsed,
            secondsUntilDue: keeper.secondsUntilDue,
            lastHeartbeat: keeper.lastHeartbeat,
            heartbeatInterval: keeper.heartbeatInterval,
          }}
          onVerified={keeper.refetch}
        />
      )}
      <PlanReadiness keeper={keeper} resolution={resolution} />
      <TrackedAssets
        state={assets}
        inheritanceExecuted={keeper.inheritanceExecuted}
      />
      <DashboardActions />
    </>
  );
}

function PlanReadiness({
  keeper,
  resolution,
}: {
  keeper: ReturnType<typeof useApplication>["keeper"];
  resolution: ReturnType<typeof useApplication>["resolution"];
}) {
  const resolved = resolution.status === "resolved";
  return (
    <section
      className="ledger-card dashboard-readiness"
      aria-labelledby="readiness-title"
    >
      <header className="ledger-head">
        <h2 id="readiness-title">Plan readiness</h2>
        <span>
          {resolved ? shortAddress(resolution.plan, 8, 6) : "No plan address"}
        </span>
      </header>
      <div className="metric-row">
        <div>
          <span>Plan state</span>
          <strong>{planState(keeper, resolved)}</strong>
        </div>
        <div>
          <span>Recovery eligibility</span>
          <strong>{recoveryEligibility(keeper, resolved)}</strong>
        </div>
        <div>
          <span>Beneficiary total</span>
          <strong>{keeper.totalShareBps / 100}%</strong>
        </div>
      </div>
      <div
        className="register-table"
        role="table"
        aria-label="Plan requirement register"
      >
        <RegisterRow
          label="Owner and network"
          evidence="Factory owner mapping"
          ready={resolved}
        />
        <RegisterRow
          label="Beneficiaries"
          evidence="Shares total 10,000 bps"
          ready={keeper.totalShareBps === 10_000}
        />
        <RegisterRow
          label="Recovery authority"
          evidence="Signer and safe vault"
          ready={keeper.recoveryKeyRegistered}
        />
        <RegisterRow
          label="Tracked assets"
          evidence="Allowance or permit state"
          ready={keeper.trackedTokens.length > 0}
          optional
        />
      </div>
    </section>
  );
}

function DashboardActions() {
  return (
    <section className="dashboard-grid dashboard-links">
      <article className="card link-card dashboard-link-register">
        <span className="section-label">Plan controls</span>
        <h2>Manage by job, not by scroll position.</h2>
        <Link href="/beneficiaries">
          Review beneficiaries <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/recovery">
          Check recovery readiness <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/activity">
          Open retained evidence <span aria-hidden="true">↗</span>
        </Link>
      </article>
      <article className="card policy-note">
        <span className="section-label">Execution policy</span>
        <h2>KeeperHub is the only product-write route.</h2>
        <p>
          Acceptance stays provisional until settlement, receipt, expected
          event, target plan, and resulting state all agree.
        </p>
      </article>
    </section>
  );
}

interface RegisterRowProps {
  label: string;
  evidence: string;
  ready: boolean;
  optional?: boolean;
}

function RegisterRow(props: RegisterRowProps) {
  const status = registerStatus(props);
  return (
    <div className="register-row" role="row">
      <span role="cell">{props.label}</span>
      <span role="cell">{props.evidence}</span>
      <strong className={props.ready ? "verified" : ""} role="cell">
        {props.ready ? "● " : "○ "}
        {status}
      </strong>
    </div>
  );
}

function registerStatus(props: RegisterRowProps): string {
  if (props.ready) return "Ready";
  return props.optional ? "Optional" : "Missing";
}

function planState(
  keeper: ReturnType<typeof useApplication>["keeper"],
  resolved: boolean,
): string {
  if (!resolved) return "Configuration required";
  if (keeper.evacuationExecuted) return "Assets evacuated";
  if (keeper.inheritanceExecuted) return "Estate distributed";
  if (!keeper.livenessActive) return "Plan paused";
  return keeper.loading ? "Reading chain state" : "Protected";
}

function recoveryEligibility(
  keeper: ReturnType<typeof useApplication>["keeper"],
  resolved: boolean,
): string {
  if (!resolved) return "Not set";
  if (keeper.inheritanceExecuted) return "Executed";
  if (keeper.evacuationExecuted) return "Closed";
  return formatCountdown(keeper.secondsUntilDue);
}
