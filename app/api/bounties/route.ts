import { getConfig } from '@/agents/router/config';
import { listBounties } from '@/agents/router/explorer';

/** GET /api/bounties - newest bounties first, reconstructed from chain state and logs. */
export async function GET() {
  try {
    const cfg = getConfig();
    const bounties = await listBounties(cfg);
    return Response.json({ bounties });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read bounties.' },
      { status: 500 },
    );
  }
}
