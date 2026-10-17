/**
 * Shared, client-safe helpers for presenting bounties. Pure functions only:
 * no fetching, no wallet access, so server and client render the same text.
 */

export type ChainStatus = 'None' | 'Open' | 'Settled' | 'Refunded';

/**
 * The lifecycle a person sees, derived from chain state plus the clock.
 * The contract has only three live states; the in-between phases matter to
 * people (is it still taking answers? is it waiting on the verifier?).
 */
export type Phase = 'gathering' | 'ready' | 'expired' | 'settled' | 'forced' | 'refunded';

export interface PhaseInput {
  status: ChainStatus;
  responsesReceived: number;
  responsesRequired: number;
  deadline: number;
  forced?: boolean;
}

export function phaseOf(b: PhaseInput, nowSec = Math.floor(Date.now() / 1000)): Phase {
  if (b.status === 'Refunded') return 'refunded';
  if (b.status === 'Settled') return b.forced ? 'forced' : 'settled';
  const past = nowSec >= b.deadline;
  if (b.responsesReceived >= b.responsesRequired) return 'ready';
  if (past) return b.responsesReceived > 0 ? 'ready' : 'expired';
  return 'gathering';
}

export const PHASE_META: Record<Phase, { label: string; tone: 'citron' | 'amber' | 'jade' | 'stone' | 'blood'; hint: string }> = {
  gathering: { label: 'Gathering answers', tone: 'citron', hint: 'Open to human contributors.' },
  ready: { label: 'Ready to verify', tone: 'amber', hint: 'Answers are in. Waiting on the verifier.' },
  expired: { label: 'Expired, no answers', tone: 'stone', hint: 'Nobody answered. Anyone can refund the requester.' },
  settled: { label: 'Settled', tone: 'jade', hint: 'Verified and paid on-chain.' },
  forced: { label: 'Force-settled', tone: 'amber', hint: 'Verifier was silent; paid by the liveness backstop.' },
  refunded: { label: 'Refunded', tone: 'stone', hint: 'Escrow returned to the requester.' },
};

/** USDC on Celo has 6 decimals. Shows cents precision, more only when needed. */
export function formatUsdc(baseUnits: string | bigint | number): string {
  const n = Number(baseUnits) / 1e6;
  if (n === 0) return '0.00';
  if (n < 0.01) return n.toFixed(4);
  return n.toFixed(2);
}

/**
 * Display currencies. Every entry converts FROM the USDC amount: USDC tracks
 * the dollar 1:1 so USD is exact; every other currency uses a static,
 * illustrative rate and is always labelled approximate, never a quote.
 * Settlement is always USDC on-chain regardless of display.
 *
 * `flag` is a real flag image in public/flags (ISO code + .png), rendered in
 * a circular medallion. Emoji flags are NOT used: Windows renders them as
 * plain two-letter codes, which would break the picker on many devices.
 */
export type DisplayCurrency =
  | 'usd' | 'ngn' | 'kes' | 'ghs' | 'zar'
  | 'inr' | 'brl' | 'aed' | 'eur' | 'gbp'
  | 'chf' | 'jpy' | 'cad' | 'aud';

export const CURRENCIES: Record<DisplayCurrency, { label: string; symbol: string; flag: string; flagImg: string; rate: number; decimals: number }> = {
  usd: { label: 'US Dollar', symbol: '$', flag: '🇺🇸', flagImg: '/flags/us.png', rate: 1, decimals: 2 },
  ngn: { label: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬', flagImg: '/flags/ng.png', rate: 1500, decimals: 0 },
  kes: { label: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', flagImg: '/flags/ke.png', rate: 129, decimals: 0 },
  ghs: { label: 'Ghanaian Cedi', symbol: '₵', flag: '🇬🇭', flagImg: '/flags/gh.png', rate: 15.2, decimals: 2 },
  zar: { label: 'South African Rand', symbol: 'R', flag: '🇿🇦', flagImg: '/flags/za.png', rate: 18, decimals: 2 },
  inr: { label: 'Indian Rupee', symbol: '₹', flag: '🇮🇳', flagImg: '/flags/in.png', rate: 83, decimals: 2 },
  brl: { label: 'Brazilian Real', symbol: 'R$', flag: '🇧🇷', flagImg: '/flags/br.png', rate: 5.0, decimals: 2 },
  aed: { label: 'UAE Dirham', symbol: 'Dh', flag: '🇦🇪', flagImg: '/flags/ae.png', rate: 3.67, decimals: 2 },
  eur: { label: 'Euro', symbol: '€', flag: '🇪🇺', flagImg: '/flags/eu.png', rate: 0.92, decimals: 2 },
  gbp: { label: 'British Pound', symbol: '£', flag: '🇬🇧', flagImg: '/flags/gb.png', rate: 0.79, decimals: 2 },
  chf: { label: 'Swiss Franc', symbol: 'CHF ', flag: '🇨🇭', flagImg: '/flags/ch.png', rate: 0.89, decimals: 2 },
  jpy: { label: 'Japanese Yen', symbol: '¥', flag: '🇯🇵', flagImg: '/flags/jp.png', rate: 149, decimals: 0 },
  cad: { label: 'Canadian Dollar', symbol: 'CA$', flag: '🇨🇦', flagImg: '/flags/ca.png', rate: 1.36, decimals: 2 },
  aud: { label: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺', flagImg: '/flags/au.png', rate: 1.52, decimals: 2 },
};

export function isDisplayCurrency(v: string): v is DisplayCurrency {
  return (Object.keys(CURRENCIES) as string[]).includes(v);
}

/**
 * Render a USDC base-unit amount in the chosen display currency.
 * Returns the symbol-prefixed figure and whether it is approximate.
 */
export function formatReward(
  baseUnits: string | bigint | number,
  currency: DisplayCurrency = 'usd',
): { text: string; approx: boolean } {
  const usd = Number(baseUnits) / 1e6;
  if (currency === 'usd') {
    if (usd === 0) return { text: '$0.00', approx: false };
    if (usd < 0.01) return { text: `$${usd.toFixed(4)}`, approx: false };
    return { text: `$${usd.toFixed(2)}`, approx: false };
  }
  const c = CURRENCIES[currency];
  const local = usd * c.rate;
  const num =
    local >= 100
      ? Math.round(local).toLocaleString('en-US')
      : local.toFixed(c.decimals);
  return { text: `${c.symbol}${num}`, approx: true };
}

export function shortAddr(a: string | null | undefined, head = 6, tail = 4): string {
  if (!a) return '';
  return a.length > head + tail + 3 ? `${a.slice(0, head)}...${a.slice(-tail)}` : a;
}

export function timeLeft(deadline: number, nowSec = Math.floor(Date.now() / 1000)): string {
  const s = deadline - nowSec;
  if (s <= 0) return 'closed';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m left`;
  if (s < 86400) return `${Math.round(s / 3600)}h left`;
  return `${Math.round(s / 86400)}d left`;
}

export interface NetworkInfo {
  chainId: number;
  label: string;
  isFork: boolean;
  escrow: string;
  explorer: string;
  /** Settlement asset bounties are funded and claimed in (USDC). */
  usdc: string;
}

export function txUrl(net: Pick<NetworkInfo, 'explorer'> | null, hash: string): string {
  return `${net?.explorer ?? 'https://celoscan.io'}/tx/${hash}`;
}

export function addrUrl(net: Pick<NetworkInfo, 'explorer'> | null, addr: string): string {
  return `${net?.explorer ?? 'https://celoscan.io'}/address/${addr}`;
}
