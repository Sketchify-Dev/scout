import type { Address, Hash } from 'viem';
import { publicClientFor } from './clients';
import type { RouterConfig } from './config';

/**
 * Read-only views over ScoutEscrow for the explorer and bounty pages.
 *
 * Everything here is reconstructed from chain state and event logs, never
 * from session memory, so a bounty page shows the same truth to every
 * visitor. The one thing the chain does not hold is the verifier's prose
 * summary; pages that need it get it from the live settle response only.
 */

const explorerAbi = [
  {
    type: 'function',
    name: 'nextBountyId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
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
  {
    type: 'event',
    name: 'BountySettled',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'confidenceBps', type: 'uint16', indexed: false },
      { name: 'paidCount', type: 'uint256', indexed: false },
      { name: 'refunded', type: 'uint256', indexed: false },
      { name: 'consensusAnswerHash', type: 'bytes32', indexed: false },
      { name: 'forced', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ResponderPaid',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'responder', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PayoutDeferred',
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'claimable',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const STATUS_NAMES = ['None', 'Open', 'Settled', 'Refunded'] as const;
export type ChainStatus = (typeof STATUS_NAMES)[number];

/** Bounties beyond this are not listed; the explorer is a window, not an archive. */
const LIST_LIMIT = 60;
const CHUNK = BigInt(4000);

export interface BountySummary {
  bountyId: string;
  question: string;
  requester: Address;
  rewardPerResponse: string;
  responsesRequired: number;
  responsesReceived: number;
  status: ChainStatus;
  deadline: number;
  createdTx: Hash | null;
  createdBlock: string | null;
}

interface CreatedCache {
  key: string;
  scannedTo: bigint;
  byId: Map<string, { question: string; tx: Hash; block: bigint }>;
}

let createdCache: CreatedCache | null = null;

function cacheKey(cfg: RouterConfig): string {
  return `${cfg.chainId}|${cfg.rpcUrl}|${cfg.escrow.toLowerCase()}`;
}

/**
 * BountyCreated lookup for specific ids, newest block first.
 *
 * The old index scanned oldest-first from the deploy block, which on a cold
 * start meant hundreds of chunked RPC calls before reaching a bounty posted
 * yesterday. Recent bounties then rendered as "(question not found in logs)"
 * while older ones resolved fine. Scanning backwards and stopping as soon as
 * every requested id is found makes the cost proportional to how new the
 * bounty is, which is exactly the common case: the page someone just posted.
 */
async function createdEvents(
  cfg: RouterConfig,
  needed: Set<string>,
): Promise<Map<string, { question: string; tx: Hash; block: bigint }>> {
  const client = publicClientFor(cfg);
  const found = new Map<string, { question: string; tx: Hash; block: bigint }>();

  // Serve anything already in the cache before touching the network.
  if (createdCache && createdCache.key === cacheKey(cfg)) {
    for (const id of needed) {
      const hit = createdCache.byId.get(id);
      if (hit) found.set(id, hit);
    }
  }
  if (found.size === needed.size) return found;

  const floor = cfg.escrowDeployBlock ?? BigInt(0);
  let to = await client.getBlockNumber();
  while (to >= floor && found.size < needed.size) {
    const from = to - CHUNK + BigInt(1) >= floor ? to - CHUNK + BigInt(1) : floor;
    const logs = await client.getContractEvents({
      address: cfg.escrow,
      abi: explorerAbi,
      eventName: 'BountyCreated',
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const args = log.args as { bountyId?: bigint; prompt?: string };
      if (args.bountyId === undefined || typeof args.prompt !== 'string') continue;
      const id = args.bountyId.toString();
      const entry = {
        question: args.prompt,
        tx: log.transactionHash as Hash,
        block: log.blockNumber as bigint,
      };
      // Cache every creation seen, not only the requested ones: the list
      // endpoint asks for a window and neighbouring pages benefit.
      if (!createdCache || createdCache.key !== cacheKey(cfg)) {
        createdCache = { key: cacheKey(cfg), scannedTo: BigInt(0), byId: new Map() };
      }
      createdCache.byId.set(id, entry);
      if (needed.has(id)) found.set(id, entry);
    }
    if (from === floor) break;
    to = from - BigInt(1);
  }
  return found;
}

async function readBounty(cfg: RouterConfig, bountyId: bigint) {
  const client = publicClientFor(cfg);
  const raw = (await client.readContract({
    address: cfg.escrow,
    abi: explorerAbi,
    functionName: 'bounties',
    args: [bountyId],
  })) as unknown as [Address, Address, bigint, bigint, number, number, number, Hash];
  const [requester, , rewardPerResponse, deadline, responsesRequired, responsesReceived, status] = raw;
  return {
    requester,
    rewardPerResponse: rewardPerResponse.toString(),
    deadline: Number(deadline),
    responsesRequired,
    responsesReceived,
    status: STATUS_NAMES[status] ?? 'None',
  };
}

/** Newest bounties first, capped at LIST_LIMIT. */
export async function listBounties(cfg: RouterConfig): Promise<BountySummary[]> {
  const client = publicClientFor(cfg);
  const next = (await client.readContract({
    address: cfg.escrow,
    abi: explorerAbi,
    functionName: 'nextBountyId',
  })) as bigint;
  const last = next - BigInt(1);
  if (last < BigInt(1)) return [];
  const ids: bigint[] = [];
  for (let id = last; id >= BigInt(1) && ids.length < LIST_LIMIT; id--) ids.push(id);
  const [states, created] = await Promise.all([
    Promise.all(ids.map((id) => readBounty(cfg, id))),
    createdEvents(cfg, new Set(ids.map((id) => id.toString()))),
  ]);
  return ids.map((id, i) => {
    const hit = created.get(id.toString());
    return {
      bountyId: id.toString(),
      question: hit?.question ?? '(question not found in logs)',
      ...states[i],
      createdTx: hit?.tx ?? null,
      createdBlock: hit?.block.toString() ?? null,
    };
  });
}

export interface BountyAnswerView {
  responseIndex: number;
  responder: Address;
  answer: string;
  txHash: Hash;
  block: string;
}

export interface SettlementView {
  txHash: Hash;
  block: string;
  confidenceBps: number;
  paidCount: number;
  refunded: string;
  consensusAnswerHash: Hash;
  forced: boolean;
  paid: Array<{ responder: Address; amount: string }>;
  deferred: Array<{ recipient: Address; amount: string }>;
}

export interface BountyDetail extends BountySummary {
  answers: BountyAnswerView[];
  settlement: SettlementView | null;
}

export interface ContributionView {
  bountyId: string;
  question: string;
  answer: string;
  txHash: Hash;
  status: ChainStatus;
  responsesReceived: number;
  responsesRequired: number;
  deadline: number;
  /** null while the bounty is unsettled. */
  outcome: 'paid' | 'claimable' | 'not-paid' | null;
  amount: string | null;
}

/**
 * Everything one wallet has answered, with outcomes, from indexed event
 * filters (responder is an indexed topic, so each chunk is one cheap query).
 */
export async function getContributorHistory(cfg: RouterConfig, responder: Address): Promise<ContributionView[]> {
  const client = publicClientFor(cfg);
  const head = await client.getBlockNumber();
  const floor = cfg.escrowDeployBlock ?? BigInt(0);
  const answered: Array<{ bountyId: bigint; answer: string; txHash: Hash }> = [];
  const paid = new Map<string, string>();
  const deferred = new Map<string, string>();

  for (let from = floor; from <= head; from += CHUNK) {
    const to = from + CHUNK - BigInt(1) < head ? from + CHUNK - BigInt(1) : head;
    const [resp, paidLogs, deferredLogs] = await Promise.all([
      client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'ResponseSubmitted', args: { responder }, fromBlock: from, toBlock: to }),
      client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'ResponderPaid', args: { responder }, fromBlock: from, toBlock: to }),
      client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'PayoutDeferred', args: { recipient: responder }, fromBlock: from, toBlock: to }),
    ]);
    for (const log of resp) {
      const a = log.args as { bountyId?: bigint; answer?: string };
      if (a.bountyId === undefined || typeof a.answer !== 'string') continue;
      answered.push({ bountyId: a.bountyId, answer: a.answer, txHash: log.transactionHash as Hash });
    }
    for (const log of paidLogs) {
      const p = log.args as { bountyId?: bigint; amount?: bigint };
      if (p.bountyId !== undefined) paid.set(p.bountyId.toString(), (p.amount ?? BigInt(0)).toString());
    }
    for (const log of deferredLogs) {
      const d = log.args as { bountyId?: bigint; amount?: bigint };
      if (d.bountyId !== undefined) deferred.set(d.bountyId.toString(), (d.amount ?? BigInt(0)).toString());
    }
  }

  // Only the bounties this person answered need their prompt resolved.
  const cache = await createdEvents(cfg, new Set(answered.map((a) => a.bountyId.toString())));
  const views = await Promise.all(
    answered.map(async (a) => {
      const state = await readBounty(cfg, a.bountyId);
      const key = a.bountyId.toString();
      const settled = state.status === 'Settled';
      const outcome: ContributionView['outcome'] = !settled
        ? null
        : paid.has(key)
          ? 'paid'
          : deferred.has(key)
            ? 'claimable'
            : 'not-paid';
      return {
        bountyId: key,
        question: cache.get(key)?.question ?? '(question not found in logs)',
        answer: a.answer,
        txHash: a.txHash,
        status: state.status,
        responsesReceived: state.responsesReceived,
        responsesRequired: state.responsesRequired,
        deadline: state.deadline,
        outcome,
        amount: paid.get(key) ?? deferred.get(key) ?? null,
      };
    }),
  );
  return views.sort((x, y) => Number(BigInt(y.bountyId) - BigInt(x.bountyId)));
}

