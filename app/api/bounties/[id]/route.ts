import type { NextRequest } from 'next/server';
import { getConfig } from '@/agents/router/config';
import { getBountyDetail } from '@/agents/router/explorer';

/** GET /api/bounties/<id> - the full chain-reconstructed story of one bounty. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return Response.json({ error: 'Bounty id must be a number.' }, { status: 400 });
    }
    const detail = await getBountyDetail(getConfig(), BigInt(id));
    if (!detail) {
      return Response.json({ error: `Bounty ${id} does not exist.` }, { status: 404 });
    }
    return Response.json(detail);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read bounty.' },
      { status: 500 },
    );
  }
}
