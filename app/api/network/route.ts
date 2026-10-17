import { getConfig } from '@/agents/router/config';
import type { NetworkInfo } from '@/lib/scout';

/**
 * GET /api/network - which chain this deployment reads and writes.
 *
 * `isFork` is true when the RPC is local (an anvil fork of Mainnet). The UI
 * labels fork state loudly so rehearsal transactions can never be mistaken
 * for Mainnet activity, and suppresses explorer links that would 404.
 */
export async function GET() {
  try {
    const cfg = getConfig();
    const isFork = /127\.0\.0\.1|localhost/.test(cfg.rpcUrl);
    const mainnet = cfg.chainId === 42220;
    const body: NetworkInfo = {
      chainId: cfg.chainId,
      label: isFork ? 'Mainnet fork (rehearsal)' : mainnet ? 'Celo Mainnet' : 'Celo Sepolia',
      isFork,
      escrow: cfg.escrow,
      explorer: mainnet ? 'https://celoscan.io' : 'https://sepolia.celoscan.io',
      usdc: cfg.usdc,
    };
    return Response.json(body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Network config unavailable.' },
      { status: 500 },
    );
  }
}
