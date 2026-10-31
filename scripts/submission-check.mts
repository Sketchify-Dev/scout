/**
 * Read-only pre-submission gate for the Loops House entry.
 *
 * Checks everything that can be checked without spending gas or holding
 * secrets: the live router 402, the ERC-8004 registration file, the builder
 * tag on a bounty creation tx, and Sourcify status. Exits non-zero on the
 * first failure so it works as a CI gate and as the "are we submittable"
 * answer the night before the cutoff.
 *
 * Usage:
 *   node scripts/submission-check.mts [--app https://...] [--bounty 14]
 */
import { verifyTx } from '@celo/attribution-tags';

const argv = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

const APP = (flagValue('--app') ?? process.env.APP_URL ?? 'https://scout-black-gamma.vercel.app').replace(/\/+$/, '');
const BUILDER_TAG = process.env.BUILDER_TAG ?? 'celo_0107eaa60597';
const PAY_TO = (process.env.ROUTER_PAY_TO ?? '0xf6C95fE38eFbcBdf2Faffa4A21b256033CA84cD5').toLowerCase();
const ESCROW = process.env.SCOUT_ESCROW_ADDRESS ?? '0xfadc702a7c7da1bc1ca0c469c859ffdb5c71f0a6';
const REPUTATION = process.env.SCOUT_REPUTATION_ADDRESS ?? '0x29bb83558cd52dc1001dcf76706dccb42f92752f';

interface Terms {
  network?: string;
  payTo?: string;
  amount?: string;
  asset?: string;
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function get(path: string): Promise<Response> {
  return fetch(`${APP}${path}`, { signal: AbortSignal.timeout(90000) });
}

// 1. Live router 402 names the registered PayTo wallet on Celo Mainnet.
const ask = await get('/api/ask?q=pre-submission+check');
check('router answers 402', ask.status === 402, `HTTP ${ask.status}`);
let terms: Terms = {};
try {
  const parsed = JSON.parse(atob(ask.headers.get('payment-required') ?? '')) as { accepts?: Terms[] };
  terms = parsed.accepts?.[0] ?? {};
} catch {
  check('402 carries readable payment terms', false, 'unparseable PAYMENT-REQUIRED header');
}
check('402 network is Celo Mainnet', terms.network === 'eip155:42220', String(terms.network));
check('402 payTo is the registered router wallet', (terms.payTo ?? '').toLowerCase() === PAY_TO, String(terms.payTo));
check('402 charges the $0.05 bounty price', terms.amount === '50000', String(terms.amount));

// 2. ERC-8004 registration file is live and names the same wallet + agent id.
const regRes = await get('/agent-registration.json');
check('registration file is live', regRes.status === 200, `HTTP ${regRes.status}`);
if (regRes.status === 200) {
  const reg = (await regRes.json()) as {
    name?: string; services?: Array<{ name: string; endpoint: string }>;
    registrations?: Array<{ agentId: number; agentRegistry: string }>;
  };
  const walletEntry = reg.services?.find((s) => s.name === 'wallet')?.endpoint ?? '';
  check('registration names Scout', reg.name === 'Scout', String(reg.name));
  check('registration wallet matches PayTo', walletEntry.toLowerCase().endsWith(PAY_TO), walletEntry);
  check('registration lists the on-chain agent id', (reg.registrations?.length ?? 0) > 0,
    reg.registrations?.map((r) => `#${r.agentId}`).join(', ') ?? 'none');
}

// 3. Cron guard answers 401 without the secret (guard working, not open).
const cron = await get('/api/cron/auto-settle');
check('auto-settle refuses callers without CRON_SECRET', cron.status === 401, `HTTP ${cron.status}`);

// 4. A bounty creation tx carries the builder tag (proves the attribution path).
const bountyId = flagValue('--bounty') ?? '14';
const detailRes = await get(`/api/bounties/${bountyId}`);
if (detailRes.status !== 200) {
  check(`bounty ${bountyId} readable`, false, `HTTP ${detailRes.status}`);
} else {
  const detail = (await detailRes.json()) as { createdTx?: string };
  if (!detail.createdTx) {
    check(`bounty ${bountyId} has a creation tx`, false, 'missing createdTx');
  } else {
    const { createPublicClient, http } = await import('viem');
    const { celo } = await import('viem/chains');
    const pub = createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC_URL ?? 'https://forno.celo.org') });
    const decoded = await verifyTx({ client: pub, hash: detail.createdTx as `0x${string}` });
    check(`bounty ${bountyId} creation tx carries ${BUILDER_TAG}`,
      !!decoded && decoded.codes.includes(BUILDER_TAG),
      decoded ? decoded.codes.join(', ') : 'no attribution suffix');
  }
}

// 5. Sourcify: both contracts verified on Mainnet (judges read the source).
for (const [label, address] of [['ScoutEscrow', ESCROW], ['ScoutReputation', REPUTATION]] as const) {
  const res = await fetch(
    `https://sourcify.dev/server/v2/contract/42220/${address}`,
    { headers: { 'User-Agent': 'scout-submission-check/1.0' }, signal: AbortSignal.timeout(30000) },
  );
  check(`${label} source verified (Sourcify)`, res.status === 200, `HTTP ${res.status}`);
}

console.log(`\n${failures === 0 ? 'SUBMITTABLE: all checks passed.' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
