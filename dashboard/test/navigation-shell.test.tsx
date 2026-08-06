import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  NAV_ITEMS,
  readCollapsedPreference,
  writeCollapsedPreference,
  type PreferenceStorage,
} from "../components/shell/Sidebar";

function memoryStorage(initial?: string): PreferenceStorage {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
}

describe("application navigation shell", () => {
  it("mounts every page beneath one shared application layout", () => {
    const applicationRoot = new URL("../app/(application)/", import.meta.url);
    expect(existsSync(new URL("layout.tsx", applicationRoot))).toBe(true);
    for (const { href } of NAV_ITEMS) {
      expect(existsSync(new URL(`.${href}/page.tsx`, applicationRoot))).toBe(
        true,
      );
    }
  });

  it("links every menu item to a real application route", () => {
    expect(NAV_ITEMS.map(({ href }) => href)).toEqual([
      "/dashboard",
      "/beneficiaries",
      "/activity",
      "/recovery",
      "/settings",
    ]);
    expect(NAV_ITEMS.every(({ href }) => !href.startsWith("#"))).toBe(true);
  });

  it("starts expanded when no preference exists", () => {
    expect(readCollapsedPreference(memoryStorage())).toBe(false);
  });

  it("restores and updates the collapsed preference", () => {
    const storage = memoryStorage("true");

    expect(readCollapsedPreference(storage)).toBe(true);
    writeCollapsedPreference(storage, false);
    expect(readCollapsedPreference(storage)).toBe(false);
  });

  it("keeps navigation usable when browser storage is unavailable", () => {
    const unavailable: PreferenceStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(readCollapsedPreference(unavailable)).toBe(false);
    expect(() => writeCollapsedPreference(unavailable, true)).not.toThrow();
  });

  it("exposes the menu and mobile drawer state to assistive technology", () => {
    const source = readFileSync(
      new URL("../components/shell/Sidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("aria-expanded");
    expect(source).toContain("aria-controls");
    expect(source).toContain("aria-modal");
    expect(source).toMatch(/aria-label=.*menu/i);
    expect(source).toContain("drawer");
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain("window.localStorage");
    expect(source).not.toMatch(/(?<!\.)\blocalStorage\b/);
  });

  it("offers an accessible disconnect action for a connected wallet", () => {
    const source = readFileSync(
      new URL("../components/shell/ApplicationShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("useDisconnect");
    expect(source).toMatch(/Disconnect wallet/i);
    expect(source).toContain("aria-expanded");
    expect(source).toContain('aria-haspopup="menu"');
  });

  it("places Telegram access immediately after the connected wallet control", () => {
    const source = readFileSync(
      new URL("../components/shell/ApplicationShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<TelegramAccessLink variant="icon" />');
    expect(source.indexOf("<ConnectedWalletMenu")).toBeLessThan(
      source.indexOf('<TelegramAccessLink variant="icon" />'),
    );
  });

  it("offers a compact Sepolia switch immediately before wallet connection", () => {
    const source = readFileSync(
      new URL("../components/wallet/WalletEntryButton.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("useSwitchChain");
    expect(source.indexOf("network-switch-button")).toBeLessThan(
      source.indexOf("entryLabel(account.isConnected"),
    );
    expect(source).toContain('aria-label="Switch wallet network to Sepolia"');
  });

  it("shows the real wallet network and never hardcodes a false Sepolia status", () => {
    const source = readFileSync(
      new URL("../components/shell/ApplicationShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("header.chainId");
    expect(source).toContain("header.onSwitchNetwork");
    expect(source).toContain("Switch to Sepolia");
    expect(source).not.toContain(
      '<span className="network-dot">Sepolia</span>',
    );
  });

  it("styles collapsed desktop and temporary mobile navigation without motion traps", () => {
    const css = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(/\.sidebar\[data-collapsed=["']true["']\]/);
    expect(css).toContain(".drawer-open");
    expect(css).toContain(".mobile-menu-button");
    expect(css).toContain("@media (hover: hover)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/transition:\s*all/i);
    expect(css).not.toContain(["scale", "(0)"].join(""));
  });

  it("keeps the navigation fixed while only application content scrolls", () => {
    const css = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
    const shell = css.match(/\.app-shell\s*\{([^}]*)\}/)?.[1] ?? "";
    const sidebar = css.match(/\.sidebar\s*\{([^}]*)\}/)?.[1] ?? "";
    const main = css.match(/\.main\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(shell).toMatch(/height:\s*100dvh/);
    expect(shell).toMatch(/overflow:\s*hidden/);
    expect(sidebar).toMatch(/overflow:\s*hidden/);
    expect(main).toMatch(/overflow-y:\s*auto/);
  });
});
