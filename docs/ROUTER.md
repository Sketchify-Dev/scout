# Scout Router: run guide

One `next dev` runs the whole demo: the router agent is `GET /api/ask`, the
demo read endpoint is `GET /api/bounty/<id>`, and the frontend (next) calls both.

## Endpoints

- `GET /api/ask?q=<question>` without payment returns **402** with the official
  x402 payment requirements (exact scheme, Celo network, USDC, payTo).
- Same URL with an `X-PAYMENT` header returns **200** with
  `{ bountyId, escrowTxHash, settlement, pricing }` after settling first and
  posting the bounty to `ScoutEscrow` second.
- `GET /api/bounty/<id>` returns escrow state. Unpaid, for the demo UI.

## Modes

| Mode | How | When |
|---|---|---|
| Dev bypass | No `X402_FACILITATOR_URL`, `ALLOW_DEV_BYPASS=true` | Sepolia testing without a facilitator. Refused on Mainnet by config. |
| Facilitator | `X402_FACILITATOR_URL` set | Any paid traffic. The facilitator must support the Celo network in use. |

## Brain: stub vs AgentRouter

No key configured means the deterministic `StubDecider` runs: flat price,
exact-match consensus, always available. Setting `AGENTROUTER_API_KEY` plus
`AGENTROUTER_MODEL` enables the hosted path, and any hosted failure (bad key,
timeout, off-peak window closed) falls back to the stub automatically. The
response always names its `quoteSource`, so a demo can show which path ran.

AgentRouter notes: OpenAI-compatible base `https://agentrouter.org/v1`, key
from `https://agentrouter.org/console/token`. If the key only works in an
off-peak window, leave it configured: in-window requests get LLM quotes,
out-of-window requests degrade to the stub instead of erroring.

## Wallet: local key vs Privy

Sepolia dev can use `ROUTER_PRIVATE_KEY` (the router refuses it on Mainnet).
Mainnet uses the Privy server wallet (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`,
`PRIVY_WALLET_ID`, `PRIVY_WALLET_ADDRESS`). Either way, `ROUTER_PAY_TO` must be
that same wallet address, because settlements land there and bounties are
funded from there. The route checks this on every paid call.

## Quick demo (dev bypass, Sepolia)

```bash
cp .env.example .env
# fill CHAIN_ID, CELO_RPC_URL, SCOUT_ESCROW_ADDRESS, ROUTER_PAY_TO, ROUTER_PRIVATE_KEY
npm run dev
# 1. see the 402:
curl 'http://localhost:3000/api/ask?q=What+is+maize+selling+for+in+Kisumu'
# 2. paid path without a facilitator (dev bypass settles nothing, posts bounty):
#    same call returns 200 with bountyId + escrowTxHash
# 3. check escrow state:
curl http://localhost:3000/api/bounty/1
```

## Seeded demo (watch the payout animation end to end)

`scripts/seed-demo.mts` posts a bounty from the router wallet and submits
sample answers from human wallets, so `/agent` has a real bounty to settle:

```bash
anvil --fork-url https://forno.celo.org   # fork rehearsal: nothing real moves
SEED_HUMAN_KEYS=0x...,0x...,0x... SIM_RPC_URL=http://127.0.0.1:8545 \
  node scripts/seed-demo.mts --answers 85KES,85KES,250KES
# Mainnet (spends real CELO + USDC):
SEED_HUMAN_KEYS=0x...,0x...,0x... \
  node scripts/seed-demo.mts --answers 85KES,85KES,250KES --confirm
```

Rules baked in: Mainnet requires `--confirm` plus `CHAIN_ID=42220`;
without `--confirm` any public RPC is refused, only a local fork is allowed;
testnets are never allowed (Celo Sepolia has no USDC for bounties, so the
seed would revert on the first approve). Answers must not all agree, so the
theater always has an outlier. Settle from the UI afterward: the seed stops
before settling on purpose.

## Verified against installed packages (not memory)

- x402 v2.28.0: `x402ResourceServer`, `x402HTTPResourceServer`,
  `HTTPFacilitatorClient` from `@x402/core/server`; `ExactEvmScheme` from
  `@x402/evm`; route key format `GET /api/ask`; settlement headers attached to
  the 200 response.
- Celo in the default asset table: Mainnet USDC `0xceba...32118C` (plus USDT
  and USAT), Sepolia USDC `0x01C5...BC44E`, all 6 decimals and EIP-3009.
  These are the defaults in `agents/router/config.ts`.
- Privy `@privy-io/node` 0.35.0: `new PrivyClient({ appId, appSecret })` plus
  `createViemAccount(privy, { walletId, address })` from the package root.

## Still to verify before Mainnet

- A facilitator that supports Celo (exact scheme) for both Sepolia testing
  and Mainnet submission, and its URL for `X402_FACILITATOR_URL`.
- The ERC-8021 tag encoding in `agents/router/attribution.ts` (safe trailing
  bytes, but confirm the exact format counts for attribution).
- USDC EIP-3009 behavior on the deployed Celo tokens (the x402 layer needs it;
  `createBounty` approve path works regardless).
