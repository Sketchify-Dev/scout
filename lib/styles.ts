/**
 * Shared class strings. Deliberately NOT a 'use client' module: server
 * components import these directly, and constants exported from a client
 * module reach the server only as client references, not as strings.
 */
export const btn = {
  primary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-citron px-6 text-[15px] font-semibold text-obsidian transition-[background-color,transform] hover:bg-citronhover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-citron',
  secondary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-linestrong px-6 text-[15px] font-medium text-ivory transition-colors hover:border-ivory/60 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory',
  ghost:
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-sm text-stone transition-colors hover:text-ivory disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ivory',
};

export const field =
  'w-full rounded-xl border border-line bg-obsidian px-3.5 text-[15px] text-ivory outline-none transition-colors placeholder:text-faint hover:border-linestrong focus:border-ivory/50';
