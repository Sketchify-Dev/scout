import type { NextRequest } from 'next/server';
import { parseUnits } from 'viem';
import { getConfig } from '@/agents/router/config';
import { getDecider } from '@/agents/router/decider';
import { getSigner } from '@/agents/router/signer';
import { createBounty } from '@/agents/router/bounty';
import { processAskPayment } from '@/agents/router/x402';

/**
 * GET /api/ask?q=<question>
 *
 * The Scout Router endpoint. Without payment it answers 402 with the x402
 * payment requirements. With a verified payment it settles first, then posts
 * the bounty to ScoutEscrow, and returns the bounty id and escrow tx hash.
 *
 * Settle-before-bounty ordering matters: the router must actually hold the
 * requester's funds before it escrows them. A settlement failure therefore
 * returns 402 and creates nothing.
 */
export async function GET(request: NextRequest) {
  try {
    const cfg = getConfig();

    const question = request.nextUrl.searchParams.get('q')?.trim();
    if (!question) {
      return Response.json(
        { error: 'Missing required query param: q. Usage: /api/ask?q=What+is+maize+selling+for+in+Kisumu' },
        { status: 400 },
      );
    }

    const paid = await processAskPayment(request, cfg);
    if (paid.status === 'unpaid') {
      return Response.json(paid.body, { status: paid.httpStatus, headers: paid.headers });
    }

    // The 402 states the flat configured price, so the bounty is funded at
    // exactly that amount. The decider sets responses, TTL, and rationale.
    // Dynamic LLM pricing would need a two-step quote endpoint; v1 keeps the
    // charged amount and the escrowed amount identical by construction.
    const decider = getDecider(cfg);
    const quote = await decider.quote(question);

    const total = parseUnits(cfg.defaultPriceUsdc, cfg.usdcDecimals);
    const rewardPerResponse = total / BigInt(quote.responsesRequired);
    if (rewardPerResponse === BigInt(0)) {
      return Response.json(
        { error: 'Configured bounty price is below one payout unit. Raise BOUNTY_PRICE_USDC.' },
        { status: 500 },
      );
    }
    const deadline = Math.floor(Date.now() / 1000) + quote.ttlSeconds;

    const signer = await getSigner(cfg);
    if (signer.address.toLowerCase() !== cfg.payTo.toLowerCase()) {
      return Response.json(
        {
          error:
            'Router misconfiguration: ROUTER_PAY_TO must be the router agent wallet that also funds bounties, or settled funds will not cover escrow.',
        },
        { status: 500 },
      );
    }

    let settlementMode = 'dev-bypass';
    let settlementHeaders: Record<string, string> = {};
    if (paid.status === 'verified') {
      try {
        const settlement = await paid.payment.settle();
        settlementMode = settlement.mode;
        settlementHeaders = settlement.headers;
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Settlement failed.' },
          { status: 402 },
        );
      }
    }

    const created = await createBounty({
      cfg,
      signer,
      question,
      rewardPerResponse,
      responsesRequired: quote.responsesRequired,
      deadline,
    });

    return Response.json(
      {
        bountyId: created.bountyId,
        escrowTxHash: created.txHash,
        settlement: settlementMode,
        question,
        pricing: {
          chargedUsdc: cfg.defaultPriceUsdc,
          rewardPerResponseUsdc: (Number(rewardPerResponse) / 10 ** cfg.usdcDecimals).toString(),
          responsesRequired: quote.responsesRequired,
          deadline,
          quoteSource: quote.source,
          quoteRationale: quote.rationale,
        },
        chainId: cfg.chainId,
        usdc: cfg.usdc,
        escrow: cfg.escrow,
        builderTag: cfg.builderTag,
      },
      { status: 200, headers: settlementHeaders },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown router error.' },
      { status: 500 },
    );
  }
}
