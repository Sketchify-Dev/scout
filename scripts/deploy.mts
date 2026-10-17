/**
 * Deploy ScoutReputation + ScoutEscrow from the Privy agent wallet.
 *
 * Privy server wallets never expose a raw private key, so this signs through
 * Privy's viem account instead of `forge script`. Deploy transactions carry
 * no attribution suffix on purpose: they are not countable deals, and the
 * marker encoding is verified separately before the first bounty.
 *
 * Usage:
 *   forge build
 *   node scripts/deploy.mts --network mainnet --confirm
 *
 * Refuses to run twice for the same chain (deployments/<chainId>.json exists)
 * unless --force is passed, so a retry can never double-spend deploy gas.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { celo, celoSepolia } from 'viem/chains';
import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';

process.loadEnvFile('.env');

const argv = process.argv.slice(2);
const network = argv[argv.indexOf('--network') + 1];
const confirmed = argv.includes('--confirm');
const force = argv.includes('--force');

if (network !== 'mainnet' && network !== 'sepolia') {
  console.error('Usage: node scripts/deploy.mts --network mainnet|sepolia [--confirm] [--force]');
  process.exit(1);
}
const chain = network === 'mainnet' ? celo : celoSepolia;
const rpcUrl =
  process.env.DEPLOY_RPC_URL ??
  (network === 'mainnet' ? 'https://forno.celo.org' : 'https://forno.celo-sepolia.celo-testnet.org');

if (network === 'mainnet' && !confirmed) {
  console.error('Mainnet deploy spends real CELO. Re-run with --confirm.');
  process.exit(1);
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const walletId = need('PRIVY_WALLET_ID');
const walletAddress = need('PRIVY_WALLET_ADDRESS') as Address;
const owner = (process.env.OWNER ?? walletAddress) as Address;
const verifier = (process.env.VERIFIER ?? walletAddress) as Address;
const humanRegistry = (process.env.HUMAN_REGISTRY ?? zeroAddress) as Address;

const outFile = `deployments/${chain.id}.json`;
if (existsSync(outFile) && !force) {
  console.error(`${outFile} already exists. Scout is already deployed on this chain. Pass --force to deploy again.`);
  process.exit(1);
}

function artifact(path: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}
const repArt = artifact('contracts/out/ScoutReputation.sol/ScoutReputation.json');
const escArt = artifact('contracts/out/ScoutEscrow.sol/ScoutEscrow.json');

const privy = new PrivyClient({ appId: need('PRIVY_APP_ID'), appSecret: need('PRIVY_APP_SECRET') });
const account = createViemAccount(privy, { walletId, address: walletAddress });
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

const rpcChainId = await pub.getChainId();
if (rpcChainId !== chain.id) throw new Error(`RPC reports chain ${rpcChainId}, expected ${chain.id}.`);

const balance = await pub.getBalance({ address: walletAddress });
console.log(`network        ${chain.name} (${chain.id})`);
console.log(`deployer       ${walletAddress} (Privy ${walletId})`);
console.log(`balance        ${formatEther(balance)} CELO`);
console.log(`owner          ${owner}`);
console.log(`verifier       ${verifier}`);
console.log(`humanRegistry  ${humanRegistry}${humanRegistry === zeroAddress ? '  (personhood gate OFF until the Self adapter is set)' : ''}`);
if (balance === BigInt(0)) throw new Error('Deployer has no CELO for gas.');

const explorer = chain.id === 42220 ? 'https://celoscan.io' : 'https://sepolia.celoscan.io';

async function deploy(label: string, art: { abi: Abi; bytecode: Hex }, args: unknown[]) {
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  console.log(`\n${label} tx  ${explorer}/tx/${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${label} deploy failed: ${hash}`);
  console.log(`${label}      ${receipt.contractAddress}  (block ${receipt.blockNumber})`);
  return { address: receipt.contractAddress, txHash: hash, block: receipt.blockNumber };
}

const reputation = await deploy('ScoutReputation', repArt, [owner]);
const escrow = await deploy('ScoutEscrow', escArt, [owner, verifier, humanRegistry, reputation.address]);

let setWriterTx: Hex | null = null;
if (owner.toLowerCase() === walletAddress.toLowerCase()) {
  setWriterTx = await wallet.writeContract({
    address: reputation.address,
    abi: repArt.abi,
    functionName: 'setWriter',
    args: [escrow.address, true],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: setWriterTx });
  if (receipt.status !== 'success') throw new Error(`setWriter failed: ${setWriterTx}`);
  console.log(`\nsetWriter tx  ${explorer}/tx/${setWriterTx}`);
} else {
  console.log(`\nOWNER is not the deployer. Owner must call ScoutReputation.setWriter(${escrow.address}, true) before the first settle.`);
}

const after = await pub.getBalance({ address: walletAddress });
console.log(`\ngas spent      ${formatEther(balance - after)} CELO`);

mkdirSync('deployments', { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify(
    {
      chainId: chain.id,
      builderTag: 'celo_0107eaa60597',
      deployer: walletAddress,
      owner,
      verifier,
      humanRegistry,
      ScoutReputation: { address: reputation.address, txHash: reputation.txHash, block: reputation.block.toString() },
      ScoutEscrow: { address: escrow.address, txHash: escrow.txHash, block: escrow.block.toString() },
      setWriterTx,
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${outFile}`);
console.log(`\n.env lines:\nSCOUT_ESCROW_ADDRESS=${escrow.address}\nSCOUT_ESCROW_DEPLOY_BLOCK=${escrow.block}`);
