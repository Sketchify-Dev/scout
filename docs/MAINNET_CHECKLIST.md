# Scout: Mainnet Submission Checklist

Updated from a fresh read of the hackathon pages (Oct 15, 2026). Earlier version
of this file was based on the builder's notes; the corrections below come from
the live pages. Three of them change the build, marked with (*).

## The event

- Name: Agents on Open Rails Hackathon. Host: Celo Devs, platform: Loops House.
- Dates: Oct 6, 2026 to Nov 9, 2026. Entry cutoff: Mon Nov 9, 09:00 GMT.
  Winners announced Fri Nov 13.
- Prize pool: $5,000 total.
  - Stable Agents LatAm (Ripio x Celo Core Co): $1,500 first, $500 second.
    Agents that hold, bill, save, and settle directly in Ripio local-currency
    stables (wARS, wBRL, wMXN, wCOP, wPEN, wCLP) with no dollar detour.
  - Open Corridors, Textile FX: $750 first, $250 second. Quote plus settle FX.
  - Open Corridors, USDT with x402: $750 first, $250 second. Live user products
    settling USDT via x402.
  - Build with buy: $1,000 across 5 projects for apps paying outside services
    they do not run.
- One squad may enter many lanes but win at most one award per lane.
- Extra: 3 months Chainstack Growth free; Prezenti $165K grants consideration.

## Where Scout fits

Scout's natural lanes are USDT with x402 (the A2A service payment settles a
dollar stable over x402) and Build with buy (the app pays humans, an outside
service it does not run, per completed task). LatAm is a stretch option only if
bounties settle in a Ripio local stable. Decision: enter USDT with x402 as the
primary lane, buy as secondary.

## Rules that change the build

### (*) 1. Attribution is calldata, not a contract constant

The binding attribution is an ERC-8021 tag appended to the calldata of each
deal sent by the app frontend and bot backend, wired before the first countable
action. A tag added late is never credited retroactively. For x402 deals, the
entry's PayTo wallet address is supplied instead, because markers are not yet
supported there.

Consequence: `ScoutEscrow.BUILDER_TAG` (now `celo_0107eaa60597`) stays as a
CeloScan-visible backup, but the real work is integrating the attribution SDK
into the router backend and the frontend wallet client, and registering the
PayTo wallet at entry. That integration is now on the build list ahead of the
Mainnet deploy.

### (*) 2. ERC-8004 identity is required, not optional

Every lane requires the agent wallet to be added to the entry plus an ERC-8004
identity created from that wallet before the cutoff. So the Privy server wallet
that acts as Scout router must have its 8004 identity registered (visible on
8004scan) before Nov 9, 09:00 GMT. This moved from nice-to-have to gating.

### (*) 3. Counterparties must be genuinely separate wallets

The counterparty must not be the entrant, must not be first financed by the
entrant or main backer, and ideally shows Celo activity predating the event.
Newcomer onboarding is welcomed but tracked separately. For the demo this means:
requester agent wallet, router wallet, and human responder wallets are all
distinct; responders are funded by the escrow payout itself, not by a direct
top-up from us; and at least part of the demo uses pre-existing accounts. Two
wallets we spin up five minutes before the demo and pay each other will read as
self-dealing.

### Other scored points to design for

- Leaderboard runs on pre-published queries over chain data; a human panel then
  judges code plus usefulness. Both halves matter: clean tagged on-chain volume
  and a repo a reviewer can read.
- Gasless flows still qualify (signer and authorizer counting), but sponsored
  fuel is not counted as builder input. Our x402 gasless path is fine; the
  filing should say so explicitly.
- USDT lane scoring: authentic settlement between separate parties, with the
  coin choice explained by the person served. Our filing line: humans earn and
  spend in the dollar stable they already use in MiniPay.
- Buy lane scoring: meaning confirmed by compensated calls from the tagged
  wallet into outside services. Every bounty payout is exactly that.
- Spamming the cheapest call earns nothing. One real $0.05 payout to a distinct
  human beats a hundred wash loops.
- Repo must be open at sign-up and still open at review; work authored during
  the event window.

## Pre-submission checklist

- [ ] Enrolled via Enroll now; marker issued; marker wired into frontend wallet
      client and router backend before the first countable action.
- [x] ERC-8021 attribution via `@celo/attribution-tags`: `withAttribution`
      on the router's wallet client tags every router transaction. Our code
      `celo_0107eaa60597` is platform-assigned by Loops House, not derived
      from the repo slug, so ATTRIBUTION_REPO stays unset. Proven on-chain:
      `node scripts/verify-attribution.mts --bounty 14` decodes the creation
      tx `0x8bcae4ce...` to `celo_0107eaa60597` (schema 0) via the official
      SDK's `verifyTx`. `node scripts/submission-check.mts` re-proves this on
      every run.
- [ ] Full loop working on Celo Sepolia: requester agent -> router (x402) ->
      escrow bounty -> human responses -> verifier settle -> callback with
      confidence score and tx hash.
- [ ] Real funds bridged to Celo Mainnet (Chain ID 42220). Faucets do not count.
      Bridge $5 to $10 of real USDC/USDT via an official route.
- [x] Contracts deployed to Celo Mainnet (block 80216773), verifier and owner
      set to the Privy agent wallet `0xf6C95fE38eFbcBdf2Faffa4A21b256033CA84cD5`:
      `ScoutEscrow` `0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6` (tag `celo_0107eaa60597`),
      `ScoutReputation` `0x29bb83558cd52dc1001dcf76706dccb42f92752f`.
      Full record in `deployments/42220.json`.
- [x] Source verification confirmed: both contracts `exact_match` on Sourcify
      (checked 2026-10-31 via `GET /v2/contract/42220/<address>` for both
      addresses below; re-check with
      `node scripts/submission-check.mts`, which asserts this live).
- [ ] ERC-8004 identity created from the agent wallet before the cutoff.
- [ ] PayTo wallet registered for x402 deals.
- [ ] At least one full real bounty loop on Mainnet with real stable: create,
      respond, settle, callback. At least one Mainnet tx hash in demo and filing.
- [ ] Counterparty wallets distinct and not first-financed by us; demo script
      names who each wallet belongs to.
- [ ] Filing mentions the gasless design (x402 authorizations, fee abstraction
      for responders) so the signer/authorizer activity is read correctly.
- [ ] Submitted via Loops.house with Mainnet addresses, live agent URL, demo,
      and pitch before Nov 9, 09:00 GMT.

## Networks

| Network              | Chain ID | Use                       |
|----------------------|----------|---------------------------|
| Celo Mainnet         | 42220    | Final deploy + submission |
| Celo Sepolia         | 11142220 | Build + test (unverified) |
| Alfajores / Baklava  | retired  | Do not deploy             |

## Sources

- Main hub: https://www.loops.house/agents-on-open-rails
- Ideation playground: https://www.loops.house/agents-on-open-rails/playground/ideate
- Attribution tags: https://github.com/celo-org/attribution-tags/blob/main/BUILDERS.md
- Bridges: https://docs.celo.org/build/tools/bridges/bridges
- ERC-8004: https://docs.celo.org/build-on-celo/build-with-ai/8004
