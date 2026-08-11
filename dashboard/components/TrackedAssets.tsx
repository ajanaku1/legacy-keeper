"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { useApplication } from "@/components/shell/ApplicationShell";
import { shortAddress } from "@/lib/format";
import { tokenNeedsApproval } from "@/lib/token-approval";
import type {
  TrackedAssetBalance,
  TrackedAssetState,
} from "@/lib/useTrackedAssets";

interface Props {
  state: TrackedAssetState;
  inheritanceExecuted: boolean;
}

export function TrackedAssets({ state, inheritanceExecuted }: Props) {
  const app = useApplication();
  const plan =
    app.resolution.status === "resolved" ? app.resolution.plan : undefined;
  return (
    <section
      className="ledger-card tracked-assets"
      aria-labelledby="assets-title"
    >
      <header className="ledger-head">
        <h2 id="assets-title">Tracked assets</h2>
        <span>{state.assets.length} ERC-20 tracked</span>
      </header>
      <p className="asset-explainer">
        ERC-20s stay in the owner wallet. Available balance is the amount the
        plan can pull under the current allowance.
      </p>
      <AssetBalanceTable
        state={state}
        inherited={inheritanceExecuted}
        plan={plan}
      />
      <EmptyAssetNote visible={state.assets.length === 0} />
    </section>
  );
}

function AssetBalanceTable(props: {
  state: TrackedAssetState;
  inherited: boolean;
  plan?: Address;
}) {
  return (
    <div
      className="asset-balance-table"
      role="table"
      aria-label="Tracked asset balances"
    >
      <AssetTableHead />
      <NativeAssetRow
        balance={props.state.planBalance}
        inherited={props.inherited}
        loading={props.state.loading}
      />
      {props.state.assets.map((asset) => (
        <TokenAssetRow
          asset={asset}
          loading={props.state.loading}
          approval={{ plan: props.plan, refetch: props.state.refetch }}
          key={asset.address}
        />
      ))}
    </div>
  );
}

function EmptyAssetNote({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <p className="asset-empty">
      No ERC-20 tokens are tracked. Native ETH held by the plan is still
      covered. <Link href="/settings">Add tokens in Settings ↗</Link>
    </p>
  );
}

function AssetTableHead() {
  return (
    <div className="asset-balance-row asset-balance-head" role="row">
      <span role="columnheader">Asset</span>
      <span role="columnheader">Owner balance</span>
      <span role="columnheader">Available to inherit</span>
      <span role="columnheader">State</span>
      <span role="columnheader">Action</span>
    </div>
  );
}

function NativeAssetRow(props: {
  balance: bigint;
  inherited: boolean;
  loading: boolean;
}) {
  const state = nativeState(props.balance, props.inherited);
  return (
    <div className="asset-balance-row" role="row">
      <AssetIdentity symbol="ETH" detail="Native · plan custody" />
      <span className="asset-value" role="cell">
        <small>Owner balance</small>—
      </span>
      <strong className="asset-value" role="cell">
        <small>Available to inherit</small>
        {amount(props.balance, 18, "ETH", props.loading)}
      </strong>
      <AssetState
        label={state}
        verified={props.inherited || props.balance > 0n}
      />
      <span role="cell" aria-label="No action available" />
    </div>
  );
}

function nativeState(balance: bigint, inherited: boolean): string {
  if (inherited) return "Distributed";
  return balance > 0n ? "Ready" : "Empty";
}

function TokenAssetRow({
  asset,
  loading,
  approval,
}: {
  asset: TrackedAssetBalance;
  loading: boolean;
  approval: { plan?: Address; refetch: () => Promise<void> };
}) {
  const state = tokenState(asset);
  return (
    <div className="asset-balance-row" role="row">
      <AssetIdentity
        symbol={asset.symbol}
        detail={shortAddress(asset.address, 7, 5)}
      />
      <span className="asset-value" role="cell">
        <small>Owner balance</small>
        {amount(asset.ownerBalance, asset.decimals, asset.symbol, loading)}
      </span>
      <strong className="asset-value" role="cell">
        <small>Available to inherit</small>
        {availableAmount(asset, loading)}
      </strong>
      <AssetState
        label={state}
        verified={state === "Ready" || state === "Distributed"}
      />
      <div className="asset-approval" role="cell">
        <TokenApprovalButton
          asset={asset}
          plan={approval.plan}
          refetch={approval.refetch}
        />
      </div>
    </div>
  );
}

function TokenApprovalButton({
  asset,
  plan,
  refetch,
}: {
  asset: TrackedAssetBalance;
  plan?: Address;
  refetch: () => Promise<void>;
}) {
  const approval = useTokenApproval({ asset, plan, refetch });
  if (!approval.visible) return null;
  return (
    <>
      <button
        type="button"
        className="secondary compact"
        disabled={approval.pending}
        onClick={approval.approve}
      >
        {approval.pending ? "Confirming approval…" : "Approve current balance"}
      </button>
      {approval.status && <small role="status">{approval.status}</small>}
    </>
  );
}

interface ApprovalContext {
  asset: TrackedAssetBalance;
  plan?: Address;
  refetch: () => Promise<void>;
}

function useTokenApproval({ asset, plan, refetch }: ApprovalContext) {
  const app = useApplication();
  const publicClient = usePublicClient({ chainId: 11155111 });
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const ownerConnected =
    app.address?.toLowerCase() === app.keeper.owner?.toLowerCase();
  const visible = Boolean(
    plan &&
      ownerConnected &&
      !app.keeper.evacuationExecuted &&
      tokenNeedsApproval(asset),
  );

  async function approve() {
    if (!plan) return;
    if (app.chainId !== 11155111) {
      app.switchToSepolia();
      return;
    }
    if (!publicClient) {
      setStatus("Sepolia is unavailable. Try again in a moment.");
      return;
    }
    setPending(true);
    setStatus("");
    try {
      const hash = await writeContractAsync({
        address: asset.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [plan, asset.ownerBalance],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      await refetch();
      setStatus("Approval confirmed on Sepolia.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Token approval failed.",
      );
    } finally {
      setPending(false);
    }
  }

  return { visible, pending, status, approve };
}

function AssetIdentity({ symbol, detail }: { symbol: string; detail: string }) {
  return (
    <span className="asset-identity" role="cell">
      <strong>{symbol}</strong>
      <small>{detail}</small>
    </span>
  );
}

function AssetState({ label, verified }: { label: string; verified: boolean }) {
  return (
    <strong
      className={verified ? "verified" : "asset-state-warning"}
      role="cell"
    >
      {verified ? "● " : "○ "}
      {label}
    </strong>
  );
}

function tokenState(asset: TrackedAssetBalance): string {
  if (asset.distributed) return "Distributed";
  if (asset.availableBalance > 0n) return "Ready";
  if (asset.ownerBalance > 0n) return "Allowance needed";
  return "Empty";
}

function availableAmount(asset: TrackedAssetBalance, loading: boolean): string {
  if (asset.distributed) return "Finalized";
  return amount(asset.availableBalance, asset.decimals, asset.symbol, loading);
}

function amount(
  value: bigint,
  decimals: number,
  symbol: string,
  loading: boolean,
): string {
  if (loading) return "Reading…";
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const visibleFraction = fraction.slice(0, 4).replace(/0+$/, "");
  const formattedWhole = BigInt(whole).toLocaleString("en-US");
  return `${formattedWhole}${visibleFraction ? `.${visibleFraction}` : ""} ${symbol}`;
}
