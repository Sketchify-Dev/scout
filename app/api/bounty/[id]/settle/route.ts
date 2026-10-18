import type { NextRequest } from 'next/server';
import { getConfig } from '@/agents/router/config';
import { verifyBounty } from '@/agents/router/verifier';

/**
 * POST /api/bounty/<id>/settle - the Verifier agent endpoint.
 *
 * Reads every answer from chain logs, judges consensus with the brain
 * (LLM when reachable, stub otherwise), and settles the bounty on-chain:
 * consensus responders get paid, outliers get nothing, leftovers refund.
 * Empty consensus settles nothing and says so honestly.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const outcome = await verifyBounty(getConfig(), id);
    if (outcome.result === 'skip' && outcome.skipped === 'Invalid bounty id.') {
      return Response.json({ error: 'Invalid bounty id.' }, { status: 400 });
    }
    if (outcome.result === 'skip') {
      return Response.json({ error: outcome.skipped }, { status: 409 });
    }
    if (outcome.result === 'open') {
      return Response.json(
        {
          settled: false,
          reason: outcome.reason,
          verdict: {
            confidenceBps: outcome.confidenceBps,
            summary: outcome.summary,
            source: outcome.verdictSource,
          },
          answers: outcome.answers,
        },
        { status: 200 },
      );
    }
    return Response.json({
      settled: true,
      bountyId: outcome.bountyId,
      paid: outcome.paid,
      answers: outcome.answers,
      confidenceBps: outcome.confidenceBps,
      summary: outcome.summary,
      verdictSource: outcome.verdictSource,
      settleTxHash: outcome.settleTxHash,
      builderTag: outcome.builderTag,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown verifier error.' },
      { status: 500 },
    );
  }
}
