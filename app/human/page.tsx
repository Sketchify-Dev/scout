import { Suspense } from 'react';
import { redirect } from 'next/navigation';

/** The old human page now lives at /contribute. Keeps shared links working. */
async function HumanRedirect({
  searchParams,
}: {
  searchParams: Promise<{ bounty?: string }>;
}): Promise<React.ReactNode> {
  const { bounty } = await searchParams;
  redirect(bounty && /^\d+$/.test(bounty) ? `/contribute?bounty=${bounty}` : '/contribute');
}

export default function HumanPage({
  searchParams,
}: {
  searchParams: Promise<{ bounty?: string }>;
}) {
  // searchParams is request-time data, so the redirect renders client-side
  // behind Suspense instead of failing the static prerender.
  return (
    <Suspense fallback={<div className="mx-auto min-h-[60vh] max-w-3xl px-4 py-16" />}>
      <HumanRedirect searchParams={searchParams} />
    </Suspense>
  );
}