export interface ClaimableBalance {
  token: Address;
  amount: string;
}

/**
 * What this wallet can withdraw right now via claim(token): USDC credited
 * after a failed push payment. Reads the contract mapping directly, so the
 * button only appears when there is something to claim.
 */
export async function getClaimable(cfg: RouterConfig, account: Address): Promise<ClaimableBalance[]> {
  const client = publicClientFor(cfg);
  const amount = (await client.readContract({
    address: cfg.escrow,
    abi: explorerAbi,
    functionName: 'claimable',
    args: [cfg.usdc, account],
  })) as bigint;
  if (amount === BigInt(0)) return [];
  return [{ token: cfg.usdc, amount: amount.toString() }];
}

/** Full chain-reconstructed story of one bounty, or null when it does not exist. */
export async function getBountyDetail(cfg: RouterConfig, bountyId: bigint): Promise<BountyDetail | null> {
  const state = await readBounty(cfg, bountyId);
  if (state.status === 'None') return null;

  const client = publicClientFor(cfg);
  const created = (await createdEvents(cfg, new Set([bountyId.toString()]))).get(bountyId.toString());
  // Everything about a bounty happens after it was created, so scans start there.
  const floor = created?.block ?? cfg.escrowDeployBlock ?? BigInt(0);
  const head = await client.getBlockNumber();

  const answers: BountyAnswerView[] = [];
  let settlement: SettlementView | null = null;
  const paid: SettlementView['paid'] = [];
  const deferred: SettlementView['deferred'] = [];

  for (let from = floor; from <= head; from += CHUNK) {
    const to = from + CHUNK - BigInt(1) < head ? from + CHUNK - BigInt(1) : head;
    const [resp, settled, paidLogs, deferredLogs] = await Promise.all([
      client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'ResponseSubmitted', args: { bountyId }, fromBlock: from, toBlock: to }),
      state.status === 'Settled'
        ? client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'BountySettled', args: { bountyId }, fromBlock: from, toBlock: to })
        : Promise.resolve([]),
      state.status === 'Settled'
        ? client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'ResponderPaid', args: { bountyId }, fromBlock: from, toBlock: to })
        : Promise.resolve([]),
      state.status === 'Settled'
        ? client.getContractEvents({ address: cfg.escrow, abi: explorerAbi, eventName: 'PayoutDeferred', args: { bountyId }, fromBlock: from, toBlock: to })
        : Promise.resolve([]),
    ]);
    for (const log of resp) {
      const a = log.args as { responder?: Address; responseIndex?: bigint; answer?: string };
      if (!a.responder || a.responseIndex === undefined || typeof a.answer !== 'string') continue;
      answers.push({
        responseIndex: Number(a.responseIndex),
        responder: a.responder,
        answer: a.answer,
        txHash: log.transactionHash as Hash,
        block: (log.blockNumber as bigint).toString(),
      });
    }
    for (const log of settled) {
      const s = log.args as {
        confidenceBps?: number;
        paidCount?: bigint;
        refunded?: bigint;
        consensusAnswerHash?: Hash;
        forced?: boolean;
      };
      settlement = {
        txHash: log.transactionHash as Hash,
        block: (log.blockNumber as bigint).toString(),
        confidenceBps: Number(s.confidenceBps ?? 0),
        paidCount: Number(s.paidCount ?? BigInt(0)),
        refunded: (s.refunded ?? BigInt(0)).toString(),
        consensusAnswerHash: (s.consensusAnswerHash ?? '0x') as Hash,
        forced: Boolean(s.forced),
        paid,
        deferred,
      };
    }
    for (const log of paidLogs) {
      const p = log.args as { responder?: Address; amount?: bigint };
      if (p.responder) paid.push({ responder: p.responder, amount: (p.amount ?? BigInt(0)).toString() });
    }
    for (const log of deferredLogs) {
      const d = log.args as { recipient?: Address; amount?: bigint };
      if (d.recipient) deferred.push({ recipient: d.recipient, amount: (d.amount ?? BigInt(0)).toString() });
    }
    // Stop early once everything the contract says exists has been found.
    if (answers.length >= state.responsesReceived && (state.status !== 'Settled' || settlement)) break;
  }

  answers.sort((a, b) => a.responseIndex - b.responseIndex);
  return {
    bountyId: bountyId.toString(),
    question: created?.question ?? '(question not found in logs)',
    ...state,
    createdTx: created?.tx ?? null,
    createdBlock: created?.block.toString() ?? null,
    answers,
    settlement,
  };
}
