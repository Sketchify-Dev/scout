'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { ChainRef, Eyebrow, btn } from '@/components/ui';
import { Money } from '@/components/Currency';
import { shortAddr, type NetworkInfo } from '@/lib/scout';

export interface TheaterAnswer {
  responseIndex: number;
  responder: string;
  answer: string;
}

export interface TheaterVerdict {
  /** Lowercased responder addresses that were paid (or credited if deferred). */
  paid: Set<string>;
  confidenceBps: number;
  forced: boolean;
  settleTxHash: string | null;
  /** Prose from a live settle call; the chain does not store it. */
  summary?: string;
  source?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function CountUp({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => String(Math.round(v)));
  useEffect(() => {
    const c = animate(mv, to, { duration: reduce ? 0 : 1.2, ease: EASE });
    return () => c.stop();
  }, [to, mv, reduce]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

type Stage = 'answers' | 'compare' | 'verdict';

interface TheaterProps {
  answers: TheaterAnswer[];
  verdict: TheaterVerdict | null;
  rewardPerResponse: string;
  net: NetworkInfo | null;
}

/**
 * The signature Scout moment: independent answers arrive, get compared, and
 * the verdict lands (agreers paid, outliers not). Every value shown comes
 * from the chain or a live settle response; nothing here is invented.
 * Consensus is presented as evidence, never as proof.
 *
 * Replay remounts the body by key, so the sequence restarts from scratch.
 */
export function VerdictTheater(props: TheaterProps) {
  const [run, setRun] = useState(0);
  return <TheaterBody key={run} {...props} onReplay={() => setRun((r) => r + 1)} />;
}

function TheaterBody({
  answers,
  verdict,
  rewardPerResponse,
  net,
  onReplay,
}: TheaterProps & { onReplay: () => void }) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>('answers');

  // Group identical answers so agreement is visible at a glance.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; members: TheaterAnswer[] }>();
    for (const a of answers) {
      const k = norm(a.answer);
      const g = m.get(k);
      if (g) g.members.push(a);
      else m.set(k, { label: a.answer.trim(), members: [a] });
    }
    return [...m.values()].sort((x, y) => y.members.length - x.members.length);
  }, [answers]);

  const consensus = useMemo(() => {
    if (!verdict) return null;
    const paidAnswer = answers.find((a) => verdict.paid.has(a.responder.toLowerCase()));
    return paidAnswer?.answer.trim() ?? null;
  }, [answers, verdict]);

