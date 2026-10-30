import { type NextRequest } from 'next/server';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';

/**
 * POST /api/requester/ask - the requester agent (server-side x402 client).
 *
 * Body: { question: string }. Pays the router's 402 with the server-held
 * requester key, then returns the posted bounty. This is the A2A leg made
 * concrete: software paying software over HTTP, no wallet UX.
 *
 * Env: REQUESTER_PRIVATE_KEY (any funded key; defaults to the local dev key
 * on forks), ASK_URL (router endpoint, defaults to this app's /api/ask).
 */
export async function POST(request: NextRequest) {
  try {
    const { question } = (await request.json()) as { question?: string };
    if (!question?.trim()) {
      return Response.json({ error: 'Body must include { question }.' }, { status: 400 });
    }
    const key = process.env.REQUESTER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) {
      return Response.json(
        { error: 'REQUESTER_PRIVATE_KEY is not set. See .env.example.' },
        { status: 500 },
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      return Response.json(
        {
          error:
            'REQUESTER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key (66 chars, e.g. 0x...64 hex) taken from the env, not a bare key or a truncated value.',
        },
        { status: 500 },
      );
    }
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(key);
    const signer = {
      address: account.address,
      signTypedData: (typed: Parameters<typeof account.signTypedData>[0]) =>
        account.signTypedData(typed),
    };
    const client = new x402Client(signer as never);
    registerExactEvmScheme(client, { signer: signer as never });
    const askUrl = process.env.ASK_URL ?? `${request.nextUrl.origin}/api/ask`;
    const paidFetch = wrapFetchWithPayment(fetch, client);
    const res = await paidFetch(`${askUrl}?q=${encodeURIComponent(question.trim())}`, {
      method: 'GET',
    });
    const body = (await res.json()) as unknown;
    return Response.json(body, { status: res.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Requester failed.' },
      { status: 500 },
    );
  }
}
