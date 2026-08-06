"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddressEqual, type Address } from "viem";
import {
  useAccount,
  useConnect,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { prepareHeartbeatMessage } from "@/lib/heartbeat-client";
import { shortAddress } from "@/lib/format";

interface RecoveryEntry {
  owner: Address;
  plan: Address;
  chainId: number;
  safeVault: Address;
  recoveryKey: Address;
  recoveryKeyRegistered: boolean;
  evacuationExecuted: boolean;
}

type EntryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entry: RecoveryEntry };

export function TelegramRecoveryClient() {
  const token = useSearchParams().get("entry") ?? "";
  const [state, setState] = useState<EntryState>({ status: "loading" });
  useEffect(() => {
    void loadEntry(token).then(setState);
  }, [token]);

  return (
    <main className="telegram-recovery-page" id="main-content">
      <header className="telegram-recovery-header">
        <Link href="/" className="brand">
          <Image src="/legacykeeper-mark.svg" alt="" width={36} height={36} />
          <strong>LegacyKeeper</strong>
        </Link>
        <span className="telegram-secure-entry">Telegram secure entry</span>
      </header>
      {state.status === "loading" && <RecoveryLoading />}
      {state.status === "error" && <RecoveryError message={state.message} />}
      {state.status === "ready" && (
        <RecoveryAuthorization entry={state.entry} />
      )}
    </main>
  );
}

function RecoveryAuthorization({ entry }: { entry: RecoveryEntry }) {
  const account = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const [status, setStatus] = useState(
    "Awaiting the registered recovery wallet.",
  );
  const [busy, setBusy] = useState(false);
  const correctSigner =
    account.address && isAddressEqual(account.address, entry.recoveryKey);

  async function authorize(): Promise<void> {
    if (!correctSigner || entry.evacuationExecuted) return;
    setBusy(true);
    try {
      if (account.chainId !== entry.chainId) {
        await switchChainAsync({ chainId: entry.chainId });
      }
      const message = prepareHeartbeatMessage(
        crypto.getRandomValues(new Uint8Array(32)),
        Math.floor(Date.now() / 1_000),
      );
      const signature = await signTypedDataAsync(
        evacuationTypedData(entry, message),
      );
      setStatus("KeeperHub accepted the signed request. Verifying settlement…");
      const response = await fetch("/api/evacuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainId: entry.chainId,
          owner: entry.owner,
          plan: entry.plan,
          nonce: message.nonce.toString(),
          deadline: message.deadline.toString(),
          signature,
        }),
      });
      const result = (await response.json()) as Record<string, unknown>;
      if (!response.ok || result.stage !== "verified") {
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Evacuation could not be verified.",
        );
      }
      setStatus(
        `Evacuation verified · KeeperHub execution ${String(result.executionId)}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Evacuation failed.");
    } finally {
      setBusy(false);
    }
  }

  const connector = connectors[0];
  return (
    <section
      className="telegram-recovery-shell"
      aria-labelledby="recovery-entry-title"
    >
      <div className="telegram-recovery-intro">
        <span className="section-label">Recovery authorization</span>
        <h1 id="recovery-entry-title">
          Telegram opened the door. Your recovery wallet holds the key.
        </h1>
        <p>
          Review the verified on-chain destination, then sign once with the
          separately registered recovery wallet. Telegram cannot authorize this
          action.
        </p>
      </div>
      <dl className="telegram-recovery-register">
        <RecoveryValue
          label="Owner plan"
          value={shortAddress(entry.plan, 8, 6)}
        />
        <RecoveryValue
          label="Safe vault"
          value={shortAddress(entry.safeVault, 8, 6)}
        />
        <RecoveryValue
          label="Required signer"
          value={shortAddress(entry.recoveryKey, 8, 6)}
        />
        <RecoveryValue label="Network" value="Sepolia" />
      </dl>
      <div className="telegram-recovery-action">
        {!account.isConnected ? (
          <button
            type="button"
            className="landing-primary"
            disabled={!connector}
            onClick={() => connector && connect({ connector })}
          >
            Connect recovery wallet
          </button>
        ) : (
          <button
            type="button"
            className="danger-button"
            disabled={!correctSigner || busy || entry.evacuationExecuted}
            onClick={() => void authorize()}
          >
            {busy ? "Verifying through KeeperHub" : "Sign emergency evacuation"}
          </button>
        )}
        <p role="status" aria-live="polite">
          {entry.evacuationExecuted
            ? "This plan has already evacuated."
            : account.isConnected && !correctSigner
              ? `Connected ${shortAddress(account.address, 6, 4)} · switch to the registered recovery wallet.`
              : status}
        </p>
      </div>
    </section>
  );
}

function RecoveryValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RecoveryLoading() {
  return (
    <section className="telegram-recovery-state" aria-live="polite">
      <span className="section-label">Verifying entry</span>
      <h1>Reading the wallet link and on-chain recovery policy…</h1>
    </section>
  );
}

function RecoveryError({ message }: { message: string }) {
  return (
    <section className="telegram-recovery-state">
      <span className="section-label">Entry unavailable</span>
      <h1>This recovery link cannot be used.</h1>
      <p>{message}</p>
      <Link href="/" className="secondary">
        Return to LegacyKeeper
      </Link>
    </section>
  );
}

async function loadEntry(token: string): Promise<EntryState> {
  if (!token)
    return { status: "error", message: "The Telegram entry token is missing." };
  try {
    const response = await fetch(
      `/api/telegram/evacuation-entry?entry=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return {
        status: "error",
        message:
          typeof body.message === "string"
            ? body.message
            : "Recovery entry expired.",
      };
    }
    return { status: "ready", entry: body as unknown as RecoveryEntry };
  } catch {
    return { status: "error", message: "Could not verify the recovery entry." };
  }
}

function evacuationTypedData(
  entry: RecoveryEntry,
  message: { nonce: bigint; deadline: bigint },
) {
  return {
    domain: {
      name: "LegacyKeeper",
      version: "1",
      chainId: entry.chainId,
      verifyingContract: entry.plan,
    },
    types: {
      Evacuate: [
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Evacuate" as const,
    message,
  } as const;
}
