import { Suspense } from 'react';
import { ContributeClient } from './ContributeClient';

export const metadata = { title: 'Contribute · Scout' };

export default function ContributePage() {
  return (
    <Suspense fallback={<div className="mx-auto min-h-[60vh] max-w-3xl px-4 py-16" />}>
      <ContributeClient />
    </Suspense>
  );
}
