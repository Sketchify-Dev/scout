import { encodeFunctionData, erc20Abi, maxUint256, parseEventLogs, type Address } from 'viem';
import { publicClientFor } from './clients';
import type { RouterConfig } from './config';
import type { RouterSigner } from './signer';

// Minimal surface of ScoutEscrow needed by the router. Field order in
// `bounties` must match the struct in contracts/src/ScoutEscrow.sol.
const escrowAbi = [
  {
    type: 'function',
    name: 'createBounty',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'rewardPerResponse', type: 'uint96' },
      { name: 'responsesRequired', type: 'uint8' },
      { name: 'deadline', type: 'uint64' },
      { name: 'prompt', type: 'string' },
    ],
    outputs: [{ name: 'bountyId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bounties',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'requester', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'rewardPerResponse', type: 'uint96' },
      { name: 'deadline', type: 'uint64' },
      { name: 'responsesRequired', type: 'uint8' },
      { name: 'responsesReceived', type: 'uint8' },
      { name: 'status', type: 'uint8' },
      { name: 'promptHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'responseCount',
    stateMutability: 'view',
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'bountyId', type: 'uint256' },
      { name: 'consensusIndices', type: 'uint256[]' },
      { name: 'confidenceBps', type: 'uint16' },
      { name: 'consensusAnswerHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'BountyCreated',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'requester', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'rewardPerResponse', type: 'uint96', indexed: false },
      { name: 'responsesRequired', type: 'uint8', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
      { name: 'promptHash', type: 'bytes32', indexed: false },
      { name: 'prompt', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ResponseSubmitted',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'responder', type: 'address', indexed: true },
      { name: 'responseIndex', type: 'uint256', indexed: false },
      { name: 'answerHash', type: 'bytes32', indexed: false },
      { name: 'answer', type: 'string', indexed: false },
    ],
  },
] as const;

export interface CreatedBounty {
  bountyId: string;
  txHash: `0x${string}`;
}

export async function createBounty(opts: {
  cfg: RouterConfig;
  signer: RouterSigner;
  question: string;
  rewardPerResponse: bigint;
  responsesRequired: number;
  deadline: number;
}): Promise<CreatedBounty> {
  const { cfg, signer } = opts;
  const client = publicClientFor(cfg);

  // createBounty pulls the payout with transferFrom, so the escrow needs an
  // allowance from the router first. A one-time max approval is safe here:
  // ScoutEscrow only ever pulls from msg.sender, so the allowance can only be
  // spent by the router calling createBounty itself.
  const total = opts.rewardPerResponse * BigInt(opts.responsesRequired);
  const allowance = await client.readContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [signer.address, cfg.escrow],
  });
  if (allowance < total) {
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [cfg.escrow, maxUint256],
    });
    const approveHash = await signer.sendTransaction({
      to: cfg.usdc,
      data: approveData,
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
  }

  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: 'createBounty',
    args: [cfg.usdc, opts.rewardPerResponse, opts.responsesRequired, BigInt(opts.deadline), opts.question],
  });
  // The router funds the bounty from its own balance, which the x402
  // settlement just topped up. Attribution rides in trailing calldata.
  const txHash = await signer.sendTransaction({
    to: cfg.escrow,
    data,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: 'BountyCreated' });
  const first = events[0];
  if (!first) {
    throw new Error(`BountyCreated event not found in receipt ${txHash}.`);
  }
  return { bountyId: first.args.bountyId.toString(), txHash };
}

export interface BountyPrompt {
  bountyId: string;
  prompt: string;
}

/**
 * Log scans are chunked: public RPCs cap eth_getLogs ranges (Forno allows
 * 5000 blocks), and an uncapped scan from the deploy block fails once the
 * chain grows past the window. Chunks run newest-first and stop once
 * `expected` events are found. That stop condition matters: Celo makes a
 * block a second, so one 4000-block chunk is ~66 minutes, and answers to a
 * day-long bounty span many chunks. Stopping at the first non-empty chunk
 * would silently drop older answers, and the verifier would judge (and pay)
 * only the latest hour of responders.
 */
async function getContractEventsChunked(
  client: ReturnType<typeof publicClientFor>,
  cfg: RouterConfig,
  args: {
    address: `0x${string}`;
    abi: typeof escrowAbi;
    eventName: 'BountyCreated' | 'ResponseSubmitted';
    args: { bountyId: bigint };
  },
  expected = 1,
): Promise<Array<{ args: Record<string, unknown>; blockNumber: bigint }>> {
  const CHUNK = BigInt(4000);
  const head = await client.getBlockNumber();
  let toBlock = head;
  const fromFloor = cfg.escrowDeployBlock ?? BigInt(0);
  const out: Array<{ args: Record<string, unknown>; blockNumber: bigint }> = [];
  while (toBlock >= fromFloor) {
    const fromBlock = toBlock - CHUNK > fromFloor ? toBlock - CHUNK : fromFloor;
    try {
      const page = await client.getContractEvents({
        address: args.address,
        abi: args.abi,
        eventName: args.eventName,
        args: args.args,
        fromBlock,
        toBlock,
      });
      out.push(...(page as Array<{ args: Record<string, unknown>; blockNumber: bigint }>));
      if (out.length >= expected) return out;
    } catch (error) {
      if (!(error instanceof Error && /exceeds|range|limit/i.test(error.message))) throw error;
    }
    if (fromBlock === fromFloor) break;
    toBlock = fromBlock - BigInt(1);
  }
  return out;
}

