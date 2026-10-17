import { redirect } from 'next/navigation';

/** The old human page now lives at /contribute. Keeps shared links working. */
export default async function HumanRedirect({
  searchParams,
}: {
  searchParams: Promise<{ bounty?: string }>;
}) {
  const { bounty } = await searchParams;
  redirect(bounty && /^\d+$/.test(bounty) ? `/contribute?bounty=${bounty}` : '/contribute');
}
