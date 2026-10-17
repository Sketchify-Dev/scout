'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useScoutAuth } from '@/components/auth/ScoutAuth';
import { ChainRef, EmptyState, Eyebrow, Notice, PhaseBadge, Skeleton } from '@/components/ui';
import { btn, field } from '@/lib/styles';
import { Money } from '@/components/Currency';
import { useNetwork } from '@/components/useNetwork';
import { phaseOf, shortAddr, timeLeft, type ChainStatus } from '@/lib/scout';

interface Task {
  bountyId: string;
  question: string;
  rewardPerResponse: string;
  responsesRequired: number;
  responsesReceived: number;
  status: ChainStatus;
  deadline: number;
}

interface Contribution {
  bountyId: string;
  question: string;
  answer: string;
  txHash: string;
  status: ChainStatus;
  responsesReceived: number;
  responsesRequired: number;
  deadline: number;
  outcome: 'paid' | 'claimable' | 'not-paid' | null;
  amount: string | null;
}

const MAX_ANSWER = 280;

function friendlyTxError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (/rejected|denied|cancel/i.test(msg)) return 'You cancelled the transaction. Nothing was submitted.';
  if (/insufficient funds|gas/i.test(msg)) return 'Your wallet needs a little CELO to pay the network fee.';
  if (/AlreadyResponded/i.test(msg)) return 'You already answered this bounty. One answer per person.';
  if (/ResponsesFull/i.test(msg)) return 'This bounty already has all the answers it needs.';
  if (/DeadlinePassed/i.test(msg)) return 'This bounty closed before your answer arrived.';
  if (/NotVerifiedHuman/i.test(msg)) return 'This bounty requires a verified-human check your wallet has not passed.';
  return msg || 'Submission failed. Try again.';
}

