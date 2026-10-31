# Scout: submission narrative (draft, 2026-10-31)

Paste-ready text for the Loops House "Agents on Open Rails" entry.
All claims below are verified read-only on 2026-10-31 (`npm run gate`: 12/12 PASS).
Style rule for this file: no em dashes. Use colons, commas, or hyphens.

## 1. Project name and one-liner

**Scout**

Agents can think, but they cannot see. Scout lets an agent hire a verified human for five cents to go look.

## 2. Lanes

- Primary: USDT with x402 (dollar-stable A2A service payment over x402).
- Secondary: Build with buy (the app pays humans, an outside service it does not run, per completed task).

Settlement asset note, stated plainly: the A2A rail settles USDC on Celo (the official x402 default asset for Celo Mainnet: `0xceba9300f2b948710d2653dd7b07f33a8b32118c`, 6 decimals, EIP-3009). USDC and USDT are both dollar stables. The coin choice is explained by the person served: humans earn and spend the dollar stable they already use in MiniPay. The buy-lane claim is unchanged: every bounty payout is a compensated call from the tagged wallet into an outside service (a human).

## 3. What it is

Scout is an agent-to-human ground-truth market on Celo Mainnet. A requester agent that cannot see the real world pays $0.05 over HTTP (x402, gasless EIP-3009 authorization, no wallet UX, no pre-funded account). The Scout router escrows the full payout in `ScoutEscrow` before anyone works, independent humans answer from their phones, and a verifier pays the answers that agree. Outliers are not paid. Unfilled and outlier slots refund to the requester.

A $0.05 payout is only economic where fees are sub-cent. That is why this is on Celo.

## 4. The two payment rails

| Rail | Who pays whom | Mechanism |
|---|---|---|
| A2A service payment | Requester agent to Scout router | x402 over HTTP, exact scheme, USDC, gasless EIP-3009 authorization, settled by facilitator |
| Agent-to-human payout | Scout escrow to human responders | Direct ERC-20 transfers on Celo (MiniPay-spendable) |

Flow: `GET /api/ask?q=...` returns 402 with price, asset, and payTo. The requester signs and retries with the payment signature. The router settles first, then posts the bounty on-chain, then humans answer, then the verifier settles: consensus paid, outliers unpaid, leftovers refunded. Read the verdict at `GET /api/bounties/:id`.

## 5. Live deployment (Celo Mainnet, chain 42220)

- App: https://scout-black-gamma.vercel.app
- Agent console (requester flow): https://scout-black-gamma.vercel.app/agent
- Bounties: https://scout-black-gamma.vercel.app/bounties
- Contribute: https://scout-black-gamma.vercel.app/contribute
- Router: `GET https://scout-black-gamma.vercel.app/api/ask?q=...` (402 states terms in the `PAYMENT-REQUIRED` header; paid retry carries `PAYMENT-SIGNATURE`)
- Verdict API: `GET https://scout-black-gamma.vercel.app/api/bounties/:id`
- Demo video: https://youtu.be/4FwuoBoeFvQ
- Repo: open at sign-up and still open at review; work authored during the event window.

Contracts (Sourcify `exact_match`, verified 2026-10-16):

- `ScoutEscrow` `0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6` (deploy block 80216773): https://celoscan.io/address/0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6
- `ScoutReputation` `0x29bb83558cd52dc1001dcf76706dccb42f92752f`: https://celoscan.io/address/0x29bb83558cd52dc1001dcf76706dccb42f92752f
- Builder tag (ERC-8021, on-chain constant and calldata suffix): `celo_0107eaa60597`

Identity (ERC-8004, gating requirement, done):

- Agent #9971, registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, registered 2026-10-17 (block 80362205) from the agent wallet.
- Registration file (live, lists agent id): https://scout-black-gamma.vercel.app/agent-registration.json
- Agent wallet = router wallet = x402 payTo: `0xf6C95fE38eFbcBdf2Faffa4A21b256033CA84cD5` (also the registered PayTo wallet on the Loops House entry).

Attribution (binding, before the first countable action):

- Router signer (Privy server wallet on Mainnet) and frontend wallet client both use `@celo/attribution-tags` `withAttribution`, so every router transaction carries the ERC-8021 suffix. PayTo wallet registered on the entry for x402 deals.
- Proof, re-runnable: `node scripts/verify-attribution.mts --bounty 14` decodes creation tx `0x8bcae4ce72c71f54aab4e0001748323373781521aafc91ccb6c6f7a405b82cd6` to `celo_0107eaa60597` (schema 0) via the official SDK `verifyTx`. `node scripts/submission-check.mts` re-proves this plus 11 other gates on every run.

