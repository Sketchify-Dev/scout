# Scout: Architecture

> Agents can think, but they cannot see. Scout lets an agent hire a verified human
> for five cents to go look.

Celo track, "Agents on Open Rails" (Loops House). Submission deadline: 2026-11-09.

## 1. The two payment rails

Scout deliberately uses two different rails, because they solve two different problems.

| Rail | Who pays whom | Mechanism | Why this one |
|---|---|---|---|
| **A2A service payment** | Requester Agent -> Scout Router | x402 over HTTP, USDC, EIP-3009 gasless authorization | The requester is software. It should pay for a service in-band, in the same request, with no wallet UX and no pre-funded account. |
| **Agent-to-human payout** | Scout Escrow -> human responders | Direct ERC-20 transfers on Celo | Payouts are ~$0.05. They must be final, auditable, and land in a wallet the recipient already spends from (MiniPay). |

Rail A is why this is an *agent* project. Rail B is why it can only be Celo:
a $0.05 payout is not economic anywhere that fees are $0.30.

## 2. Pipeline

```
Requester Agent                Scout Router              Humans            Verifier Agent
      |                             |                       |                     |
      |-- GET /ask?q=... ---------->|                       |                     |
      |<-- 402 Payment Required ----|                       |                     |
      |   (price, asset, payTo)     |                       |                     |
      |                             |                       |                     |
      |-- GET + X-PAYMENT --------->|                       |                     |
      |                             |-- settle via          |                     |
      |                             |   facilitator         |                     |
      |                             |                       |                     |
      |                             |-- createBounty() ---------------------->(on-chain escrow)
      |                             |-- dispatch task ----->|                     |
      |                             |                       |-- submitResponse()->|
      |                             |                       |   (N humans)        |
      |                             |                       |                     |
      |                             |<-- consensus + confidence ------------------|
      |                             |                       |<-- settle() pays consensus
      |<-- 200 {answer, confidence, |                       |                     |
      |         txHash, responders} |                       |                     |
```

## 3. Trust model, stated honestly

For v1 the **verifier is a single known address**. It decides which responses are in
consensus. That is a centralized trust assumption and we say so out loud rather than
pretending otherwise. The migration path is ERC-8004's validation registry: multiple
independent validators attest, and `settle` accepts a quorum of attestations instead of
one signature. The contract is written so that swapping this is an access-control change,
not a redesign.

## 4. Design decision: no stake, no slashing

The obvious mechanism for punishing bad answers is to make responders post stake and
slash it. We are not doing that, for two reasons:

1. **It inverts the economics.** Nobody stakes $5 to earn $0.05. Requiring stake from
   micro-earners in emerging markets defeats the entire point of the product.
2. **Withholding is already sufficient.** An outlier response simply is not paid.

Instead, accuracy is enforced by **reputation-weighted selection** (`ScoutReputation`):
consensus responders gain score, outliers lose it, and dispatch prefers high-scoring
responders. Sybil resistance comes from proof-of-personhood at registration (Self
Protocol), not from capital at risk. This is both more humane and a better fit for
ERC-8004's reputation registry.

## 5. Answers on-chain, cheaply

Response **hashes** go to storage; full response **text** goes into an event. Events are
far cheaper than string storage, and CeloScan renders them, so the full audit trail
(question, every answer, who got paid, confidence score) is publicly inspectable without
paying storage costs for arbitrary-length strings. On a sub-cent chain this makes "every
answer is on-chain" a true statement rather than a marketing one.

## 6. Isolating what we could not verify

The research window was closed when these contracts were written (network outage), so
every external dependency we could not read the spec for sits behind an interface we own:

| External thing | Our interface | Why |
|---|---|---|
| Self Protocol verification | `IHumanRegistry.isVerifiedHuman(address)` | Self's actual verifier API is unread. The adapter is a later, isolated change. |
| USDC EIP-3009 support | `IERC3009.receiveWithAuthorization(...)` | Must be checked against the deployed Celo USDC before we rely on the gasless path. `createBounty` (approve + transferFrom) works regardless. |
| x402 wire format | Router HTTP layer only | No contract depends on x402 field names. If the header schema differs from our memory, only the router changes. |

## 7. To verify before deploying (all currently UNVERIFIED)

- [ ] Celo Sepolia chain ID and RPC. Claimed: `11142220`, `https://forno.celo-sepolia.celo-testnet.org`. Confirm against Celo docs.
- [ ] Alfajores retirement status.
- [ ] USDC address on Celo Sepolia, and whether it implements EIP-3009.
- [ ] x402 exact-scheme payload and `X-PAYMENT` header schema, and whether a facilitator supports Celo.
- [ ] Self Protocol contract addresses and verification flow on Celo Sepolia.
- [ ] The actual Loops House judging rubric. Never read. Everything above infers it.
