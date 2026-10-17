import type { NextRequest } from 'next/server';
import { getConfig } from '@/agents/router/config';
import { getBountyStatus } from '@/agents/router/bounty';

/** GET /api/bounty/<id> - escrow state for one bounty. Unpaid, for the demo UI. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const cfg = getConfig();
    let bountyId: bigint;
    try {
      bountyId = BigInt(id);
    } catch {
      return Response.json({ error: 'Invalid bounty id.' }, { status: 400 });
    }
    const status = await getBountyStatus(cfg, bountyId);
    if (status.status === 'None') {
      return Response.json({ error: `Bounty ${id} does not exist.` }, { status: 404 });
    }
    return Response.json(status);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown router error.' },
      { status: 500 },
    );
  }
}
