import { Suspense } from 'react';
import { BountyView } from './BountyView';

export default function BountyPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto min-h-[60vh] max-w-6xl px-4 py-16" />}>
      <BountyView params={params} />
    </Suspense>
  );
}
