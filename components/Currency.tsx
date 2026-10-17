'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { formatReward, isDisplayCurrency, type DisplayCurrency } from '@/lib/scout';

const KEY = 'scout-currency';

interface CurrencyState {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
}

const Ctx = createContext<CurrencyState>({ currency: 'usd', setCurrency: () => {} });

function stored(): DisplayCurrency {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && isDisplayCurrency(saved)) return saved;
  } catch {
    // Private mode: fall through to the default.
  }
  return 'usd';
}

/** Display-currency preference, persisted. Never affects settlement: always USDC on-chain. */
export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Initialized from storage during render (client component, no SSR markup
  // depends on it), so no setState-in-effect is needed.
  const [currency, setCurrency] = useState<DisplayCurrency>(() =>
    typeof window === 'undefined' ? 'usd' : stored(),
  );
  const set = useCallback((c: DisplayCurrency) => {
    setCurrency(c);
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      // Ignore.
    }
  }, []);
  const value = useMemo(() => ({ currency, setCurrency: set }), [currency, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyState {
  return useContext(Ctx);
}

/**
 * A USDC base-unit amount in the viewer's display currency.
 * USD renders like $0.05; every other currency renders like ₦75 with an
 * inline "approx" tag, plus the exact USDC figure on hover.
 */
export function Money({
  baseUnits,
  per,
  className = '',
}: {
  baseUnits: string | bigint | number;
  per?: string;
  className?: string;
}) {
  const { currency } = useCurrency();
  const { text, approx } = formatReward(baseUnits, currency);
  const usd = Number(baseUnits) / 1e6;
  return (
    <span
      className={className}
      title={approx ? `≈ $${usd.toFixed(2)} USDC at a static illustrative rate` : `${text} USDC`}
    >
      {text}
      {per ? <span className="text-faint"> {per}</span> : null}
      {approx ? (
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wide text-faint">approx</span>
      ) : null}
    </span>
  );
}
