"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { shortAddress } from "@/lib/format";
import type {
  TrackedAssetBalance,
  TrackedAssetState,
} from "@/lib/useTrackedAssets";

interface Props {
  state: TrackedAssetState;
  inheritanceExecuted: boolean;
}

export function TrackedAssets({ state, inheritanceExecuted }: Props) {
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
      <AssetBalanceTable state={state} inherited={inheritanceExecuted} />
      <EmptyAssetNote visible={state.assets.length === 0} />
    </section>
  );
}

function AssetBalanceTable(props: {
  state: TrackedAssetState;
  inherited: boolean;
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
}: {
  asset: TrackedAssetBalance;
  loading: boolean;
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
    </div>
  );
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