/** Gas status for the signed-in wallet, with a rehearsal-only top-up. */
function WalletCard({ address, identity, onBalance }: { address: string; identity: string | null; onBalance: (hasGas: boolean) => void }) {
  const net = useNetwork();
  const [wei, setWei] = useState<bigint | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/balance?address=${address}`, { cache: 'no-store' });
      const body = (await res.json()) as { celoWei?: string; usdcBaseUnits?: string };
      if (body.celoWei !== undefined) {
        const v = BigInt(body.celoWei);
        setWei(v);
        onBalance(v > BigInt(0));
      }
      if (body.usdcBaseUnits !== undefined) setUsdc(BigInt(body.usdcBaseUnits));
    } catch {
      // Unknown balance: let the submission itself report a gas problem.
      onBalance(true);
    }
  }, [address, onBalance]);

  useEffect(() => {
    const t = setTimeout(() => void check(), 0);
    return () => clearTimeout(t);
  }, [check]);

  const fund = async () => {
    setFunding(true);
    setFundError(null);
    try {
      const res = await fetch('/api/dev/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Top-up failed.');
      await check();
    } catch (e) {
      setFundError(e instanceof Error ? e.message : 'Top-up failed.');
    } finally {
      setFunding(false);
    }
  };

  const noGas = wei !== null && wei === BigInt(0);
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="mb-2">Your wallet</Eyebrow>
          {identity && <p className="truncate text-[15px] text-ivory">{identity}</p>}
          <ChainRef value={address} kind="address" net={net} className="mt-1" />
        </div>
        <div className="text-right">
          <Eyebrow className="mb-2">Balance</Eyebrow>
          <p className={`font-mono text-sm ${wei === null ? 'text-faint' : noGas ? 'text-amber' : 'text-jade'}`}>
            {usdc === null ? (wei === null ? 'checking...' : '…') : <Money baseUnits={usdc} per="USDC" />}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-faint">
            {wei === null ? '' : noGas ? 'no gas' : `${(Number(wei) / 1e18).toFixed(4)} CELO gas`}
          </p>
          <Link href="/wallet" className="mt-1 inline-block text-[11px] text-ivory underline underline-offset-2">
            Wallet · send
          </Link>
        </div>
      </div>
      {noGas && (
        <div className="mt-4 flex flex-col gap-3">
          {net?.isFork ? (
            <>
              <Notice tone="amber" title="Needs gas to answer">
                Each answer is a transaction. On this rehearsal fork you can add test gas instantly; it is not real CELO.
              </Notice>
              <button type="button" onClick={() => void fund()} disabled={funding} className={`${btn.secondary} w-full sm:w-auto`}>
                {funding ? 'Adding test gas...' : 'Add test gas (fork only)'}
              </button>
            </>
          ) : (
            <Notice tone="amber" title="Needs a little CELO for fees">
              Each answer costs under $0.01 in network fees. Send a small amount of CELO to the address above,
              for example from MiniPay or an exchange, then refresh.
            </Notice>
          )}
          {fundError && <p className="text-sm text-blood">{fundError}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * Withdraw USDC the escrow could not push directly. The payout was credited
 * to claim(token) instead, so this button sends that second transaction.
 * The send carries the same ERC-8021 builder tag as every other transaction.
 */
function ClaimCard({ address }: { address: string }) {
  const auth = useScoutAuth();
  const net = useNetwork();
  const [balances, setBalances] = useState<Array<{ token: string; amount: string }> | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/claimable/${address}`, { cache: 'no-store' });
      const body = (await res.json()) as { balances?: Array<{ token: string; amount: string }> };
      if (res.ok && body.balances) {
        setBalances(body.balances);
        setError(null);
      }
    } catch {
      // Claimable is secondary; the answer flow works without it.
    }
  }, [address]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Stay visible after a claim so the success notice (with tx hash) is shown;
  // otherwise the card would vanish the moment balances clear.
  if (balances === null || (balances.length === 0 && !claimed)) return null;

  const onClaim = async (token: `0x${string}`) => {
    setClaiming(true);
    setError(null);
    try {
      const { hash } = await auth.claimRewards(token);
      setClaimed(hash);
      setBalances([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed.');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section aria-labelledby="claimable" className="flex flex-col gap-4 rounded-3xl border border-amber/40 bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="claimable" className="text-xl font-semibold text-ivory">
          Ready to withdraw
        </h2>
        <Money baseUnits={balances.reduce((sum, b) => sum + BigInt(b.amount), BigInt(0))} className="font-mono text-xl text-jade" />
      </div>
      <p className="text-sm leading-relaxed text-stone">
        A payout could not land directly, so the escrow credited it for you to withdraw.
        Claiming sends one transaction from your wallet.
      </p>
      {balances.map((b) => (
        <button
          key={b.token}
          type="button"
          onClick={() => void onClaim(b.token as `0x${string}`)}
          disabled={claiming}
          className={`${btn.primary} w-full`}
        >
          {claiming ? 'Claiming...' : <span>Claim <Money baseUnits={b.amount} per="USDC" /></span>}
        </button>
      ))}
      {claimed && balances.length === 0 && (
        <p className="text-sm font-medium text-jade">All caught up. Nothing left to withdraw.</p>
      )}
      {claimed && (
        <Notice tone="jade" title="Withdrawn">
          Your USDC is on its way. <ChainRef value={claimed} kind="tx" net={net} />
        </Notice>
      )}
      {error && (
        <Notice tone="blood" title="Claim failed">
          {error}
        </Notice>
      )}
    </section>
  );
}

function Composer({
  task,
  canSubmit,
  onDone,
}: {
  task: Task;
  canSubmit: boolean;
  onDone: () => void;
}) {
  const auth = useScoutAuth();
  const net = useNetwork();
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState<'idle' | 'signing' | 'done' | 'error'>('idle');
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = answer.trim();
    if (!text || state === 'signing') return;
    setState('signing');
    setError(null);
    try {
      const r = await auth.submitAnswer(task.bountyId, text);
      setHash(r.hash);
      setState('done');
      onDone();
    } catch (e) {
      setError(friendlyTxError(e));
      setState('error');
    }
  };

  if (state === 'done' && hash) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-jade/40 bg-jade/[0.05] p-4" role="status">
        <p className="font-semibold text-jade">Your answer is on-chain.</p>
        <p className="text-sm leading-relaxed text-stone">
          If it matches what the other contributors report, you will be paid{' '}
          <Money baseUnits={task.rewardPerResponse} per="USDC" className="text-ivory" /> when the verifier runs.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
          transaction <ChainRef value={hash} kind="tx" net={net} />
        </div>
        <Link href={`/bounties/${task.bountyId}`} className="w-fit text-sm text-ivory underline underline-offset-4">
          Follow this bounty
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm text-stone">Your answer</span>
        <textarea
          autoFocus
          value={answer}
          maxLength={MAX_ANSWER}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          placeholder="Be specific: include the number, the unit, and where you saw it."
          className={`${field} resize-none py-3`}
        />
      </label>
      <div className="flex items-center justify-between text-xs text-faint">
        <span>Answers are public and permanent.</span>
        <span className="font-mono">
          {answer.length}/{MAX_ANSWER}
        </span>
      </div>
      {error && (
        <Notice tone="blood" title="Not submitted">
          {error}
        </Notice>
      )}
      <button type="submit" disabled={!canSubmit || !answer.trim() || state === 'signing'} className={`${btn.primary} h-12 w-full`}>
        {state === 'signing' ? 'Submitting to Celo...' : <span>Submit answer · earn <Money baseUnits={task.rewardPerResponse} /></span>}
      </button>
      {!canSubmit && <p className="text-center text-xs text-amber">Add gas to your wallet first.</p>}
    </form>
  );
}

