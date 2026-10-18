import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
} from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import { DEFAULT_USDC, type RouterConfig } from './config';

export interface VerifiedAskPayment {
  settle: () => Promise<{ mode: 'facilitator'; headers: Record<string, string> }>;
}

export type AskPaymentResult =
  | {
      status: 'unpaid';
      httpStatus: number;
      headers: Record<string, string>;
      body: unknown;
    }
  | { status: 'verified'; payment: VerifiedAskPayment }
  | { status: 'dev-bypass' };

let cachedServer: Promise<x402HTTPResourceServer> | null = null;
let cachedKey = '';

async function getHttpServer(cfg: RouterConfig): Promise<x402HTTPResourceServer> {
  // The x402 layer always charges the SDK default asset for the network, so a
  // custom USDC_ADDRESS would silently split the charged asset from the escrow
  // asset. Refuse that combination loudly instead of mischarging anyone.
  if (cfg.usdc.toLowerCase() !== DEFAULT_USDC[cfg.chainId].toLowerCase()) {
    throw new Error(
      'USDC_ADDRESS does not match the x402 default asset for this network. ' +
        'Remove the override or the requester would pay a different asset than the escrow settles.',
    );
  }
  const key = [cfg.chainId, cfg.payTo, cfg.defaultPriceUsdc, cfg.facilitatorUrl].join('|');
  if (!cachedServer || cachedKey !== key) {
    cachedKey = key;
    cachedServer = buildHttpServer(cfg);
  }
  return cachedServer;
}

async function buildHttpServer(cfg: RouterConfig): Promise<x402HTTPResourceServer> {
  const network = `eip155:${cfg.chainId}` as Network;
  // Celo's facilitator leaves /verify and /supported open but gates /settle
  // behind X-API-Key. The SDK takes auth via createAuthHeaders, keyed by
  // facilitator path. Without a key everything works until the first real
  // settlement, which fails 401.
  const apiKey = cfg.facilitatorApiKey;
  const facilitator = new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl ?? undefined,
    timeoutMs: 30_000,
    ...(apiKey
      ? {
          createAuthHeaders: () => {
            const headers = { 'X-API-Key': apiKey };
            return Promise.resolve({ verify: headers, settle: headers, supported: headers });
          },
        }
      : {}),
  });
  const server = new x402ResourceServer(facilitator);
  registerExactEvmScheme(server, { networks: [network] });
  const httpServer = new x402HTTPResourceServer(server, {
    'GET /api/ask': {
      accepts: [
        {
          scheme: 'exact',
          network,
          payTo: cfg.payTo,
          price: `$${cfg.defaultPriceUsdc}`,
          maxTimeoutSeconds: 300,
        },
      ],
      description:
        'Posts a $0.05 USDC bounty for humans to answer a question the requester agent cannot answer itself.',
      mimeType: 'application/json',
    },
  });
  // Fetches facilitator support and validates the route. Throws
  // RouteConfigurationError when the facilitator does not support this
  // scheme and network, which surfaces as a 500 telling the operator to set
  // X402_FACILITATOR_URL to a Celo-supporting facilitator.
  await httpServer.initialize();
  return httpServer;
}

function toAdapter(request: Request): HTTPAdapter {
  const url = new URL(request.url);
  return {
    getHeader: (name: string) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get('accept') ?? '',
    getUserAgent: () => request.headers.get('user-agent') ?? '',
  };
}

/**
 * Run the x402 payment gate for GET /api/ask.
 *
 * Production path uses the official SDK end to end: 402 body construction,
 * X-PAYMENT verification against the facilitator, and settlement. Dev path
 * (no facilitator configured plus ALLOW_DEV_BYPASS, Sepolia only) skips the
 * gate so the loop is testable without one.
 */
export async function processAskPayment(
  request: Request,
  cfg: RouterConfig,
): Promise<AskPaymentResult> {
  if (!cfg.facilitatorUrl && cfg.allowDevBypass) {
    return { status: 'dev-bypass' };
  }
  const httpServer = await getHttpServer(cfg);
  const url = new URL(request.url);
  const result = await httpServer.processHTTPRequest({
    adapter: toAdapter(request),
    path: url.pathname,
    method: request.method,
  });
  if (result.type === 'payment-error') {
    return {
      status: 'unpaid',
      httpStatus: result.response.status,
      headers: result.response.headers,
      body: result.response.body ?? { error: 'Payment required.' },
    };
  }
  if (result.type === 'no-payment-required') {
    throw new Error('x402 route is not enforcing payment. Check route registration.');
  }
  const { paymentPayload, paymentRequirements } = result;
  return {
    status: 'verified',
    payment: {
      settle: async () => {
        const settlement = await httpServer.processSettlement(paymentPayload, paymentRequirements);
        if (!settlement.success) {
          throw new Error(`x402 settlement failed: ${settlement.errorReason}`);
        }
        return { mode: 'facilitator' as const, headers: settlement.headers };
      },
    },
  };
}
