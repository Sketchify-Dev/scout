'use client';

import { useEffect, useState } from 'react';
import type { NetworkInfo } from '@/lib/scout';

let cached: Promise<NetworkInfo | null> | null = null;

function load(): Promise<NetworkInfo | null> {
  if (!cached) {
    cached = fetch('/api/network')
      .then((r) => (r.ok ? (r.json() as Promise<NetworkInfo>) : null))
      .catch(() => null);
  }
  return cached;
}

/** Which chain this deployment talks to. Fetched once per page load. */
export function useNetwork(): NetworkInfo | null {
  const [net, setNet] = useState<NetworkInfo | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((n) => {
      if (live) setNet(n);
    });
    return () => {
      live = false;
    };
  }, []);
  return net;
}