/** Full question text, recovered from the BountyCreated event log. */
export async function getBountyPrompt(
  cfg: RouterConfig,
  bountyId: bigint,
): Promise<BountyPrompt> {
  const client = publicClientFor(cfg);
  const events = await getContractEventsChunked(client, cfg, {
    address: cfg.escrow,
    abi: escrowAbi,
    eventName: 'BountyCreated',
    args: { bountyId },
  });
  const first = events[0];
  if (!first || typeof first.args.prompt !== 'string') {
    throw new Error(`BountyCreated event not found for bounty ${bountyId}.`);
  }
  return { bountyId: bountyId.toString(), prompt: first.args.prompt };
}

export interface BountyAnswer {
  responseIndex: number;
  responder: string;
  answer: string;
  answerHash: string;
}

/** Full answer texts, recovered from ResponseSubmitted event logs. */
export async function getResponseTexts(
  cfg: RouterConfig,
  bountyId: bigint,
): Promise<BountyAnswer[]> {
  const client = publicClientFor(cfg);
  // The contract's own count is the scan target, so no answer is ever missed.
  const expected = Number(
    await client.readContract({
      address: cfg.escrow,
      abi: escrowAbi,
      functionName: 'responseCount',
      args: [bountyId],
    }),
  );
  if (expected === 0) return [];
  const events = await getContractEventsChunked(
    client,
    cfg,
    {
      address: cfg.escrow,
      abi: escrowAbi,
      eventName: 'ResponseSubmitted',
      args: { bountyId },
    },
    expected,
  );
  if (events.length < expected) {
    throw new Error(
      `Found ${events.length} of ${expected} answers for bounty ${bountyId} in logs. Refusing to judge a partial set.`,
    );
  }
  const answers: BountyAnswer[] = [];
  for (const e of events) {
    const a = e.args as {
      responseIndex?: unknown;
      responder?: unknown;
      answer?: unknown;
      answerHash?: unknown;
    };
    if (
      a.responseIndex === undefined ||
      typeof a.responder !== 'string' ||
      typeof a.answer !== 'string' ||
      typeof a.answerHash !== 'string'
    ) {
      throw new Error(`Malformed ResponseSubmitted event for bounty ${bountyId}.`);
    }
    answers.push({
      responseIndex: Number(a.responseIndex),
      responder: a.responder,
      answer: a.answer,
      answerHash: a.answerHash,
    });
  }
  return answers.sort((a, b) => a.responseIndex - b.responseIndex);
}

export async function settleBounty(opts: {
  cfg: RouterConfig;
  signer: RouterSigner;
  bountyId: bigint;
  consensusIndices: number[];
  confidenceBps: number;
  consensusAnswerHash: `0x${string}`;
}): Promise<`0x${string}`> {
  const { cfg, signer } = opts;
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: 'settle',
    args: [
      opts.bountyId,
      opts.consensusIndices.map((i) => BigInt(i)),
      opts.confidenceBps,
      opts.consensusAnswerHash,
    ],
  });
  const txHash = await signer.sendTransaction({
    to: cfg.escrow,
    data,
  });
  await publicClientFor(cfg).waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

const STATUS_NAMES = ['None', 'Open', 'Settled', 'Refunded'] as const;

export interface BountyStatus {
  bountyId: string;
  requester: string;
  token: string;
  rewardPerResponse: string;
  responsesRequired: number;
  responsesReceived: number;
  status: string;
  deadline: number;
  responseCount: number;
}

export async function getBountyStatus(
  cfg: RouterConfig,
  bountyId: bigint,
): Promise<BountyStatus> {
  const client = publicClientFor(cfg);
  const [raw, count] = await Promise.all([
    client.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: 'bounties', args: [bountyId] }),
    client.readContract({ address: cfg.escrow, abi: escrowAbi, functionName: 'responseCount', args: [bountyId] }),
  ]);
  // Positional destructure: the ABI infers a mixed tuple, so named access
  // does not typecheck. Order matches ScoutEscrow.Bounty field order.
  const [requester, token, rewardPerResponse, deadline, responsesRequired, responsesReceived, status] =
    raw as unknown as [Address, Address, bigint, bigint, number, number, number];
  return {
    bountyId: bountyId.toString(),
    requester,
    token,
    rewardPerResponse: rewardPerResponse.toString(),
    responsesRequired,
    responsesReceived,
    status: STATUS_NAMES[status] ?? 'Unknown',
    deadline: Number(deadline),
    responseCount: Number(count),
  };
}
