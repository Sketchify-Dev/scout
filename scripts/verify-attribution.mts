/**
 * Prove the ERC-8021 builder tag lands on Mainnet bounty transactions.
 *
 * Read-only: fetches the tx input from Forno and decodes the trailing
 * attribution suffix with the official SDK. Exits non-zero when the tag is
 * missing so CI (or a pre-submission check) fails loudly.
 *
 * Usage:
 *   node scripts/verify-attribution.mts --tx 0x...
 *   node scripts/verify-attribution.mts --bounty 14   (uses the bounty's creation tx)
 */
import { createPublicClient, http } from 'viem';
import { celo } from 'viem/chains';
import { verifyTx } from '@celo/attribution-tags';

process.loadEnvFile('.env');

const argv = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const txArg = flagValue('--tx');
const bountyArg = flagValue('--bounty');

const EXPECTED = process.env.BUILDER_TAG ?? 'celo_0107eaa60597';
const ESCROW = (process.env.SCOUT_ESCROW_ADDRESS ?? '0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6') as `0x${string}`;
const RPC = process.env.CELO_RPC_URL ?? 'https://forno.celo.org';

const pub = createPublicClient({ chain: celo, transport: http(RPC) });

async function creationTx(bountyId: bigint): Promise<`0x${string}`> {
  const CHUNK = 4000n;
  const head = await pub.getBlockNumber();
  const floor = process.env.SCOUT_ESCROW_DEPLOY_BLOCK ? BigInt(process.env.SCOUT_ESCROW_DEPLOY_BLOCK) : 0n;
  const abi = [
    {
      type: 'event', name: 'BountyCreated',
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
  // Newest-first: the common case is a recently posted bounty.
  let to = head;
  while (to >= floor) {
    const from = to - CHUNK + 1n >= floor ? to - CHUNK + 1n : floor;
    const logs = await pub.getContractEvents({
      address: ESCROW, abi, eventName: 'BountyCreated',
      args: { bountyId }, fromBlock: from, toBlock: to,
    });
    if (logs.length > 0) return logs[0].transactionHash;
    if (from === floor) break;
    to = from - 1n;
  }
  throw new Error(`BountyCreated event not found for bounty ${bountyId}.`);
}

let hash: `0x${string}`;
if (txArg) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txArg)) throw new Error('--tx must be a 0x transaction hash.');
  hash = txArg as `0x${string}`;
} else if (bountyArg) {
  hash = await creationTx(BigInt(bountyArg));
  console.log(`bounty ${bountyArg} creation tx: ${hash}`);
} else {
  console.error('Usage: node scripts/verify-attribution.mts --tx 0x... | --bounty <id>');
  process.exit(1);
}

const decoded = await verifyTx({ client: pub, hash });
console.log(`tx        ${hash}`);
console.log(`codes     ${decoded ? decoded.codes.join(', ') : '(no attribution suffix found)'}`);
if (!decoded || !decoded.codes.includes(EXPECTED)) {
  console.error(`FAIL: expected builder code ${EXPECTED} in tx input.`);
  process.exit(1);
}
console.log(`PASS: ${EXPECTED} attributed (schema ${decoded.schemaId}).`);
