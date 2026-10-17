'use client';

import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { CURRENCIES, type DisplayCurrency } from '@/lib/scout';
import { useCurrency } from './Currency';

const EASE = [0.22, 1, 0.36, 1] as const;

function Flag({ code, size }: { code: DisplayCurrency; size: number }) {
  const info = CURRENCIES[code];
  return (
    <span
      aria-hidden
      className="relative shrink-0 overflow-hidden rounded-full bg-elevated ring-1 ring-line"
      style={{ width: size, height: size }}
    >
      <Image
        src={info.flagImg}
        alt=""
        width={size * 2}
        height={size * 2}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </span>
  );
}

/**
 * Display-currency menu, styled like a pro fintech picker: pill trigger with
 * a real flag medallion, ISO code, and symbol; an animated panel with full
 * names, ISO code badges, and an active checkmark. Closes on Escape, outside
 * click, and after selection. Settlement is always USDC; every non-USD figure
 * stays labelled approximate.
 *
 * Flags are real PNGs in public/flags, never emoji: Windows renders emoji
 * flags as plain two-letter codes, which would break this picker on many of
 * our contributors' devices.
 */
export function CurrencySwitch() {
  const { currency, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = CURRENCIES[currency];

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

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Display currency"
        title="Display currency. Settlement is always USDC; other figures are approximate."
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2.5 text-ivory shadow-sm transition-colors hover:border-linestrong hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-citron"
      >
        <Flag code={currency} size={24} />
        <span className="font-mono text-[12px] font-semibold tracking-wide">{currency.toUpperCase()}</span>
        <span aria-hidden className="font-mono text-[12px] text-faint">{current.symbol}</span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
          className={`text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Display currency"
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute right-0 top-11 z-50 max-h-72 w-64 origin-top overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-[0_16px_48px_rgba(16,20,15,0.18)]"
          >
            {(Object.keys(CURRENCIES) as DisplayCurrency[]).map((c) => {
              const info = CURRENCIES[c];
              const active = c === currency;
              return (
                <li key={c}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setCurrency(c);
                      setOpen(false);
                      trigger.current?.focus();
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none ${
                      active ? 'bg-elevated/70 text-ivory' : 'text-stone'
                    }`}
                  >
                    <Flag code={c} size={28} />
                    <span className="min-w-0 flex-1 truncate font-medium">{info.label}</span>
                    <span className="shrink-0 rounded-md bg-obsidian px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-faint ring-1 ring-line">
                      {c.toUpperCase()}
                    </span>
                    {active && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-jade">
                        <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
