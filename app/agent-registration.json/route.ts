import { getConfig } from '@/agents/router/config';

/** ERC-8004 Identity Registry per chain, from docs.celo.org/build-on-celo/build-with-ai/8004. */
const IDENTITY_REGISTRY: Record<number, string> = {
  42220: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  11142220: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
};

/**
 * GET /agent-registration.json - the ERC-8004 registration file.
 *
 * The on-chain identity's agentURI points here. Built from env so the file
 * and the deployment can never disagree about the endpoint or the wallet.
 * ERC8004_AGENT_ID is only known after register() is mined; once set,
 * `registrations` lets callers cross-check this file against the registry.
 */
export async function GET() {
  try {
    const appUrl = process.env.APP_URL?.replace(/\/+$/, '');
    if (!appUrl) {
      return Response.json({ error: 'APP_URL is not set.' }, { status: 500 });
    }
    const cfg = getConfig();
    const agentId = process.env.ERC8004_AGENT_ID;

    return Response.json({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Scout',
      description:
        'Ground truth for agents. An agent pays a $0.05 USDC bounty over x402, humans answer what it cannot see, and a verifier pays the answers that agree, on Celo.',
      image: `${appUrl}/scout-icon.svg`,
      services: [
        { name: 'web', endpoint: appUrl },
        { name: 'x402', endpoint: `${appUrl}/api/ask` },
        { name: 'wallet', endpoint: `eip155:${cfg.chainId}:${cfg.payTo}` },
      ],
      x402Support: true,
      active: true,
      supportedTrust: ['reputation'],
      ...(agentId
        ? {
            registrations: [
              {
                agentId: Number(agentId),
                agentRegistry: `eip155:${cfg.chainId}:${IDENTITY_REGISTRY[cfg.chainId]}`,
              },
            ],
          }
        : {}),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Registration file unavailable.' },
      { status: 500 },
    );
  }
}
