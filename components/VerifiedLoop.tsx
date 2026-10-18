import type { ReactNode } from 'react';
import { Eyebrow } from '@/components/ui';

const ESCROW = '0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6';
const ESCROW_TX = '0x7c60bb0e7c3bd5db20707bddac527382a9e8a6c46d38b05b317dc91c14a0562c';
const SETTLE_TX = '0x1702f653be6b83fdf0b4000089e3bd33adb2f39a89e7f1fcec0df08d99c81070';

function short(h: string) {
  return `${h.slice(0, 10)}...${h.slice(-6)}`;
}

/**
 * Proof that the full loop ran on Celo Mainnet: paid over HTTP, escrowed,
 * answered, settled. Both transactions carry the builder tag in trailing
 * calldata (visible in the raw input view on CeloScan, not the decoded one).
 */
export function VerifiedLoop() {
  const rows: Array<[string, ReactNode]> = [
    ['Bounty', <span key="b">#1 · “What are we building after church service today?”</span>],
    [
      'Escrow tx',
      <a
        key="e"
        href={`https://celoscan.io/tx/${ESCROW_TX}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-ivory underline decoration-linestrong underline-offset-4 hover:decoration-ivory"
      >
        {short(ESCROW_TX)} <span aria-hidden className="text-faint">↗</span>
      </a>,
    ],
    [
      'Settlement tx',
      <a
        key="s"
        href={`https://celoscan.io/tx/${SETTLE_TX}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-ivory underline decoration-linestrong underline-offset-4 hover:decoration-ivory"
      >
        {short(SETTLE_TX)} <span aria-hidden className="text-faint">↗</span>
      </a>,
    ],
    [
      'Escrow',
      <a
        key="c"
        href={`https://celoscan.io/address/${ESCROW}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-ivory underline decoration-linestrong underline-offset-4 hover:decoration-ivory"
      >
        {short(ESCROW)} <span aria-hidden className="text-faint">↗</span>
      </a>,
    ],
    ['Builder code', <span key="t" className="font-mono">celo_0107eaa60597</span>],
  ];
  return (
    <section
      aria-label="Verified on Celo Mainnet"
      className="rounded-3xl border border-jade/40 bg-jade/[0.05] p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Eyebrow>Verified on Celo Mainnet</Eyebrow>
        <span className="font-mono text-[11px] text-jade">$0.05 USDC · paid, escrowed, settled</span>
      </div>
      <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="min-w-0 break-words text-ivory">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
