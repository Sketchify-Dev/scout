'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { isAddress } from 'viem';
import { useScoutAuth } from '@/components/auth/ScoutAuth';
import { ChainRef, Eyebrow, Notice, Skeleton } from '@/components/ui';
import { btn, field } from '@/lib/styles';
import { Money } from '@/components/Currency';
import { useNetwork } from '@/components/useNetwork';

interface Balances {
  celoWei: string;
  usdcBaseUnits: string;
}

/**
 * The person's own money: copy the address, export the key into another
 * wallet, or send USDC to anyone from the embedded wallet.
 */
function WalletHome({ address }: { address: string }) {
  const auth = useScoutAuth();
  const net = useNetwork();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [securing, setSecuring] = useState(false);
  const [secureMsg, setSecureMsg] = useState<string | null>(null);
  const [secureTone, setSecureTone] = useState<'jade' | 'blood'>('jade');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/balance?address=${address}`, { cache: 'no-store' });
      const body = (await res.json()) as Balances & { error?: string };
      if (res.ok && body.celoWei !== undefined) {
        setBalances({ celoWei: body.celoWei, usdcBaseUnits: body.usdcBaseUnits ?? '0' });
      }
    } catch {
      // Balances are nice-to-have; the send flow reports its own errors.
    }
  }, [address]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const send = async () => {
    if (!isAddress(to)) {
      setError('That destination is not a valid Celo address.');
      setState('error');
      return;
    }
    const usdc = Number(amount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setError('Enter an amount above zero.');
      setState('error');
      return;
    }
    setState('sending');
    setError(null);
    try {
      const baseUnits = BigInt(Math.round(usdc * 1e6));
      const r = await auth.sendUsdc(to as `0x${string}`, baseUnits);
      setHash(r.hash);
      setState('done');
      setTo('');
      setAmount('');
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Send failed.';
      setError(/rejected|denied|cancel/i.test(msg) ? 'You cancelled the transaction. Nothing was sent.' : msg);
      setState('error');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <Eyebrow className="mb-2">Your wallet</Eyebrow>
        <p className="font-mono text-sm break-all text-ivory">{address}</p>
        {balances && BigInt(balances.celoWei) === BigInt(0) && (
          <Notice tone="amber" title="Needs a little CELO for fees">
            Each transaction costs under $0.01. Send a small amount of CELO to the address above, for example
            from MiniPay or an exchange, then refresh.
          </Notice>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold text-ivory">Send USDC</h2>
          <p className="mt-1 text-sm leading-relaxed text-stone">
            Your wallet signs directly. Scout only relays; it never holds your keys or your money.
          </p>
        </div>
        {state === 'done' && hash ? (
          <div className="flex flex-col gap-3" role="status">
            <Notice tone="jade" title="Sent">
              Your USDC is on its way. <ChainRef value={hash} kind="tx" net={net} />
            </Notice>
            <button type="button" onClick={() => setState('idle')} className={btn.secondary}>
              Send again
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm text-stone">To address</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
                className={`${field} h-12 font-mono text-sm`}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm text-stone">Amount (USDC)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.05"
                inputMode="decimal"
                className={`${field} h-12 font-mono`}
              />
            </label>
            {error && (
              <Notice tone="blood" title="Not sent">
                {error}
              </Notice>
            )}
            <button type="submit" disabled={state === 'sending' || !to || !amount} className={`${btn.primary} h-12`}>
              {state === 'sending' ? 'Sending...' : 'Send USDC'}
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold text-ivory">Protect this wallet</h2>
          <p className="mt-1 text-sm leading-relaxed text-stone">
            Two optional layers, both in Privy windows where Scout never sees your secrets.
          </p>
        </div>
        <ul className="flex flex-col gap-3 text-sm leading-relaxed text-stone">
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="text-ivory">Wallet password.</span> Locks the encrypted backup of
              this wallet, so a stolen login alone cannot restore it on another device.
            </span>
          </li>
          <li className="flex items-start justify-between gap-3">
            <span>
              <span className="text-ivory">Two-step sign-in.</span>{' '}
              {auth.mfaMethods.length > 0
                ? `On (${auth.mfaMethods.join(', ')}).`
                : 'Off. Every sign-in on a new device asks for a second code.'}
            </span>
          </li>
        </ul>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setSecuring(true);
              setSecureMsg(null);
              void auth.setWalletPassword().then(() => {
                setSecureTone('jade');
                setSecureMsg('Wallet password set. Keep it somewhere safe.');
              }).catch((e: unknown) => {
                setSecureTone('blood');
                setSecureMsg(e instanceof Error ? e.message : 'Could not set the password.');
              }).finally(() => setSecuring(false));
            }}
            disabled={securing}
            className={`${btn.secondary} h-12`}
          >
            {securing ? 'Opening...' : 'Set wallet password'}
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                auth.enrollMfa();
              } catch (e) {
                setSecureTone('blood');
                setSecureMsg(e instanceof Error ? e.message : 'Could not open enrollment.');
              }
            }}
            className={`${btn.secondary} h-12`}
          >
            {auth.mfaMethods.length > 0 ? 'Manage two-step sign-in' : 'Turn on two-step sign-in'}
          </button>
        </div>
        {secureMsg && (
          <p className={`text-sm ${secureTone === 'jade' ? 'text-jade' : 'text-blood'}`}>{secureMsg}</p>
        )}
        <p className="text-xs leading-relaxed text-faint">
          No password or code you enter here ever reaches Scout. If you lose both the login and the
          recovery password, the wallet cannot be recovered, so back up the secret too.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold text-ivory">Take your wallet with you</h2>
          <p className="mt-1 text-sm leading-relaxed text-stone">
            Back up your secret now: anyone holding it controls this wallet. Never share it, never paste
            it into a site you did not mean to trust.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-obsidian px-3.5 py-3">
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-ivory" title={address}>{address}</span>
          <button
            type="button"
            onClick={() => {
              setCopiedAddr(true);
              setTimeout(() => setCopiedAddr(false), 1400);
              void navigator.clipboard?.writeText(address);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-linestrong px-3 py-1.5 text-sm font-medium text-ivory transition-colors hover:border-ivory/50"
          >
            {copiedAddr ? 'Copied' : 'Copy'}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="text-stone">
              <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9.5 4.5v-2a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 2.5v5A1.5 1.5 0 0 0 3 9h1.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setExporting(true);
              setExportError(null);
              void auth.exportWallet().catch((e: unknown) => {
                setExportError(e instanceof Error ? e.message : 'Export failed.');
              }).finally(() => setExporting(false));
            }}
            disabled={exporting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-citron font-semibold text-white transition-colors hover:bg-citronhover disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.8 6.8L13.5 13.5M11 13.5h2.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {exporting ? 'Opening...' : 'Copy key'}
          </button>
          <button
            type="button"
            onClick={() => {
              setExporting(true);
              setExportError(null);
              void auth.exportWallet().catch((e: unknown) => {
                setExportError(e instanceof Error ? e.message : 'Export failed.');
              }).finally(() => setExporting(false));
            }}
            disabled={exporting}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-citron font-semibold text-white transition-colors hover:bg-citronhover disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 4.5h12M2 8h12M2 11.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {exporting ? 'Opening...' : 'Copy phrase'}
          </button>
        </div>
        {exportError && <p className="text-sm text-blood">{exportError}</p>}
        <p className="text-center text-xs text-faint">Backed up securely · Powered by Privy</p>
      </section>
    </div>
  );
}

export function WalletClient() {
  const auth = useScoutAuth();
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Wallet</p>
        <h1 className="font-display text-5xl leading-[1.02] text-ivory">Your money, your keys.</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-stone">
          Payouts land here. Copy the address to receive, send USDC anywhere, or export the wallet into an
          app you already use.
        </p>
      </header>
      <div className="mt-10">
        {!auth.enabled ? (
          <Notice tone="amber" title="Sign-in is not configured">
            This deployment has no Privy app id, so wallets are unavailable yet.
          </Notice>
        ) : !auth.ready ? (
          <Skeleton className="h-40" />
        ) : !auth.authenticated || !auth.address ? (
          <section className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-6">
            <p className="text-[15px] leading-relaxed text-stone">
              Sign in first. A Celo wallet is created for you automatically.
            </p>
            <Link href="/login?next=%2Fwallet" className={btn.primary}>
              Sign in
            </Link>
          </section>
        ) : (
          <WalletHome address={auth.address} />
        )}
      </div>
    </div>
  );
}
