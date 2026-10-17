# Scout: deploy guide

Target: Celo Mainnet (chain id 42220). Only Mainnet counts for the hackathon.
The deployer, owner, verifier, and router are all the Privy agent wallet for
v1, so one funded wallet runs everything.

## Why not `forge script`

Privy server wallets never expose a raw private key, so Foundry cannot sign
for them. Foundry only compiles. Signing goes through Privy's viem account in
`scripts/deploy.mts`.

## 1. Compile

```bash
forge build
```

Artifacts land in `contracts/out/`.

## 2. Rehearse locally (free, mandatory before Mainnet)

```bash
anvil --chain-id 11142220 &
node scripts/simulate.mts
```

Runs the exact transaction shapes the router sends (max approve,
createBounty with the attribution suffix, three responses, settle, and both
backstops) and asserts every balance. It must print `ALL CHECKS PASSED`.

## 3. Deploy to Mainnet

Needs in `.env`: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID`,
`PRIVY_WALLET_ADDRESS`. The wallet needs a little CELO for gas.

```bash
node scripts/deploy.mts --network mainnet --confirm
```

Optional overrides: `OWNER`, `VERIFIER`, `HUMAN_REGISTRY`, `DEPLOY_RPC_URL`.
The script refuses to deploy twice to the same chain unless `--force` is
passed, and writes `deployments/42220.json` with addresses, tx hashes, and
blocks.

## 4. Verify source

No API key needed via Sourcify:

```bash
forge verify-contract <address> contracts/src/ScoutEscrow.sol:ScoutEscrow \
  --chain 42220 --verifier sourcify
```

CeloScan's own verification needs a free Etherscan API key
(`--verifier etherscan --etherscan-api-key <key>`).

## 5. Point the router at the deployment

Copy the printed lines into `.env`, and switch the chain:

```bash
CHAIN_ID=42220
CELO_RPC_URL=https://forno.celo.org
SCOUT_ESCROW_ADDRESS=<from deploy output>
SCOUT_ESCROW_DEPLOY_BLOCK=<from deploy output>
ALLOW_DEV_BYPASS=false
```

Remove any `USDC_ADDRESS` override so the router uses Mainnet USDC.

## Gates before the first countable bounty

Deploying is not a countable deal. These must be done before the first
bounty, because attribution can never be credited retroactively:

- ERC-8021 marker encoding verified against celo-org/attribution-tags
  BUILDERS.md (`agents/router/attribution.ts` is still a placeholder format).
- ERC-8004 identity registered from the agent wallet.
- A Celo-supporting x402 facilitator set in `X402_FACILITATOR_URL`.
- `HUMAN_REGISTRY` is zero at deploy (personhood gate off). The owner can
  set the Self adapter later with `setHumanRegistry`, no redeploy needed.
