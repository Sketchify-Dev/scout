'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useScoutAuth } from '@/components/auth/ScoutAuth';
import { CurrencySwitch } from '@/components/CurrencySwitch';
import { LogoLockup } from '@/components/Logo';
import { ThemeToggle, useTheme } from '@/components/Theme';
import { CopyButton } from '@/components/ui';
import { Money } from '@/components/Currency';
import { useNetwork } from '@/components/useNetwork';
import { shortAddr } from '@/lib/scout';

const NAV = [
  { href: '/bounties', label: 'Explore' },
  { href: '/contribute', label: 'Contribute' },
  { href: '/agent', label: 'For agents' },
];

function NetworkPill() {
  const net = useNetwork();
  if (!net) return null;
  return (
    <span
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] sm:inline-flex ${
        net.isFork ? 'border-amber/40 text-amber' : 'border-line text-stone'
      }`}
      title={net.isFork ? 'Local fork of Celo Mainnet. Nothing here moves real funds.' : `Escrow ${net.escrow}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${net.isFork ? 'bg-amber' : 'bg-jade'}`} aria-hidden />
      {net.label}
    </span>
  );
}

/**
 * Live USDC balance in the header, so the money is visible without a
 * scroll. Refreshes once a minute and on focus; the full wallet page
 * stays one click away. Mobile keeps the header uncluttered and shows
 * the same figure inside the account menu instead.
 */
function useUsdcBalance(address: string | null) {
  const [baseUnits, setBaseUnits] = useState<string | null>(null);
  useEffect(() => {
    if (!address) {
      setBaseUnits(null);
      return;
    }
    let stop = false;
    const load = () => {
      void fetch(`/api/balance?address=${address}`, { cache: 'no-store' })
        .then((r) => r.json() as Promise<{ usdcBaseUnits?: string }>)
        .then((b) => {
          if (!stop && b.usdcBaseUnits !== undefined) setBaseUnits(b.usdcBaseUnits);
        })
        .catch(() => {
          // Balance is a convenience; the wallet page reports real errors.
        });
    };
    load();
    const timer = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [address]);
  return baseUnits;
}

function HeaderBalance({ address }: { address: string | null }) {
  const baseUnits = useUsdcBalance(address);
  return (
    <Link
      href="/wallet"
      title="Your USDC balance. Open the wallet to send."
      className="hidden h-9 items-center rounded-full border border-line bg-surface px-3 font-mono text-[12px] text-ivory transition-colors hover:border-linestrong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory sm:inline-flex"
    >
      {baseUnits === null ? <span className="text-faint">···</span> : <Money baseUnits={baseUnits} />}
    </Link>
  );
}

function AccountBalance({ address }: { address: string | null }) {
  const baseUnits = useUsdcBalance(address);
  if (baseUnits === null) return <span className="text-faint">···</span>;
  return <Money baseUnits={baseUnits} />;
}

function Account() {
  const auth = useScoutAuth();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open ]);
  if (!auth.enabled) return null;
  if (!auth.ready) return <span className="h-9 w-20 animate-pulse rounded-full bg-elevated" aria-hidden />;
  if (!auth.authenticated) {
    return (
      <Link
        href="/login"
        className="inline-flex h-9 items-center rounded-full bg-ivory px-4 text-sm font-semibold text-obsidian transition-colors hover:bg-citron hover:text-obsidian focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory"
      >
        Sign in
      </Link>
    );
  }
  const onExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await auth.exportWallet();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-2 rounded-full border border-linestrong px-3 font-mono text-[12px] text-ivory transition-colors hover:border-ivory/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory"
      >
        <span className="h-2 w-2 rounded-full bg-jade" aria-hidden />
        {auth.address ? shortAddr(auth.address) : 'Creating wallet...'}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-72 rounded-2xl border border-line bg-surface p-3 shadow-[0_12px_40px_rgba(16,20,15,0.14)]"
        >
          {auth.identity && <p className="truncate px-2 text-sm text-ivory">{auth.identity}</p>}
          {auth.address && (
            <p className="flex items-center gap-1 px-2 pt-0.5 font-mono text-[11px] text-faint">
              <span className="min-w-0 flex-1 truncate" title={auth.address}>{auth.address}</span>
              <CopyButton value={auth.address} />
            </p>
          )}
          <div className="my-2 flex items-center justify-between px-2 text-sm sm:hidden">
            <span className="text-faint">Balance</span>
            <span className="font-mono text-ivory">
              <AccountBalance address={auth.address} />
            </span>
          </div>
          <div className="my-2 h-px bg-line" />
          <Link
            href="/contribute"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2 py-2 text-sm text-stone hover:bg-elevated hover:text-ivory"
          >
            My answers
          </Link>
          <Link
            href="/wallet"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2 py-2 text-sm text-stone hover:bg-elevated hover:text-ivory"
          >
            Wallet · send
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void onExport()}
            disabled={exporting || !auth.address}
            className="block w-full rounded-lg px-2 py-2 text-left text-sm text-stone hover:bg-elevated hover:text-ivory disabled:opacity-50"
          >
            {exporting ? 'Opening export...' : 'Export wallet'}
          </button>
          {exportError && <p className="px-2 pt-1 text-xs text-blood">{exportError}</p>}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void auth.logout();
            }}
            className="block w-full rounded-lg px-2 py-2 text-left text-sm text-stone hover:bg-elevated hover:text-ivory"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  return (
    <Suspense>
      <HeaderInner />
    </Suspense>
  );
}

function HeaderInner() {
  const path = usePathname();
  const auth = useScoutAuth();
  const address = auth.authenticated ? auth.address : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-obsidian/85 backdrop-blur-md supports-[backdrop-filter]:bg-obsidian/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ivory" aria-label="Scout home">
          <HeaderLockup />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ivory ${
                  active ? 'bg-elevated text-ivory' : 'text-stone hover:text-ivory'
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <HeaderBalance address={address} />
          <ThemeToggle />
          <CurrencySwitch />
          <NetworkPill />
          <Account />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 md:hidden" aria-label="Main">
        {NAV.map((n) => {
          const active = path === n.href || path.startsWith(`${n.href}/`);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${active ? 'bg-elevated text-ivory' : 'text-stone'}`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function HeaderLockup() {
  const { theme } = useTheme();
  return <LogoLockup height={48} variant={theme === 'dark' ? 'dark' : 'light'} />;
}

function FooterLockup() {
  const { theme } = useTheme();
  return <LogoLockup height={48} variant={theme === 'dark' ? 'dark' : 'light'} />;
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="flex flex-col gap-3">
          <FooterLockup />
          <p className="max-w-xs text-sm leading-relaxed text-faint">
            Human-grounded answers for AI agents. Escrowed in USDC, verified by consensus, settled on Celo.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-[11px] text-faint sm:items-end">
          <span>Agents on Open Rails · Celo track</span>
          <span>ERC-8021 builder code celo_0107eaa60597</span>
          <span>x402 payments · ERC-8004 identity</span>
        </div>
      </div>
    </footer>
  );
}
