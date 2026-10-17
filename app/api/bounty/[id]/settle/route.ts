import type { NextRequest } from 'next/server';
import { keccak256, stringToHex } from 'viem';
import { getConfig } from '@/agents/router/config';
import { getDecider } from '@/agents/router/decider';
import { getSigner } from '@/agents/router/signer';
import {
  getBountyPrompt,
  getBountyStatus,
  getResponseTexts,
  settleBounty,
} from '@/agents/router/bounty';

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
    const cfg = getConfig();
    let bountyId: bigint;
    try {
      bountyId = BigInt(id);
    } catch {
      return Response.json({ error: 'Invalid bounty id.' }, { status: 400 });
    }

    const status = await getBountyStatus(cfg, bountyId);
    if (status.status !== 'Open') {
      return Response.json(
        { error: `Bounty ${id} is ${status.status}, nothing to settle.` },
        { status: 409 },
      );
    }
    if (status.responsesReceived === 0) {
      return Response.json(
        { settled: false, reason: 'No responses submitted yet.' },
        { status: 200 },
      );
    }

    const { prompt } = await getBountyPrompt(cfg, bountyId);
    const answers = await getResponseTexts(cfg, bountyId);
    const byIndex = new Map(answers.map((a) => [a.responseIndex, a]));

    const decider = getDecider(cfg);
    const verdict = await decider.judge(
      prompt,
      answers.map((a) => a.answer),
    );
    const answerCards = answers.map((a) => ({
      responseIndex: a.responseIndex,
      responder: a.responder,
      answer: a.answer,
    }));
    if (verdict.consensusIndices.length === 0) {
      return Response.json(
        {
          settled: false,
          reason: 'No consensus among responses. Bounty left open.',
          verdict: {
            confidenceBps: verdict.confidenceBps,
            summary: verdict.summary,
            source: verdict.source,
          },
          answers: answerCards,
        },
        { status: 200 },
      );
    }

    const first = byIndex.get(verdict.consensusIndices[0]);
    if (!first) {
      return Response.json(
        { error: 'Verdict references an unknown response index.' },
        { status: 500 },
      );
    }
    const consensusAnswerHash = keccak256(stringToHex(first.answer));

    const signer = await getSigner(cfg);
    const txHash = await settleBounty({
      cfg,
      signer,
      bountyId,
      consensusIndices: verdict.consensusIndices,
      confidenceBps: verdict.confidenceBps,
      consensusAnswerHash,
    });

    return Response.json({
      settled: true,
      bountyId: id,
      paid: verdict.consensusIndices.map((i) => ({
        responseIndex: i,
        responder: byIndex.get(i)?.responder,
      })),
      answers: answerCards,
      confidenceBps: verdict.confidenceBps,
      summary: verdict.summary,
      verdictSource: verdict.source,
      settleTxHash: txHash,
      builderTag: cfg.builderTag,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown verifier error.' },
      { status: 500 },
    );
  }
}
