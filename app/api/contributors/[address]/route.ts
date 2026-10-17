import type { NextRequest } from 'next/server';
import { isAddress } from 'viem';
import { getConfig } from '@/agents/router/config';
import { getContributorHistory } from '@/agents/router/explorer';

/** GET /api/contributors/<address> - what this wallet answered and how each one ended. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    if (!isAddress(address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
    const contributions = await getContributorHistory(getConfig(), address);
    return Response.json({ contributions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read contributions.' },
      { status: 500 },
    );
  }
}
