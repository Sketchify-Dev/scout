import { Suspense } from 'react';
import { WalletClient } from './WalletClient';

export const metadata = { title: 'Wallet · Scout' };

export default function WalletPage() {
  return (
    <Suspense fallback={<div className="mx-auto min-h-[60vh] max-w-2xl px-4 py-16" />}>
      <WalletClient />
    </Suspense>
  );
}
