import { keccak256, stringToHex } from 'viem';
import { getConfig, type RouterConfig } from './config';
import { getDecider } from './decider';
import { getSigner } from './signer';
import {
  getBountyPrompt,
  getBountyStatus,
  getResponseTexts,
  settleBounty,
} from './bounty';

export interface VerifyOutcome {
  bountyId: string;
  /** 'settled' paid consensus on-chain; 'open' left the bounty untouched. */
  result: 'settled' | 'open' | 'skip';
  reason?: string;
  summary?: string;
  verdictSource?: string;
  paid?: Array<{ responseIndex: number; responder: string }>;
  answers?: Array<{ responseIndex: number; responder: string; answer: string }>;
  confidenceBps?: number;
  settleTxHash?: string;
  builderTag?: string;
  skipped?: string;
}

/**
 * Judge one bounty and settle it when consensus exists. Empty consensus
 * settles nothing: the bounty stays open and the caller reports why.
 * Shared by the manual POST route and the auto-settle cron so both paths
 * judge, pay, and report identically.
 */
export async function verifyBounty(
  cfg: RouterConfig,
  id: string,
): Promise<VerifyOutcome> {
  let bountyId: bigint;
  try {
    bountyId = BigInt(id);
  } catch {
    return { bountyId: id, result: 'skip', skipped: 'Invalid bounty id.' };
  }

  const status = await getBountyStatus(cfg, bountyId);
  if (status.status !== 'Open') {
    return { bountyId: id, result: 'skip', skipped: `Bounty ${id} is ${status.status}.` };
  }
  if (status.responsesReceived === 0) {
    return { bountyId: id, result: 'open', reason: 'No responses submitted yet.' };
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
    return {
      bountyId: id,
      result: 'open',
      reason: 'No consensus among responses. Bounty left open.',
      summary: verdict.summary,
      verdictSource: verdict.source,
      answers: answerCards,
      confidenceBps: verdict.confidenceBps,
    };
  }

  const first = byIndex.get(verdict.consensusIndices[0]);
  if (!first) {
    throw new Error('Verdict references an unknown response index.');
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

  return {
    bountyId: id,
    result: 'settled',
    paid: verdict.consensusIndices.map((i) => ({
      responseIndex: i,
      responder: byIndex.get(i)?.responder ?? '',
    })),
    answers: answerCards,
    confidenceBps: verdict.confidenceBps,
    summary: verdict.summary,
    verdictSource: verdict.source,
    settleTxHash: txHash,
    builderTag: cfg.builderTag,
  };
}

/** Test hook and cron entry: verify with the ambient server config. */
export async function verifyBountyWithEnv(id: string): Promise<VerifyOutcome> {
  return verifyBounty(getConfig(), id);
}
