"use client";

import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { OnboardingController } from "@/components/onboarding/OnboardingController";
import { TelegramAccessLink } from "@/components/telegram/TelegramAccessLink";
import { WalletAccessGate } from "@/components/wallet/WalletAccessGate";
import { SEPOLIA_CHAIN_ID } from "@/lib/onboarding-draft";
import { shortAddress } from "@/lib/format";
import { useKeeper, type KeeperState } from "@/lib/useKeeper";
import { usePlanResolver } from "@/lib/usePlanResolver";
import { type PlanResolution } from "@/lib/plan-resolver";
import { Sidebar } from "./Sidebar";

interface ApplicationState {
  address?: `0x${string}`;
  connected: boolean;
  chainId?: number;
  resolution: PlanResolution;
  keeper: KeeperState;
  connectWallet: () => void;
  switchToSepolia: () => void;
}

const ApplicationContext = createContext<ApplicationState | null>(null);

export function useApplication(): ApplicationState {
  const value = useContext(ApplicationContext);
  if (!value)
    throw new Error("useApplication must be used inside ApplicationShell");
  return value;
}

export function ApplicationShell({ children }: { children: ReactNode }) {
  const account = useAccount();

  if (account.status === "reconnecting") {
    return <WalletAccessGate restoring />;
  }
  if (!account.isConnected) {
    return <WalletAccessGate restoring={false} />;
  }
  return <ConnectedApplicationShell>{children}</ConnectedApplicationShell>;
}

function ConnectedApplicationShell({ children }: { children: ReactNode }) {
  const shell = useShellController();

  return (
    <ApplicationContext.Provider value={shell.state}>
      <div className="app-shell">
        <AppHeader header={shell.header} />
        <Sidebar drawer={shell.drawer} />
        <main className="main" id="main-content">
          {children}
        </main>
        <OnboardingController />
      </div>
    </ApplicationContext.Provider>
  );
}

function useShellController() {
  const account = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const resolution = usePlanResolver(account.address);
  const planAddress =
    resolution.status === "resolved" ? resolution.plan : undefined;
  const keeper = useKeeper(planAddress);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const connectWallet = useCallback((): void => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  }, [connect, connectors]);
  const closeDrawer = useCallback((): void => setDrawerOpen(false), []);
  const openDrawer = useCallback((): void => setDrawerOpen(true), []);
  const switchToSepolia = useCallback(
    (): void => switchChain({ chainId: SEPOLIA_CHAIN_ID }),
    [switchChain],
  );

  const state = useMemo<ApplicationState>(
    () => ({
      address: account.address,
      connected: account.isConnected,
      chainId: account.chainId,
      resolution,
      keeper,
      connectWallet,
      switchToSepolia,
    }),
    [
      account.address,
      account.chainId,
      account.isConnected,
      connectWallet,
      keeper,
      resolution,
      switchToSepolia,
    ],
  );

  return {
    state,
    header: {
      address: account.address,
      connected: account.isConnected,
      chainId: account.chainId,
      drawerOpen,
      menuButtonRef,
      onConnect: connectWallet,
      onDisconnect: disconnect,
      onSwitchNetwork: switchToSepolia,
      onOpenMenu: openDrawer,
    },
    drawer: { open: drawerOpen, close: closeDrawer, triggerRef: menuButtonRef },
  };
}

interface HeaderProps {
  address?: string;
  connected: boolean;
  chainId?: number;
  drawerOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchNetwork: () => void;
  onOpenMenu: () => void;
}

function AppHeader({ header }: { header: HeaderProps }) {
  return (
    <header className="topbar">
      <button
        className="mobile-menu-button"
        aria-label="Open menu"
        aria-controls="primary-navigation"
        aria-expanded={header.drawerOpen}
        onClick={header.onOpenMenu}
        ref={header.menuButtonRef}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <Link
        className="brand"
        href="/dashboard"
        aria-label="LegacyKeeper dashboard"
      >
        <Image
          src="/legacykeeper-mark.svg"
          alt=""
          width={36}
          height={36}
          priority
        />
        <strong>LegacyKeeper</strong>
      </Link>
      <div className="account">
        <NetworkControl
          chainId={header.chainId}
          onSwitch={header.onSwitchNetwork}
        />
        {header.connected ? (
          <>
            <ConnectedWalletMenu
              address={header.address}
              onDisconnect={header.onDisconnect}
            />
            <TelegramAccessLink variant="icon" />
          </>
        ) : (
          <button className="connect-button" onClick={header.onConnect}>
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}

function NetworkControl({
  chainId,
  onSwitch,
}: {
  chainId?: number;
  onSwitch: () => void;
}) {
  const supported = chainId === SEPOLIA_CHAIN_ID;
  return (
    <button
      className="network-control"
      type="button"
      data-supported={supported}
      disabled={supported}
      onClick={onSwitch}
      aria-label={supported ? "Connected to Sepolia" : "Switch to Sepolia"}
    >
      <span aria-hidden="true" />
      {supported ? "Sepolia" : networkLabel(chainId)}
    </button>
  );
}

function networkLabel(chainId?: number): string {
  if (!chainId) return "Switch to Sepolia";
  if (chainId === 1) return "Ethereum · switch";
  return `Chain ${chainId} · switch`;
}

function ConnectedWalletMenu({
  address,
  onDisconnect,
}: {
  address?: string;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback((): void => setOpen(false), []);
  useDismissableMenu(menuRef, open, closeMenu);
  const label = shortAddress(address, 4, 3);

  return (
    <div className="account-menu-wrap" ref={menuRef}>
      <button
        className="avatar account-trigger"
        type="button"
        aria-label={`Wallet account ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onDisconnect();
            }}
          >
            Disconnect wallet
          </button>
        </div>
      )}
    </div>
  );
}

function useDismissableMenu(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const dismissPointer = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const dismissKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", dismissPointer);
    document.addEventListener("keydown", dismissKey);
    return () => {
      document.removeEventListener("pointerdown", dismissPointer);
      document.removeEventListener("keydown", dismissKey);
    };
  }, [close, open, ref]);
}