  // Stage sequencing runs from timer callbacks only. Reduced motion uses
  // zero delays, so the result appears immediately with no animation.
  useEffect(() => {
    if (!verdict) return;
    const perCard = reduce ? 0 : 0.18 * answers.length;
    const t1 = setTimeout(() => setStage('compare'), reduce ? 0 : (0.5 + perCard) * 1000);
    const t2 = setTimeout(() => setStage('verdict'), reduce ? 0 : (1.6 + perCard) * 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [verdict, reduce, answers.length]);

  const showVerdict = Boolean(verdict) && stage === 'verdict';
  const total = answers.length;

  return (
    <section aria-labelledby="theater-title" className="rounded-3xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Eyebrow>Verification</Eyebrow>
          <span className="font-mono text-[11px] text-faint">
            {verdict ? (stage === 'answers' ? '1 · answers in' : stage === 'compare' ? '2 · comparing' : '3 · verdict') : 'awaiting verifier'}
          </span>
        </div>
        {verdict && (
          <button type="button" className={btn.ghost} onClick={onReplay}>
            <span aria-hidden>↻</span> Replay
          </button>
        )}
      </div>

      <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Left: the answers, as they arrived */}
        <div>
          <h3 id="theater-title" className="sr-only">
            Answers and verdict
          </h3>
          <ol className="flex flex-col gap-2.5">
            {answers.map((a, i) => {
              const paid = verdict?.paid.has(a.responder.toLowerCase()) ?? false;
              const judged = showVerdict;
              return (
                <motion.li
                  key={a.responseIndex}
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: judged && !paid ? 0.55 : 1, y: 0 }}
                  transition={{ duration: 0.45, ease: EASE, delay: reduce ? 0 : 0.15 + i * 0.18 }}
                  className={`relative overflow-hidden rounded-2xl border px-4 py-3 transition-colors duration-500 ${
                    judged ? (paid ? 'border-jade/50 bg-jade/[0.05]' : 'border-blood/30 bg-obsidian') : 'border-line bg-obsidian'
                  }`}
                >
                  {stage === 'compare' && !reduce && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-citron/[0.12] to-transparent"
                      initial={{ x: '-100%' }}
                      animate={{ x: '300%' }}
                      transition={{ duration: 0.9, ease: 'easeInOut', delay: i * 0.08 }}
                    />
                  )}
                  <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                    <span className="text-faint">
                      #{a.responseIndex + 1} · {shortAddr(a.responder)}
                    </span>
                    <AnimatePresence mode="wait">
                      {judged ? (
                        <motion.span
                          key="judged"
                          initial={reduce ? false : { opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : i * 0.08 }}
                          className={paid ? 'text-jade' : 'text-blood'}
                        >
                          {paid ? (<span>paid <Money baseUnits={rewardPerResponse} per="USDC" /></span>) : 'not paid · outlier'}
                        </motion.span>
                      ) : (
                        <motion.span key="pending" className="text-faint" exit={{ opacity: 0 }}>
                          {verdict ? 'submitted' : 'on-chain'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className={`mt-1.5 text-[17px] text-ivory ${judged && !paid ? 'line-through decoration-blood/50' : ''}`}>
                    {a.answer}
                  </p>
                </motion.li>
              );
            })}
          </ol>
        </div>

        {/* Right: distribution and verdict */}
        <div className="flex flex-col gap-6">
          <div>
            <Eyebrow className="mb-3">Agreement</Eyebrow>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-elevated" role="img" aria-label={groups.map((g) => `${g.label}: ${g.members.length}`).join(', ')}>
              {groups.map((g, gi) => {
                const winning = showVerdict && consensus !== null && norm(g.label) === norm(consensus);
                return (
                  <motion.div
                    key={g.label}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${(g.members.length / Math.max(1, total)) * 100}%` }}
                    transition={{ duration: 0.8, ease: EASE, delay: reduce ? 0 : 0.4 + gi * 0.1 }}
                    className={`h-full border-r border-obsidian last:border-r-0 ${
                      winning ? 'bg-jade' : showVerdict ? 'bg-linestrong' : 'bg-stone/60'
                    }`}
                  />
                );
              })}
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {groups.map((g) => (
                <li key={g.label} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="truncate text-stone">{g.label}</span>
                  <span className="shrink-0 font-mono text-[12px] text-faint">
                    {g.members.length} of {total}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-h-[9rem] border-t border-line pt-5">
            {!verdict && (
              <div>
                <Eyebrow className="mb-2">Verdict</Eyebrow>
                <p className="text-sm leading-relaxed text-stone">
                  Not judged yet. When the verifier runs, matching answers are paid and outliers are not.
                </p>
              </div>
            )}
            {verdict && !showVerdict && (
              <div aria-live="polite">
                <Eyebrow className="mb-2">Verdict</Eyebrow>
                <p className="font-mono text-sm text-faint">{stage === 'compare' ? 'comparing independent answers...' : 'collecting answers...'}</p>
              </div>
            )}
            {verdict && showVerdict && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE }}
                aria-live="polite"
              >
                <Eyebrow className="mb-2">{verdict.forced ? 'Force-settled' : 'Verdict'}</Eyebrow>
                {consensus ? (
                  <>
                    <p className="font-display text-[44px] leading-none text-ivory">{consensus}</p>
                    <p className="mt-3 text-sm text-stone">
                      <span className="font-mono text-jade">
                        <CountUp to={Math.round(verdict.confidenceBps / 100)} />%
                      </span>{' '}
                      agreement · {verdict.paid.size} of {total} paid
                    </p>
                  </>
                ) : (
                  <p className="text-[15px] text-ivory">No consensus. Nothing was paid as truth.</p>
                )}
                {verdict.forced && (
                  <p className="mt-2 text-xs leading-relaxed text-amber">
                    The verifier did not act before the grace period ended, so every responder was paid by the
                    liveness backstop. Confidence is zero because no consensus was computed.
                  </p>
                )}
                <p className="mt-3 text-xs leading-relaxed text-faint">
                  {verdict.summary ?? 'Consensus is evidence from independent people, not proof of truth.'}
                </p>
                {verdict.settleTxHash && (
                  <div className="mt-4 flex items-center gap-2 text-xs text-faint">
                    settlement <ChainRef value={verdict.settleTxHash} kind="tx" net={net} />
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
