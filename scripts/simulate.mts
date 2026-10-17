/**
 * Full-loop rehearsal on a local anvil chain, run before anything touches
 * Mainnet. Deploys a mock USDC plus the real Scout contracts, then runs the
 * exact transaction shapes the router sends: max approve, createBounty with
 * the attribution suffix, three human responses, verifier settle, and both
 * liveness backstops (forceSettle, refundExpired). Every balance and every
 * reputation change is asserted. Exits non-zero on the first mismatch.
 *
 * Usage:
 *   forge build
 *   anvil --chain-id 11142220 &
 *   node scripts/simulate.mts
 */
import { readFileSync } from 'node:fs';
import { fromDataSuffix, toDataSuffix } from '@celo/attribution-tags';
import {
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  maxUint256,
  parseEventLogs,
  stringToHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from 'viem';

const RPC = process.env.SIM_RPC_URL ?? 'http://127.0.0.1:8545';
const TAG = 'celo_0107eaa60597';

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

function artifact(path: string): Artifact {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const usdcArt = artifact('contracts/out/MockUSDC.sol/MockUSDC.json');
const repArt = artifact('contracts/out/ScoutReputation.sol/ScoutReputation.json');
const escArt = artifact('contracts/out/ScoutEscrow.sol/ScoutEscrow.json');

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${String(actual)}${ok ? '' : `  (expected ${String(expected)})`}`);
  if (!ok) failures += 1;
}

// Same ERC-8021 suffix the router's withAttribution client appends, so this
// proves the escrow's ABI decoder ignores it.
const SUFFIX = toDataSuffix(TAG) as Hex;
function tag(data: Hex): Hex {
  return concat([data, SUFFIX]);
}

const probe = createPublicClient({ transport: http(RPC) });
const chainId = await probe.getChainId();
const chain = defineChain({
  id: chainId,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ chain, transport: http(RPC) });
const testClient = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
const accounts = await wallet.getAddresses();
const [router, h1, h2, h3, stranger] = accounts;

async function deploy(art: Artifact, args: unknown[]): Promise<Address> {
  const hash = await wallet.deployContract({ account: router, abi: art.abi, bytecode: art.bytecode, args });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`Deploy produced no address: ${hash}`);
  return receipt.contractAddress;
}

async function send(from: Address, to: Address, data: Hex) {
  const hash = await wallet.sendTransaction({ account: from, to, data });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

async function expectRevert(label: string, from: Address, functionName: string, args: unknown[], errorName: string) {
  try {
    await pub.simulateContract({ account: from, address: escrow, abi: escArt.abi, functionName, args });
    check(label, 'no revert', `revert ${errorName}`);
  } catch (error) {
    check(label, String(error).includes(errorName) ? `revert ${errorName}` : `wrong revert: ${String(error).slice(0, 120)}`, `revert ${errorName}`);
  }
}

const usdcBalance = async (who: Address) =>
  (await pub.readContract({ address: token, abi: usdcArt.abi, functionName: 'balanceOf', args: [who] })) as bigint;
const bountyStatus = async (id: bigint) => {
  const raw = (await pub.readContract({ address: escrow, abi: escArt.abi, functionName: 'bounties', args: [id] })) as unknown[];
  return Number(raw[6]);
};
const score = (who: Address) =>
  pub.readContract({ address: reputation, abi: repArt.abi, functionName: 'score', args: [who] });
const escrowCall = (functionName: string, args: unknown[]) =>
  encodeFunctionData({ abi: escArt.abi, functionName, args });
const now = async () => Number((await pub.getBlock()).timestamp);

// --- Setup ---
const token = await deploy(usdcArt, []);
const reputation = await deploy(repArt, [router]);
const escrow = await deploy(escArt, [router, router, zeroAddress, reputation]);
await send(router, reputation, encodeFunctionData({ abi: repArt.abi, functionName: 'setWriter', args: [escrow, true] }));
await send(router, token, encodeFunctionData({ abi: usdcArt.abi, functionName: 'mint', args: [router, 1_000_000n] }));
console.log(`chain ${chainId}  token ${token}  reputation ${reputation}  escrow ${escrow}\n`);

check('builder tag constant', await pub.readContract({ address: escrow, abi: escArt.abi, functionName: 'BUILDER_TAG' }), TAG);

// --- Bounty 1: the happy path with one outlier ---
await send(router, token, tag(encodeFunctionData({ abi: usdcArt.abi, functionName: 'approve', args: [escrow, maxUint256] })));
const created = await send(
  router,
  escrow,
  tag(escrowCall('createBounty', [token, 16_666n, 3, BigInt((await now()) + 3600), 'What is maize selling for in Kisumu market today?'])),
);
const bountyId = (parseEventLogs({ abi: escArt.abi, logs: created.logs, eventName: 'BountyCreated' })[0] as unknown as { args: { bountyId: bigint } }).args.bountyId;
check('bounty 1 id', bountyId, 1n);
const createdTx = await pub.getTransaction({ hash: created.transactionHash });
check('ERC-8021 suffix decodes to builder code', fromDataSuffix(createdTx.input)?.codes.join(','), TAG);
check('escrow holds full payout up front', await usdcBalance(escrow), 49_998n);

await send(h1, escrow, tag(escrowCall('submitResponse', [bountyId, '85 KES'])));
await expectRevert('same human cannot answer twice', h1, 'submitResponse', [bountyId, '85 KES'], 'AlreadyResponded');
await send(h2, escrow, tag(escrowCall('submitResponse', [bountyId, '85 KES'])));
await send(h3, escrow, tag(escrowCall('submitResponse', [bountyId, '250 KES'])));
await expectRevert('fourth answer rejected when full', stranger, 'submitResponse', [bountyId, 'late'], 'ResponsesFull');
await expectRevert('non-verifier cannot settle', stranger, 'settle', [bountyId, [0n, 1n], 6667, keccak256(stringToHex('85 KES'))], 'NotVerifier');
await expectRevert('unsorted indices rejected', router, 'settle', [bountyId, [1n, 0n], 6667, keccak256(stringToHex('85 KES'))], 'IndicesNotSorted');
await expectRevert('out-of-range index rejected', router, 'settle', [bountyId, [0n, 5n], 6667, keccak256(stringToHex('85 KES'))], 'IndexOutOfRange');

await send(router, escrow, tag(escrowCall('settle', [bountyId, [0n, 1n], 6667, keccak256(stringToHex('85 KES'))])));
check('agreer 1 paid', await usdcBalance(h1), 16_666n);
check('agreer 2 paid', await usdcBalance(h2), 16_666n);
check('outlier unpaid', await usdcBalance(h3), 0n);
check('outlier slot refunded to router', await usdcBalance(router), 966_668n);
check('escrow empty after settle', await usdcBalance(escrow), 0n);
check('bounty 1 status Settled', await bountyStatus(bountyId), 2);
check('agreer 1 reputation +1', await score(h1), 1n);
check('outlier reputation -1', await score(h3), -1n);
await expectRevert('cannot settle twice', router, 'settle', [bountyId, [0n], 5000, keccak256(stringToHex('85 KES'))], 'BountyNotOpen');

// --- Bounty 2: verifier goes dark, anyone can force-settle after grace ---
const b2 = await send(router, escrow, escrowCall('createBounty', [token, 10_000n, 2, BigInt((await now()) + 600), 'Is the Kigali bus park pharmacy open?']));
const bounty2 = (parseEventLogs({ abi: escArt.abi, logs: b2.logs, eventName: 'BountyCreated' })[0] as unknown as { args: { bountyId: bigint } }).args.bountyId;
await send(h1, escrow, escrowCall('submitResponse', [bounty2, 'yes, open']));
await expectRevert('force-settle blocked before grace', stranger, 'forceSettle', [bounty2], 'GraceNotElapsed');
await testClient.increaseTime({ seconds: 600 + 3 * 86_400 + 1 });
await testClient.mine({ blocks: 1 });
const forced = await send(stranger, escrow, escrowCall('forceSettle', [bounty2]));
const settledEvt = parseEventLogs({ abi: escArt.abi, logs: forced.logs, eventName: 'BountySettled' })[0] as unknown as { args: { forced: boolean; confidenceBps: number } };
check('force-settle flagged as forced', settledEvt.args.forced, true);
check('force-settle reports zero confidence', settledEvt.args.confidenceBps, 0);
check('responder paid by stranger after grace', await usdcBalance(h1), 26_666n);
check('unfilled slot refunded', await usdcBalance(router), 956_668n);

// --- Bounty 3: nobody answers, anyone can refund the requester ---
const b3 = await send(router, escrow, escrowCall('createBounty', [token, 5_000n, 2, BigInt((await now()) + 60), 'Unanswered question']));
const bounty3 = (parseEventLogs({ abi: escArt.abi, logs: b3.logs, eventName: 'BountyCreated' })[0] as unknown as { args: { bountyId: bigint } }).args.bountyId;
await expectRevert('refund blocked before deadline', stranger, 'refundExpired', [bounty3], 'DeadlineNotPassed');
await testClient.increaseTime({ seconds: 61 });
await testClient.mine({ blocks: 1 });
await send(stranger, escrow, escrowCall('refundExpired', [bounty3]));
check('bounty 3 status Refunded', await bountyStatus(bounty3), 3);
check('requester made whole', await usdcBalance(router), 956_668n);
check('escrow empty at the end', await usdcBalance(escrow), 0n);
check('no money created or lost', (await usdcBalance(router)) + (await usdcBalance(h1)) + (await usdcBalance(h2)), 1_000_000n);

// --- Seed a fresh router account for the HTTP route test ---
const routeRouter = accounts[5];
await send(router, token, encodeFunctionData({ abi: usdcArt.abi, functionName: 'mint', args: [routeRouter, 1_000_000n] }));
console.log(`\nroute-test env: SCOUT_ESCROW_ADDRESS=${escrow} USDC_ADDRESS=${token} ROUTER_PAY_TO=${routeRouter}`);
console.log(`route-test humans: ${accounts[6]} ${accounts[7]} ${accounts[8]}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
