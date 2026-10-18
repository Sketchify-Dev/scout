'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Eyebrow, btn } from '@/components/ui';

const EASE = [0.22, 1, 0.36, 1] as const;

const QUESTION = 'What does maize cost in Kisumu today?';

interface DemoAnswer {
  id: number;
  from: string;
  text: string;
  agrees: boolean;
}

const ANSWERS: DemoAnswer[] = [
  { id: 0, from: 'Kisumu · contributor 1', text: '85 KES per kg', agrees: true },
  { id: 1, from: 'Kisumu · contributor 2', text: '85 KES per kg', agrees: true },
  { id: 2, from: 'Kisumu · contributor 3', text: '250 KES per kg', agrees: false },
];

const STAGE_LABEL = ['1 · question', '2 · answers', '3 · comparing', '4 · verdict', '5 · payout'];

/**
 * Hero animation: the Scout loop in miniature. An agent question arrives,
 * three demo answers land at human pace, the two that agree group together,
 * the verdict lands, and a restrained payout receipt closes the loop before
 * it resets. Demo fixtures only, kept separate from live data. Reduced
 * motion renders the final state statically. The loop pauses offscreen.
 */
export function HeroTheater() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [run, setRun] = useState(0);
  // Phase: 0 question, 1 answers, 2 compare, 3 verdict, 4 payout receipt.
  const [phase, setPhase] = useState(0);
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduce) {
      setPhase(4);
      setShown(ANSWERS.length);
      return;
    }
    if (!inView) {
      setPhase(0);
      setShown(0);
      setVisible(true);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    at(900, () => setShown(1));
    at(1600, () => setShown(2));
    at(2300, () => setShown(3));
    at(2500, () => setPhase(1));
    at(3600, () => setPhase(2));
    at(4800, () => setPhase(3));
    at(6200, () => setPhase(4));
    at(10200, () => setVisible(false));
    at(10700, () => {
      setRun((r) => r + 1);
      setPhase(0);
      setShown(0);
      setVisible(true);
    });
    return () => timers.forEach(clearTimeout);
  }, [run, inView, reduce]);

  const judged = phase >= 3;

  return (
    <div ref={ref} className="relative">
      <span className="absolute -top-3 left-5 z-10 rounded-full border border-linestrong bg-obsidian px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Demo · sample data
      </span>
      <section aria-label="How Scout works" className="overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Eyebrow>How Scout works</Eyebrow>
            <span className="font-mono text-[11px] text-faint">{STAGE_LABEL[Math.min(phase, 4)]}</span>
          </div>
          {!reduce && (
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                setRun((r) => r + 1);
                setPhase(0);
                setShown(0);
                setVisible(true);
              }}
            >
              <span aria-hidden>↻</span> Replay
            </button>
          )}
        </div>

        <motion.div
          key={run}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: visible ? 1 : 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex flex-col gap-3 p-5 sm:p-6"
        >
          {/* Act 1: the agent question arrives */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="rounded-2xl border border-citron/30 bg-obsidian px-4 py-3"
          >
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-citron" aria-hidden />
              <span className="uppercase tracking-[0.12em] text-citron">Agent question</span>
              <span className="ml-auto text-faint">$0.05 · x402</span>
            </div>
            <p className="mt-1.5 font-display text-[22px] leading-snug text-ivory">{QUESTION}</p>
          </motion.div>

          {/* Act 2: three independent answers land at human pace */}
          <ol className="flex flex-col gap-2.5">
            {ANSWERS.slice(0, shown).map((a) => (
              <motion.li
                key={a.id}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: judged && !a.agrees ? 0.55 : 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE }}
                className={`relative overflow-hidden rounded-2xl border px-4 py-3 transition-colors duration-500 ${
                  judged ? (a.agrees ? 'border-jade/50 bg-jade/[0.05]' : 'border-blood/30 bg-obsidian') : 'border-line bg-obsidian'
                }`}
              >
                {phase === 2 && !reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-citron/[0.12] to-transparent"
                    initial={{ x: '-100%' }}
                    animate={{ x: '300%' }}
                    transition={{ duration: 0.9, ease: 'easeInOut', delay: a.id * 0.08 }}
                  />
                )}
                <div className="flex items-center justify-between gap-3 font-mono text-[11px]">
                  <span className="text-faint">{a.from}</span>
                  {judged && (
                    <span className={a.agrees ? 'text-jade' : 'text-blood'}>
                      {a.agrees ? 'agrees' : 'outlier'}
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-[17px] text-ivory ${judged && !a.agrees ? 'line-through decoration-blood/50' : ''}`}>
                  {a.text}
                </p>
              </motion.li>
            ))}
          </ol>

          {/* Act 3 and 4: verdict */}
          {phase >= 3 && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              aria-live="polite"
              className="rounded-2xl border-t border-line pt-4"
            >
              <Eyebrow className="mb-2">Verdict</Eyebrow>
              <p className="font-display text-[40px] leading-none text-ivory">85 KES per kg</p>
              <p className="mt-2 text-sm text-stone">
                <span className="font-mono text-jade">67%</span> agreement · 2 of 3 paid
              </p>
            </motion.div>
          )}

          {/* Act 5: restrained payout receipt, clearly illustrative */}
          {phase >= 4 && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="rounded-2xl border border-jade/40 bg-jade/[0.05] px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-jade">Demo payout</p>
                <p className="font-mono text-sm text-ivory">2 × $0.02 USDC</p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-faint">
                Illustration only. Live payouts settle on Celo with a linked transaction.
              </p>
            </motion.div>
          )}
        </motion.div>

        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint sm:px-6">
          Sample answers for illustration. Live bounties pay real USDC on Celo.
        </p>
      </section>
    </div>
  );
}
