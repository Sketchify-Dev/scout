import type { NextRequest } from 'next/server';
import { getConfig } from '@/agents/router/config';
import { listBounties } from '@/agents/router/explorer';
import { verifyBounty } from '@/agents/router/verifier';

// A bounty becomes eligible this many seconds after its deadline. Past the
// deadline no new answers can land (the contract rejects them), so judging
// then is final. The default 4h gives the requester first move on fresh
// answers while nothing waits longer than one cron tick past the window.
const AUTO_AFTER_SECONDS = Number(process.env.AUTO_SETTLE_AFTER_SECONDS ?? '14400');
// Cap work per tick: each verify is an RPC scan plus a possible LLM call plus
// a possible settlement tx. Vercel cron ticks are cheap; blown deadlines are
// not, so stop early and let the next tick continue.
const MAX_PER_TICK = 5;

/**
 * GET /api/cron/auto-settle - daily verifier sweep (Vercel Cron).
 *
 * For every Open bounty past deadline + AUTO_SETTLE_AFTER_SECONDS with at
 * least one answer, run the same verifyBounty the manual button uses:
 * consensus pays on-chain, a split is reported and left open. Bounties with
 * no answers are never touched (refundExpired remains the manual path).
 * Guarded by CRON_SECRET so only the scheduler can trigger it.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return Response.json(
        { error: 'CRON_SECRET is not set. Set it and match it in vercel.json.' },
        { status: 500 },
      );
    }
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const cfg = getConfig();
    const now = Math.floor(Date.now() / 1000);
    const eligible = (await listBounties(cfg)).filter(
      (b) =>
        b.status === 'Open' &&
        b.responsesReceived > 0 &&
        now >= b.deadline + AUTO_AFTER_SECONDS,
    );

    const settled: Array<{ bountyId: string; settleTxHash?: string }> = [];
    const leftOpen: Array<{ bountyId: string; reason?: string }> = [];
    const skipped: string[] = [];
    const failed: Array<{ bountyId: string; error: string }> = [];

    for (const b of eligible.slice(0, MAX_PER_TICK)) {
      try {
        const outcome = await verifyBounty(cfg, b.bountyId);
        if (outcome.result === 'settled') {
          settled.push({ bountyId: b.bountyId, settleTxHash: outcome.settleTxHash });
        } else if (outcome.result === 'open') {
          leftOpen.push({ bountyId: b.bountyId, reason: outcome.reason });
        } else {
          skipped.push(b.bountyId);
        }
      } catch (error) {
        failed.push({
          bountyId: b.bountyId,
          error: error instanceof Error ? error.message : 'Unknown verifier error.',
        });
      }
    }

    return Response.json({
      checked: eligible.length,
      settled,
      leftOpen,
      skipped,
      failed,
      deferred: Math.max(0, eligible.length - MAX_PER_TICK),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown auto-settle error.' },
      { status: 500 },
    );
  }
}
