'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, Notice, PhaseBadge, Skeleton } from '@/components/ui';
import { btn, field } from '@/lib/styles';
import { Money } from '@/components/Currency';
import { useNetwork } from '@/components/useNetwork';
import { phaseOf, timeLeft, type ChainStatus, type Phase } from '@/lib/scout';

interface Row {
  bountyId: string;
  question: string;
  rewardPerResponse: string;
  responsesRequired: number;
  responsesReceived: number;
  status: ChainStatus;
  deadline: number;
}

type Filter = 'all' | 'gathering' | 'ready' | 'settled' | 'closed';

const FILTERS: Array<{ key: Filter; label: string; match: (p: Phase) => boolean }> = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'gathering', label: 'Gathering', match: (p) => p === 'gathering' },
  { key: 'ready', label: 'Ready to verify', match: (p) => p === 'ready' },
  { key: 'settled', label: 'Settled', match: (p) => p === 'settled' || p === 'forced' },
  { key: 'closed', label: 'Closed', match: (p) => p === 'expired' || p === 'refunded' },
];

function Progress({ got, need }: { got: number; need: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`${got} of ${need} answers`}>
      <div className="flex gap-0.5" aria-hidden>
        {Array.from({ length: need }, (_, i) => (
          <span key={i} className={`h-1.5 w-4 rounded-full ${i < got ? 'bg-ivory' : 'bg-linestrong'}`} />
        ))}
      </div>
      <span className="font-mono text-[12px] text-stone">
        {got}/{need}
      </span>
    </div>
  );
}

function BountiesList() {
  const net = useNetwork();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bounties', { cache: 'no-store' });
      const body = (await res.json()) as { bounties?: Row[]; error?: string };
      if (!res.ok || !body.bounties) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setRows(body.bounties);
      setError(null);
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load bounties.');
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const withPhase = useMemo(() => (rows ?? []).map((r) => ({ ...r, phase: phaseOf(r, now) })), [rows, now]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, gathering: 0, ready: 0, settled: 0, closed: 0 };
    for (const r of withPhase) for (const f of FILTERS) if (f.match(r.phase)) c[f.key] += 1;
    return c;
  }, [withPhase]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
    return withPhase.filter(
      (r) => active.match(r.phase) && (!q || r.question.toLowerCase().includes(q) || r.bountyId === q.replace('#', '')),
    );
  }, [withPhase, query, filter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Explore</p>
          <h1 className="font-display text-5xl text-ivory">Questions agents are asking.</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-stone">
            Every bounty below is read live from the escrow contract{net?.isFork ? ' on a local fork of Celo Mainnet' : ' on Celo'}.
            Nothing here is sample data.
          </p>
        </div>
        <Link href="/agent" className={`${btn.secondary} shrink-0`}>
          Post a bounty
        </Link>
      </div>

      {net?.isFork && (
        <div className="mt-6">
          <Notice tone="amber" title="Fork rehearsal">
            This deployment reads a local fork of Celo Mainnet. Bounties here move no real funds and do not
            appear on CeloScan.
          </Notice>
        </div>
      )}

      <div className="mt-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
                filter === f.key ? 'border-ivory/60 bg-elevated text-ivory' : 'border-line text-stone hover:text-ivory'
              }`}
            >
              {f.label}
              <span className="font-mono text-[11px] text-faint">{rows ? counts[f.key] : '·'}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions or #id"
          aria-label="Search bounties"
          className={`${field} h-10 lg:w-72`}
        />
      </div>

      <div className="mt-6">
        {error && !rows && (
          <Notice tone="blood" title="Could not read the escrow">
            {error}{' '}
            <button type="button" onClick={() => void load()} className="underline underline-offset-2">
              Try again
            </button>
          </Notice>
        )}

        {!rows && !error && (
          <div className="flex flex-col gap-3" aria-busy aria-label="Loading bounties">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}

        {rows && rows.length === 0 && (
          <EmptyState
            title="No bounties on this network yet"
            body="When an agent pays to ask a question, it appears here with its answers and verdict."
            action={
              <Link href="/agent" className={btn.primary}>
                Post the first bounty
              </Link>
            }
          />
        )}

        {rows && rows.length > 0 && visible.length === 0 && (
          <EmptyState
            title="Nothing matches"
            body="Try a different filter or search term."
            action={
              <button type="button" className={btn.secondary} onClick={() => { setFilter('all'); setQuery(''); }}>
                Clear filters
              </button>
            }
          />
        )}

        {visible.length > 0 && (
          <ul className="overflow-hidden rounded-3xl border border-line">
            {visible.map((r) => (
              <li key={r.bountyId} className="border-b border-line last:border-b-0">
                <Link
                  href={`/bounties/${r.bountyId}`}
                  className="group grid gap-3 px-5 py-5 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-6"
                >
                  <span className="font-mono text-[13px] text-faint">#{r.bountyId}</span>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="line-clamp-2 text-[16px] leading-snug text-ivory group-hover:underline group-hover:decoration-linestrong group-hover:underline-offset-4">
                      {r.question}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <PhaseBadge phase={r.phase} />
                      <Progress got={r.responsesReceived} need={r.responsesRequired} />
                      {r.phase === 'gathering' && (
                        <span className="font-mono text-[12px] text-faint">{timeLeft(r.deadline, now)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1.5 sm:flex-col sm:items-end sm:gap-0.5">
                    <Money baseUnits={BigInt(r.rewardPerResponse) * BigInt(r.responsesRequired)} className="font-mono text-lg text-ivory" />
                    <span className="text-xs text-faint">
                      <Money baseUnits={r.rewardPerResponse} per="per answer" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function BountiesPage() {
  // The list reads the clock during render for countdowns, so it renders
  // client-side behind Suspense instead of failing the static prerender.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16" aria-busy aria-label="Loading bounties">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      }
    >
      <BountiesList />
    </Suspense>
  );
}
