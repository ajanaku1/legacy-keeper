"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useSignTypedData } from "wagmi";
import { useApplication } from "@/components/shell/ApplicationShell";
import {
  accessTelegramLink,
  activateTelegramLink,
  createTelegramLinkSession,
  readTelegramLinkSession,
  restoreTelegramLink,
  sendTelegramTest,
  TelegramClientError,
  unlinkTelegramLink,
  type TelegramDetectedSession,
  type TelegramLinkedWallet,
  type TelegramLinkSessionClient,
} from "@/lib/telegram-client";
import {
  telegramActionTypedData,
  telegramLinkTypedData,
  telegramUnlinkTypedData,
  telegramWalletAccessTypedData,
} from "@/lib/telegram-typed-data";
import { shortAddress } from "@/lib/format";
import { TelegramIcon } from "./TelegramAccessLink";

const SEPOLIA = 11_155_111;
const SIGNING_WINDOW_SECONDS = 300;
type PanelState =
  | { kind: "restoring" }
  | { kind: "restore-error" }
  | { kind: "not-connected" }
  | { kind: "waiting-telegram"; session: TelegramLinkSessionClient }
  | {
      kind: "waiting-signature";
      session: TelegramLinkSessionClient;
      detected: TelegramDetectedSession & { telegramUserId: string };
    }
  | {
      kind: "connected";
      link: TelegramLinkedWallet;
      activeCount: number;
      limit: number;
      lastDelivery?: {
        eventType: string;
        deliveredAt?: string;
      };
    };

