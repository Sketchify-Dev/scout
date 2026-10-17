import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import { withAttribution } from '@celo/attribution-tags';
import { createWalletClient, http, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { chainFor } from './clients';
import type { RouterConfig } from './config';

export interface RouterSigner {
  readonly address: Address;
  sendTransaction(tx: { to: Address; data: Hex; value?: bigint }): Promise<Hash>;
}

/** Local private-key signer. Fine for Sepolia dev, never for Mainnet. */
export class LocalSigner implements RouterSigner {
  readonly address: Address;
  private readonly send: (tx: { to: Address; data: Hex; value?: bigint }) => Promise<Hash>;

  constructor(cfg: RouterConfig) {
    if (!cfg.routerPrivateKey) {
      throw new Error(
        'No signer configured. Set PRIVY_WALLET_ID (plus Privy creds) or ROUTER_PRIVATE_KEY. See .env.example.',
      );
    }
    if (cfg.chainId === 42220) {
      throw new Error('ROUTER_PRIVATE_KEY must never fund Mainnet bounties. Use the Privy server wallet.');
    }
    const account = privateKeyToAccount(cfg.routerPrivateKey);
    this.address = account.address;
    const client = createWalletClient({
      account,
      chain: chainFor(cfg),
      transport: http(cfg.rpcUrl),
    }).extend(withAttribution(cfg.builderTag));
    this.send = (tx) =>
      client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? BigInt(0) });
  }

  sendTransaction(tx: { to: Address; data: Hex; value?: bigint }): Promise<Hash> {
    return this.send(tx);
  }
}

/** Privy server-wallet signer. This is the Mainnet path for the agent wallet. */
export class PrivySigner implements RouterSigner {
  readonly address: Address;
  private readonly send: (tx: { to: Address; data: Hex; value?: bigint }) => Promise<Hash>;

  private constructor(
    address: Address,
    send: (tx: { to: Address; data: Hex; value?: bigint }) => Promise<Hash>,
  ) {
    this.address = address;
    this.send = send;
  }

  static async create(cfg: RouterConfig): Promise<PrivySigner> {
    if (!cfg.privyAppId || !cfg.privyAppSecret || !cfg.privyWalletId || !cfg.privyWalletAddress) {
      throw new Error(
        'Privy signer needs PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_WALLET_ID and PRIVY_WALLET_ADDRESS. See .env.example.',
      );
    }
    const privy = new PrivyClient({ appId: cfg.privyAppId, appSecret: cfg.privyAppSecret });
    const account = createViemAccount(privy, {
      walletId: cfg.privyWalletId,
      address: cfg.privyWalletAddress,
    });
    const client = createWalletClient({
      account,
      chain: chainFor(cfg),
      transport: http(cfg.rpcUrl),
    }).extend(withAttribution(cfg.builderTag));
    const address = cfg.privyWalletAddress;
    return new PrivySigner(address, (tx) =>
      client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? BigInt(0) }),
    );
  }

  sendTransaction(tx: { to: Address; data: Hex; value?: bigint }): Promise<Hash> {
    return this.send(tx);
  }
}

export async function getSigner(cfg: RouterConfig): Promise<RouterSigner> {
  if (cfg.privyWalletId) return PrivySigner.create(cfg);
  return new LocalSigner(cfg);
}
