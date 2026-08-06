"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { SEPOLIA_CHAIN_ID } from "@/lib/onboarding-draft";

export function WalletEntryButton({
  className = "landing-primary",
}: {
  className?: string;
}) {
  const account = useAccount();
  const router = useRouter();
  const { connectAsync, connectors, isPending } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [error, setError] = useState("");

  const switchToSepolia = async (): Promise<void> => {
    setError("");
    try {
      if (!account.isConnected) {
        const connector = connectors[0];
        if (!connector) throw new Error("No browser wallet was detected.");
        await connectAsync({ connector, chainId: SEPOLIA_CHAIN_ID });
        return;
      }
      await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Network switch failed.",
      );
    }
  };

  const enter = async (): Promise<void> => {
    setError("");
    try {
      if (!account.isConnected) {
        const connector = connectors[0];
        if (!connector) throw new Error("No browser wallet was detected.");
        await connectAsync({ connector });
      }
      router.push("/dashboard");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet connection failed.",
      );
    }
  };

  return (
    <div className="wallet-entry">
      {account.chainId !== SEPOLIA_CHAIN_ID && (
        <button
          className="network-switch-button"
          type="button"
          onClick={switchToSepolia}
          disabled={isPending || isSwitching}
          aria-label="Switch wallet network to Sepolia"
        >
          {isSwitching ? "Switching…" : "Sepolia"}
        </button>
      )}
      <button
        className={className}
        type="button"
        onClick={enter}
        disabled={isPending || isSwitching}
      >
        {entryLabel(account.isConnected, isPending)}
      </button>
      {error && <p className="wallet-entry-error">{error}</p>}
    </div>
  );
}

function entryLabel(connected: boolean, pending: boolean): string {
  if (pending) return "Connecting…";
  return connected ? "Open dashboard" : "Connect wallet";
}
