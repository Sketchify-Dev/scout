/**
 * Register Scout's ERC-8004 identity from the Privy agent wallet.
 *
 * register() mints the identity NFT to msg.sender and publishes msg.sender as
 * the agent's payment wallet, so this must run from the wallet that is also
 * the router's x402 payTo. The hackathon requires this identity, created from
 * the entry's agent wallet, before the Nov 9 cutoff.
 *
 * Usage:
 *   node scripts/register-agent.mts --confirm
 *
 * Before spending gas it fetches ${APP_URL}/agent-registration.json and checks
 * the file is live, parses, and names the same wallet. Refuses if the wallet
 * already holds an identity or deployments/erc8004-42220.json exists, so a
 * retry can never mint a second identity.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http, parseEventLogs, type Address } from 'viem';
import { celo } from 'viem/chains';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { withAttribution } from '@celo/attribution-tags';

process.loadEnvFile('.env');

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const abi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const;

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

if (!process.argv.includes('--confirm')) {
  console.error('Registering spends real CELO on Celo Mainnet. Re-run with --confirm.');
  process.exit(1);
}

const outFile = 'deployments/erc8004-42220.json';
if (existsSync(outFile)) {
  console.error(`${outFile} already exists. Scout is already registered. Use setAgentURI to change the file.`);
  process.exit(1);
}

const appUrl = need('APP_URL').replace(/\/+$/, '');
const agentURI = `${appUrl}/agent-registration.json`;
const walletId = need('PRIVY_WALLET_ID');
const walletAddress = need('PRIVY_WALLET_ADDRESS') as Address;

// The file must be live before the registry points at it.
const res = await fetch(agentURI, { signal: AbortSignal.timeout(15000) });
if (!res.ok) throw new Error(`${agentURI} returned HTTP ${res.status}. Deploy the app first.`);
const file = (await res.json()) as { name?: string; services?: Array<{ name: string; endpoint: string }> };
const walletEntry = file.services?.find((s) => s.name === 'wallet')?.endpoint ?? '';
if (file.name !== 'Scout' || !walletEntry.toLowerCase().endsWith(walletAddress.toLowerCase())) {
  throw new Error(`${agentURI} does not describe Scout with wallet ${walletAddress}. Check APP_URL and the deployment env.`);
}

const rpcUrl = process.env.DEPLOY_RPC_URL ?? 'https://forno.celo.org';
const privy = new PrivyClient({ appId: need('PRIVY_APP_ID'), appSecret: need('PRIVY_APP_SECRET') });
const account = createViemAccount(privy, { walletId, address: walletAddress });
const pub = createPublicClient({ chain: celo, transport: http(rpcUrl) });
// The register() call is a real Mainnet send from the agent wallet, so it
// carries the ERC-8021 builder tag like every other countable transaction.
const wallet = createWalletClient({ account, chain: celo, transport: http(rpcUrl) }).extend(
  withAttribution('celo_0107eaa60597'),
);

const owned = await pub.readContract({ address: IDENTITY_REGISTRY, abi, functionName: 'balanceOf', args: [walletAddress] });
if (owned > BigInt(0)) {
  throw new Error(`${walletAddress} already holds ${owned} ERC-8004 identity. Refusing to mint another.`);
}

const balance = await pub.getBalance({ address: walletAddress });
console.log(`registry   ${IDENTITY_REGISTRY}`);
console.log(`owner      ${walletAddress} (Privy ${walletId})`);
console.log(`agentURI   ${agentURI}`);
console.log(`balance    ${formatEther(balance)} CELO`);

const { request } = await pub.simulateContract({
  account,
  address: IDENTITY_REGISTRY,
  abi,
  functionName: 'register',
  args: [agentURI],
});
const hash = await wallet.writeContract(request);
console.log(`\nregister tx  https://celoscan.io/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') throw new Error(`register reverted: ${hash}`);

// Per the Celo guide, read the id from the event, not the simulated return value,
// which is wrong if someone else registered in between.
const [registered] = parseEventLogs({ abi, eventName: 'Registered', logs: receipt.logs });
if (!registered) throw new Error(`Registered event missing from ${hash}`);
const agentId = registered.args.agentId.toString();

mkdirSync('deployments', { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify(
    {
      chainId: 42220,
      identityRegistry: IDENTITY_REGISTRY,
      agentId,
      agentURI,
      owner: walletAddress,
      txHash: hash,
      block: receipt.blockNumber.toString(),
      registeredAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log(`\nScout is ERC-8004 agent #${agentId}. Wrote ${outFile}.`);
console.log(`Next: set ERC8004_AGENT_ID=${agentId} in the deployment env and redeploy, so the file lists the registration.`);
