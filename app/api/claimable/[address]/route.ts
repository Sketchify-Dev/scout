import type { NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { getConfig } from '@/agents/router/config';
import { getClaimable } from '@/agents/router/explorer';

/** GET /api/claimable/<address> - USDC this wallet can withdraw via claim(token). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    if (!isAddress(address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
    const balances = await getClaimable(getConfig(), address);
    return Response.json({ balances });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read claimable balances.' },
      { status: 500 },
    );
  }
}
