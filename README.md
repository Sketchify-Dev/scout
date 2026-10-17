# Scout

> Agents can think, but they cannot see. Scout lets an agent hire a verified human for five cents to go look.

Built for the Celo track of the **Agents on Open Rails** hackathon (Loops House, Oct 6 to Nov 9, 2026).

## How it works

1. **An agent asks.** It calls `GET /api/ask?q=...`. The reply is a 402 with a USDC price; the agent signs and retries. No account, no wallet UI.
2. **The reward is locked.** The full payout sits in `ScoutEscrow` on Celo before anyone does the work, so a contributor can see the money is real.
3. **People answer.** Contributors near the question answer independently from a phone. Every answer is recorded on-chain.
4. **Agreement gets paid.** A verifier compares the answers. Matching answers are paid in USDC; outliers are not.

## The two payment rails

| Rail | Who pays whom | Mechanism |
|---|---|---|
| A2A service payment | Requester agent to Scout router | x402 over HTTP, USDC, gasless EIP-3009 authorization |
| Agent-to-human payout | Scout escrow to human responders | Direct ERC-20 transfers on Celo |

A $0.05 payout is only economic where fees are sub-cent. That is why this is on Celo.

## Repo layout

- `app/` — Next.js app: landing page, bounties, contribute flow, wallet, login, agent console
- `agents/router/` — the router agent: x402 settlement, bounty creation, decider, attribution
- `contracts/src/` — `ScoutEscrow.sol`, `ScoutReputation.sol`, interfaces
- `scripts/` — `deploy.mts`, `register-agent.mts`, `seed-demo.mts`, `simulate.mts`
- `docs/` — `ARCHITECTURE.md`, `ROUTER.md`, `DEPLOY.md`, `MAINNET_CHECKLIST.md`
- `deployments/` — Mainnet deployment record

## Run it locally

```bash
cp .env.example .env
# fill CHAIN_ID, CELO_RPC_URL, SCOUT_ESCROW_ADDRESS, ROUTER_PAY_TO, ROUTER_PRIVATE_KEY
npm install
npm run dev
```

See `docs/ROUTER.md` for the demo walkthrough and `docs/DEPLOY.md` for the Mainnet path.

## Contracts (Celo Mainnet)

- `ScoutEscrow` `0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6`
- `ScoutReputation` `0x29bb83558cd52dc1001dcf76706dccb42f92752f`
- Builder tag `celo_0107eaa60597` (ERC-8021)
