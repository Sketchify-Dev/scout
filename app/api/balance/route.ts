import { createPublicClient, erc20Abi, http, isAddress } from 'viem';
import { celo } from 'viem/chains';
import { getConfig } from '@/agents/router/config';

/**
 * GET /api/balance?address=0x... - CELO gas plus USDC balances for a contributor.
 * The contribute page uses it to explain "needs gas" before a submission
 * fails, and to show the spendable USDC balance next to the send form.
 */
export async function GET(request: Request) {
  try {
    const address = new URL(request.url).searchParams.get('address') ?? '';
    if (!isAddress(address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
    const cfg = getConfig();
    const client = createPublicClient({ chain: celo, transport: http(cfg.rpcUrl) });
    const [wei, usdc] = await Promise.all([
      client.getBalance({ address }),
      client.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => BigInt(0)),
    ]);
    return Response.json({ address, celoWei: wei.toString(), usdcBaseUnits: usdc.toString(), usdc: cfg.usdc });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Balance unavailable.' },
      { status: 500 },
    );
  }
}
