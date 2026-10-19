'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  PrivyProvider,
  addRpcUrlOverrideToChain,
  useCreateWallet,
  useExportWallet,
  useLogout,
  useMfaEnrollment,
  usePrivy,
  useSendTransaction,
  useSetWalletRecovery,
  useWallets,
} from '@privy-io/react-auth';
import { toDataSuffix } from '@celo/attribution-tags';
import { concat, encodeFunctionData, type Hex } from 'viem';
import { celo } from 'viem/chains';

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';
const ESCROW = (process.env.NEXT_PUBLIC_SCOUT_ESCROW ?? '') as `0x${string}`;
const BUILDER_TAG = process.env.NEXT_PUBLIC_BUILDER_TAG ?? 'celo_0107eaa60597';
/** Settlement asset for person-to-person sends (Mainnet USDC). Same value as the API's table default. */
const USDC = (process.env.NEXT_PUBLIC_USDC ?? '0xcebA9300f2b948710d2653dD7B07f33A8B32118C') as `0x${string}`;
/** Set only for fork rehearsals, so embedded wallets broadcast to the local fork. */
const RPC_OVERRIDE = process.env.NEXT_PUBLIC_CHAIN_RPC ?? '';

const CHAIN = RPC_OVERRIDE ? addRpcUrlOverrideToChain(celo, RPC_OVERRIDE) : celo;

const SUBMIT_ABI = [
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
] as const;

const CLAIM_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const;

const TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface ScoutAuth {
  /** False when no Privy app id is configured; every page must still render. */
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | null;
  /** Email, phone, or Google account the person signed in with. */
  identity: string | null;
  logout: () => Promise<void>;
  submitAnswer: (bountyId: string, answer: string) => Promise<{ hash: string }>;
  /** Withdraw USDC credited after a failed push payment. Tagged like every other send. */
  claimRewards: (token: `0x${string}`) => Promise<{ hash: string }>;
  /**
   * Opens the Privy export modal, where the person copies their private key
   * or seed phrase into another wallet (MiniPay, MetaMask). Scout never sees
   * the key: it loads in a Privy-hosted iframe on a separate domain.
   */
  exportWallet: () => Promise<void>;
  /**
   * Wallet recovery password (Privy-hosted): protects the encrypted key
   * backup so a stolen login alone cannot restore the wallet elsewhere.
   * Runs in a Privy modal; Scout never sees the password.
   */
  setWalletPassword: () => Promise<void>;
  /** MFA methods enrolled on this account (sms, totp, passkey). */
  mfaMethods: Array<'sms' | 'totp' | 'passkey'>;
  /** Open Privy's MFA enrollment modal (TOTP authenticator or SMS). */
  enrollMfa: () => void;
  /**
   * Send USDC from the person's own wallet to any address. Self-custody: the
   * embedded wallet signs, Scout only relays. Carries the builder tag like
   * every other transaction.
   */
  sendUsdc: (to: `0x${string}`, amountBaseUnits: bigint) => Promise<{ hash: string }>;
}

const DISABLED: ScoutAuth = {
  enabled: false,
  ready: true,
  authenticated: false,
  address: null,
  identity: null,
  logout: async () => {},
  submitAnswer: async () => {
    throw new Error('Login is not configured on this deployment.');
  },
  claimRewards: async () => {
    throw new Error('Login is not configured on this deployment.');
  },
  exportWallet: async () => {
    throw new Error('Login is not configured on this deployment.');
  },
  setWalletPassword: async () => {
    throw new Error('Login is not configured on this deployment.');
  },
  mfaMethods: [],
  enrollMfa: () => {
    throw new Error('Login is not configured on this deployment.');
  },
  sendUsdc: async () => {
    throw new Error('Login is not configured on this deployment.');
  },
};

const Ctx = createContext<ScoutAuth>(DISABLED);

function Bridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { logout } = useLogout();
  const { exportWallet } = useExportWallet();
  const { sendTransaction } = useSendTransaction();
  const { createWallet } = useCreateWallet();
  const { setWalletRecovery } = useSetWalletRecovery();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const mfaMethods = (user?.mfaMethods ?? []) as Array<'sms' | 'totp' | 'passkey'>;

  // Prefer the Privy embedded wallet: it is the one created for this person.
  // createOnLogin should have made one already; if auth completed before the
  // wallet did (slow provisioning), create it explicitly so nobody waits.
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0] ?? null;
  const creating = useRef(false);
  useEffect(() => {
    if (ready && authenticated && !wallet && !creating.current) {
      creating.current = true;
      createWallet().catch(() => {
        creating.current = false;
      });
    }
    if (wallet) creating.current = false;
  }, [ready, authenticated, wallet, createWallet]);
  const address = (wallet?.address ?? user?.wallet?.address ?? null) as `0x${string}` | null;
  const identity = user?.email?.address ?? user?.phone?.number ?? user?.google?.email ?? null;

  const doExportWallet = useCallback(async () => {
    if (!address) throw new Error('Sign in first.');
    await exportWallet({ address });
  }, [address, exportWallet]);

  const setWalletPassword = useCallback(async () => {
    if (!address) throw new Error('Sign in first.');
    await setWalletRecovery();
  }, [address, setWalletRecovery]);

  const enrollMfa = useCallback(() => {
    if (!address) throw new Error('Sign in first.');
    showMfaEnrollmentModal();
  }, [address, showMfaEnrollmentModal]);

  const submitAnswer = useCallback(
    async (bountyId: string, answer: string) => {
      if (!address) throw new Error('Sign in first.');
      if (!ESCROW) throw new Error('Escrow address is not configured (NEXT_PUBLIC_SCOUT_ESCROW).');
      const call = encodeFunctionData({
        abi: SUBMIT_ABI,
        functionName: 'submitResponse',
        args: [BigInt(bountyId), answer],
      });
      // ERC-8021 attribution on the human's own transaction, same code as the router.
      const data = concat([call, toDataSuffix(BUILDER_TAG) as Hex]);
      const receipt = await sendTransaction(
        { to: ESCROW, data, chainId: celo.id },
        { address, uiOptions: { showWalletUIs: false } },
      );
      return { hash: receipt.hash };
    },
    [address, sendTransaction],
  );

  const claimRewards = useCallback(
    async (token: `0x${string}`) => {
      if (!address) throw new Error('Sign in first.');
      if (!ESCROW) throw new Error('Escrow address is not configured (NEXT_PUBLIC_SCOUT_ESCROW).');
      const call = encodeFunctionData({
        abi: CLAIM_ABI,
        functionName: 'claim',
        args: [token],
      });
      // ERC-8021 attribution on the human's own transaction, same code as the router.
      const data = concat([call, toDataSuffix(BUILDER_TAG) as Hex]);
      const receipt = await sendTransaction(
        { to: ESCROW, data, chainId: celo.id },
        { address, uiOptions: { showWalletUIs: false } },
      );
      return { hash: receipt.hash };
    },
    [address, sendTransaction],
  );

  const sendUsdc = useCallback(
    async (to: `0x${string}`, amountBaseUnits: bigint) => {
      if (!address) throw new Error('Sign in first.');
      if (!USDC) throw new Error('USDC address is not configured (NEXT_PUBLIC_USDC).');
      if (amountBaseUnits <= BigInt(0)) throw new Error('Enter an amount above zero.');
      const call = encodeFunctionData({
        abi: TRANSFER_ABI,
        functionName: 'transfer',
        args: [to, amountBaseUnits],
      });
      // ERC-8021 attribution on the human's own transaction, same code as the router.
      const data = concat([call, toDataSuffix(BUILDER_TAG) as Hex]);
      const receipt = await sendTransaction(
        { to: USDC, data, chainId: celo.id },
        { address, uiOptions: { showWalletUIs: false } },
      );
      return { hash: receipt.hash };
    },
    [address, sendTransaction],
  );

  const value = useMemo<ScoutAuth>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      address,
      identity,
      logout,
      submitAnswer,
      claimRewards,
      exportWallet: doExportWallet,
      sendUsdc,
      setWalletPassword,
      mfaMethods,
      enrollMfa,
    }),
    [ready, authenticated, address, identity, logout, submitAnswer, claimRewards, doExportWallet, sendUsdc, setWalletPassword, mfaMethods, enrollMfa],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ScoutAuthProvider({ children }: { children: React.ReactNode }) {
  if (!APP_ID) return <Ctx.Provider value={DISABLED}>{children}</Ctx.Provider>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ['email', 'sms', 'google'],
        appearance: {
          theme: 'light',
          accentColor: '#06302A',
          logo: '/scout-icon.svg',
          landingHeader: 'Sign in to Scout',
          loginMessage: 'Get paid for what you can see.',
          showWalletLoginFirst: false,
        },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

export function useScoutAuth(): ScoutAuth {
  return useContext(Ctx);
}
