'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { ChainRef, Dl, EmptyState, Eyebrow, Notice, PhaseBadge, Skeleton } from '@/components/ui';
import { btn } from '@/lib/styles';
import { Money } from '@/components/Currency';
import { useNetwork } from '@/components/useNetwork';
import { VerdictTheater, type TheaterVerdict } from '@/components/VerdictTheater';
import { phaseOf, shortAddr, timeLeft, type ChainStatus, type Phase } from '@/lib/scout';

interface Detail {
  bountyId: string;
  question: string;
  requester: string;
  rewardPerResponse: string;
  responsesRequired: number;
  responsesReceived: number;
  status: ChainStatus;
  deadline: number;
  createdTx: string | null;
  answers: Array<{ responseIndex: number; responder: string; answer: string; txHash: string }>;
  settlement: {
    txHash: string;
    confidenceBps: number;
    paidCount: number;
    refunded: string;
    forced: boolean;
    paid: Array<{ responder: string; amount: string }>;
    deferred: Array<{ recipient: string; amount: string }>;
  } | null;
}

interface SettleResponse {
  settled: boolean;
  reason?: string;
  summary?: string;
  verdictSource?: string;
  error?: string;
}

const STEPS: Array<{ key: string; label: string }> = [
  { key: 'posted', label: 'Posted and funded' },
  { key: 'answering', label: 'Humans answer' },
  { key: 'verify', label: 'Verifier judges' },
  { key: 'paid', label: 'Paid on-chain' },
];

function stepIndex(phase: Phase): number {
  if (phase === 'gathering') return 1;
  if (phase === 'ready' || phase === 'expired') return 2;
  return 4;
}

function Timeline({ phase, got, need }: { phase: Phase; got: number; need: number }) {
  const current = stepIndex(phase);
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4" aria-label="Bounty lifecycle">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.key} className="flex flex-col gap-1.5 bg-obsidian px-4 py-3.5" aria-current={active ? 'step' : undefined}>
            <span
              className={`flex items-center gap-2 font-mono text-[11px] ${
                done ? 'text-jade' : active ? 'text-citron' : 'text-faint'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${done ? 'bg-jade' : active ? 'animate-pulse bg-citron' : 'bg-linestrong'}`}
                aria-hidden
              />
              {done ? 'done' : active ? 'now' : 'next'}
            </span>
            <span className={`text-sm ${done || active ? 'text-ivory' : 'text-faint'}`}>
              {s.key === 'answering' ? `${s.label} · ${got}/${need}` : s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Reads the URL at click time, so server and client render identical markup. */
function ShareLink() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="rounded px-1 font-mono text-[11px] text-faint transition-colors hover:text-ivory"
    >
      {done ? 'link copied' : 'copy link'}
    </button>
  );
}

