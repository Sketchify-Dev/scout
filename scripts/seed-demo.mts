/**
 * Demo seed script: posts a test bounty and submits sample answers so the
 * payout animation can be watched end to end.
 *
 * Fork rehearsals (default) need no keys and touch nothing real: humans are
 * derived from the standard anvil test mnemonic (already funded with gas on
 * any anvil chain), the router is index 0, and router USDC is sourced from a
 * Mainnet whale via impersonation when the fork balance falls short.
 *
 * Mainnet ONLY with --confirm (spends real CELO + USDC): the router signs
 * through Privy and each simulated human needs one funded throwaway key in
 * SEED_HUMAN_KEYS. Never testnets: Celo Sepolia has no USDC for bounties.
 *
 * Usage:
 *   anvil --fork-url https://forno.celo.org --chain-id 42220   # terminal 1
 *   SIM_RPC_URL=http://127.0.0.1:8545 node scripts/seed-demo.mts --answers 85KES,85KES,250KES
 *   SEED_HUMAN_KEYS=0x...,0x...,0x... node scripts/seed-demo.mts --answers 85KES,85KES,250KES --confirm
 */
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, maxUint256, parseEventLogs, parseEther, parseUnits } from 'viem';
import { celo } from 'viem/chains';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { withAttribution } from '@celo/attribution-tags';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';

process.loadEnvFile('.env');

// In fork rehearsals the caller passes chain config inline, which must win
// over .env (the real Mainnet addresses). Explicit vars always win.
for (const name of ['CHAIN_ID', 'CELO_RPC_URL', 'SCOUT_ESCROW_ADDRESS', 'USDC_ADDRESS', 'ROUTER_PRIVATE_KEY', 'PRIVY_WALLET_ID']) {
  const override = process.env[`SEED_${name}`];
  if (override !== undefined) process.env[name] = override;
}
if (process.env.SEED_PRIVY_OFF === '1') delete process.env.PRIVY_WALLET_ID;

/** The mnemonic every anvil chain funds by default. Fork-only, never Mainnet. */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

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
    name: 'submitResponse',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'bountyId', type: 'uint256' },
      { name: 'answer', type: 'string' },
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
] as const;

const argv = process.argv.slice(2);
const answersArg = argv[argv.indexOf('--answers') + 1];
const confirmed = argv.includes('--confirm');

if (!answersArg) {
  console.error('Usage: node scripts/seed-demo.mts --answers 85KES,85KES[,80KES...] [--confirm]');
  process.exit(1);
}
const answers = answersArg.split(',').map((a) => a.trim()).filter(Boolean);
if (answers.length < 2) {
  console.error('Seed needs at least 2 answers for a consensus.');
  process.exit(1);
}
if (new Set(answers).size === 1) {
  console.error('Seed answers must not all agree; include at least one outlier for the theater.');
  process.exit(1);
}

