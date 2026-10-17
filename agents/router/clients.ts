import { createPublicClient, http } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import type { RouterConfig } from './config';

export function chainFor(cfg: RouterConfig) {
  return cfg.chainId === 42220 ? celo : celoSepolia;
}

// Return type is inferred on purpose: the Celo chain carries custom
// formatters, so its client is not assignable to the default PublicClient.
export function publicClientFor(cfg: RouterConfig) {
  return createPublicClient({
    chain: chainFor(cfg),
    transport: http(cfg.rpcUrl),
  });
}
