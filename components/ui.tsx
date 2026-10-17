'use client';

import { useState } from 'react';
import { PHASE_META, addrUrl, shortAddr, txUrl, type NetworkInfo, type Phase } from '@/lib/scout';
import { btn, field } from '@/lib/styles';

// Re-exported for client components. Server components must import from @/lib/styles.
export { btn, field };

export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-faint ${className}`}>
      {children}
    </p>
  );
}

const TONE: Record<string, string> = {
  citron: 'border-citron/30 bg-citron/[0.06] text-citron',
  amber: 'border-amber/30 bg-amber/[0.06] text-amber',
  jade: 'border-jade/30 bg-jade/[0.07] text-jade',
  stone: 'border-linestrong bg-surface text-stone',
  blood: 'border-blood/30 bg-blood/[0.06] text-blood',
};

export function PhaseBadge({ phase, className = '' }: { phase: Phase; className?: string }) {
  const meta = PHASE_META[phase];
  return (
    <span
      title={meta.hint}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-wide ${TONE[meta.tone]} ${className}`}
    >
      {phase === 'gathering' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-citron" aria-hidden />}
      {meta.label}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="rounded px-1 font-mono text-[11px] text-faint transition-colors hover:text-ivory focus-visible:outline-1 focus-visible:outline-ivory"
      aria-label={`${label} ${value}`}
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}

/**
 * A transaction hash or address. Links to the explorer only when the chain
 * is real; fork rehearsal hashes exist only locally, so they are labelled
 * instead of linked to a page that would 404.
 */
export function ChainRef({
  value,
  kind,
  net,
  className = '',
}: {
  value: string;
  kind: 'tx' | 'address';
  net: NetworkInfo | null;
  className?: string;
}) {
  const text = shortAddr(value, kind === 'tx' ? 8 : 6, 6);
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] ${className}`}>
      {net && !net.isFork ? (
        <a
          href={kind === 'tx' ? txUrl(net, value) : addrUrl(net, value)}
          target="_blank"
          rel="noreferrer"
          className="text-ivory underline decoration-linestrong underline-offset-4 transition-colors hover:decoration-ivory"
        >
          {text}
          <span aria-hidden className="ml-0.5 text-faint">↗</span>
        </a>
      ) : (
        <span className="text-ivory" title={net?.isFork ? 'Fork rehearsal: exists only on the local chain' : undefined}>
          {text}
        </span>
      )}
      <CopyButton value={value} />
    </span>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-linestrong px-6 py-10">
      <p className="text-[15px] font-semibold text-ivory">{title}</p>
      <div className="max-w-md text-sm leading-relaxed text-stone">{body}</div>
      {action}
    </div>
  );
}

export function Notice({
  tone = 'stone',
  title,
  children,
}: {
  tone?: 'stone' | 'amber' | 'blood' | 'jade';
  title?: string;
  children: React.ReactNode;
}) {
  const border =
    tone === 'amber' ? 'border-amber/40' : tone === 'blood' ? 'border-blood/40' : tone === 'jade' ? 'border-jade/40' : 'border-linestrong';
  const head =
    tone === 'amber' ? 'text-amber' : tone === 'blood' ? 'text-blood' : tone === 'jade' ? 'text-jade' : 'text-ivory';
  return (
    <div className={`rounded-xl border ${border} bg-surface/60 px-4 py-3 text-sm leading-relaxed text-stone`} role="status">
      {title && <p className={`mb-0.5 font-semibold ${head}`}>{title}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-elevated ${className}`} aria-hidden />;
}

export function Dl({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="min-w-0 break-words text-ivory">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
