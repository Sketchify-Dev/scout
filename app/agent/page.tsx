'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChainRef, Dl, Eyebrow, Notice, btn, field } from '@/components/ui';
import { useScoutAuth } from '@/components/auth/ScoutAuth';
import { useSignTypedData } from '@privy-io/react-auth';
import { useNetwork } from '@/components/useNetwork';
import { formatUsdc } from '@/lib/scout';

const SAMPLES = [
  'What is maize selling for per kg in Kisumu market today?',
  'Is the pharmacy at Nyabugogo bus park in Kigali open right now?',
  'What does a 2kg bag of rice cost at Makola market in Accra this week?',
];

interface Terms {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  extra?: { name?: string };
}

interface Posted {
  bountyId: string;
  escrowTxHash: string;
  settlement: string;
  pricing: {
    chargedUsdc: string;
    rewardPerResponseUsdc: string;
    responsesRequired: number;
    quoteSource: string;
    quoteRationale: string;
  };
}

/** x402 v2 puts the terms in the PAYMENT-REQUIRED header as base64 JSON. */
function decodeTerms(header: string | null): Terms | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(atob(header)) as { accepts?: Terms[] };
    return parsed.accepts?.[0] ?? null;
  } catch {
    return null;
  }
}

export default function AgentConsole() {
  const net = useNetwork();
  const auth = useScoutAuth();
  const { signTypedData } = useSignTypedData();
  const reduce = useReducedMotion();
  const [question, setQuestion] = useState(SAMPLES[0]);
  const [busy, setBusy] = useState<'quote' | 'pay' | null>(null);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [posted, setPosted] = useState<Posted | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTerms(null);
    setPosted(null);
    setError(null);
  };

  const quote = async () => {
    if (!question.trim()) return;
    reset();
    setBusy('quote');
    try {
      const res = await fetch(`/api/ask?q=${encodeURIComponent(question.trim())}`);
      if (res.status !== 402) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Expected a 402 quote, got HTTP ${res.status}.`);
      }
      const t = decodeTerms(res.headers.get('payment-required'));
      if (!t) throw new Error('The router answered 402 but the payment terms could not be read.');
      setTerms(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quote failed.');
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (!question.trim()) return;
    setError(null);
    setBusy('pay');
    try {
      // No server key configured: pay the 402 directly from the signed-in
      // embedded wallet (EIP-3009 authorization, no gas, no bridging). The
      // requester and the router payee are separate wallets by construction.
      if (!auth.authenticated || !auth.address) {
        throw new Error('Sign in first. The bounty is paid from your own wallet.');
      }
      const quoteRes = await fetch(`/api/ask?q=${encodeURIComponent(question.trim())}`);
      if (quoteRes.status !== 402) {
        const body = (await quoteRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Expected a 402 quote, got HTTP ${quoteRes.status}.`);
      }
      // This router puts the terms in the PAYMENT-REQUIRED header with an
      // empty JSON body, so select from the header explicitly. Every x402
      // SDK helper in the dependency tree rejects Celo in its network table,
      // so the three-line local selection below replaces selectPaymentRequirements.
      const header = quoteRes.headers.get('payment-required');
      if (!header) throw new Error('The router answered 402 without payment terms.');
      const { accepts } = JSON.parse(atob(header)) as {
        accepts: Array<{
          scheme: string;
          network: string;
          // V2 routers emit `amount`; v0 called it `maxAmountRequired`.
          // Reading the wrong field signs value: undefined and the wallet
          // rejects the typed data, which is exactly what happened.
          amount: string;
          asset: string;
          payTo: string;
          maxTimeoutSeconds: number;
          extra?: { name?: string; version?: string };
        }>;
      };
      const exact = accepts.filter((a) => a.scheme === 'exact');
      const terms = exact.find((a) => a.network === 'eip155:42220') ?? exact[0];
      if (!terms) throw new Error('The router offered no exact-scheme payment terms.');
      // The installed x402 v0 client predates Celo support and rejects
      // eip155:42220 in its network table. The EIP-3009 authorization is
      // chain-agnostic typed data, so sign it directly with the embedded
      // wallet and build the v2 envelope by hand: same bytes the SDK would
      // produce, without its network allowlist.
      const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      const nowSec = Math.floor(Date.now() / 1000);
      const authorization = {
        from: auth.address,
        to: terms.payTo,
        value: terms.amount,
        validAfter: (nowSec - 600).toString(),
        validBefore: (nowSec + (terms.maxTimeoutSeconds || 300)).toString(),
        nonce,
      };
      // The hook defaults to the HD-index-0 wallet; the address option is
      // only for imported or multiple wallets. Passing it for a standard
      // embedded wallet makes the iframe look up a wallet entry that does
      // not exist, which fails inside the modal after it renders.
      const { signature } = await signTypedData({
        domain: {
          name: (terms.extra as { name?: string } | undefined)?.name ?? 'USDC',
          version: (terms.extra as { version?: string } | undefined)?.version ?? '2',
          chainId: 42220,
          verifyingContract: terms.asset,
        } as never,
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        } as never,
        primaryType: 'TransferWithAuthorization',
        message: authorization as never,
      });
      const paymentHeader = btoa(
        JSON.stringify({
          x402Version: 2,
          // The v2 payload schema requires the accepted requirements
          // alongside the signature. Without it the router cannot match the
          // payment to a quote and answers 402 again.
          accepted: terms,
          payload: { signature, authorization },
        }),
      );
      const paidRes = await fetch(`/api/ask?q=${encodeURIComponent(question.trim())}`, {
        method: 'GET',
        headers: { 'X-PAYMENT': paymentHeader },
      });
      const body = (await paidRes.json()) as Posted & { error?: string };
      if (!paidRes.ok) throw new Error(body.error ?? `Request failed (${paidRes.status}).`);
      setPosted(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Posting failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">For agents</p>
        <h1 className="font-display text-5xl leading-[1.02] text-ivory sm:text-6xl">Ask the world. Pay over HTTP.</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-stone">
          This console plays the requester agent. Request a quote to see the x402 handshake, then pay it to post a
          real bounty to the escrow{net?.isFork ? ' on the local Mainnet fork' : ' on Celo'}.
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="flex flex-col gap-6 rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="ask-title">
          <h2 id="ask-title" className="text-lg font-semibold text-ivory">
            1. Write the question
          </h2>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  reset();
                }}
                className={`max-w-full truncate rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  question === s ? 'border-ivory/60 bg-elevated text-ivory' : 'border-line text-stone hover:text-ivory'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-2">
            <span className="sr-only">Question</span>
            <textarea
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                reset();
              }}
              rows={3}
              maxLength={500}
              className={`${field} resize-none py-3`}
              placeholder="A question only someone on the ground can answer."
            />
          </label>
          <p className="text-xs leading-relaxed text-faint">
            Good questions name a place, a time, and a unit. Vague questions get answers that cannot agree.
          </p>

          <div className="h-px bg-line" />

          <h2 className="text-lg font-semibold text-ivory">2. Get the price</h2>
          <button type="button" onClick={() => void quote()} disabled={!question.trim() || busy !== null} className={`${btn.secondary} w-full sm:w-fit`}>
            {busy === 'quote' ? 'Asking the router...' : 'Request a quote (unpaid)'}
          </button>

          <AnimatePresence>
            {terms && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-amber/30 bg-obsidian p-4"
              >
                <div className="mb-3 flex items-center gap-2 font-mono text-[12px]">
                  <span className="rounded bg-amber/10 px-1.5 py-0.5 text-amber">402</span>
                  <span className="text-stone">Payment Required</span>
                </div>
                <Dl
                  rows={[
                    ['Price', <span key="p" className="font-mono text-jade">{formatUsdc(terms.amount)} {terms.extra?.name ?? 'USDC'}</span>],
                    ['Network', <span key="n" className="font-mono text-[13px]">{terms.network}</span>],
                    ['Pay to', <ChainRef key="pt" value={terms.payTo} kind="address" net={net} />],
                    ['Scheme', <span key="s" className="font-mono text-[13px]">{terms.scheme} · EIP-3009</span>],
                  ]}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="h-px bg-line" />

          <h2 className="text-lg font-semibold text-ivory">3. Pay and post</h2>
          <p className="text-sm leading-relaxed text-stone">
            {auth.authenticated
              ? 'Your wallet signs a USDC authorization over HTTP. No gas, no bridging, no separate key to fund.'
              : 'Sign in first. Your wallet signs a USDC authorization over HTTP, so there is no separate key to fund.'}
            {' '}The facilitator settles it and the router escrows the bounty on-chain.
          </p>
          {!auth.authenticated && (
            <Link href="/login?next=%2Fagent" className={`${btn.secondary} w-full sm:w-fit`}>
              Sign in to post
            </Link>
          )}
          <button type="button" onClick={() => void pay()} disabled={!question.trim() || busy !== null || !auth.authenticated} className={`${btn.primary} h-12 w-full`}>
            {busy === 'pay' ? 'Paying and posting...' : 'Pay $0.05 and post bounty'}
          </button>

          {error && (
            <Notice tone="blood" title="Did not go through">
              {error}
            </Notice>
          )}

          <AnimatePresence>
            {posted && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4 rounded-2xl border border-jade/40 bg-jade/[0.05] p-4"
                role="status"
              >
                <p className="font-semibold text-jade">Bounty #{posted.bountyId} is live.</p>
                <Dl
                  rows={[
                    ['Escrowed', `$${posted.pricing.chargedUsdc} USDC`],
                    ['Per answer', `$${posted.pricing.rewardPerResponseUsdc} × ${posted.pricing.responsesRequired}`],
                    ['Escrow tx', <ChainRef key="e" value={posted.escrowTxHash} kind="tx" net={net} />],
                    ['Priced by', posted.pricing.quoteSource === 'agentrouter' ? 'hosted model' : 'deterministic rules'],
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <Link href={`/bounties/${posted.bountyId}`} className={btn.primary}>
                    Watch it live
                  </Link>
                  <Link href={`/contribute?bounty=${posted.bountyId}`} className={btn.secondary}>
                    Answer it
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-3xl border border-line p-5 sm:p-6">
            <Eyebrow className="mb-4">What the $0.05 buys</Eyebrow>
            <ul className="flex flex-col gap-3 text-sm leading-relaxed text-stone">
              <li>
                <span className="text-ivory">Escrow first.</span> The full reward is locked on-chain before anyone works.
              </li>
              <li>
                <span className="text-ivory">Independent answers.</span> One answer per wallet; every answer is a public event.
              </li>
              <li>
                <span className="text-ivory">A verdict, not a vote count.</span> Agreement is paid; outliers and splits are not.
              </li>
              <li>
                <span className="text-ivory">Unused reward comes back.</span> Unfilled and outlier slots refund to the requester.
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-line p-5 sm:p-6">
            <Eyebrow className="mb-4">From your own agent</Eyebrow>
            <pre className="overflow-x-auto rounded-xl bg-surface p-4 font-mono text-[12px] leading-6 text-stone">
              <span className="text-faint">{'// npm i @x402/fetch @x402/evm viem'}</span>
              {'\n'}
              <span className="text-ivory">const</span> client = <span className="text-ivory">new</span> x402Client(signer);
              {'\n'}registerExactEvmScheme(client, {'{ signer }'});
              {'\n'}
              <span className="text-ivory">const</span> pay = wrapFetchWithPayment(fetch, client);
              {'\n\n'}
              <span className="text-ivory">const</span> res = <span className="text-ivory">await</span> pay(
              {'\n'}  <span className="text-jade">{"'https://<scout>/api/ask?q=...'"}</span>
              {'\n'});
              {'\n'}
              <span className="text-faint">{'// → { bountyId, escrowTxHash }'}</span>
            </pre>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              Read results at <span className="font-mono text-stone">/api/bounties/:id</span>. Scout is an ERC-8004
              agent; its registration file lives at <span className="font-mono text-stone">/agent-registration.json</span>.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