if (confirmed) {
  if (process.env.CHAIN_ID !== '42220') {
    console.error('Refusing: --confirm requires CHAIN_ID=42220 (Celo Mainnet).');
    process.exit(1);
  }
} else if (process.env.SIM_RPC_URL || (process.env.CELO_RPC_URL ?? '').includes('127.0.0.1')) {
  // Fork rehearsal: no confirmation needed, nothing real moves.
} else {
  console.error('Refusing: without --confirm, point CELO_RPC_URL at a local anvil fork, not a public RPC.');
  process.exit(1);
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const builderTag = process.env.BUILDER_TAG ?? 'celo_0107eaa60597';
const usdc = need('USDC_ADDRESS') as `0x${string}`;
const escrow = need('SCOUT_ESCROW_ADDRESS') as `0x${string}`;
const ttlSeconds = Number(process.env.BOUNTY_TTL_SECONDS ?? '86400');
const priceUsdc = process.env.BOUNTY_PRICE_USDC ?? '0.05';
const rpcUrl = process.env.SIM_RPC_URL ?? need('CELO_RPC_URL');

const chain = { ...celo, rpcUrls: { default: { http: [rpcUrl] } } } as typeof celo;
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const rpcChainId = await client.getChainId();
if (rpcChainId !== 42220) {
  console.error(`Refusing: RPC reports chain ${rpcChainId}, expected Celo Mainnet (42220) or a fork of it.`);
  process.exit(1);
}

// --- Wallets ---
let routerAddress: `0x${string}`;
let routerSend: (tx: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
const humanAccounts: { address: `0x${string}`; send: (tx: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`> }[] = [];

if (confirmed) {
  // Mainnet: router signs through Privy, humans bring their own throwaway keys.
  const privyWalletId = process.env.PRIVY_WALLET_ID;
  if (!privyWalletId) throw new Error('Mainnet seeds need PRIVY_WALLET_ID (the router signs through Privy).');
  const privy = new PrivyClient({ appId: need('PRIVY_APP_ID'), appSecret: need('PRIVY_APP_SECRET') });
  const account = createViemAccount(privy, { walletId: privyWalletId, address: need('PRIVY_WALLET_ADDRESS') as `0x${string}` });
  const router = createWalletClient({ account, chain, transport: http(rpcUrl) }).extend(withAttribution(builderTag));
  routerAddress = account.address;
  routerSend = (tx) => router.sendTransaction({ ...tx, value: BigInt(0) });

  const keys = (process.env.SEED_HUMAN_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean) as `0x${string}`[];
  if (keys.length < answers.length) {
    console.error(`SEED_HUMAN_KEYS holds ${keys.length} key(s) but ${answers.length} answers were given.`);
    process.exit(1);
  }
  for (const key of keys.slice(0, answers.length)) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      console.error('SEED_HUMAN_KEYS must be comma-separated 0x-prefixed 32-byte keys. Check each key is 66 chars.');
      process.exit(1);
    }
    const account = privateKeyToAccount(key);
    const w = createWalletClient({ account, chain, transport: http(rpcUrl) }).extend(withAttribution(builderTag));
    humanAccounts.push({ address: account.address, send: (tx) => w.sendTransaction({ ...tx, value: BigInt(0) }) });
  }
  for (const [i, h] of humanAccounts.entries()) {
    const bal = await client.getBalance({ address: h.address });
    if (bal === BigInt(0)) {
      console.error(`Human ${i + 1} (${h.address}) has no CELO for gas. Fund it before seeding.`);
      process.exit(1);
    }
  }
} else {
  // Fork rehearsal: everything derives from the anvil test mnemonic, whose
  // accounts anvil funds with gas automatically. No keys to mistype.
  const mnemonic = process.env.SEED_HUMAN_MNEMONIC ?? ANVIL_MNEMONIC;
  const indices = (process.env.SEED_HUMAN_INDICES ?? '1,2,3').split(',').map((s) => Number(s.trim()));
  if (indices.length < answers.length) {
    console.error(`SEED_HUMAN_INDICES holds ${indices.length} indice(s) but ${answers.length} answers were given.`);
    process.exit(1);
  }
  const routerAccount = mnemonicToAccount(mnemonic, { addressIndex: 0 });
  const router = createWalletClient({ account: routerAccount, chain, transport: http(rpcUrl) }).extend(
    withAttribution(builderTag),
  );
  routerAddress = routerAccount.address;
  routerSend = (tx) => router.sendTransaction({ ...tx, value: BigInt(0) });
  for (const index of indices.slice(0, answers.length)) {
    const account = mnemonicToAccount(mnemonic, { addressIndex: index });
    const w = createWalletClient({ account, chain, transport: http(rpcUrl) }).extend(withAttribution(builderTag));
    humanAccounts.push({ address: account.address, send: (tx) => w.sendTransaction({ ...tx, value: BigInt(0) }) });
  }
}

console.log(`rpc          ${rpcUrl}`);
console.log(`mode         ${confirmed ? 'MAINNET (real funds)' : 'fork rehearsal'}`);
console.log(`router       ${routerAddress}`);
console.log(`question     What is maize selling for in Kisumu market today?`);
console.log(`answers      ${answers.map((a, i) => `${humanAccounts[i].address.slice(0, 8)}: ${a}`).join(' | ')}`);

const total = parseUnits(priceUsdc, 6);
const rewardPerResponse = total / BigInt(answers.length);

// On a fork the router may hold no Mainnet USDC. Source it from a whale via
// impersonation (local chain only; impossible on Mainnet, where the router
// must already be funded).
const routerUsdc = (await client.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [routerAddress],
})) as bigint;
if (routerUsdc < total) {
  if (confirmed) throw new Error(`Router holds ${routerUsdc} base units of USDC, need ${total}. Fund it first.`);
  // Fork-only transfer: this whale impersonation cannot run on Mainnet (the
  // confirmed path throws above), and fork rehearsals move no real funds, so
  // this send is not a countable deal and carries no attribution suffix.
  const testClient = createTestClient({ chain, mode: 'anvil', transport: http(rpcUrl) });
  const latest = await client.getBlockNumber();
  const fromBlock = latest > BigInt(2000) ? latest - BigInt(2000) : BigInt(0);
  const logs = await client.getContractEvents({
    address: usdc,
    abi: erc20Abi,
    eventName: 'Transfer',
    fromBlock,
    toBlock: latest,
  });
  let whale: `0x${string}` | null = null;
  const seen = new Set<string>();
  for (const log of logs) {
    const to = (log.args as { to?: `0x${string}` }).to;
    if (!to || seen.has(to.toLowerCase()) || seen.size > 60) continue;
    seen.add(to.toLowerCase());
    const bal = (await client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [to],
    })) as bigint;
    if (bal >= total) {
      whale = to;
      break;
    }
  }
  if (!whale) throw new Error('No USDC whale found in recent transfers. Fund the fork router manually.');
  await testClient.impersonateAccount({ address: whale });
  await testClient.setBalance({ address: whale, value: parseEther('1') });
  const whaleClient = createWalletClient({ account: whale, chain, transport: http(rpcUrl) });
  const fundHash = await whaleClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [routerAddress, total],
    account: whale,
  });
  await client.waitForTransactionReceipt({ hash: fundHash });
  await testClient.stopImpersonatingAccount({ address: whale });
  console.log(`funded       ${total} base USDC from whale ${whale.slice(0, 10)}... (${fundHash.slice(0, 10)}...)`);
}

// Same approve-then-create shape the router uses.
const allowance = (await client.readContract({
  address: usdc,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [routerAddress, escrow],
})) as bigint;
if (allowance < total) {
  const approveHash = await routerSend({
    to: usdc,
    data: (await import('viem')).encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [escrow, maxUint256],
    }),
  });
  await client.waitForTransactionReceipt({ hash: approveHash });
  console.log(`approved      ${approveHash}`);
}

const QUESTION = 'What is maize selling for in Kisumu market today?';
const createTx = await routerSend({
  to: escrow,
  data: (await import('viem')).encodeFunctionData({
    abi: escrowAbi,
    functionName: 'createBounty',
    args: [usdc, rewardPerResponse, answers.length, BigInt(Math.floor(Date.now() / 1000) + ttlSeconds), QUESTION],
  }),
});
const createReceipt = await client.waitForTransactionReceipt({ hash: createTx });
const created = parseEventLogs({ abi: escrowAbi, logs: createReceipt.logs, eventName: 'BountyCreated' })[0];
if (!created) throw new Error(`BountyCreated event not found in ${createTx}`);
const bountyId = (created.args as { bountyId: bigint }).bountyId;
console.log(`\nbounty #${bountyId} posted: ${createTx}`);

for (const [i, answer] of answers.entries()) {
  const h = humanAccounts[i];
  const hash = await h.send({
    to: escrow,
    data: (await import('viem')).encodeFunctionData({
      abi: escrowAbi,
      functionName: 'submitResponse',
      args: [bountyId, answer],
    }),
  });
  await client.waitForTransactionReceipt({ hash });
  console.log(`answer ${i + 1} ("${answer}") submitted: ${hash}`);
}

const base = process.env.APP_URL ?? 'http://localhost:3000';
console.log(`\nWatch it: open ${base}/agent, find bounty #${bountyId}, and press "Judge consensus and pay".`);
console.log('The seed stops before settling on purpose; the payout animation runs from the UI.');
