import { createTestClient, http, isAddress, parseEther } from 'viem';
import { celo } from 'viem/chains';
import { getConfig } from '@/agents/router/config';

/**
 * POST /api/dev/fund { address } - fork rehearsals only.
 *
 * Gives a contributor's wallet 1 CELO of gas on the local anvil fork, so the
 * full login -> answer -> settle loop can be demonstrated without real funds.
 * Refuses on any non-local RPC: this endpoint must never exist on Mainnet.
 */
export async function POST(request: Request) {
  try {
    const cfg = getConfig();
    if (!/127\.0\.0\.1|localhost/.test(cfg.rpcUrl)) {
      return Response.json({ error: 'Gas top-ups exist only on local fork rehearsals.' }, { status: 403 });
    }
    const { address } = (await request.json()) as { address?: string };
    if (!address || !isAddress(address)) {
      return Response.json({ error: 'Invalid address.' }, { status: 400 });
    }
    const test = createTestClient({ chain: celo, mode: 'anvil', transport: http(cfg.rpcUrl) });
    await test.setBalance({ address, value: parseEther('1') });
    return Response.json({ funded: true, address, celo: '1' });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Top-up failed.' },
      { status: 500 },
    );
  }
}