export function BountyView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const net = useNetwork();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleNote, setSettleNote] = useState<SettleResponse | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bounties/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      const body = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
      setDetail(body);
      setError(null);
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this bounty.');
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const phase = detail ? phaseOf({ ...detail, forced: detail.settlement?.forced }, now) : null;

  const verdict = useMemo<TheaterVerdict | null>(() => {
    if (!detail?.settlement) return null;
    const s = detail.settlement;
    return {
      paid: new Set([...s.paid.map((p) => p.responder.toLowerCase()), ...s.deferred.map((d) => d.recipient.toLowerCase())]),
      confidenceBps: s.confidenceBps,
      forced: s.forced,
      settleTxHash: s.txHash,
      summary: settleNote?.summary,
      source: settleNote?.verdictSource,
    };
  }, [detail, settleNote]);

  const runVerifier = async () => {
    setSettling(true);
    setSettleNote(null);
    try {
      const res = await fetch(`/api/bounty/${encodeURIComponent(id)}/settle`, { method: 'POST' });
      const body = (await res.json()) as SettleResponse;
      if (!res.ok) throw new Error(body.error ?? `Verifier failed (${res.status}).`);
      setSettleNote(body);
      await load();
    } catch (e) {
      setSettleNote({ settled: false, error: e instanceof Error ? e.message : 'Verifier failed.' });
    } finally {
      setSettling(false);
    }
  };

  if (missing) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <EmptyState
          title={`Bounty #${id} does not exist`}
          body="It may not have been posted yet on this network, or the id is wrong."
          action={
            <Link href="/bounties" className={btn.secondary}>
              Back to all bounties
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/bounties" className="text-sm text-stone hover:text-ivory">
        <span aria-hidden>←</span> All bounties
      </Link>

      {error && !detail && (
        <div className="mt-8">
          <Notice tone="blood" title="Could not read this bounty">
            {error}{' '}
            <button type="button" onClick={() => void load()} className="underline underline-offset-2">
              Try again
            </button>
          </Notice>
        </div>
      )}

      {!detail && !error && (
        <div className="mt-8 flex flex-col gap-4" aria-busy aria-label="Loading bounty">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-64" />
        </div>
      )}

      {detail && phase && (
        <div className="mt-8 flex flex-col gap-10">
          <header className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-faint">Bounty #{detail.bountyId}</span>
              <PhaseBadge phase={phase} />
              {net?.isFork && (
                <span className="rounded-full border border-amber/40 px-2.5 py-0.5 font-mono text-[11px] text-amber">fork rehearsal</span>
              )}
            </div>
            <h1 className="max-w-4xl font-display text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] text-ivory">
              {detail.question}
            </h1>
          </header>

          <Timeline phase={phase} got={detail.responsesReceived} need={detail.responsesRequired} />

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="flex min-w-0 flex-col gap-8">
              {detail.answers.length > 0 ? (
                <VerdictTheater
                  answers={detail.answers}
                  verdict={verdict}
                  rewardPerResponse={detail.rewardPerResponse}
                  net={net}
                />
              ) : (
                <EmptyState
                  title="No answers yet"
                  body={
                    phase === 'gathering'
                      ? 'Contributors have not answered. Share the link with someone who can see this, or answer it yourself.'
                      : 'Nobody answered before the deadline. The escrowed reward can be refunded to the requester.'
                  }
                  action={
                    phase === 'gathering' ? (
                      <Link href={`/contribute?bounty=${detail.bountyId}`} className={btn.primary}>
                        Answer this bounty
                      </Link>
                    ) : undefined
                  }
                />
              )}

              {settleNote && !settleNote.settled && (
                <Notice tone={settleNote.error ? 'blood' : 'amber'} title={settleNote.error ? 'Verifier failed' : 'Not settled'}>
                  {settleNote.error ?? settleNote.reason ?? 'The verifier could not reach a consensus.'}
                </Notice>
              )}

              {detail.settlement && (
                <section className="flex flex-col gap-4">
                  <Eyebrow>Payouts</Eyebrow>
                  <ul className="overflow-hidden rounded-2xl border border-line">
                    {detail.settlement.paid.map((p) => (
                      <li key={p.responder} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
                        <ChainRef value={p.responder} kind="address" net={net} />
                        <Money baseUnits={p.amount} per="USDC" className="font-mono text-sm text-jade" />
                      </li>
                    ))}
                    {detail.settlement.deferred.map((d) => (
                      <li key={d.recipient} className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
                        <ChainRef value={d.recipient} kind="address" net={net} />
                        <span className="font-mono text-sm text-amber" title="Transfer failed; credited to claim() instead">
                          <Money baseUnits={d.amount} per="USDC claimable" />
                        </span>
                      </li>
                    ))}
                    {BigInt(detail.settlement.refunded) > BigInt(0) && (
                      <li className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-stone">Refunded to requester (unfilled or outlier slots)</span>
                        <Money baseUnits={detail.settlement.refunded} per="USDC" className="font-mono text-sm text-stone" />
                      </li>
                    )}
                  </ul>
                </section>
              )}
            </div>

            <aside className="flex flex-col gap-6">
              <div className="rounded-3xl border border-line bg-surface p-5">
                <p className="font-mono text-3xl text-ivory">
                  <Money baseUnits={BigInt(detail.rewardPerResponse) * BigInt(detail.responsesRequired)} />
                </p>
                <p className="mt-1 text-sm text-stone">
                  escrowed · <Money baseUnits={detail.rewardPerResponse} per="for each agreeing answer" />
                </p>

                <div className="mt-5 flex flex-col gap-2">
                  {phase === 'gathering' && (
                    <>
                      <Link href={`/contribute?bounty=${detail.bountyId}`} className={`${btn.primary} w-full`}>
                        Answer this bounty
                      </Link>
                      <p className="text-center font-mono text-[12px] text-faint">{timeLeft(detail.deadline, now)}</p>
                    </>
                  )}
                  {phase === 'ready' && (
                    <>
                      <button type="button" onClick={() => void runVerifier()} disabled={settling} className={`${btn.primary} w-full`}>
                        {settling ? 'Verifier is judging...' : 'Run the verifier'}
                      </button>
                      <p className="text-xs leading-relaxed text-faint">
                        Compares the answers, pays the ones that agree, and records the verdict on-chain.
                      </p>
                    </>
                  )}
                  {(phase === 'settled' || phase === 'forced') && (
                    <p className="text-sm leading-relaxed text-stone">This bounty is closed. The verdict above is final and on-chain.</p>
                  )}
                  {phase === 'expired' && (
                    <p className="text-sm leading-relaxed text-stone">
                      Closed with no answers. Anyone can call refundExpired on the escrow to return the reward.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-line p-5">
                <Dl
                  rows={[
                    ['Requester', <ChainRef key="r" value={detail.requester} kind="address" net={net} />],
                    ['Answers', `${detail.responsesReceived} of ${detail.responsesRequired}`],
                    [
                      'Deadline',
                      <span key="d" className="font-mono text-[13px]">
                        {new Date(detail.deadline * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>,
                    ],
                    ...(detail.createdTx
                      ? ([['Escrow tx', <ChainRef key="t" value={detail.createdTx} kind="tx" net={net} />]] as Array<[string, React.ReactNode]>)
                      : []),
                  ]}
                />
                <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-xs text-faint">
                  Share this bounty
                  <ShareLink />
                </div>
              </div>

              {detail.answers.length > 0 && (
                <div className="rounded-3xl border border-line p-5">
                  <Eyebrow className="mb-3">Answer transactions</Eyebrow>
                  <ul className="flex flex-col gap-2">
                    {detail.answers.map((a) => (
                      <li key={a.txHash} className="flex items-center justify-between gap-3 text-xs text-faint">
                        <span>#{a.responseIndex + 1} {shortAddr(a.responder)}</span>
                        <ChainRef value={a.txHash} kind="tx" net={net} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
