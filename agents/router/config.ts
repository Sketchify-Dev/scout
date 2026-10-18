import type { Address } from 'viem';
import { assertBuilderCode } from './attribution';

/**
 * Default USDC per chain, taken from the official @x402/evm default asset
 * table (node_modules/@x402/evm/dist/cjs/index.js). Both entries are marked
 * there as EIP-3009 supported, which is what the x402 exact scheme needs.
 * Override with USDC_ADDRESS only for a different settlement asset, and note
 * the x402 layer always charges the table default for its network.
 */
export const DEFAULT_USDC: Record<number, Address> = {
  42220: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  11142220: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
};

export interface RouterConfig {
  chainId: 42220 | 11142220;
  rpcUrl: string;
  usdc: Address;
  escrow: Address;
  payTo: Address;
  usdcDecimals: number;
  builderTag: string;
  /** GitHub owner/repo the builder code was derived from, for the startup check. */
  attributionRepo: string | null;
  facilitatorUrl: string | null;
  /** API key for the facilitator's key-gated calls (Celo requires it on /settle). */
  facilitatorApiKey: string | null;
  allowDevBypass: boolean;
  defaultPriceUsdc: string;
  defaultResponses: number;
  defaultTtlSeconds: number;
  agentRouterKey: string | null;
  agentRouterBaseUrl: string;
  agentRouterModel: string | null;
  brainProtocol: 'openai' | 'anthropic';
  routerPrivateKey: `0x${string}` | null;
  privyAppId: string | null;
  privyAppSecret: string | null;
  privyWalletId: string | null;
  privyWalletAddress: Address | null;
  /** First block to scan for Scout events. Defaults to earliest when unset. */
  escrowDeployBlock: bigint | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function isAddress(value: string, name: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Env var ${name} is not an Ethereum address: ${value}`);
  }
  return value as Address;
}

let cached: RouterConfig | null = null;

export function getConfig(): RouterConfig {
  if (cached) return cached;

  const chainId = Number(required('CHAIN_ID'));
  if (chainId !== 42220 && chainId !== 11142220) {
    throw new Error(
      `CHAIN_ID ${chainId} is not supported. Use 42220 (Celo Mainnet) or 11142220 (Celo Sepolia).`,
    );
  }

  const allowDevBypass = process.env.ALLOW_DEV_BYPASS === 'true';
  if (allowDevBypass && chainId === 42220) {
    throw new Error('ALLOW_DEV_BYPASS must never be true on Celo Mainnet.');
  }

  const agentRouterKey = process.env.AGENTROUTER_API_KEY ?? null;
  if (agentRouterKey && !process.env.AGENTROUTER_MODEL) {
    throw new Error(
      'AGENTROUTER_MODEL is required when AGENTROUTER_API_KEY is set. Use the model id from your brain provider console.',
    );
  }
  const brainProtocol = process.env.AGENTROUTER_PROTOCOL ?? 'anthropic';
  if (brainProtocol !== 'openai' && brainProtocol !== 'anthropic') {
    throw new Error('AGENTROUTER_PROTOCOL must be "openai" or "anthropic".');
  }

  const routerPrivateKey = process.env.ROUTER_PRIVATE_KEY ?? null;
  if (routerPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(routerPrivateKey)) {
    throw new Error('ROUTER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.');
  }

  const usdcRaw = process.env.USDC_ADDRESS ?? null;
  const usdc = usdcRaw ? isAddress(usdcRaw, 'USDC_ADDRESS') : DEFAULT_USDC[chainId];

  const privyWalletAddress = process.env.PRIVY_WALLET_ADDRESS ?? null;

  const builderTag = process.env.BUILDER_TAG ?? 'celo_0107eaa60597';
  const attributionRepo = process.env.ATTRIBUTION_REPO ?? null;
  assertBuilderCode(builderTag, attributionRepo);

  cached = {
    chainId,
    rpcUrl: required('CELO_RPC_URL'),
    usdc,
    escrow: isAddress(required('SCOUT_ESCROW_ADDRESS'), 'SCOUT_ESCROW_ADDRESS'),
    payTo: isAddress(required('ROUTER_PAY_TO'), 'ROUTER_PAY_TO'),
    usdcDecimals: Number(process.env.USDC_DECIMALS ?? '6'),
    builderTag,
    attributionRepo,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? null,
    facilitatorApiKey: process.env.X402_API_KEY ?? null,
    allowDevBypass,
    defaultPriceUsdc: process.env.BOUNTY_PRICE_USDC ?? '0.05',
    defaultResponses: Number(process.env.RESPONSES_REQUIRED ?? '3'),
    defaultTtlSeconds: Number(process.env.BOUNTY_TTL_SECONDS ?? '86400'),
    agentRouterKey,
    agentRouterBaseUrl: process.env.AGENTROUTER_BASE_URL ?? 'https://agentrouter.org/v1',
    agentRouterModel: process.env.AGENTROUTER_MODEL ?? null,
    brainProtocol,
    routerPrivateKey: routerPrivateKey as `0x${string}` | null,
    privyAppId: process.env.PRIVY_APP_ID ?? null,
    privyAppSecret: process.env.PRIVY_APP_SECRET ?? null,
    privyWalletId: process.env.PRIVY_WALLET_ID ?? null,
    privyWalletAddress: privyWalletAddress ? isAddress(privyWalletAddress, 'PRIVY_WALLET_ADDRESS') : null,
    escrowDeployBlock: process.env.SCOUT_ESCROW_DEPLOY_BLOCK
      ? BigInt(process.env.SCOUT_ESCROW_DEPLOY_BLOCK)
      : undefined,
  };
  return cached;
}

/** Test hook. Do not call in production code. */
export function resetConfig(): void {
  cached = null;
}