const OUTCOME: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Paid', cls: 'text-jade' },
  claimable: { label: 'Claimable', cls: 'text-amber' },
  'not-paid': { label: 'Not paid · outlier', cls: 'text-stone' },
  pending: { label: 'Awaiting verdict', cls: 'text-citron' },
};

export function ContributeClient() {
  const auth = useScoutAuth();
  const params = useSearchParams();
  const reduce = useReducedMotion();
  const preselect = params.get('bounty');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [mine, setMine] = useState<Contribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(preselect);
  const [hasGas, setHasGas] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bounties', { cache: 'no-store' });
      const body = (await res.json()) as { bounties?: Task[]; error?: string };
      if (!res.ok || !body.bounties) throw new Error(body.error ?? 'Could not load tasks.');
      setTasks(body.bounties);
      setError(null);
      setNow(Math.floor(Date.now() / 1000));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tasks.');
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (!auth.address) return;
    try {
      const res = await fetch(`/api/contributors/${auth.address}`, { cache: 'no-store' });
      const body = (await res.json()) as { contributions?: Contribution[] };
      if (body.contributions) setMine(body.contributions);
    } catch {
      // History is secondary; tasks still work without it.
    }
  }, [auth.address]);

  // One welcome email per wallet, once its first session is established.
  useEffect(() => {
    if (!auth.authenticated || !auth.address) return;
    let stop = false;
    try {
      if (window.localStorage.getItem(`scout-welcomed-${auth.address.toLowerCase()}`)) return;
    } catch {
      return;
    }
    void fetch('/api/emails/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: auth.address, identity: auth.identity }),
    })
      .then((r) => r.json() as Promise<{ sent?: boolean; skipped?: boolean }>)
      .then((b) => {
        if (!stop && (b.sent || b.skipped)) {
          try {
            window.localStorage.setItem(`scout-welcomed-${auth.address!.toLowerCase()}`, '1');
          } catch {
            // Ignore.
          }
        }
      })
      .catch(() => {
        // Email is best effort; the wallet works regardless.
      });
    return () => {
      stop = true;
    };
  }, [auth.authenticated, auth.address, auth.identity]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
      void loadMine();
    }, 0);
    const timer = setInterval(() => void load(), 15000);
    return () => {
      clearTimeout(t);
      clearInterval(timer);
    };
  }, [load, loadMine]);

  const answeredIds = useMemo(() => new Set((mine ?? []).map((c) => c.bountyId)), [mine]);
  const open = useMemo(
    () => (tasks ?? []).filter((t) => phaseOf(t, now) === 'gathering' && !answeredIds.has(t.bountyId)),
    [tasks, now, answeredIds],
  );
  const preselected = preselect ? (tasks ?? []).find((t) => t.bountyId === preselect) : undefined;
  const preselectClosed = preselected && phaseOf(preselected, now) !== 'gathering';

  const earned = (mine ?? []).reduce((sum, c) => (c.outcome === 'paid' || c.outcome === 'claimable' ? sum + BigInt(c.amount ?? '0') : sum), BigInt(0));

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Contribute</p>
        <h1 className="font-display text-5xl leading-[1.02] text-ivory">Answer what you can see.</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-stone">
          Each task is a question from an AI agent. Answer honestly and specifically. When your answer agrees
          with other independent contributors, you are paid in USDC on Celo.
        </p>
      </header>

      <div className="mt-10 flex flex-col gap-10">
        {!auth.enabled ? (
          <Notice tone="amber" title="Sign-in is not configured">
            This deployment has no Privy app id, so contributors cannot sign in yet.
          </Notice>
        ) : !auth.ready ? (
          <Skeleton className="h-28" />
        ) : !auth.authenticated ? (
          <section className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-6">
            <p className="text-[15px] leading-relaxed text-stone">
              Sign in with email, phone, or Google. A Celo wallet is created for you; payouts land there.
            </p>
            <Link href={`/login?next=${encodeURIComponent(preselect ? `/contribute?bounty=${preselect}` : '/contribute')}`} className={btn.primary}>
              Sign in to answer
            </Link>
          </section>
        ) : auth.address ? (
          <>
            <WalletCard address={auth.address} identity={auth.identity} onBalance={setHasGas} />
            <ClaimCard address={auth.address} />
            {mine && mine.length > 0 && (
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line">
                <div className="bg-obsidian px-4 py-3">
                  <p className="font-mono text-xl text-ivory">{mine.length}</p>
                  <p className="text-xs text-faint">Answered</p>
                </div>
                <div className="bg-obsidian px-4 py-3">
                  <p className="font-mono text-xl text-ivory">{mine.filter((c) => c.outcome === 'paid' || c.outcome === 'claimable').length}</p>
                  <p className="text-xs text-faint">Paid</p>
                </div>
                <div className="bg-obsidian px-4 py-3">
                  <p className="font-mono text-xl text-ivory"><Money baseUnits={earned} /></p>
                  <p className="text-xs text-faint">Earned</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <Notice title="Setting up your wallet">
            Your wallet is being created. This usually takes a few seconds; if it takes longer than a
            minute, sign out and back in.
          </Notice>
        )}

        <section aria-labelledby="open-tasks" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 id="open-tasks" className="text-xl font-semibold text-ivory">
              Open tasks
            </h2>
            {tasks && <span className="font-mono text-xs text-faint">{open.length} open</span>}
          </div>

          {preselectClosed && (
            <Notice title={`Bounty #${preselect} is no longer taking answers`}>
              <Link href={`/bounties/${preselect}`} className="underline underline-offset-2">
                See how it ended
              </Link>
              .
            </Notice>
          )}
          {preselect && answeredIds.has(preselect) && (
            <Notice tone="jade" title={`You already answered bounty #${preselect}`}>
              One answer per person. Its outcome is listed under your answers below.
            </Notice>
          )}

          {error && !tasks && (
            <Notice tone="blood" title="Could not load tasks">
              {error}
            </Notice>
          )}
          {!tasks && !error && (
            <div className="flex flex-col gap-3" aria-busy aria-label="Loading tasks">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          )}
          {tasks && open.length === 0 && (
            <EmptyState
              title="No open tasks right now"
              body="New questions appear here as agents post them. This page refreshes on its own."
            />
          )}

          <ul className="flex flex-col gap-3">
            {open.map((t) => {
              const expanded = openId === t.bountyId;
              return (
                <li key={t.bountyId} className={`rounded-3xl border transition-colors ${expanded ? 'border-ivory/30 bg-surface' : 'border-line'}`}>
                  <button
                    type="button"
                    onClick={() => setOpenId(expanded ? null : t.bountyId)}
                    aria-expanded={expanded}
                    className="flex w-full flex-col gap-3 rounded-3xl p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-faint">#{t.bountyId}</span>
                      <Money baseUnits={t.rewardPerResponse} className="font-mono text-lg text-jade" />
                    </div>
                    <p className="text-[17px] leading-snug text-ivory">{t.question}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-faint">
                      <PhaseBadge phase="gathering" />
                      <span className="font-mono">
                        {t.responsesReceived}/{t.responsesRequired} answered
                      </span>
                      <span className="font-mono">{timeLeft(t.deadline, now)}</span>
                    </div>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={reduce ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduce ? undefined : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-line p-5">
                          {auth.authenticated && auth.address ? (
                            <Composer task={t} canSubmit={hasGas} onDone={() => void loadMine()} />
                          ) : (
                            <Link href={`/login?next=${encodeURIComponent(`/contribute?bounty=${t.bountyId}`)}`} className={`${btn.primary} w-full`}>
                              Sign in to answer
                            </Link>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </section>

        {auth.authenticated && mine && (
          <section aria-labelledby="my-answers" className="flex flex-col gap-4">
            <h2 id="my-answers" className="text-xl font-semibold text-ivory">
              Your answers
            </h2>
            {mine.length === 0 ? (
              <p className="text-sm text-stone">Nothing yet. Your answers and payouts will appear here.</p>
            ) : (
              <ul className="overflow-hidden rounded-3xl border border-line">
                {mine.map((c) => {
                  const o = OUTCOME[c.outcome ?? 'pending'];
                  return (
                    <li key={c.txHash} className="border-b border-line last:border-b-0">
                      <Link href={`/bounties/${c.bountyId}`} className="flex flex-col gap-1.5 px-5 py-4 hover:bg-surface">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-faint">#{c.bountyId}</span>
                          <span className={`font-mono text-xs ${o.cls}`}>
                            {o.label}
                            {c.amount && (c.outcome === 'paid' || c.outcome === 'claimable') ? (
                              <> · <Money baseUnits={c.amount} /></>
                            ) : ''}
                          </span>
                        </div>
                        <p className="line-clamp-1 text-sm text-stone">{c.question}</p>
                        <p className="text-[15px] text-ivory">“{c.answer}”</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-faint">Answering as {shortAddr(auth.address)}.</p>
          </section>
        )}
      </div>
    </div>
  );
}
