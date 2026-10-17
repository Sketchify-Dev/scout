import { Suspense } from 'react';
import { LoginClient } from './LoginClient';

export const metadata = { title: 'Sign in · Scout' };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto min-h-[60vh] max-w-6xl px-4 py-24" />}>
      <LoginClient />
    </Suspense>
  );
}