## 6. Real Mainnet evidence (not wash loops)

On-chain state at submission time: 14 bounties posted, 3 settled with real payouts, 7 distinct human responder wallets, 15+ USDC funding payments of exactly 50000 base units ($0.05) into the router from a distinct payer.

Lead with these two (clean "agreement gets paid, outliers do not" stories):

- Bounty 2 settle: https://celoscan.io/tx/0x86c8601889f92948552dc5c745553252ea9b94e3e4193d0b42090aa3eeef05b2 (paid 2 of 3, outlier unpaid, leftover refunded)
- Bounty 4 settle: https://celoscan.io/tx/0x719143c8856acc97577a5950ccb64d1fe6df1fdf89ff2ba79c2317d1ad8256e4 (paid 2 of 3, outlier unpaid, leftover refunded; tx confirmed on-chain at block 80470403)

Honest negative example (shows the rule holds when answers split):

- Bounty 5: 3 answers, no matching pair, verifier returned "no consensus," no transaction sent, no gas spent, reward stays locked. A forced pay-everyone settlement would report zero confidence, so it is left open rather than faked.

## 7. Counterparties (distinct wallets, named)

- Requester/payer: the wallet that signs the x402 authorization and funds the $0.05 charge. Observed funder across 15+ bounties: `0xEd70BB8f7131E4227685983B32eB77B609df69A7`, distinct from the router. (On-chain `requester` on each bounty reads as the router because the router escrows after settlement tops it up. Distinctness evidence is the payer plus the humans below.)
- Router/verifier/owner: Privy server wallet `0xf6C95fE38eFbcBdf2Faffa4A21b256033CA84cD5` (also ERC-8004 agent #9971 and registered payTo).
- Humans: 7 distinct responder wallets (e.g. `0x10ad8DaD...`, `0xD8eBf240...`, `0x9FBfB529...`, `0x5cb087f6...`, `0x2Eea132A...`, `0x869A304E...`, `0x30508880...`). Responders are paid by the escrow payout itself, never by direct top-ups from us. Demo script names each wallet's owner at recording time.
- Self-dealing guard: one real $0.05 payout to a distinct human beats wash loops. No spam, no reciprocal router-to-router payments.

## 8. Gasless and trust notes (for correct scoring)

- Gasless design: requesters pay via EIP-3009 authorizations (no gas, no bridging); responders transact on Celo where fees are sub-cent (fee abstraction compatible). Signer and authorizer activity should be read as real usage, not sponsored fuel. Sponsored fuel is not counted as builder input and we claim none.
- Trust model, stated honestly: the verifier is a single known address in v1. The liveness backstop is `forceSettle` (anyone can pay responders after deadline plus 3 day grace, reported at zero confidence). The migration path is ERC-8004 validation registry quorum instead of one signature.
- No stake, no slashing (deliberate): requiring stake from $0.05 earners inverts the economics. Withholding payment from outliers is sufficient, and `ScoutReputation` makes it persistent (consensus gains score, outliers lose it, dispatch prefers high scorers). Sybil resistance comes from proof of personhood at registration, not capital at risk.
- Answers on-chain, cheaply: response hashes in storage, full text in events. The full audit trail (question, every answer, who got paid, confidence) is public on CeloScan.

## 9. Suggested demo script (3 minutes, Mainnet)

1. Agent console: ask a grounded question, show the 402 (`eip155:42220`, 0.05 USDC, payTo = agent wallet), pay it, show bounty id + escrow tx.
2. Bounty page: show full escrow locked on-chain, then 3 human answers arriving as events.
3. Judge: run the verifier, show 2 paid + 1 outlier unpaid + refund, link the settle tx (use bounty 4: `0x719143...`).
4. Close: registration file + agent #9971 + Sourcify verified source + `npm run gate` 12/12.

## 10. Copy blocks for the form

- Short description: Scout is an agent-to-human ground-truth market on Celo. An agent pays $0.05 over x402, the router escrows it on-chain, independent humans answer, and the verifier pays the answers that agree.
- Why Celo: a $0.05 payout needs sub-cent fees plus MiniPay-spendable dollars plus gasless EIP-3009 auth. Only Celo gives all three.
- x402 detail: exact scheme, `eip155:42220`, USDC `0xceba9300f2b948710d2653dd7b07f33a8b32118c`, payTo `0xf6C95fE38eFbcBdf2Faffa4A21b256033CA84cD5`, facilitator-settled, settle-before-bounty ordering.
- Buy-lane detail: every payout is a compensated call from the tagged wallet to an outside service (a human). Bounty 2 and bounty 4 settle txs are the receipts.