export function TelegramLinkPanel() {
  const app = useApplication();
  const { signTypedDataAsync } = useSignTypedData();
  const [state, setState] = useState<PanelState>({ kind: "restoring" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [restoreVersion, setRestoreVersion] = useState(0);

  useEffect(() => {
    if (!app.address || !app.chainId) return;
    let current = true;
    setState({ kind: "restoring" });
    setError("");
    void restoreTelegramLink(app.address, app.chainId)
      .then((result) => {
        if (current) setState({ kind: "connected", ...result });
      })
      .catch((caught: unknown) => {
        if (!current) return;
        if (caught instanceof TelegramClientError && caught.status === 401) {
          setState({ kind: "not-connected" });
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Telegram status is unavailable.",
        );
        setState({ kind: "restore-error" });
      });
    return () => {
      current = false;
    };
  }, [app.address, app.chainId, restoreVersion]);

  useTelegramDetection(state, setState, setError);
  if (!app.address) return null;

  const context = { owner: app.address, chainId: app.chainId ?? 0 };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Telegram request failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const actions = createPanelActions({
    context,
    state,
    setState,
    setNotice,
    signTypedDataAsync,
    run,
    retryRestore: () => setRestoreVersion((version) => version + 1),
  });

  return (
    <section
      className="telegram-link-panel"
      id="telegram-notifications"
      aria-labelledby="telegram-title"
    >
      <TelegramPanelHeader state={state} />
      <TelegramPanelBody
        view={{
          state,
          busy,
          supported: context.chainId === SEPOLIA,
          switchNetwork: app.switchToSepolia,
        }}
        actions={actions}
      />
      {(notice || error) && (
        <p
          className={`telegram-panel-notice ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
        </p>
      )}
    </section>
  );
}

interface ActionContext {
  owner: Address;
  chainId: number;
}

interface PanelActions {
  connect: () => void;
  signLink: () => void;
  manage: () => void;
  test: () => void;
  unlink: () => void;
  reset: () => void;
  retryRestore: () => void;
}

interface CreateActionsInput {
  context: ActionContext;
  state: PanelState;
  setState: (state: PanelState) => void;
  setNotice: (notice: string) => void;
  signTypedDataAsync: ReturnType<typeof useSignTypedData>["signTypedDataAsync"];
  run: (operation: () => Promise<void>) => Promise<void>;
  retryRestore: () => void;
}

function createPanelActions(input: CreateActionsInput): PanelActions {
  const authMessage = () => ({ ...input.context, ...freshAuthorization() });
  return {
    connect: () => connectTelegram(input),
    signLink: () => signTelegramLink(input),
    manage: () => manageTelegramLink(input, authMessage),
    test: () => runTest(input, authMessage),
    unlink: () => runUnlink(input, authMessage),
    reset: () => input.setState({ kind: "not-connected" }),
    retryRestore: input.retryRestore,
  };
}

function connectTelegram(input: CreateActionsInput): void {
  void input.run(async () => {
    assertSepolia(input.context.chainId);
    const session = await createTelegramLinkSession(
      input.context.owner,
      input.context.chainId,
    );
    window.open(session.telegramUrl, "_blank", "noopener,noreferrer");
    input.setState({ kind: "waiting-telegram", session });
  });
}

function signTelegramLink(input: CreateActionsInput): void {
  void input.run(async () => {
    if (input.state.kind !== "waiting-signature") return;
    const signature = await input.signTypedDataAsync(
      telegramLinkTypedData(input.state.detected),
    );
    const result = await activateTelegramLink(input.state.detected, signature);
    input.setState({ kind: "connected", ...result });
    input.setNotice("Telegram alerts are now linked to this wallet.");
  });
}

type AuthorizationMessage = ReturnType<typeof freshAuthorization> &
  ActionContext;

function manageTelegramLink(
  input: CreateActionsInput,
  authMessage: () => AuthorizationMessage,
): void {
  void input.run(async () => {
    assertSepolia(input.context.chainId);
    const message = authMessage();
    const signature = await input.signTypedDataAsync(
      telegramWalletAccessTypedData(message),
    );
    const result = await accessTelegramLink({ ...message, signature });
    input.setState({ kind: "connected", ...result });
  });
}

function runTest(
  input: CreateActionsInput,
  authMessage: () => AuthorizationMessage,
) {
  void input.run(async () => {
    if (input.state.kind !== "connected") return;
    const message = {
      ...authMessage(),
      action: "test" as const,
      linkId: input.state.link.id,
    };
    const signature = await input.signTypedDataAsync(
      telegramActionTypedData(message),
    );
    const result = await sendTelegramTest({ ...message, signature });
    if (!result.ok) throw new Error("Telegram did not confirm test delivery.");
    input.setNotice("Test alert delivered to your linked Telegram account.");
  });
}

function runUnlink(
  input: CreateActionsInput,
  authMessage: () => AuthorizationMessage,
) {
  void input.run(async () => {
    if (input.state.kind !== "connected") return;
    const message = { ...authMessage(), linkId: input.state.link.id };
    const signature = await input.signTypedDataAsync(
      telegramUnlinkTypedData(message),
    );
    await unlinkTelegramLink({ ...message, signature });
    input.setState({ kind: "not-connected" });
    input.setNotice("Telegram monitoring has been unlinked from this wallet.");
  });
}

function useTelegramDetection(
  state: PanelState,
  setState: (state: PanelState) => void,
  setError: (error: string) => void,
) {
  const detect = useCallback(async () => {
    if (state.kind !== "waiting-telegram") return;
    const current = await readTelegramLinkSession(
      state.session.sessionId,
      state.session.browserToken,
    );
    if (current.state === "detected" && current.telegramUserId) {
      setState({
        kind: "waiting-signature",
        session: state.session,
        detected: { ...current, telegramUserId: current.telegramUserId },
      });
    }
  }, [setState, state]);

  useEffect(() => {
    if (state.kind !== "waiting-telegram") return;
    const timer = window.setInterval(() => {
      void detect().catch((caught: unknown) => {
        setError(
          caught instanceof Error ? caught.message : "Link session expired.",
        );
        setState({ kind: "not-connected" });
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [detect, setError, state.kind]);
}

function TelegramPanelHeader({ state }: { state: PanelState }) {
  const connected = state.kind === "connected";
  return (
    <header className="telegram-panel-head">
      <span className="telegram-panel-icon" aria-hidden="true">
        <TelegramIcon />
      </span>
      <div>
        <span className="section-label">Notification channel</span>
        <h2 id="telegram-title">Telegram alerts</h2>
        <p>Wallet-scoped status, transaction, and recovery notifications.</p>
      </div>
      <span
        className={`telegram-panel-state ${connected ? "is-connected" : ""}`}
      >
        <i aria-hidden="true" /> {connected ? "Connected" : "Not connected"}
      </span>
    </header>
  );
}

interface TelegramPanelView {
  state: PanelState;
  busy: boolean;
  supported: boolean;
  switchNetwork: () => void;
}

function TelegramPanelBody({
  view,
  actions,
}: {
  view: TelegramPanelView;
  actions: PanelActions;
}) {
  if (!view.supported) {
    return (
      <div className="telegram-panel-body">
        <TelegramCopy
          title="Sepolia required"
          body="Switch networks before linking or managing Telegram."
        />
        <button className="primary" type="button" onClick={view.switchNetwork}>
          Switch to Sepolia
        </button>
      </div>
    );
  }
  if (view.state.kind === "restoring") {
    return (
      <div className="telegram-panel-body">
        <TelegramCopy
          title="Restoring Telegram connection"
          body="Checking this browser session for the verified wallet link."
        />
      </div>
    );
  }
  if (view.state.kind === "restore-error") {
    return (
      <div className="telegram-panel-body">
        <TelegramCopy
          title="Telegram status unavailable"
          body="The secure session could not be checked. Your existing Telegram link has not been changed."
        />
        <button
          className="secondary"
          type="button"
          disabled={view.busy}
          onClick={actions.retryRestore}
        >
          Retry status
        </button>
      </div>
    );
  }
  if (view.state.kind === "waiting-telegram") {
    return <WaitingForTelegram busy={view.busy} actions={actions} />;
  }
  if (view.state.kind === "waiting-signature") {
    return (
      <WaitingForSignature
        state={view.state}
        busy={view.busy}
        actions={actions}
      />
    );
  }
  if (view.state.kind === "connected") {
    return (
      <ConnectedTelegram
        state={view.state}
        busy={view.busy}
        actions={actions}
      />
    );
  }
  return <NotConnected busy={view.busy} actions={actions} />;
}

function NotConnected({
  busy,
  actions,
}: {
  busy: boolean;
  actions: PanelActions;
}) {
  return (
    <div className="telegram-panel-body">
      <TelegramCopy
        title="Link a private Telegram chat"
        body="The bot detects your Telegram identity; your wallet signature proves plan ownership. No bot key can authorize a transaction."
      />
      <div className="telegram-panel-actions">
        <button
          className="telegram-primary"
          type="button"
          disabled={busy}
          onClick={actions.connect}
        >
          <TelegramIcon /> Connect Telegram
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={actions.manage}
        >
          Manage existing link
        </button>
      </div>
      <span className="telegram-capacity">
        2-wallet free limit · no payment enabled
      </span>
    </div>
  );
}

function WaitingForTelegram({
  busy,
  actions,
}: {
  busy: boolean;
  actions: PanelActions;
}) {
  return (
    <div className="telegram-panel-body">
      <TelegramCopy
        title="Waiting for Telegram"
        body="In the opened private chat, press Start. This browser will detect the identity without exposing your chat ID."
      />
      <span className="telegram-waiting">
        <i aria-hidden="true" /> Checking secure link…
      </span>
      <button
        className="secondary"
        type="button"
        disabled={busy}
        onClick={actions.reset}
      >
        Cancel
      </button>
    </div>
  );
}

function WaitingForSignature({
  state,
  busy,
  actions,
}: {
  state: Extract<PanelState, { kind: "waiting-signature" }>;
  busy: boolean;
  actions: PanelActions;
}) {
  return (
    <div className="telegram-panel-body">
      <TelegramCopy
        title="Telegram identity detected"
        body={`User ${state.detected.telegramUserId} is ready. Sign the typed message to bind only this wallet and registered plan.`}
      />
      <button
        className="primary"
        type="button"
        disabled={busy}
        onClick={actions.signLink}
      >
        {busy ? "Waiting for signature…" : "Verify wallet ownership"}
      </button>
    </div>
  );
}

function ConnectedTelegram({
  state,
  busy,
  actions,
}: {
  state: Extract<PanelState, { kind: "connected" }>;
  busy: boolean;
  actions: PanelActions;
}) {
  return (
    <div className="telegram-connected">
      <dl>
        <div>
          <dt>Telegram user</dt>
          <dd>{state.link.telegramUserId}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{shortAddress(state.link.owner, 8, 6)}</dd>
        </div>
        <div>
          <dt>Monitoring capacity</dt>
          <dd>
            {state.activeCount} / {state.limit} wallets
          </dd>
        </div>
        <div>
          <dt>Last successful alert</dt>
          <dd>{lastDeliveryLabel(state.lastDelivery)}</dd>
        </div>
      </dl>
      <div className="telegram-panel-actions">
        <button
          className="telegram-test-button"
          type="button"
          disabled={busy}
          onClick={actions.test}
        >
          Send test alert
        </button>
        <button
          className="telegram-unlink-button"
          type="button"
          aria-label="Unlink Telegram"
          disabled={busy}
          onClick={actions.unlink}
        >
          <UnlinkIcon />
        </button>
      </div>
    </div>
  );
}

function UnlinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8.6 8.6 6.8 6.8" />
      <path d="m7.1 13.4-1.4 1.4a3.5 3.5 0 0 0 5 5l2.1-2.1" />
      <path d="m16.9 10.6 1.4-1.4a3.5 3.5 0 0 0-5-5l-2.1 2.1" />
      <path d="M4 4 20 20" />
    </svg>
  );
}

function TelegramCopy({ title, body }: { title: string; body: string }) {
  return (
    <div className="telegram-panel-copy">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function lastDeliveryLabel(
  delivery: Extract<PanelState, { kind: "connected" }>["lastDelivery"],
): string {
  if (!delivery) return "No delivery yet";
  if (!delivery.deliveredAt) return delivery.eventType;
  return `${delivery.eventType} · ${new Date(delivery.deliveredAt).toLocaleDateString()}`;
}

function freshAuthorization() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const deadline = String(
    Math.floor(Date.now() / 1_000) + SIGNING_WINDOW_SECONDS,
  );
  return { nonce, deadline };
}

function assertSepolia(chainId: number): void {
  if (chainId !== SEPOLIA)
    throw new Error("Switch to Sepolia before continuing.");
}
