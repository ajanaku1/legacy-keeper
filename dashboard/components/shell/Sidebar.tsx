'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';

const COLLAPSED_KEY = 'legacykeeper:sidebar-collapsed';

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: '⌂' },
  { label: 'Beneficiaries', href: '/beneficiaries', icon: '◎' },
  { label: 'Activity', href: '/activity', icon: '↗' },
  { label: 'Recovery', href: '/recovery', icon: '◇' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
] as const;

export function readCollapsedPreference(storage: PreferenceStorage): boolean {
  try {
    return storage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeCollapsedPreference(
  storage: PreferenceStorage,
  collapsed: boolean
): void {
  try {
    storage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // The navigation still works when privacy settings block persistence.
  }
}

interface DrawerState {
  open: boolean;
  close: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

interface SidebarProps {
  drawer: DrawerState;
}

export function Sidebar({ drawer }: SidebarProps) {
  const pathname = usePathname();
  const { close, open, triggerRef } = drawer;
  const { collapsed, toggleCollapsed } = useCollapsedNavigation();

  useEffect(() => close(), [close, pathname]);
  useDrawerKeyboard(drawer);

  return (
    <>
      <DrawerScrim open={open} close={close} />
      <aside
        className={`sidebar ${open ? 'drawer-open' : ''}`}
        data-collapsed={collapsed}
        id="primary-navigation"
        aria-label="Application menu"
        aria-modal={open ? true : undefined}
        role={open ? 'dialog' : undefined}
      >
        <p className="nav-label">Continuity plan</p>
        <NavigationLinks collapsed={collapsed} pathname={pathname} />
        <SidebarFooter
          collapsed={collapsed}
          toggleCollapsed={toggleCollapsed}
        />
      </aside>
    </>
  );
}

function useCollapsedNavigation() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(
    () => setCollapsed(readCollapsedPreference(window.localStorage)),
    []
  );

  function toggleCollapsed(): void {
    setCollapsed((current) => {
      const next = !current;
      writeCollapsedPreference(window.localStorage, next);
      return next;
    });
  }
  return { collapsed, toggleCollapsed };
}

function useDrawerKeyboard(drawer: DrawerState): void {
  const { close, open, triggerRef } = drawer;
  useEffect(() => {
    if (!open) return;
    function handleDrawerKeys(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      } else if (event.key === 'Tab') {
        keepFocusInsideDrawer(event);
      }
    }
    document.addEventListener('keydown', handleDrawerKeys);
    document.querySelector<HTMLAnchorElement>('#primary-navigation a')?.focus();
    return () => document.removeEventListener('keydown', handleDrawerKeys);
  }, [close, open, triggerRef]);
}

function DrawerScrim({ open, close }: { open: boolean; close: () => void }) {
  if (!open) return null;
  return (
    <button className="drawer-scrim" aria-label="Close menu" onClick={close} />
  );
}

function NavigationLinks({
  collapsed,
  pathname,
}: {
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {NAV_ITEMS.map((item) => (
        <Link
          href={item.href}
          aria-current={pathname === item.href ? 'page' : undefined}
          aria-label={collapsed ? item.label : undefined}
          key={item.href}
        >
          <span className="nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="nav-word">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function SidebarFooter({
  collapsed,
  toggleCollapsed,
}: {
  collapsed: boolean;
  toggleCollapsed: () => void;
}) {
  return (
    <div className="sidebar-foot">
      <p>
        <span aria-hidden="true">●</span> KeeperHub configured
      </p>
      <button
        className="collapse-button"
        aria-expanded={!collapsed}
        aria-controls="primary-navigation"
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        onClick={toggleCollapsed}
      >
        <span className="nav-icon" aria-hidden="true">
          {collapsed ? '»' : '«'}
        </span>
        <span className="nav-word">Collapse menu</span>
      </button>
    </div>
  );
}

function keepFocusInsideDrawer(event: KeyboardEvent): void {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('#primary-navigation a')
  );
  const first = links[0];
  const last = links.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
